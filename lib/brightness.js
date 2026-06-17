const { execFile } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");

function brightnessBinaryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "helper", "linbar-brightness");
  }
  return path.join(__dirname, "..", "helper", "linbar-brightness");
}

function runBrightness(args) {
  const bin = brightnessBinaryPath();
  if (!fs.existsSync(bin)) {
    return Promise.reject(new Error("brightness helper missing"));
  }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || "").trim());
    });
  });
}

async function getBrightness() {
  const out = await runBrightness(["get"]);
  const level = Number(out);
  if (!Number.isFinite(level)) throw new Error("invalid brightness");
  return { level: Math.max(0, Math.min(100, Math.round(level))) };
}

async function setBrightness(rawLevel) {
  const level = Math.max(0, Math.min(100, Math.round(Number(rawLevel) || 0)));
  const out = await runBrightness(["set", String(level)]);
  const settled = Number(out);
  return { level: Number.isFinite(settled) ? Math.max(0, Math.min(100, Math.round(settled))) : level };
}

module.exports = { getBrightness, setBrightness };
