"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

test("Windows launcher derives the current-user path and rejects unauthorized requests", {
  skip: process.platform !== "win32"
}, () => {
  const launcher = path.join(__dirname, "..", "launcher.ps1");
  const output = execFileSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher, "-SelfTest"
  ], { encoding: "utf8" });
  assert.match(output, /Launcher self-test passed/);
});
