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
  return { origin, fixture };
}
async function launchBrowser() {
  return require(driver).chromium.launch({
    executablePath: process.env.APOCALYPTER_BROWSER_EXECUTABLE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true
  });
}
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
    for (const theme of ["light", "dark"]) for (const season of ["spring", "summer", "autumn", "winter"]) {
      await page.evaluate(({ theme, season }) => { preferences.theme = theme; preferences.season = season; saveAppearance(); }, { theme, season });
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
    assert.match(await page.locator("#item-action-status").innerText(), /staged 160.*160 counters skipped/);
    assert.equal(await page.locator("#item-editor").isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
