const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function helperBinaryPath() {
  const p = path.join(__dirname, "..", "helper", "linbar-helper");
  // Packaged builds keep the binary outside the asar archive.
  return p.includes("app.asar") ? p.replace("app.asar", "app.asar.unpacked") : p;
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
    }
  });

  const send = (obj) => {
    try {
      child.stdin.write(JSON.stringify(obj) + "\n");
    } catch {
      /* helper gone; exit handler deals with it */
    }
  };

  return {
    raise: (pid, id) => send({ cmd: "raise", pid, id }),
    minimize: (pid, id) => send({ cmd: "minimize", pid, id }),
    close: (pid, id) => send({ cmd: "close", pid, id }),
    requestSnapshot: () => send({ cmd: "snapshot" }),
    kill: () => {
      try {
        child.kill();
      } catch {}
    },
  };
}

module.exports = { startNativeTracker };
