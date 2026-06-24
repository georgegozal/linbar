#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronVersion = require("electron/package.json").version;
const helperDir = path.join(__dirname, "..", "helper");
const nodeGyp = path.join(__dirname, "..", "node_modules", ".bin", "node-gyp");

const result = spawnSync(
  nodeGyp,
  ["rebuild", `--target=${electronVersion}`, `--arch=${process.arch}`, "--dist-url=https://electronjs.org/headers"],
  { cwd: helperDir, stdio: "inherit" }
);

process.exit(result.status === null ? 1 : result.status);
