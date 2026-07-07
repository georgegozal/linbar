const path = require("node:path");
const { app } = require("electron");

let configureFn = null;

function addonPath() {
  if (app.isPackaged) {
    // asarUnpack preserves the in-app relative path (helper/build/Release/...).
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "helper",
      "build",
      "Release",
      "linbar_panel.node",
    );
  }
  return path.join(__dirname, "..", "helper", "build", "Release", "linbar_panel.node");
}

function loadConfigure() {
  if (configureFn) return configureFn;
  const mod = require(addonPath());
  configureFn = mod.configure;
  return configureFn;
}

/** Keep the overlay stationary and visible during Mission Control / App Exposé. */
function configurePanelWindow(browserWindow) {
  if (process.platform !== "darwin" || !browserWindow || browserWindow.isDestroyed()) return;
  try {
    const configure = loadConfigure();
    configure(browserWindow.getNativeWindowHandle());
  } catch (err) {
    console.warn("[LinBar] panel window configure failed:", err && err.message ? err.message : err);
  }
}

module.exports = { configurePanelWindow };
