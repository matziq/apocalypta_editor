"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { prepareEdit } = require("../save-edit-validator.js");

const original = Buffer.from('\ufeff{\r\n"peacefulMode":{"__type":"bool","value":false},\r\n"ref":9182880418645639079\r\n}');

test("server-side validator uses the lossless scalar serializer", () => {
  const edited = prepareEdit(original, { peacefulMode: true });
  assert.equal(edited.toString("utf8"), original.toString("utf8").replace('"value":false', '"value":true'));
  assert.throws(() => prepareEdit(original, { ref: 12 }), /not supported/);
  assert.throws(() => prepareEdit(original, { peacefulMode: "true" }), /must be true or false/);
  assert.throws(() => prepareEdit(original, {}), /No changes/);
});

test("confirmed native writes preserve backups and refuse stale or failed replacements", {
  skip: process.platform !== "win32"
}, () => {
  const parent = process.env.APOCALYPTER_TEST_OUTPUT || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "apocalypter-save-test-"));
  try {
    const output = execFileSync("powershell.exe", [
      "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", path.join(__dirname, "save-storage.test.ps1"), "-Root", root
    ], { encoding: "utf8", timeout: 30000 });
    assert.match(output, /Storage tests passed/);
  } finally {
    for (const name of fs.readdirSync(root)) fs.unlinkSync(path.join(root, name));
    fs.rmdirSync(root);
  }
});
