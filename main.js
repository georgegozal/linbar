const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require("electron");
const path = require("node:path");
const {
  listWindowTasks,
  getFrontmostWindowTask,
  activateWindowTask,
  openApp,
  toggleOutputMuted,
  getVolumeState,
  getClipboardText,
} = require("./lib/applescript");

const PANEL_HEIGHT = 48;
const DEBUG_TASKS = process.env.LINBAR_DEBUG_TASKS === "1";

let mainWindow = null;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function ownProcessNamesToExclude() {
  /** Dev: System Events name is usually "Electron". Packaged: productName e.g. "LinBar". */
  const names = [app.getName(), "Electron", "LinBar", "linbar", "XFCE Taskbar", "xfce-taskbar-app"];
  return [...new Set(names.filter(Boolean))];
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
  const exclude = ownProcessNamesToExclude();
  const startedAt = nowMs();
  try {
    const [tasks, front] = await Promise.all([listWindowTasks(exclude), getFrontmostWindowTask()]);
    if (DEBUG_TASKS && mainWindow && !mainWindow.isDestroyed()) {
      console.log(
        "[LinBar] tasks:list",
        "tasks=" + tasks.length,
        "front=" + (front && front.process ? front.process : "none"),
        "ms=" + (nowMs() - startedAt).toFixed(1),
      );
    }
    return { tasks, front };
  } catch (err) {
    console.error("[LinBar] tasks:list failed:", err.message || err);
    return { tasks: [], front: null, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("tasks:activate", async (_e, task) => {
  if (!task || typeof task !== "object") return { ok: false };
  const process = task.process;
  const kind = task.kind;
  const ref = Number(task.ref);
  if (typeof process !== "string" || !process) return { ok: false };
  if (kind !== "system" && kind !== "terminal" && kind !== "browser") return { ok: false };
  if (!Number.isFinite(ref) || ref < 1) return { ok: false };
  const startedAt = nowMs();
  try {
    await activateWindowTask({
      process,
      kind,
      ref,
      title: typeof task.title === "string" ? task.title : "",
    });
    if (DEBUG_TASKS) {
      console.log("[LinBar] tasks:activate", process, kind, ref, "ms=" + (nowMs() - startedAt).toFixed(1));
    }
    return { ok: true };
  } catch (err) {
    if (DEBUG_TASKS) {
      console.warn(
        "[LinBar] tasks:activate failed",
        process,
        kind,
        ref,
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

app.whenReady().then(() => {
  setMacMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
