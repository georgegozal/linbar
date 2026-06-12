const { execFile } = require("node:child_process");

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Visible foreground apps from Launch Services (fast; avoids System Events scans).
 * @returns {Promise<string[]>}
 */
async function getVisibleAppNames() {
  const out = await runCommand("/usr/bin/lsappinfo", ["visibleprocesslist"]);
  const names = [];
  const re = /ASN:[^:]+-"([^"]+)"/g;
  let m;
  while ((m = re.exec(out)) !== null) {
    const name = cleanAppName(m[1].replace(/_/g, " "));
    if (name) names.push(name);
  }
  return names;
}

/** Strip invisible directionality marks some apps embed in their names (e.g. WhatsApp). */
function cleanAppName(name) {
  return String(name).replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
}

/**
 * @returns {Promise<string>}
 */
async function getFrontmostAppName() {
  const asn = await runCommand("/usr/bin/lsappinfo", ["front"]);
  if (!asn) return "";
  try {
    const info = await runCommand("/usr/bin/lsappinfo", ["info", "-only", "name", asn]);
    const m = info.match(/"LSDisplayName"="([^"]+)"/);
    if (m) return cleanAppName(m[1]);
  } catch {
    /* fall through */
  }
  return "";
}

module.exports = {
  getVisibleAppNames,
  getFrontmostAppName,
};
