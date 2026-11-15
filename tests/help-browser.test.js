"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const driver = process.env.APOCALYPTER_BROWSER_DRIVER;
const address = process.env.APOCALYPTER_BROWSER_TEST_URL;
const browserOptions = { skip: !driver || !address, timeout: 45000 };
async function syntheticBridge() {
  const origin = new URL(address).origin;
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const pageSource = await (await fetch(origin)).text();
  const token = pageSource.match(/name="save-picker-token" content="([^"]+)"/)[1];
  const status = await (await fetch(origin + "/api/status", {
    method: "POST", headers: { Origin: origin, "X-Editor-Token": token }
  })).json();
  const fixture = path.join(process.env.APOCALYPTER_TEST_OUTPUT || "D:\\AI_Output\\Apocalypta_editor\\save-tests", "help-ui");
  assert.equal(path.resolve(status.saveFolder), path.resolve(fixture), "Refuse to run a writing UI test against a real save folder");
  return { origin, fixture, token };
}
async function launchBrowser() {
  return require(driver).chromium.launch({
    executablePath: process.env.APOCALYPTER_BROWSER_EXECUTABLE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true
  });
}

test("native backup controls persist, preserve inline drafts, and honor zero and stale-policy safety", browserOptions, async () => {
    const { origin, fixture, token } = await syntheticBridge();
    const post = (route, body) => fetch(origin + route, {
      method: "POST", headers: { Origin: origin, "X-Editor-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const target = path.join(fixture, "SaveGame1.es3");
    const source = index => JSON.stringify({
      Player: { __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs: { Health: { __type: "float", value: index } } } }
    });
    const eligible = () => fs.readdirSync(fixture).filter(name => /^SaveGame1\.es3\.[0-9]{8}T[0-9]{9}Z\.[a-f0-9]{32}\.original\.bak$/.test(name));
    await post("/api/retention", { backupLimit: 3 });
    fs.writeFileSync(target, source(45));
    for (let index = 0; index < 6; index++) fs.writeFileSync(`${target}.20200101T00000000${index}Z.${String(index).padStart(32, "0")}.original.bak`, source(index));
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      const requests = [];
      const prompts = [];
      let accept = true;
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.url().includes("/api/")) requests.push(request.url()); });
      page.on("dialog", async dialog => { prompts.push(dialog.message()); if (accept) await dialog.accept(); else await dialog.dismiss(); });
      await page.goto(origin);
      await page.waitForFunction(() => !!doc && !openingNative);
      assert.equal(await page.locator("#backup-limit").inputValue(), "3");
      assert.equal(eligible().length, 3);
      const id = await page.evaluate(() => inputs.get("Player.Health").id);
      const input = page.locator("#" + id);
      await input.fill("76");
      accept = false;
      const beforeRejected = fs.readdirSync(fixture).sort();
      const requestCount = requests.length;
      await page.locator("#native-picker").click();
      assert.equal(requests.length, requestCount, "Discard refusal must not call picker, create backups, or prune");
      assert.deepEqual(fs.readdirSync(fixture).sort(), beforeRejected);
      assert.equal(await input.inputValue(), "76");
      accept = true;
      await page.locator("#backup-limit").fill("0");
      await page.locator("#apply-backup-limit").click();
      await page.waitForFunction(() => !backupSettingsBusy && nativeSource.backupLimit === 0);
      assert.match(prompts.at(-1), /ALL eligible editor backups/);
      assert.equal(eligible().length, 0);
      assert.match(await page.locator("#source-status").innerText(), /Backups disabled: no recovery/);
      assert.equal(await input.inputValue(), "76");
      assert.equal(await input.evaluate(element => element === inputs.get("Player.Health")), true);
      await page.locator("#autosave").check();
      await page.waitForFunction(() => !saving && doc.fields.find(field => field.id === "Player.Health").value === 76);
      assert.equal(eligible().length, 0);
      assert.match(await page.locator("#autosave-status").innerText(), /Autosaved/);
      await page.locator("#autosave").uncheck();
      await input.fill("");
      await page.locator("#backup-limit").fill("1");
      await page.locator("#apply-backup-limit").click();
      await page.waitForFunction(() => !backupSettingsBusy && nativeSource.backupLimit === 1);
      assert.equal(await input.inputValue(), "");
      assert.equal(await input.getAttribute("aria-invalid"), "true");
      assert.equal(eligible().length, 1);
      assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).Player.value.objs.Health.value, 76);
      await input.fill("80");
      await page.locator("#save-top").click();
      await page.waitForFunction(() => !saving && doc.fields.find(field => field.id === "Player.Health").value === 80);
      assert.equal(eligible().length, 1);
      assert.equal(await page.locator("#backup-limit").inputValue(), "1");
      await page.locator("#autosave").check();
      await input.fill("81");
      await input.press("Enter");
      await page.waitForFunction(() => !saving && doc.fields.find(field => field.id === "Player.Health").value === 81);
      assert.equal(eligible().length, 1);

      // A second tab changes global policy without this tab acknowledging it.
      const second = await browser.newPage();
      second.on("dialog", dialog => dialog.accept());
      await second.goto(origin);
      await second.waitForFunction(() => !!doc && !openingNative);
      await second.locator("#backup-limit").fill("0");
      await second.locator("#apply-backup-limit").click();
      await second.waitForFunction(() => !backupSettingsBusy && nativeSource.backupLimit === 0);
      const currentBytes = fs.readFileSync(target);
      await input.fill("82");
      await input.press("Enter");
      await page.waitForFunction(() => autosaveFailed);
      assert.deepEqual(fs.readFileSync(target), currentBytes);
      assert.equal(await input.inputValue(), "82");
      assert.match(await page.locator("#message").innerText(), /policy changed in another window/);
      await page.locator("#backup-limit").fill("2");
      await page.locator("#apply-backup-limit").click();
      await page.waitForFunction(() => !backupSettingsBusy && nativeSource.backupLimit === 2);
      assert.equal(await input.inputValue(), "82");
      await page.locator("#autosave").uncheck();
      await page.locator("#autosave").check();
      await page.waitForFunction(() => !saving && doc.fields.find(field => field.id === "Player.Health").value === 82);
      assert.equal(eligible().length, 1);
      await page.locator("#autosave").uncheck();
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 800 }]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.reload();
      await page.waitForFunction(() => !!doc && !openingNative);
      assert.equal(await page.locator("#backup-limit").inputValue(), "2");
      assert.equal(await page.locator("#autosave").isChecked(), false);
      assert.deepEqual(errors, []);
      await second.close();
    } finally { await browser.close(); await post("/api/retention", { backupLimit: 3 }); }
});
test("native numeric spinners stay stationary near the viewport bottom while autosaving", browserOptions, async () => {
  const { origin, fixture } = await syntheticBridge();
  const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
  const number = value => ({ __type: "float", value });
  fs.writeFileSync(path.join(fixture, "SaveGame1.es3"), JSON.stringify({
    Player: pm({ Health: number(45) }),
    Ammo: pm({ armor: number(20), ammo_9mm: { __type: "int", value: 250 }, ammo_22caliber: { __type: "int", value: 15 }, ammo_556: { __type: "int", value: 20 } }),
    global: pm({ Hunger: number(20), Thirst: number(30), Fatigue: number(40), Radiation: number(5), Money: number(39), Sanity: number(-27) })
  }));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => document.getElementById("filename").textContent === "SaveGame1.es3");
    await page.locator("#autosave").check();
    const id = await page.evaluate(() => inputs.get("Ammo.ammo_556").id);
    const input = page.locator("#" + id);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 500 }, { width: 390, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(id => {
        const bounds = document.getElementById(id).getBoundingClientRect();
        scrollTo(0, scrollY + bounds.bottom - innerHeight + 50);
      }, id);
      const start = await input.boundingBox();
      const value = Number(await input.inputValue());
      for (let count = 1; count <= 3; count++) {
        await page.mouse.move(start.x + start.width - 17, start.y + start.height * .38);
        await page.mouse.click(start.x + start.width - 17, start.y + start.height * .38);
        for (const delay of [0, 100, 450]) {
          if (delay) await page.waitForTimeout(delay);
          const current = await input.boundingBox();
          assert.ok(Math.abs(current.y - start.y) <= 1, `${viewport.width}x${viewport.height}: input moved vertically`);
          assert.ok(Math.abs(current.x - start.x) <= 1);
          assert.equal(await page.locator("#floating-help").isVisible(), false);
        }
        assert.equal(Number(await input.inputValue()), value + count, "Stationary pointer must reach each native spin button increment");
        await page.waitForFunction(() => changes.size === 0 && !saving);
      }
      const trigger = page.getByRole("button", { name: "Help: 556", exact: true });
      await trigger.hover();
      await page.locator("#floating-help").waitFor({ state: "visible" });
      await input.hover();
      assert.equal(await page.locator("#floating-help").isVisible(), false);
      await trigger.focus();
      assert.equal(await page.locator("#floating-help").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#floating-help").isVisible(), false);
      assert.ok(await input.getAttribute("aria-describedby"));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("Repair & Top Off autosaves verified supplies without changing unplated armor", browserOptions, async () => {
  const { origin, fixture } = await syntheticBridge();
  const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
  const name = "first_aid_1(Clone)1", ref = "aid-1", prefab = { prefabId: "3955095449936337101" };
  const batteryName = "flashlight_batteries(Clone)2", batteryRef = "batteries-2", batteryPrefab = { prefabId: "6027655925999442117" };
  const target = path.join(fixture, "SaveGame1.es3");
  fs.writeFileSync(target, JSON.stringify({
    Ammo: pm({ armor: { __type: "float", value: 0 }, armorPlates: { __type: "int", value: 0 },
      ammo_9mm: { __type: "int", value: 4 }, ammo_9mm_capacity: { __type: "int", value: 40 } }),
    global: pm({ Money: { __type: "int", value: 42 } }),
    newGOArray_Items: { value: { array: [{ name, _ES3Ref: ref, es3Prefab: prefab },
      { name: batteryName, _ES3Ref: batteryRef, es3Prefab: batteryPrefab }] } },
    [name]: pm({ owner: { _ES3Ref: ref, es3Prefab: prefab }, Quantity: { __type: "int", value: 3 } }),
    [batteryName]: pm({ owner: { _ES3Ref: batteryRef, es3Prefab: batteryPrefab },
      batteries: { __type: "int", value: 0 }, ForBuyInt: { __type: "int", value: 0 } })
  }));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => !!doc && !openingNative);
    await page.locator("#autosave").check();
    await page.locator("#tab-vehicles").click();
    await page.locator("#all-vehicles").click();
    await page.waitForFunction(() => !saving && doc.fields.find(field => field.id === "global.Money").value === 900000);
    const saved = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(saved.Ammo.value.objs.armor.value, 0);
    assert.equal(saved.Ammo.value.objs.armorPlates.value, 0);
    assert.equal(saved.Ammo.value.objs.ammo_9mm.value, 999);
    assert.equal(saved.Ammo.value.objs.ammo_9mm_capacity.value, 40);
    assert.equal(saved.global.value.objs.Money.value, 900000);
    assert.equal(saved[name].value.objs.Quantity.value, 999);
    assert.equal(saved[batteryName].value.objs.batteries.value, 999);
    assert.equal(saved[batteryName].value.objs.ForBuyInt.value, 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("long item lists expand in place, keep inline drafts through autosave, and maximize hidden verified targets", browserOptions, async () => {
  const { origin, fixture } = await syntheticBridge();
  const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
  const root = { Player: pm({ Health: { __type: "float", value: 45 } }), newGOArray_Items: { value: { array: [] } } };
  for (let index = 0; index < 80; index++) {
    const name = `engine(Clone)${index}`;
    const ref = `item-${index}`;
    root.newGOArray_Items.value.array.push({ name, _ES3Ref: ref });
    root[name] = pm({ owner: { _ES3Ref: ref }, Quantity: { __type: "int", value: 3 }, ammo: { __type: "int", value: 4 },
      Condition: { __type: "float", value: 25 }, Liquid: { __type: "float", value: 2 }, LiquidCapacity: { __type: "float", value: 5 } });
  }
  fs.writeFileSync(path.join(fixture, "SaveGame1.es3"), JSON.stringify(root));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => document.getElementById("filename").textContent === "SaveGame1.es3");
    await page.locator("#autosave").check();
    await page.locator("#tab-items").click();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 800 }]) {
      await page.setViewportSize(viewport);
      for (const index of [40, 70]) {
        const button = page.getByRole("button", { name: `Edit values: engine(Clone)${index}, ref item-${index}`, exact: true });
        await button.scrollIntoViewIfNeeded();
        const before = await button.boundingBox();
        await button.click();
        assert.ok(Math.abs((await button.boundingBox()).y - before.y) <= 1, "Opening B must not move its button even when A above it collapses");
        assert.equal(await button.getAttribute("aria-expanded"), "true");
        assert.equal(await page.evaluate(() => document.getElementById("item-editor").closest("tr").previousElementSibling.querySelector(".item-action").getAttribute("aria-expanded")), "true");
        assert.equal(await page.evaluate(() => document.getElementById("item-editor").closest("tbody").id), "item-rows");
      }
      const selected = page.getByRole("button", { name: "Edit values: engine(Clone)70, ref item-70", exact: true });
      const before = await selected.boundingBox();
      await selected.click();
      assert.equal(await selected.getAttribute("aria-expanded"), "false");
      assert.ok(Math.abs((await selected.boundingBox()).y - before.y) <= 1);
      await selected.click();
      const id = await page.evaluate(() => inputs.get(doc.items[70].fieldIds.find(id => id.endsWith(":Quantity"))).id);
      const input = page.locator("#" + id);
      await input.scrollIntoViewIfNeeded();
      const inputBox = await input.boundingBox();
      const value = Number(await input.inputValue());
      await page.mouse.click(inputBox.x + inputBox.width - 17, inputBox.y + inputBox.height * .38);
      await page.waitForFunction(() => !saving && changes.size === 0);
      assert.equal(Number(await input.inputValue()), value + 1);
      assert.ok(Math.abs((await input.boundingBox()).y - inputBox.y) <= 1, "Autosave must not move inline inputs");
      assert.equal(await selected.getAttribute("aria-expanded"), "true");
      assert.equal(await page.locator("#floating-help").isVisible(), false);
      assert.equal(await input.evaluate(element => element === document.activeElement), true);
      await page.locator("#item-filter").fill("engine(Clone)0");
      assert.equal(await page.locator("#item-editor").isVisible(), false);
      await page.locator("#item-filter").fill("");
      assert.equal(await page.locator("#item-editor").isVisible(), true);
      assert.equal(Number(await input.inputValue()), value + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    for (const theme of ["light", "dark"]) for (const palette of ["wasteland", "desert", "nuclear-winter", "apocalypse"]) {
      await page.evaluate(({ theme, palette }) => { preferences.theme = theme; preferences.palette = palette; saveAppearance(); }, { theme, palette });
      await page.locator("#item-editor input").first().focus();
      await page.locator("#item-editor .help-trigger").first().focus();
      assert.equal(await page.locator("#floating-help").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#floating-help").isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    // Hide every target except one; the bulk action must still operate on all items.
    await page.locator("#item-filter").fill("engine(Clone)70");
    const writes = [];
    page.on("request", request => { if (request.url().endsWith("/api/save")) writes.push(request.postDataJSON()); });
    await page.locator("#maximize-items").click();
    await page.waitForFunction(() => !saving && doc.items.every(item => item.condition === 100 && item.liquid.value === 5));
    assert.equal(writes.length, 1);
    assert.equal(Object.keys(writes[0].changes).length, 160);
    assert.match(await page.locator("#item-action-status").innerText(), /staged 160.*160 unverified counters/);
    assert.equal(await page.locator("#item-editor").isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("bulk targets persist across native bridge origins and invalid settings never stage writes", browserOptions, async () => {
  const { origin, fixture, token } = await syntheticBridge();
  const pm = objs => ({ __type: "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass", value: { objs } });
  const target = path.join(fixture, "SaveGame1.es3");
  fs.writeFileSync(target, JSON.stringify({
    Ammo: pm({ armor: { __type: "float", value: 0 }, armorPlates: { __type: "int", value: 0 },
      ammo_9mm: { __type: "int", value: 4 }, ammo_9mm_capacity: { __type: "int", value: 40 } }),
    global: pm({ Money: { __type: "int", value: 42 } })
  }));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.on("dialog", dialog => dialog.accept());
    const writes = [];
    page.on("request", request => { if (request.url().endsWith("/api/save")) writes.push(request.url()); });
    await page.goto(origin);
    await page.waitForFunction(() => !!doc && !openingNative && targetsReady && !targetsBusy);
    await page.locator("#autosave").check();
    for (const [key, value] of Object.entries({ ammo: "999", consumables: "999", nuts: "900000", liquids: "100" })) {
      await page.locator(`#target-${key}`).fill(value);
    }
    await page.locator("#apply-targets").click();
    await page.waitForFunction(() => !targetsBusy && targetsReady);
    assert.equal(writes.length, 0);
    await page.locator("#autosave").uncheck();
    await page.locator("#maximize-player").click();
    assert.equal(await page.evaluate(() => changes.get("Ammo.ammo_9mm")), 999);
    assert.equal(await page.evaluate(() => changes.has("Ammo.ammo_9mm_capacity")), false);
    assert.equal(await page.evaluate(() => changes.has("Ammo.armor")), false);
    await page.locator("#reset").click();
    for (const [key, value] of Object.entries({ ammo: "321", consumables: "765", nuts: "12345", liquids: "25" })) {
      await page.locator(`#target-${key}`).fill(value);
    }
    await page.locator("#apply-targets").click();
    await page.waitForFunction(() => !targetsBusy && targetsReady && appliedTargets.ammo === 321);
    assert.equal(await page.evaluate(() => changes.size), 0);
    assert.equal(writes.length, 0);
    const second = await browser.newPage();
    await second.goto(process.env.APOCALYPTER_BROWSER_TEST_URL_ALT || origin);
    await second.waitForFunction(() => !!doc && !openingNative && targetsReady && !targetsBusy);
    for (const [key, value] of Object.entries({ ammo: "321", consumables: "765", nuts: "12345", liquids: "25" })) {
      assert.equal(await second.locator(`#target-${key}`).inputValue(), value);
    }
    await second.locator("#target-liquids").fill("101");
    await second.locator("#apply-targets").click();
    await second.locator("#maximize-player").click();
    assert.match(await second.locator("#target-status").innerText(), /liquids target/);
    assert.equal(await second.evaluate(() => changes.size), 0);
    await second.close();
  } finally {
    await browser.close();
    const reset = await fetch(origin + "/api/targets", {
      method: "POST", headers: { Origin: origin, "X-Editor-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ ammo: 999, consumables: 999, nuts: 900000, liquids: 100 })
    });
    assert.equal(reset.ok, true);
  }
});

test("game-world palettes remain readable on desktop and mobile", browserOptions, async () => {
  const { origin } = await syntheticBridge();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => !targetsBusy);
    const seen = new Set();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) for (const palette of ["wasteland", "desert", "nuclear-winter", "apocalypse"]) {
        await page.evaluate(({ theme, palette }) => { preferences.theme = theme; preferences.palette = palette; updateAppearance(); }, { theme, palette });
        const values = await page.evaluate(() => {
          const css = getComputedStyle(document.body);
          const color = key => css.getPropertyValue(key).trim();
          const luminance = hex => {
            if (/^#[0-9a-f]{3}$/i.test(hex)) hex = "#" + [...hex.slice(1)].map(c => c + c).join("");
            const values = hex.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
            return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
          };
          const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
          return { canvas: color("--canvas"), surface: color("--surface"),
            body: contrast(color("--ink"), color("--canvas")), help: contrast(color("--ink"), color("--surface")),
            muted: contrast(color("--muted"), color("--surface")), button: contrast(color("--button-text"), color("--accent")),
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(values.body >= 4.5 && values.help >= 4.5 && values.muted >= 4.5 && values.button >= 4.5, `${theme}/${palette}: ${JSON.stringify(values)}`);
        assert.equal(values.overflow, false, `${theme}/${palette}/${width}`);
        if (width === 1440 && theme === "light") seen.add(values.canvas);
      }
    }
    assert.equal(seen.size, 4, "Each world theme must use a distinct canvas color");
  } finally { await browser.close(); }
});
