const { execFile } = require("node:child_process");

/**
 * Run AppleScript and return trimmed stdout.
 * @param {string} source
 * @returns {Promise<string>}
 */
function runOsascript(source) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-e", source], { encoding: "utf8" }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Escape a string for use inside AppleScript string literal (double-quoted).
 * @param {string} s
 */
function appleScriptStringLiteral(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Apps that have at least one window (System Events).
 * @param {string[]} excludeNames Lowercase process names to skip
 * @returns {Promise<string[]>}
 */
async function listAppsWithWindows(excludeNames) {
  const exclude = new Set(excludeNames.map((n) => n.toLowerCase()));
  const script = `
tell application "System Events"
  set out to {}
  repeat with p in (every application process whose background only is false)
    try
      set n to name of p as text
      if (count of windows of p) > 0 then
        set end of out to n
      end if
    end try
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
out as text`;

  const out = await runOsascript(script);
  if (!out) return [];
  const names = out.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const n of names) {
    if (exclude.has(n.toLowerCase())) continue;
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    uniq.push(n);
  }
  return uniq;
}

/**
 * Frontmost application display name.
 * @returns {Promise<string|null>}
 */
async function getFrontmostAppName() {
  const script = `
tell application "System Events"
  try
    set f to name of first application process whose frontmost is true
    return f as text
  on error
    return ""
  end try
end tell`;
  const name = await runOsascript(script);
  return name || null;
}

/**
 * @param {string} appName As returned by System Events / listAppsWithWindows
 * @returns {Promise<void>}
 */
async function activateApp(appName) {
  const q = appleScriptStringLiteral(appName);
  await runOsascript(`tell application "${q}" to activate`);
}

/**
 * @param {string} appName e.g. "Safari", "Terminal"
 */
async function openApp(appName) {
  const q = appleScriptStringLiteral(appName);
  await runOsascript(`tell application "${q}" to activate`);
}

/** Toggle output mute */
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

/** @returns {Promise<{ muted: boolean, level: number }>} */
async function getVolumeState() {
  const script = `
set s to get volume settings
return (output muted of s as text) & tab & (output volume of s as text)`;
  const line = await runOsascript(script);
  const [mut, lev] = line.split("\t");
  return { muted: mut === "true", level: Number(lev) || 0 };
}

/** @returns {Promise<string>} */
async function getClipboardText() {
  return runOsascript("return the clipboard as text");
}

module.exports = {
  runOsascript,
  listAppsWithWindows,
  getFrontmostAppName,
  activateApp,
  openApp,
  toggleOutputMuted,
  getVolumeState,
  getClipboardText,
};
