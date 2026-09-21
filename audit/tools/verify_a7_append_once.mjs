// 追加步骤回归（纯 SPA 导航，不做整页刷新）：第一次进入 +1 步，返回列表再进入不得再加
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
const line = (o) => console.log(JSON.stringify(o));

await click("载入示例");
await click("发送到…");
await page.evaluate(() => {
  const item = [...document.querySelectorAll(".sendto__item")].find((el) => (el.innerText || "").includes("订单快照解析"));
  if (item) item.click();
});
await page.waitForTimeout(1400);
const first = await page.evaluate(() => location.pathname);
const firstSteps = await steps();

// 纯客户端导航：流程列表 → 再进同一条流程
await click("流程列表");
const listPath = await page.evaluate(() => location.pathname);
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".wf__card")].find((c) => (c.innerText || "").includes("订单快照解析"));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.innerText || "").includes("编排")) : null;
  if (btn) btn.click();
});
await page.waitForTimeout(1400);
const secondPath = await page.evaluate(() => location.pathname);
const secondSteps = await steps();

// 再来一轮，确认不会累积
await click("流程列表");
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".wf__card")].find((c) => (c.innerText || "").includes("订单快照解析"));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.innerText || "").includes("编排")) : null;
  if (btn) btn.click();
});
await page.waitForTimeout(1400);
const thirdSteps = await steps();

line({
  test: "G09 追加步骤只生效一次（SPA 导航）",
  firstPath: first,
  firstSteps,
  listPath,
  secondPath,
  secondSteps,
  thirdSteps,
  appendedOnce: firstSteps.length === 7 && secondSteps.length === 7 && thirdSteps.length === 7
});
console.log("SPACE " + task.spaceId);
