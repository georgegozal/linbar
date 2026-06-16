const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONFIG_DIR = path.join(os.homedir(), ".config", "linbar");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  // No auto-pins: the bar starts empty; pin apps from the drawer or right-click menus.
  pinned: [],
  drawerView: "icons",
  launchAtLogin: false,
  // Hide the Dock tile when running from /Applications (menu-bar icon remains).
  hideDockIcon: false,
  onboardingComplete: false,
};

let cached = null;

function asBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

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
    launchAtLogin: asBool(data.launchAtLogin, DEFAULTS.launchAtLogin),
    hideDockIcon: asBool(data.hideDockIcon, DEFAULTS.hideDockIcon),
    onboardingComplete: asBool(data.onboardingComplete, DEFAULTS.onboardingComplete),
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

module.exports = { loadConfig, saveConfig, CONFIG_PATH, DEFAULTS };
