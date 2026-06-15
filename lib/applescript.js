const { execFile } = require("node:child_process");
const { getVisibleAppNames, getFrontmostAppName } = require("./lsappinfo");
const DEBUG_TASKS = process.env.LINBAR_DEBUG_TASKS === "1";
const CURRENT_SPACE_ONLY = process.env.LINBAR_CURRENT_SPACE_ONLY === "1";
const TASK_LIST_CACHE_MS = Math.max(0, Number(process.env.LINBAR_TASK_CACHE_MS || 3500));
const OSASCRIPT_TIMEOUT_MS = Math.max(1000, Number(process.env.LINBAR_OSASCRIPT_TIMEOUT_MS || 10000));

/** System Events serializes poorly when hit concurrently; queue those scripts. */
let systemEventsChain = Promise.resolve();

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

/**
 * Run AppleScript and return trimmed stdout.
 * @param {string} source
 * @param {{ label?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
function runOsascript(source, opts = {}) {
  const startedAt = nowMs();
  const timeoutMs = opts.timeoutMs ?? OSASCRIPT_TIMEOUT_MS;
  const label = opts.label || String(source).trim().split(/\r?\n/, 1)[0] || "script";
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/osascript", ["-e", source], { encoding: "utf8" }, (err, stdout, stderr) => {
      clearTimeout(timer);
      if (DEBUG_TASKS) {
        console.log("[LinBar] osascript", label.slice(0, 48), "ms=" + (nowMs() - startedAt).toFixed(1));
      }
      if (err) {
        const stderrStr = stderr ? String(stderr).trim() : "";
        const detail = [stderrStr, err.message && err.message !== "Command failed" ? err.message : ""]
          .filter(Boolean)
          .join(" — ");
        const hint = detail || "osascript exited with an error (check Automation / Accessibility for System Events)";
        const e = new Error(hint);
        e.cause = err;
        return reject(e);
      }
      resolve(String(stdout).trim());
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`osascript timed out after ${timeoutMs}ms (${label.slice(0, 48)})`));
    }, timeoutMs);
  });
}

/**
 * @param {string} source
 * @param {{ label?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<string>}
 */
function runSystemEventsScript(source, opts = {}) {
  const run = () => runOsascript(source, { label: opts.label || "System Events", timeoutMs: opts.timeoutMs });
  const job = systemEventsChain.then(run, run);
  systemEventsChain = job.catch(() => {});
  return job;
}

function appleScriptStringLiteral(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Apps where System Events lists **tabs** as separate "windows". We use each app's own
 * AppleScript so we get **one row per OS window** (tabs stay inside).
 * Names must match `name of application process` from System Events.
 */
const APP_SCRIPTING_SKIP = [
  "Terminal",
  "iTerm2",
  "iTerm",
  "Brave Browser",
  "Google Chrome",
  "Chromium",
  "Microsoft Edge",
  "Opera",
  "Vivaldi",
  "Arc",
  "Safari",
  "Cursor",
];

/** @type {Set<string>} */
const BROWSER_STYLE_APPS = new Set([
  "Brave Browser",
  "Google Chrome",
  "Chromium",
  "Microsoft Edge",
  "Opera",
  "Vivaldi",
  "Arc",
  "Safari",
  "Cursor",
  "iTerm2",
  "iTerm",
]);

/**
 * @typedef {{ process: string, kind: 'system' | 'terminal' | 'browser', ref: number, title: string, key: string }} WindowTask
 */

function taskKeyFor(process, kind, ref) {
  return String(process) + "::" + String(kind) + "::" + String(ref);
}

/**
 * @param {{ process: string, kind: 'system' | 'terminal' | 'browser', ref: number, title?: string }} task
 * @returns {WindowTask}
 */
function normalizeTask(task) {
  const process = String(task.process || "");
  const kind = task.kind;
  const ref = Math.floor(Number(task.ref));
  return {
    process,
    kind,
    ref,
    title: typeof task.title === "string" ? task.title : process,
    key: taskKeyFor(process, kind, ref),
  };
}

/**
 * Lines: process TAB kindLetter TAB ref TAB title
 * kindLetter: s=system (SE index), t=terminal (window id), b=browser (window index)
 * @param {string} blob
 * @returns {WindowTask[]}
 */
function parseTaskLines(blob) {
  /** @type {WindowTask[]} */
  const tasks = [];
  if (!blob) return tasks;
  const lines = blob.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const a = line.indexOf("\t");
    if (a === -1) continue;
    const b = line.indexOf("\t", a + 1);
    if (b === -1) continue;
    const c = line.indexOf("\t", b + 1);
    if (c === -1) continue;
    const process = line.slice(0, a);
    const kindL = line.slice(a + 1, b);
    const ref = parseInt(line.slice(b + 1, c), 10);
    const title = line.slice(c + 1);
    if (!process) continue;
    /** @type {WindowTask["kind"] | null} */
    let kind = null;
    if (kindL === "s") kind = "system";
    else if (kindL === "t") kind = "terminal";
    else if (kindL === "b") kind = "browser";
    if (!kind || !Number.isFinite(ref)) continue;
    if (kind === "system" && ref < 1) continue;
    if (kind === "browser" && ref < 1) continue;
    if (kind === "terminal" && ref < 1) continue;
    tasks.push(normalizeTask({ process, kind, ref, title }));
  }
  return tasks;
}

