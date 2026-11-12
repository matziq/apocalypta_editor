"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");

test("run.bat serves the actual assets and authenticated latest/backup/autosave flow", {
  skip: process.platform !== "win32", timeout: 45000
}, async t => {
  const parent = process.env.APOCALYPTER_TEST_OUTPUT || "D:\\AI_Output\\Apocalypta_editor\\save-tests";
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "bridge-"));
  const original = Buffer.from('{"peacefulMode":{"__type":"bool","value":false}}');
  for (const name of ["SaveGame1.es3", "SaveGame2.es3", "SaveGame2.edited.es3", "SaveSettings.es3", "SaveGame9.es3.original.bak"]) {
    fs.writeFileSync(path.join(root, name), original);
  }
  fs.utimesSync(path.join(root, "SaveGame1.es3"), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(root, "SaveGame2.es3"), new Date(2000), new Date(2000));
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "run.bat", "-NoLaunch", "-SaveFolderOverride", root], {
    cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let bridgePid;
  t.after(() => {
    if (bridgePid) execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${bridgePid} -ErrorAction SilentlyContinue`]);
    child.kill();
    for (const file of fs.readdirSync(root)) fs.unlinkSync(path.join(root, file));
    fs.rmdirSync(root);
  });
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const deadline = Date.now() + 20000;
  while (!/Bridge process ID: (\d+)/.test(output)) {
    if (Date.now() > deadline || child.exitCode !== null) throw Error(`Bridge did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  bridgePid = Number(output.match(/Bridge process ID: (\d+)/)[1]);
  const port = Number(output.match(/listening on 127\.0\.0\.1:(\d+)/)[1]);
  const origin = `http://127.0.0.1:${port}`;
  const page = await (await fetch(origin)).text();
  const token = page.match(/name="save-picker-token" content="([^"]+)"/)[1];
  const headers = { Origin: origin, "X-Editor-Token": token };
  const post = (route, body, extraHeaders) => fetch(origin + route, {
    method: "POST", headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined
  });
  for (const asset of ["/app.js", "/save-format.js", "/ui-preferences.js", "/vehicle-actions.js", "/style.css"]) {
    const response = await fetch(origin + asset);
    assert.equal(response.status, 200, asset);
    assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, "..", asset.slice(1)), "utf8"));
  }
  assert.equal((await fetch(origin + "/save-storage.ps1")).status, 404);
  assert.equal((await post("/api/latest", null, { "X-Editor-Token": "bad" })).status, 403);
  assert.equal((await post("/api/latest", null, { Origin: "http://evil.invalid" })).status, 403);
  assert.equal((await post("/api/latest", {})).status, 403);
  assert.equal((await post("/api/latest?path=C:\\secret")).status, 200, "Query strings cannot supply paths");
  await new Promise((resolve, reject) => {
    const request = http.request(`${origin}/api/status`, { method: "POST", headers: { ...headers, Host: "localhost:" + port, "Content-Length": 0 } }, response => {
      assert.equal(response.statusCode, 403); response.resume(); response.on("end", resolve);
    });
    request.on("error", reject); request.end();
  });
  const status = await (await post("/api/status")).json();
  assert.equal(status.protocolVersion, 3);
  assert.equal(status.saveFolder, root);
  const opened = await (await post("/api/latest")).json();
  assert.equal(opened.name, "SaveGame2.es3", "Newer edited exports/settings/backups must not outrank a numbered slot");
  assert.deepEqual(fs.readFileSync(opened.source.backupPath), original);
  const backupCount = () => fs.readdirSync(root).filter(name => name.endsWith(".original.bak")).length;
  const count = backupCount();
  const again = await (await post("/api/latest")).json();
  assert.equal(again.source.backupPath, opened.source.backupPath);
  assert.equal(backupCount(), count);
  const request = { handle: opened.source.handle, confirmed: true, changes: { peacefulMode: true }, autosave: true };
  assert.equal((await post("/api/save", { ...request, path: path.join(root, "SaveGame1.es3") })).status, 409);
  assert.equal((await post("/api/save", { ...request, autosave: "true" })).status, 409);
  const canceled = await (await post("/api/save", { ...request, confirmed: false })).json();
  assert.equal(canceled.canceled, true);
  assert.deepEqual(fs.readFileSync(path.join(root, opened.name)), original);
  const saved = await (await post("/api/save", request)).json();
  assert.equal(saved.backupPath, opened.source.backupPath);
  assert.equal(backupCount(), count);
  assert.match(fs.readFileSync(path.join(root, opened.name), "utf8"), /"value":true/);
  assert.deepEqual(fs.readFileSync(saved.backupPath), original);
  fs.appendFileSync(path.join(root, opened.name), " ");
  const stale = await post("/api/save", { ...request, changes: { peacefulMode: false } });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /changed outside/);
  fs.writeFileSync(path.join(root, "SaveGame3.es3"), "invalid newest slot");
  const newest = await (await post("/api/latest")).json();
  assert.equal(newest.name, "SaveGame3.es3", "Do not silently fall back to an older valid slot");
  assert.equal(Buffer.from(newest.contentBase64, "base64").toString(), "invalid newest slot");
  // The UI's parser rejects this payload; the server's edit validator also refuses it.
  const invalid = await post("/api/save", { ...request, handle: newest.source.handle });
  assert.equal(invalid.status, 409);
  assert.equal(fs.readFileSync(path.join(root, "SaveGame3.es3"), "utf8"), "invalid newest slot");
});
