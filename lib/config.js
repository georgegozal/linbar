const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONFIG_DIR = path.join(os.homedir(), ".config", "linbar");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  // No auto-pins: the bar starts with just the default-browser launcher, and the
  // user pins whatever they want from the app drawer (right-click → Pin to Taskbar).
  pinned: [],
  drawerView: "icons",
};

let cached = null;

function loadConfig() {
  if (cached) return cached;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    /* first run or unreadable; use defaults */
  }
  cached = {
    ...DEFAULTS,
    ...data,
    pinned: Array.isArray(data.pinned) ? data.pinned.filter((p) => typeof p === "string" && p) : [...DEFAULTS.pinned],
    drawerView: data.drawerView === "list" ? "list" : "icons",
  };
  return cached;
}

function saveConfig(partial) {
  const cfg = { ...loadConfig(), ...partial };
  cached = cfg;
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (err) {
    console.warn("[LinBar] could not save config:", err.message);
  }
  return cfg;
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
