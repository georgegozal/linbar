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

  /** path -> array of pending resolvers for icon requests */
  const pendingIcons = new Map();
  /** FIFO of { resolve, done } — the helper answers `categories` commands in order. */
  const pendingCategories = [];

  /** Resolve every waiter for a path and clear it so a later request re-sends the command. */
  const settleIcons = (appPath, value) => {
    const waiters = pendingIcons.get(appPath);
    if (!waiters) return;
    pendingIcons.delete(appPath);
    for (const resolve of waiters) resolve(value);
  };

  const settleCategories = (entry, value) => {
    if (!entry || entry.done) return;
    entry.done = true;
    const idx = pendingCategories.indexOf(entry);
    if (idx !== -1) pendingCategories.splice(idx, 1);
    entry.resolve(value);
  };

  const exitOnce = (err) => {
    if (exited) return;
    exited = true;
    for (const appPath of [...pendingIcons.keys()]) settleIcons(appPath, null);
    while (pendingCategories.length) settleCategories(pendingCategories[0], {});
    onExit(err);
  };
  child.on("error", exitOnce);
  child.on("exit", () => exitOnce());

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
        settleIcons(msg.path, msg.data || null);
      } else if (msg.type === "categories") {
        settleCategories(pendingCategories[0], msg.items || {});
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

  const REQUEST_TIMEOUT_MS = 5000;

  return {
    raise: (pid, id) => send({ cmd: "raise", pid, id }),
    minimize: (pid, id) => send({ cmd: "minimize", pid, id }),
    close: (pid, id) => send({ cmd: "close", pid, id }),
    requestSnapshot: () => send({ cmd: "snapshot" }),
    setReserve: (height, pid) => send({ cmd: "reserve", height, pid }),
    minimizeAll: () => send({ cmd: "minimizeAll" }),
    getIcon: (appPath) =>
      new Promise((resolve) => {
        const waiters = pendingIcons.get(appPath);
        if (waiters) {
          // A command for this path is already in flight; share its response.
          waiters.push(resolve);
          return;
        }
        pendingIcons.set(appPath, [resolve]);
        send({ cmd: "icon", path: appPath });
        // Timing out clears the entry, so a later request re-sends the command.
        setTimeout(() => settleIcons(appPath, null), REQUEST_TIMEOUT_MS);
      }),
    getCategories: (paths) =>
      new Promise((resolve) => {
        const entry = { resolve, done: false };
        pendingCategories.push(entry);
        send({ cmd: "categories", paths });
        setTimeout(() => settleCategories(entry, {}), REQUEST_TIMEOUT_MS);
      }),
    kill: () => {
      try {
        child.kill();
      } catch {}
    },
  };
}

module.exports = { startNativeTracker };
