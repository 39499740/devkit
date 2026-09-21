// 追加步骤回归（纯 SPA 导航，不做整页刷新）：第一次进入 +1 步，返回列表再进入不得再加。
// 证据口径：先确认「确实从工具发送到流程」「确实从列表点进同一条流程」两个前置条件成立，再断言步骤数不变。
const BASE = "http://localhost:4321";
const task = await taskSpace("verify append once spa");
const page = task.page("p1");

await page.goto(BASE + "/offline-fallback.html?cb=" + Date.now());
await page.waitForTimeout(400);
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
});
await page.goto(BASE + "/tools/json-format?cb=" + Date.now());
await page.waitForTimeout(900);

const click = async (label, exact = false) => {
  const ok = await page.evaluate(({ l, ex }) => {
    const els = [...document.querySelectorAll("button, a")];
    const el = els.find((b) => (ex ? (b.innerText || "").trim() === l : (b.innerText || "").includes(l)));
    if (!el) return false;
    el.click();
    return true;
  }, { l: label, ex: exact });
  await page.waitForTimeout(700);
  return ok;
};
const steps = () => page.evaluate(() => [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim()));
const path = () => page.evaluate(() => location.pathname);
const failures = [];
const record = (test, ok, detail) => {
  console.log(JSON.stringify({ test, ok, ...detail }));
  if (!ok) failures.push(test);
};

const loadedSample = await click("载入示例");
const openedMenu = await click("发送到…");
const menuOpened = await page.evaluate(() => !!document.querySelector(".sendto__summary-text"));
const pickedFlow = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".sendto__item")].find((el) => (el.innerText || "").includes("订单快照解析"));
  if (!item) return false;
  item.click();
  return true;
});
await page.waitForTimeout(1400);
const firstPath = await path();
const firstSteps = await steps();

// 纯客户端导航：流程列表 → 再进同一条流程
const backToList = await click("流程列表");
const listPath = await path();
const reenterListed = await page.evaluate(() => {
  const card = [...document.querySelectorAll(".wf__card")].find((c) => (c.innerText || "").includes("订单快照解析"));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.innerText || "").includes("编排")) : null;
  if (btn) btn.click();
  return !!btn;
});
await page.waitForTimeout(1400);
const secondPath = await path();
const secondSteps = await steps();

// 再来一轮，确认不会累积
await click("流程列表");
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".wf__card")].find((c) => (c.innerText || "").includes("订单快照解析"));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.innerText || "").includes("编排")) : null;
  if (btn) btn.click();
});
await page.waitForTimeout(1400);
const thirdPath = await path();
const thirdSteps = await steps();

record(
  "G09 追加步骤只生效一次（纯 SPA 导航）",
  loadedSample && openedMenu && menuOpened && pickedFlow && firstPath === "/workflows/wf-order-snapshot" && listPath === "/workflows" && secondPath === firstPath && thirdPath === firstPath && firstSteps.length > 2 && secondSteps.length === firstSteps.length && thirdSteps.length === firstSteps.length,
  {
    preconditions: { loadedSample, openedMenu, menuOpened, pickedFlow, reenterListed, backToList },
    firstPath, listPath, secondPath, thirdPath,
    firstSteps, secondSteps, thirdSteps,
    appendedOnce: firstSteps.length === secondSteps.length && secondSteps.length === thirdSteps.length
  }
);
console.log("SPACE " + task.spaceId);
if (failures.length) {
  console.error("✗ 失败用例：" + failures.join(" / "));
  process.exit(1);
}
console.log("✓ 追加步骤用例通过（前置条件均已确认）");
