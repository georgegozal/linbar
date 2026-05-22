const { execFile } = require("node:child_process");
const DEBUG_TASKS = process.env.LINBAR_DEBUG_TASKS === "1";

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

/**
 * Run AppleScript and return trimmed stdout.
 * @param {string} source
 * @returns {Promise<string>}
 */
function runOsascript(source) {
  const startedAt = nowMs();
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", source], { encoding: "utf8" }, (err, stdout, stderr) => {
      if (DEBUG_TASKS) {
        const firstLine = String(source).trim().split(/\r?\n/, 1)[0] || "script";
        console.log("[LinBar] osascript", firstLine.slice(0, 48), "ms=" + (nowMs() - startedAt).toFixed(1));
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
  });
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

function buildSkipProcsAppleScriptSet() {
  const parts = APP_SCRIPTING_SKIP.map((n) => `"${appleScriptStringLiteral(n)}"`);
  return `{${parts.join(", ")}}`;
}

async function listSystemEventsWindows() {
  const skipSet = buildSkipProcsAppleScriptSet();
  const script = `
tell application "System Events"
	set skipProcs to ${skipSet}
	set procList to every application process
	set taskText to ""
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
  const out = await runOsascript(script);
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

/** @returns {Promise<Set<string>>} */
async function getRunningApplicationProcessNames() {
  const script = `
tell application "System Events"
	set procList to every application process
	set nmArr to {}
	repeat with idx from 1 to (count of procList)
		try
			set axProc to item idx of procList
			set procNm to name of axProc as text
			set end of nmArr to procNm
		end try
	end repeat
	set AppleScript's text item delimiters to linefeed
	return nmArr as text
end tell`;
  const out = await runOsascript(script);
  return new Set(
    out
      .split(/\r\n|\n|\r/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

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
    running = await getRunningApplicationProcessNames();
  } catch (err) {
    console.warn("[LinBar] running-app snapshot failed:", err.message);
  }

  /** If snapshot failed or came back empty, probe Terminal + all known browsers (each call is wrapped in safeList). */
  const probeAll = running.size === 0;
  const want = (processName) => probeAll || running.has(processName);

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
    listSystemEventsWindows(),
    want("Terminal") ? safeList(() => listTerminalAppWindows()) : Promise.resolve([]),
    ...browserQueries,
    iTerm2Job,
    iTermJob,
  ]);
  return chunks.flat();
}

/**
 * @param {string[]} excludeProcessNames Case-insensitive process names to omit
 * @returns {Promise<WindowTask[]>}
 */
async function listWindowTasks(excludeProcessNames) {
  const all = await listWindowTasksMerged();
  const ex = new Set(excludeProcessNames.map((n) => String(n).toLowerCase()));
  return all.filter((t) => !ex.has(t.process.toLowerCase()));
}

function elapsedMs(startedAt) {
  return Number((nowMs() - startedAt).toFixed(1));
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
    tasks = await listWindowTasks(excludeProcessNames);
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

async function getFrontmostProcessName() {
  const script = `
tell application "System Events"
	set procList to every application process
	repeat with idx from 1 to (count of procList)
		set proc to item idx of procList
		try
			if (frontmost of proc) is true then return name of proc as text
		end try
	end repeat
end tell
return ""`;
  return runOsascript(script);
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
	set procList to every application process
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
  const line = await runOsascript(script);
  const tasks = parseTaskLines(line);
  return tasks[0] || null;
}

/**
 * @returns {Promise<WindowTask|null>}
 */
async function getFrontmostWindowTask() {
  let proc = "";
  try {
    proc = await getFrontmostProcessName();
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
  toggleOutputMuted,
  getVolumeState,
  getClipboardText,
  APP_SCRIPTING_SKIP,
  parseTaskLines,
  taskKeyFor,
};