function buildAppleScriptStringSet(items) {
  const parts = items.map((n) => `"${appleScriptStringLiteral(n)}"`);
  return `{${parts.join(", ")}}`;
}

async function listSystemEventsWindows(skipList = APP_SCRIPTING_SKIP) {
  const skipSet = buildAppleScriptStringSet(skipList);
  const visibilityCheck = CURRENT_SPACE_ONLY
    ? "if (visible of window i) is false then error number -128"
    : "";
  const script = `
tell application "System Events"
	set skipProcs to ${skipSet}
	set taskText to ""
	set procList to every application process whose background only is false
	repeat with idx from 1 to (count of procList)
		set proc to item idx of procList
		try
			tell proc
				set pn to name as text
			end tell
			if skipProcs contains pn then
			else
				tell proc
					set wc to count of windows
					if wc > 0 then
						repeat with i from 1 to wc
							try
								${visibilityCheck}
								set wn to name of window i as text
								if wn is "" then set wn to "Window " & i
								set taskText to taskText & pn & tab & "s" & tab & i & tab & wn & return
							end try
						end repeat
					end if
				end tell
			end if
		end try
	end repeat
	return taskText
end tell`;
  const out = await runSystemEventsScript(script, { label: "SE window list" });
  return parseTaskLines(out);
}

async function listTerminalAppWindows() {
  const script = `
tell application "Terminal"
	set taskText to ""
	repeat with w in windows
		try
			set wid to id of w
			set wn to name of w as text
			if wn is "" then set wn to "Terminal"
			set taskText to taskText & "Terminal" & tab & "t" & tab & wid & tab & wn & return
		end try
	end repeat
	return taskText
end tell`;
  const out = await runOsascript(script);
  return parseTaskLines(out);
}

async function listBrowserAppWindows(appName) {
  const q = appleScriptStringLiteral(appName);
  const script = `
tell application "${q}"
	set taskText to ""
	repeat with i from 1 to (count of windows)
		try
			set w to window i
			set wn to ""
			try
				set wn to title of w as text
			end try
			if wn is "" then try
				set wn to name of w as text
			end try
			if wn is "" then set wn to "${q}"
			set taskText to taskText & "${q}" & tab & "b" & tab & i & tab & wn & return
		end try
	end repeat
	return taskText
end tell`;
  const out = await runOsascript(script);
  return parseTaskLines(out);
}

const BROWSER_APP_NAMES = [
  "Brave Browser",
  "Google Chrome",
  "Chromium",
  "Microsoft Edge",
  "Opera",
  "Vivaldi",
  "Arc",
  "Safari",
  "Cursor",
];
let lastGoodSnapshot = { tasks: [], front: null, at: 0 };
let lastTaskListCache = { tasks: [], at: 0 };

