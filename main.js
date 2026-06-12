const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require("electron");
const path = require("node:path");
const {
  listTaskSnapshot,
  getFrontmostWindowTask,
  activateWindowTask,
  openApp,
  getAppBundlePath,
  minimizeWindowTask,
  closeWindowTask,
  toggleOutputMuted,
  getVolumeState,
  setOutputVolume,
  getClipboardText,
} = require("./lib/applescript");
const { getFrontmostAppName } = require("./lib/lsappinfo");
const { startNativeTracker } = require("./lib/helper");
const { loadConfig, saveConfig } = require("./lib/config");

const PANEL_HEIGHT = 48;
const DEBUG_TASKS = process.env.LINBAR_DEBUG_TASKS === "1";
const FORCE_APPLESCRIPT = process.env.LINBAR_FORCE_APPLESCRIPT === "1";
const TASK_REFRESH_ACTIVE_MS = 1600;
const TASK_REFRESH_IDLE_MS = 4000;
const TASK_ACTIVE_WINDOW_MS = 8000;
const FRONT_POLL_MS = 700;

let mainWindow = null;
let taskRefreshTimer = null;
let taskRefreshInFlight = false;
let lastInteractionAt = 0;
let lastTaskPayload = null;
let lastTaskSnapshot = "";
let frontPollInFlight = false;
let lastFrontAppName = "";

let nativeTracker = null;
let nativeMode = false;
let fallbackStarted = false;
/** Stable XFCE-style button order: each window keeps its slot for its lifetime. */
const taskOrderByKey = new Map();
let taskOrderSeq = 0;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function getTaskRefreshDelay() {
  return Date.now() - lastInteractionAt < TASK_ACTIVE_WINDOW_MS
    ? TASK_REFRESH_ACTIVE_MS
    : TASK_REFRESH_IDLE_MS;
}

function scheduleTaskRefresh(delayMs = getTaskRefreshDelay()) {
  if (taskRefreshTimer) clearTimeout(taskRefreshTimer);
  taskRefreshTimer = setTimeout(() => {
    taskRefreshTimer = null;
    void runTaskRefresh("scheduler");
  }, Math.max(0, Math.floor(delayMs)));
}

function markTaskInteraction() {
  lastInteractionAt = Date.now();
}

async function buildTaskPayload(reason) {
  const startedAt = nowMs();
  const snapshot = await listTaskSnapshot(ownProcessNamesToExclude());
  return {
    tasks: snapshot.tasks,
    front: snapshot.front,
    error: snapshot.error,
    meta: {
      reason,
      at: Date.now(),
      durationMs: Number((nowMs() - startedAt).toFixed(1)),
      stale: snapshot.meta.stale,
      timings: snapshot.meta.timings,
    },
  };
}

function emitTaskPayload(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("taskbar:tasksUpdated", payload);
}

async function runTaskRefresh(reason) {
  if (taskRefreshInFlight) return;
  taskRefreshInFlight = true;
  try {
    const payload = await buildTaskPayload(reason);
    const snap = JSON.stringify({ tasks: payload.tasks, front: payload.front, error: payload.error });
    const changed = snap !== lastTaskSnapshot;
    lastTaskSnapshot = snap;
    lastTaskPayload = payload;
    if (changed || DEBUG_TASKS) emitTaskPayload(payload);
    if (DEBUG_TASKS) {
      console.log(
        "[LinBar] refresh",
        "reason=" + reason,
        "changed=" + String(changed),
        "tasks=" + payload.tasks.length,
        "ms=" + payload.meta.durationMs,
        "stale=" + String(Boolean(payload.meta.stale)),
        "parts=" + JSON.stringify(payload.meta.timings || {}),
      );
    }
  } finally {
    taskRefreshInFlight = false;
    scheduleTaskRefresh();
  }
}

