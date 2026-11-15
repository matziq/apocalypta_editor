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
  assert.equal((await post("/api/targets", null, { "X-Editor-Token": "bad" })).status, 403);
  assert.equal((await post("/api/targets", null, { Origin: "http://evil.invalid" })).status, 403);
  assert.equal((await post("/api/font-size", null, { "X-Editor-Token": "bad" })).status, 403);
  assert.equal((await post("/api/font-size", null, { Origin: "http://evil.invalid" })).status, 403);
  assert.equal((await (await post("/api/font-size")).json()).fontSize, 100);
  assert.equal((await post("/api/font-size", { fontSize: 80 })).status, 200);
  for (const value of [79, 81, 150, "100"]) assert.equal((await post("/api/font-size", { fontSize: value })).status, 409);
  assert.equal((await (await post("/api/font-size")).json()).fontSize, 80);
  assert.deepEqual((await (await post("/api/targets")).json()).targets,
    { ammo: 999, consumables: 999, nuts: 900000, liquids: 100 });
  const targets = { ammo: 321, consumables: 765, nuts: 12345, liquids: 25 };
  assert.equal((await post("/api/targets", targets)).status, 200);
  assert.equal((await post("/api/targets", { ...targets, ammo: -1 })).status, 409);
  assert.deepEqual((await (await post("/api/targets")).json()).targets, targets);
  assert.deepEqual(fs.readFileSync(path.join(root, "SaveGame1.es3")), original, "Target preferences never write game saves");
  assert.equal((await post("/api/latest?path=C:\\secret")).status, 200, "Query strings cannot supply paths");
  await new Promise((resolve, reject) => {
    const request = http.request(`${origin}/api/status`, { method: "POST", headers: { ...headers, Host: "localhost:" + port, "Content-Length": 0 } }, response => {
      assert.equal(response.statusCode, 403); response.resume(); response.on("end", resolve);
    });
    request.on("error", reject); request.end();
  });
  const status = await (await post("/api/status")).json();
  assert.equal(status.protocolVersion, 4);
  assert.equal(status.backupLimit, 3);
  assert.equal(status.saveFolder, root);
  const opened = await (await post("/api/latest")).json();
  assert.equal(opened.name, "SaveGame2.es3", "Newer edited exports/settings/backups must not outrank a numbered slot");
  assert.deepEqual(fs.readFileSync(opened.source.backupPath), original);
  const backupCount = () => fs.readdirSync(root).filter(name => name.endsWith(".original.bak")).length;
  const count = backupCount();
  const again = await (await post("/api/latest")).json();
  assert.equal(again.source.backupPath, opened.source.backupPath);
  assert.equal(backupCount(), count);
  const request = { handle: opened.source.handle, backupLimit: 3, confirmed: true, changes: { peacefulMode: true }, autosave: true };
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
  const policySource = await (await post("/api/latest")).json();
  const policyRequest = { ...request, handle: policySource.source.handle, changes: { peacefulMode: false } };
  const policySnapshot = () => Object.fromEntries(fs.readdirSync(root).map(name => [name, fs.readFileSync(path.join(root, name)).toString("base64")]));
  for (const body of [{ backupLimit: -1 }, { backupLimit: "0" }, { backupLimit: 1.5 }, { backupLimit: 2, path: root }, { backupLimit: 2, handle: "unknown" }]) {
    assert.equal((await post("/api/retention", body)).status, 409);
  }
  assert.equal((await post("/api/retention", { backupLimit: 0 }, { "X-Editor-Token": "bad" })).status, 403);
  assert.equal((await post("/api/retention", { backupLimit: 0 }, { Origin: "http://evil.invalid" })).status, 403);
  await post("/api/retention", { backupLimit: 5 });
  const beforePolicyMismatch = policySnapshot();
  for (const autosave of [false, true]) {
    const refused = await post("/api/save", { ...policyRequest, autosave });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /saved backup policy changed.*Apply/);
    assert.deepEqual(policySnapshot(), beforePolicyMismatch, "A stale acknowledged policy must not write or prune");
  }
  const reapplied = await (await post("/api/retention", { backupLimit: 5, handle: policySource.source.handle })).json();
  assert.equal(reapplied.backupLimit, 5);
  assert.ok(reapplied.backupPath);
  const afterReapply = await post("/api/save", { ...policyRequest, backupLimit: 5 });
  assert.equal(afterReapply.status, 200);
  assert.equal((await afterReapply.json()).saved, true);
  await post("/api/retention", { backupLimit: 0, handle: policySource.source.handle });
  const beforeSameHandleMismatch = policySnapshot();
  const sameHandle = await post("/api/save", { ...policyRequest, backupLimit: 5 });
  assert.equal(sameHandle.status, 409);
  assert.match((await sameHandle.json()).error, /policy for this opened file changed/);
  assert.deepEqual(policySnapshot(), beforeSameHandleMismatch);
  const zeroSave = await (await post("/api/save", { ...policyRequest, backupLimit: 0, changes: { peacefulMode: true } })).json();
  assert.equal(zeroSave.saved, true);
  assert.equal(zeroSave.backupPath, null);
  assert.equal(fs.readdirSync(root).filter(name => /^SaveGame2\.es3\.[0-9]{8}T[0-9]{9}Z\.[a-f0-9]{32}\.original\.bak$/.test(name)).length, 0);

  // A concurrent relaunch must read the same native preference even on a different origin/port.
  await post("/api/retention", { backupLimit: 7 });
  const other = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "run.bat", "-NoLaunch", "-SaveFolderOverride", root], {
    cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"]
  });
  let otherOutput = "", otherPid;
  other.stdout.on("data", data => { otherOutput += data; });
  other.stderr.on("data", data => { otherOutput += data; });
  t.after(() => {
    if (otherPid) execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${otherPid} -ErrorAction SilentlyContinue`]);
    other.kill();
  });
  const otherDeadline = Date.now() + 20000;
  while (!/Bridge process ID: (\d+)/.test(otherOutput)) {
    if (Date.now() > otherDeadline || other.exitCode !== null) throw Error(`Second bridge did not start: ${otherOutput}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  otherPid = Number(otherOutput.match(/Bridge process ID: (\d+)/)[1]);
  const otherPort = Number(otherOutput.match(/listening on 127\.0\.0\.1:(\d+)/)[1]);
  assert.notEqual(otherPort, port);
  const otherOrigin = `http://127.0.0.1:${otherPort}`;
  const otherPage = await (await fetch(otherOrigin)).text();
  const otherToken = otherPage.match(/name="save-picker-token" content="([^"]+)"/)[1];
  const otherPost = (route, body) => fetch(otherOrigin + route, {
    method: "POST", headers: { Origin: otherOrigin, "X-Editor-Token": otherToken, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  assert.equal((await (await otherPost("/api/status")).json()).backupLimit, 7);
  for (let index = 0; index < 9; index++) fs.writeFileSync(path.join(root,
    `SaveGame2.es3.20200101T00000000${index}Z.${String(index).padStart(32, "0")}.original.bak`), Buffer.concat([original, Buffer.alloc(index, 32)]));
  const reopened = await (await otherPost("/api/latest")).json();
  assert.equal(reopened.source.backupLimit, 7);
  assert.equal(fs.readdirSync(root).filter(name => /^SaveGame2\.es3\.[0-9]{8}T[0-9]{9}Z\.[a-f0-9]{32}\.original\.bak$/.test(name)).length, 7);
  await post("/api/retention", { backupLimit: 0 });
  const acrossProcessSnapshot = policySnapshot();
  for (const autosave of [false, true]) {
    const staleProcess = await otherPost("/api/save", { ...policyRequest, handle: reopened.source.handle, backupLimit: 7, autosave });
    assert.equal(staleProcess.status, 409);
    assert.match((await staleProcess.json()).error, /saved backup policy changed/);
    assert.deepEqual(policySnapshot(), acrossProcessSnapshot);
  }
  const reopenedZero = await (await post("/api/latest")).json();
  assert.equal(reopenedZero.source.backupLimit, 0);
  assert.equal(reopenedZero.source.backupPath, null);
  assert.equal(fs.readdirSync(root).filter(name => /^SaveGame2\.es3\.[0-9]{8}T[0-9]{9}Z\.[a-f0-9]{32}\.original\.bak$/.test(name)).length, 0);
  fs.writeFileSync(path.join(root, ".apocalypter-editor-settings.json"), '{"version":1,"backupLimit":"bad"}');
  const beforeBadSettings = policySnapshot();
  for (const route of ["/api/status", "/api/latest", "/api/pick"]) {
    const refused = await post(route);
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /settings/i);
    assert.deepEqual(policySnapshot(), beforeBadSettings, "Bad native settings must never default/prune or open a dialog");
  }
  await post("/api/retention", { backupLimit: 3 });
  assert.equal((await (await post("/api/status")).json()).backupLimit, 3);
  fs.writeFileSync(path.join(root, "SaveGame3.es3"), "invalid newest slot");
  for (let index = 0; index < 5; index++) fs.writeFileSync(path.join(root,
    `SaveGame3.es3.20200101T00000000${index}Z.${String(index).padStart(32, "0")}.original.bak`), original);
  const beforeInvalid = fs.readdirSync(root).sort();
  const newest = await post("/api/latest");
  assert.equal(newest.status, 409);
  assert.match((await newest.json()).error, /newest game slot.*No older slot/);
  assert.deepEqual(fs.readdirSync(root).sort(), beforeInvalid, "Rejected newest slot must not create or prune any backups");
  assert.equal(fs.readFileSync(path.join(root, "SaveGame3.es3"), "utf8"), "invalid newest slot");
});