async function safeList(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function listWindowTasksMerged() {
  let running = /** @type {Set<string>} */ (new Set());
  try {
    running = new Set(await getVisibleAppNames());
  } catch (err) {
    console.warn("[LinBar] running-app snapshot failed:", err.message);
  }

  /** If snapshot failed or came back empty, probe Terminal + all known browsers (each call is wrapped in safeList). */
  const probeAll = running.size === 0;
  const want = (processName) => probeAll || running.has(processName);

  // Try Terminal native scripting first. If it returns nothing (e.g. Automation permission
  // for Terminal wasn't granted), fall back by letting System Events pick up Terminal windows.
  const terminalTasks = want("Terminal") ? await safeList(() => listTerminalAppWindows()) : [];
  const seSkipList = terminalTasks.length > 0
    ? APP_SCRIPTING_SKIP
    : APP_SCRIPTING_SKIP.filter((n) => n !== "Terminal");

  const browserQueries = BROWSER_APP_NAMES.filter(want).map((app) =>
    safeList(() => listBrowserAppWindows(app)),
  );

  const iTerm2Job =
    probeAll || running.has("iTerm2")
      ? safeList(() => listBrowserAppWindows("iTerm2"))
      : Promise.resolve([]);
  const iTermJob =
    probeAll || (running.has("iTerm") && !running.has("iTerm2"))
      ? safeList(() => listBrowserAppWindows("iTerm"))
      : Promise.resolve([]);

  const chunks = await Promise.all([
    listSystemEventsWindows(seSkipList),
    ...browserQueries,
    iTerm2Job,
    iTermJob,
  ]);
  return [...chunks.flat(), ...terminalTasks];
}

/**
 * @param {string[]} excludeProcessNames Case-insensitive process names to omit
 * @returns {Promise<WindowTask[]>}
 */
async function listWindowTasks(excludeProcessNames) {
  const all = await listWindowTasksMerged();
  const ex = new Set(excludeProcessNames.map((n) => String(n).toLowerCase()));
  return all.filter((t) => !ex.has(t.process.toLowerCase()) && !isLikelyHelperProcess(t.process));
}

/**
 * @param {string[]} excludeProcessNames
 * @returns {Promise<WindowTask[]>}
 */
async function listWindowTasksCached(excludeProcessNames) {
  const now = Date.now();
  if (now - lastTaskListCache.at < TASK_LIST_CACHE_MS) {
    return lastTaskListCache.tasks;
  }
  const fresh = await listWindowTasks(excludeProcessNames);
  lastTaskListCache = { tasks: fresh, at: now };
  return fresh;
}

function elapsedMs(startedAt) {
  return Number((nowMs() - startedAt).toFixed(1));
}

function isLikelyHelperProcess(processName) {
  const n = String(processName || "").toLowerCase();
  if (!n) return true;
  // Note: don't filter on a bare "." — real apps embed dots in their display name
  // (e.g. "zoom.us"). System Events already excludes background-only processes.
  return (
    n.includes("notificationcenter") ||
    n.includes("window server") ||
    n.endsWith(" helper") ||
    n.endsWith(".app")
  );
}

/**
 * Consolidated snapshot endpoint with stale fallback data for transient failures.
 * @param {string[]} excludeProcessNames
 * @returns {Promise<{ tasks: WindowTask[], front: WindowTask | null, error: string | null, meta: { timings: Record<string, number>, stale: boolean, at: number } }>}
 */
async function listTaskSnapshot(excludeProcessNames) {
  const timings = {};
  const startedTasksAt = nowMs();
  let tasks = [];
  let tasksError = null;
  try {
    tasks = await listWindowTasksCached(excludeProcessNames);
  } catch (err) {
    tasksError = String(err && err.message ? err.message : err);
    tasks = lastGoodSnapshot.tasks || [];
  } finally {
    timings.listWindowTasks = elapsedMs(startedTasksAt);
  }

  const startedFrontAt = nowMs();
  let front = null;
  let frontError = null;
  try {
    front = await getFrontmostWindowTask();
  } catch (err) {
    frontError = String(err && err.message ? err.message : err);
    front = lastGoodSnapshot.front || null;
  } finally {
    timings.getFrontmostWindowTask = elapsedMs(startedFrontAt);
  }

  const stale = Boolean(tasksError || frontError);
  tasks = tasks.map(normalizeTask);
  front = front ? normalizeTask(front) : null;
  if (!stale) {
    lastGoodSnapshot = { tasks, front, at: Date.now() };
  }

  return {
    tasks,
    front,
    error: [tasksError, frontError].filter(Boolean).join(" | ") || null,
    meta: {
      timings,
      stale,
      at: Date.now(),
    },
  };
}

async function getFrontTerminalTask() {
  const s = `
tell application "Terminal"
	tell front window
		return "Terminal" & tab & "t" & tab & (id as text) & tab & (name as text)
	end tell
end tell`;
  const line = await runOsascript(s);
  const tasks = parseTaskLines(line);
  return tasks[0] || null;
}

async function getFrontBrowserTask(appName) {
  const q = appleScriptStringLiteral(appName);
  const script = `
tell application "${q}"
	tell front window
		set wi to index
		set wn to ""
		try
			set wn to title as text
		end try
		if wn is "" then set wn to name as text
		return "${q}" & tab & "b" & tab & wi & tab & wn
	end tell
end tell`;
  const line = await runOsascript(script);
  const tasks = parseTaskLines(line);
  return tasks[0] || null;
}

async function getSystemEventsFrontWindowTask() {
  const script = `
tell application "System Events"
	set procList to every application process whose background only is false
	repeat with idx from 1 to (count of procList)
		set proc to item idx of procList
		try
			if (frontmost of proc) is true then
				tell proc
					set pn to name as text
					set wc to count of windows
					if wc is 0 then return pn & tab & "s" & tab & "0" & tab & ""
					set wi to 1
					repeat with i from 1 to wc
						try
							if (focused of window i) is true then
								set wi to i
								exit repeat
							end if
						end try
					end repeat
					set wn to ""
					try
						set wn to name of window wi as text
					end try
					if wn is "" then set wn to "Window " & wi
					return pn & tab & "s" & tab & wi & tab & wn
				end tell
			end if
		end try
	end repeat
end tell
return tab & "s" & tab & "0" & tab`;
  const line = await runSystemEventsScript(script, { label: "SE front window" });
  const tasks = parseTaskLines(line);
  return tasks[0] || null;
}

/**
 * @returns {Promise<WindowTask|null>}
 */
async function getFrontmostWindowTask() {
  let proc = "";
  try {
    proc = await getFrontmostAppName();
  } catch {
    return null;
  }
  if (!proc) return null;
  try {
    if (proc === "Terminal") {
      const t = await getFrontTerminalTask();
      if (t) return t;
    }
    if (BROWSER_STYLE_APPS.has(proc)) {
      const t = await getFrontBrowserTask(proc);
      if (t) return t;
    }
  } catch {
    /* fall through */
  }
  try {
    return await getSystemEventsFrontWindowTask();
  } catch {
    return null;
  }
}

async function activateTerminalById(windowId) {
  const wid = Math.floor(Number(windowId));
  if (!Number.isFinite(wid)) throw new Error("Invalid Terminal window id");
  await runOsascript(`
tell application "Terminal"
	activate
	repeat with w in windows
		if id of w is ${wid} then
			set frontmost of w to true
			exit repeat
		end if
	end repeat
end tell`);
}

async function activateBrowserWindow(appName, windowIndex) {
  const q = appleScriptStringLiteral(appName);
  const i = Math.floor(Number(windowIndex));
  if (!Number.isFinite(i) || i < 1) throw new Error("Invalid window index");
  if (appName === "iTerm2" || appName === "iTerm") {
    await runOsascript(`
tell application "${q}"
	activate
	select window ${i}
end tell`);
    return;
  }
  await runOsascript(`
tell application "${q}"
	activate
	set index of window ${i} to 1
end tell`);
}

async function activateSystemWindow(processName, windowIndex) {
  const proc = appleScriptStringLiteral(processName);
  const idx = Math.floor(Number(windowIndex));
  if (!Number.isFinite(idx) || idx < 1) throw new Error("Invalid window index");
  await runOsascript(`
tell application "System Events"
	tell application process "${proc}"
		set frontmost to true
		try
			perform action "AXRaise" of window ${idx}
		on error
			set frontmost to true
		end try
	end tell
end tell`);
}

/**
 * @param {WindowTask} task
 * @returns {Promise<void>}
 */
async function activateWindowTaskOnce(task) {
  if (task.kind === "terminal") {
    await activateTerminalById(task.ref);
    return;
  }
  if (task.kind === "browser") {
    await activateBrowserWindow(task.process, task.ref);
    return;
  }
  await activateSystemWindow(task.process, task.ref);
}

/**
 * @param {WindowTask} task
 * @returns {Promise<void>}
 */
async function activateWindowTask(task) {
  const normalized = normalizeTask(task);
  try {
    await activateWindowTaskOnce(normalized);
  } catch (firstErr) {
    if (normalized.kind === "terminal") throw firstErr;
    try {
      await activateApp(normalized.process);
      await activateWindowTaskOnce(normalized);
      return;
    } catch {
      throw firstErr;
    }
  }
}

async function activateApp(appName) {
  const q = appleScriptStringLiteral(appName);
  await runOsascript(`tell application "${q}" to activate`);
}

async function getAppBundlePath(processName) {
  const q = appleScriptStringLiteral(processName);
  const script = `tell application "System Events"
    try
      set p to file of application process "${q}"
      return POSIX path of p
    on error
      return ""
    end try
  end tell`;
  return runOsascript(script);
}

async function minimizeWindowTask(task) {
  const ref = Math.floor(Number(task.ref));
  if (task.kind === "terminal") {
    await runOsascript(`tell application "Terminal" to set miniaturized of (first window whose id is ${ref}) to true`);
    return;
  }
  if (task.kind === "browser") {
    const q = appleScriptStringLiteral(task.process);
    await runOsascript(`tell application "${q}" to set miniaturized of window ${ref} to true`);
    return;
  }
  const proc = appleScriptStringLiteral(task.process);
  await runOsascript(`
tell application "System Events"
  tell application process "${proc}"
    perform action "AXMinimize" of window ${ref}
  end tell
end tell`);
}

async function closeWindowTask(task) {
  const ref = Math.floor(Number(task.ref));
  if (task.kind === "terminal") {
    await runOsascript(`tell application "Terminal" to close (first window whose id is ${ref})`);
    return;
  }
  if (task.kind === "browser") {
    const q = appleScriptStringLiteral(task.process);
    await runOsascript(`tell application "${q}" to close window ${ref}`);
    return;
  }
  const proc = appleScriptStringLiteral(task.process);
  await runOsascript(`
tell application "System Events"
  tell application process "${proc}"
    close window ${ref}
  end tell
end tell`);
}

async function openApp(appName) {
  const q = appleScriptStringLiteral(appName);
  await runOsascript(`tell application "${q}" to activate`);
}

async function toggleOutputMuted() {
  const script = `
set s to get volume settings
if output muted of s then
  set volume with output unmuted
else
  set volume with output muted
end if`;
  await runOsascript(script);
}

async function setOutputVolume(level) {
  const n = Math.max(0, Math.min(100, Math.round(Number(level) || 0)));
  await runOsascript(`set volume output volume ${n}`);
}

async function getVolumeState() {
  const script = `
set s to get volume settings
return (output muted of s as text) & tab & (output volume of s as text)`;
  const line = await runOsascript(script);
  const [mut, lev] = line.split("\t");
  return { muted: mut === "true", level: Number(lev) || 0 };
}

async function getClipboardText() {
  return runOsascript("return the clipboard as text");
}

module.exports = {
  runOsascript,
  listWindowTasks,
  getFrontmostWindowTask,
  listTaskSnapshot,
  activateWindowTask,
  activateApp,
  openApp,
  getAppBundlePath,
  minimizeWindowTask,
  closeWindowTask,
  toggleOutputMuted,
  getVolumeState,
  setOutputVolume,
  getClipboardText,
  APP_SCRIPTING_SKIP,
  parseTaskLines,
  taskKeyFor,
};