/**
 * Cheap focus tracker: lsappinfo tells us the frontmost app in ~20ms. Only when it
 * changes do we resolve the exact frontmost window (1 osascript) and re-emit, so the
 * active highlight follows Cmd+Tab without waiting for a full window scan.
 */
async function pollFrontmost() {
  if (frontPollInFlight || !lastTaskPayload) return;
  frontPollInFlight = true;
  try {
    const appName = await getFrontmostAppName();
    if (!appName || appName === lastFrontAppName) return;
    lastFrontAppName = appName;
    const front = await getFrontmostWindowTask();
    if (!front || !lastTaskPayload) return;
    const prev = lastTaskPayload.front;
    if (prev && prev.key === front.key) return;
    lastTaskPayload = { ...lastTaskPayload, front };
    lastTaskSnapshot = JSON.stringify({
      tasks: lastTaskPayload.tasks,
      front: lastTaskPayload.front,
      error: lastTaskPayload.error,
    });
    emitTaskPayload(lastTaskPayload);
    if (DEBUG_TASKS) console.log("[LinBar] front changed ->", front.key);
  } catch {
    /* transient; next tick will retry */
  } finally {
    frontPollInFlight = false;
  }
}

function ownProcessNamesToExclude() {
  /** Dev: System Events name is usually "Electron". Packaged: productName e.g. "LinBar". */
  const names = [app.getName(), "Electron", "LinBar", "linbar", "XFCE Taskbar", "xfce-taskbar-app"];
  return [...new Set(names.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Native (Swift helper) backend — event-driven, preferred.
// ---------------------------------------------------------------------------

/** appName -> bundle path, learned from native snapshots; lets icon lookup skip AppleScript. */
const bundlePathByApp = new Map();

function handleNativeSnapshot(snap) {
  const exclude = new Set(ownProcessNamesToExclude().map((n) => n.toLowerCase()));
  const tasks = [];
  let front = null;

  for (const w of snap.windows || []) {
    if (w.pid === process.pid) continue;
    if (exclude.has(String(w.app).toLowerCase())) continue;
    if (w.bundlePath) bundlePathByApp.set(w.app, w.bundlePath);
    const key = `${w.app}::native::${w.id}`;
    if (!taskOrderByKey.has(key)) taskOrderByKey.set(key, taskOrderSeq++);
    const task = {
      process: w.app,
      kind: "native",
      ref: w.id,
      pid: w.pid,
      title: w.title || w.app,
      minimized: Boolean(w.minimized),
      key,
    };
    tasks.push(task);
    if (w.focused) front = task;
  }

  tasks.sort((a, b) => taskOrderByKey.get(a.key) - taskOrderByKey.get(b.key));
  const liveKeys = new Set(tasks.map((t) => t.key));
  for (const key of taskOrderByKey.keys()) {
    if (!liveKeys.has(key)) taskOrderByKey.delete(key);
  }

  const payload = {
    tasks,
    front,
    error: null,
    meta: { reason: snap.reason, at: Date.now(), native: true },
  };
  const snapStr = JSON.stringify({ tasks, front });
  const changed = snapStr !== lastTaskSnapshot;
  lastTaskSnapshot = snapStr;
  lastTaskPayload = payload;
  if (changed) emitTaskPayload(payload);
  if (DEBUG_TASKS) {
    console.log("[LinBar] native snapshot", "reason=" + snap.reason, "tasks=" + tasks.length, "changed=" + changed);
  }
}

function startBackend() {
  if (!FORCE_APPLESCRIPT) {
    nativeTracker = startNativeTracker({
      onSnapshot: handleNativeSnapshot,
      onStatus: (s) => {
        if (s.trusted) {
          nativeMode = true;
          console.log("[LinBar] native helper active (event-driven backend)");
        } else {
          console.warn(
            "[LinBar] Accessibility permission missing — grant it in System Settings → Privacy & Security → Accessibility, then restart LinBar. Using AppleScript fallback.",
          );
          const t = nativeTracker;
          nativeTracker = null;
          if (t) t.kill();
          startAppleScriptScheduler();
        }
      },
      onExit: () => {
        if (nativeMode) console.warn("[LinBar] native helper exited; using AppleScript fallback");
        nativeTracker = null;
        nativeMode = false;
        startAppleScriptScheduler();
      },
    });
  }
  if (!nativeTracker) startAppleScriptScheduler();
}

// ---------------------------------------------------------------------------
// AppleScript backend — fallback when the helper is unavailable.
// ---------------------------------------------------------------------------

function startAppleScriptScheduler() {
  if (fallbackStarted) return;
  fallbackStarted = true;
  markTaskInteraction();
  scheduleTaskRefresh(0);
  setInterval(() => void pollFrontmost(), FRONT_POLL_MS);
}

function panelBoundsForDisplay(display) {
  const { x, y, width, height } = display.bounds;
  return {
    x,
    y: y + height - PANEL_HEIGHT,
    width,
    height: PANEL_HEIGHT,
  };
}

function positionPanelWindow(win) {
  const display = screen.getDisplayNearestPoint(win.getBounds());
  const b = panelBoundsForDisplay(display);
  win.setBounds(b);
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const b = panelBoundsForDisplay(primary);

  mainWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === "darwin") {
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  screen.on("display-metrics-changed", () => {
    if (mainWindow && !mainWindow.isDestroyed()) positionPanelWindow(mainWindow);
  });
}

function setMacMenu() {
  if (process.platform !== "darwin") return;
  const template = [
    {
      label: app.name,
      submenu: [{ role: "quit" }],
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { type: "separator" }, { role: "togglefullscreen" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("tasks:list", async () => {
  markTaskInteraction();
  if (!lastTaskPayload) {
    if (nativeTracker) {
      nativeTracker.requestSnapshot();
      return { tasks: [], front: null, error: null };
    }
    lastTaskPayload = await buildTaskPayload("tasks:list");
    lastTaskSnapshot = JSON.stringify({
      tasks: lastTaskPayload.tasks,
      front: lastTaskPayload.front,
      error: lastTaskPayload.error,
    });
  }
  return {
    tasks: lastTaskPayload.tasks,
    front: lastTaskPayload.front,
    error: lastTaskPayload.error,
  };
});

ipcMain.on("tasks:poke", () => {
  markTaskInteraction();
  if (nativeTracker) nativeTracker.requestSnapshot();
  else scheduleTaskRefresh(0);
});

ipcMain.handle("tasks:activate", async (_e, rawTask) => {
  const task = validateTask(rawTask);
  if (!task) return { ok: false };
  const startedAt = nowMs();
  try {
    if (task.kind === "native") {
      if (!nativeTracker) return { ok: false, error: "native backend unavailable" };
      nativeTracker.raise(task.pid, task.ref);
    } else {
      await activateWindowTask(task);
      markTaskInteraction();
      scheduleTaskRefresh(0);
    }
    if (DEBUG_TASKS) {
      console.log("[LinBar] tasks:activate", task.process, task.kind, task.ref, "ms=" + (nowMs() - startedAt).toFixed(1));
    }
    return { ok: true };
  } catch (err) {
    if (DEBUG_TASKS) {
      console.warn(
        "[LinBar] tasks:activate failed",
        task.process,
        task.kind,
        task.ref,
        "ms=" + (nowMs() - startedAt).toFixed(1),
      );
    }
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("app:open", async (_e, appName) => {
  if (!appName || typeof appName !== "string") return { ok: false };
  try {
    await openApp(appName);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("path:open", async (_e, target) => {
  if (!target || typeof target !== "string") return { ok: false };
  const err = await shell.openPath(target);
  if (err) return { ok: false, error: err };
  return { ok: true };
});

/** Open well-known folders: documents | desktop | downloads | home */
ipcMain.handle("path:special", async (_e, key) => {
  const map = {
    documents: "documents",
    desktop: "desktop",
    downloads: "downloads",
    home: "home",
  };
  const name = map[key];
  if (!name) return { ok: false, error: "unknown key" };
  const err = await shell.openPath(app.getPath(name));
  if (err) return { ok: false, error: err };
  return { ok: true };
});

/**
 * Popups (start menu, calendar) need room above the 48px bar: grow the window
 * upward while keeping the panel glued to the bottom edge, shrink when closed.
 */
ipcMain.on("panel:setHeight", (_e, rawHeight) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const height = Math.max(PANEL_HEIGHT, Math.min(600, Math.floor(Number(rawHeight) || PANEL_HEIGHT)));
  const display = screen.getDisplayNearestPoint(mainWindow.getBounds());
  const b = display.bounds;
  mainWindow.setBounds({ x: b.x, y: b.y + b.height - height, width: b.width, height });
});

ipcMain.handle("audio:changeVolume", async (_e, rawDelta) => {
  const delta = Math.max(-25, Math.min(25, Number(rawDelta) || 0));
  try {
    const s = await getVolumeState();
    const level = Math.max(0, Math.min(100, Math.round(s.level + delta)));
    await setOutputVolume(level);
    return { muted: s.muted, level };
  } catch (err) {
    return { muted: false, level: 0, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("audio:toggleMute", async () => {
  try {
    await toggleOutputMuted();
    return await getVolumeState();
  } catch (err) {
    return { muted: false, level: 0, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("audio:getVolume", async () => {
  try {
    return await getVolumeState();
  } catch {
    return { muted: false, level: 0 };
  }
});

ipcMain.handle("clipboard:preview", async () => {
  try {
    const text = await getClipboardText();
    const trimmed = text.replace(/\s+/g, " ").trim();
    const preview = trimmed.length > 600 ? trimmed.slice(0, 600) + "…" : trimmed;
    return { ok: true, preview: preview || "(empty)", rawLength: text.length };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("sys:aboutMac", async () => {
  await shell.openPath("/System/Library/CoreServices/Applications/About This Mac.app");
  return { ok: true };
});

ipcMain.handle("sys:notificationSettings", async () => {
  await shell.openExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension");
  return { ok: true };
});

ipcMain.handle("sys:settings", async () => {
  await shell.openExternal("x-apple.systempreferences:");
  return { ok: true };
});

const iconCache = new Map();

async function findAppIcon(appName) {
  if (iconCache.has(appName)) return iconCache.get(appName);
  iconCache.set(appName, null);
  let dataUrl = null;
  try {
    const known = bundlePathByApp.get(appName);
    const bundlePath = known || (nativeMode ? "" : await getAppBundlePath(appName));
    if (bundlePath && bundlePath.trim()) {
      const img = await app.getFileIcon(bundlePath.trim(), { size: "normal" });
      dataUrl = img.toDataURL();
    }
  } catch {}
  if (!dataUrl) {
    const candidates = [
      `/Applications/${appName}.app`,
      `/System/Applications/${appName}.app`,
      `/System/Applications/Utilities/${appName}.app`,
    ];
    for (const p of candidates) {
      try {
        const img = await app.getFileIcon(p, { size: "normal" });
        dataUrl = img.toDataURL();
        break;
      } catch {}
    }
  }
  iconCache.set(appName, dataUrl);
  return dataUrl;
}

ipcMain.handle("icon:get", async (_e, appName) => {
  if (!appName || typeof appName !== "string") return null;
  return findAppIcon(appName);
});

function validateTask(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind;
  const process = String(raw.process || "");
  const ref = Number(raw.ref);
  if (!process || !["system", "terminal", "browser", "native"].includes(kind)) return null;
  if (!Number.isFinite(ref) || ref < 1) return null;
  const task = { process, kind, ref, title: String(raw.title || ""), minimized: Boolean(raw.minimized) };
  if (kind === "native") {
    const pid = Number(raw.pid);
    if (!Number.isFinite(pid) || pid < 1) return null;
    task.pid = pid;
  }
  return task;
}

ipcMain.handle("window:minimize", async (_e, rawTask) => {
  const task = validateTask(rawTask);
  if (!task) return { ok: false };
  try {
    if (task.kind === "native") {
      if (!nativeTracker) return { ok: false, error: "native backend unavailable" };
      nativeTracker.minimize(task.pid, task.ref);
    } else {
      await minimizeWindowTask(task);
      scheduleTaskRefresh(0);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("window:close", async (_e, rawTask) => {
  const task = validateTask(rawTask);
  if (!task) return { ok: false };
  try {
    if (task.kind === "native") {
      if (!nativeTracker) return { ok: false, error: "native backend unavailable" };
      nativeTracker.close(task.pid, task.ref);
    } else {
      await closeWindowTask(task);
      scheduleTaskRefresh(0);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

function broadcastPins() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("taskbar:pinsUpdated", loadConfig().pinned);
}

function togglePin(appName) {
  const pinned = [...loadConfig().pinned];
  const idx = pinned.indexOf(appName);
  if (idx === -1) pinned.push(appName);
  else pinned.splice(idx, 1);
  saveConfig({ pinned });
  broadcastPins();
}

ipcMain.handle("pins:list", () => loadConfig().pinned);

ipcMain.handle("pins:toggle", (_e, appName) => {
  if (!appName || typeof appName !== "string") return { ok: false };
  togglePin(appName);
  return { ok: true, pinned: loadConfig().pinned };
});

ipcMain.on("pins:contextmenu", (_e, appName) => {
  if (!appName || typeof appName !== "string") return;
  const win = BrowserWindow.fromWebContents(_e.sender);
  const menu = Menu.buildFromTemplate([
    { label: "Open " + appName, click: () => void openApp(appName).catch(() => {}) },
    { type: "separator" },
    { label: "Unpin from Taskbar", click: () => togglePin(appName) },
  ]);
  menu.popup({ window: win });
});

async function performTaskAction(task, action) {
  try {
    if (task.kind === "native") {
      if (!nativeTracker) return;
      if (action === "activate") nativeTracker.raise(task.pid, task.ref);
      else if (action === "minimize") nativeTracker.minimize(task.pid, task.ref);
      else if (action === "close") nativeTracker.close(task.pid, task.ref);
      return;
    }
    if (action === "activate") await activateWindowTask(task);
    else if (action === "minimize") await minimizeWindowTask(task);
    else if (action === "close") await closeWindowTask(task);
    scheduleTaskRefresh(0);
  } catch {
    /* surfaced via next snapshot */
  }
}

ipcMain.on("window:contextmenu", (_e, rawTask) => {
  const task = validateTask(rawTask);
  if (!task) return;
  const win = BrowserWindow.fromWebContents(_e.sender);
  const isPinned = loadConfig().pinned.includes(task.process);
  const menu = Menu.buildFromTemplate([
    {
      label: task.minimized ? "Restore" : "Bring to Front",
      click: () => void performTaskAction(task, "activate"),
    },
    { type: "separator" },
    {
      label: "Minimize",
      enabled: !task.minimized,
      click: () => void performTaskAction(task, "minimize"),
    },
    { label: "Close Window", click: () => void performTaskAction(task, "close") },
    { type: "separator" },
    {
      label: isPinned ? "Unpin from Taskbar" : "Pin to Taskbar",
      click: () => togglePin(task.process),
    },
  ]);
  menu.popup({ window: win });
});

app.whenReady().then(() => {
  setMacMenu();
  createWindow();
  startBackend();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    if (nativeTracker) nativeTracker.requestSnapshot();
    else {
      markTaskInteraction();
      scheduleTaskRefresh(0);
    }
  });
});

app.on("will-quit", () => {
  if (nativeTracker) nativeTracker.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
