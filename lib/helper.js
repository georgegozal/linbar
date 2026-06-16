const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

function helperBinaryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "helper", "linbar-helper");
  }
  return path.join(__dirname, "..", "helper", "linbar-helper");
}

/**
 * Spawn the native window tracker and stream its NDJSON messages.
 * Returns null when the binary is missing (caller falls back to AppleScript).
 *
 * @param {{
 *   onSnapshot: (snap: { reason: string, front: number | null, windows: Array<{ id: number, pid: number, app: string, bundle: string, title: string, minimized: boolean, focused: boolean }> }) => void,
 *   onStatus: (status: { trusted: boolean }) => void,
 *   onExit: (err?: Error) => void,
 * }} handlers
 */
function startNativeTracker({ onSnapshot, onStatus, onExit }) {
  const bin = helperBinaryPath();
  if (!fs.existsSync(bin)) return null;

  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
  let exited = false;
  const exitOnce = (err) => {
    if (exited) return;
    exited = true;
    onExit(err);
  };
  child.on("error", exitOnce);
  child.on("exit", () => exitOnce());

  /** path -> array of pending resolvers for icon requests */
  const pendingIcons = new Map();
  let pendingCategories = [];

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "snapshot") onSnapshot(msg);
      else if (msg.type === "status") onStatus(msg);
      else if (msg.type === "icon") {
        const waiters = pendingIcons.get(msg.path);
        pendingIcons.delete(msg.path);
        for (const resolve of waiters || []) resolve(msg.data || null);
      } else if (msg.type === "categories") {
        const waiters = pendingCategories;
        pendingCategories = [];
        for (const resolve of waiters) resolve(msg.items || {});
      }
    }
  });

  const send = (obj) => {
    try {
      child.stdin.write(JSON.stringify(obj) + "\n");
    } catch {
      /* helper gone; exit handler deals with it */
    }
  };

  const withTimeout = (promise, ms, fallback) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

  return {
    raise: (pid, id) => send({ cmd: "raise", pid, id }),
    minimize: (pid, id) => send({ cmd: "minimize", pid, id }),
    close: (pid, id) => send({ cmd: "close", pid, id }),
    requestSnapshot: () => send({ cmd: "snapshot" }),
    setReserve: (height, pid) => send({ cmd: "reserve", height, pid }),
    minimizeAll: () => send({ cmd: "minimizeAll" }),
    getIcon: (appPath) => {
      const p = new Promise((resolve) => {
        const waiters = pendingIcons.get(appPath) || [];
        waiters.push(resolve);
        pendingIcons.set(appPath, waiters);
        if (waiters.length === 1) send({ cmd: "icon", path: appPath });
      });
      return withTimeout(p, 5000, null);
    },
    getCategories: (paths) => {
      const p = new Promise((resolve) => {
        pendingCategories.push(resolve);
        send({ cmd: "categories", paths });
      });
      return withTimeout(p, 5000, {});
    },
    kill: () => {
      try {
        child.kill();
      } catch {}
    },
  };
}

module.exports = { startNativeTracker };
