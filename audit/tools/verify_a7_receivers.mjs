// G09 接收端覆盖：transferTargets 里列出的目标必须真的收得到内容。
// 回归：base64 / url-encode 两个目标在菜单里标「完全兼容」，但页面没有 take()，点进去没反应、载荷 5 分钟后静默过期。
const BASE = "http://localhost:4321";
const task = await taskSpace("verify receivers");
const page = task.page("p1");

await page.goto(BASE + "/offline-fallback.html?cb=" + Date.now());
await page.waitForTimeout(400);
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
});

async function open(p) {
  await page.goto(BASE + p + (p.includes("?") ? "&" : "?") + "cb=" + Date.now());
  await page.waitForTimeout(800);
}
async function clickText(label, exact = false) {
  const ok = await page.evaluate(({ l, ex }) => {
    const els = [...document.querySelectorAll("button, a")];
    const el = els.find((b) => (ex ? (b.innerText || "").trim() === l : (b.innerText || "").includes(l)));
    if (!el) return false;
    el.click();
    return true;
  }, { l: label, ex: exact });
  await page.waitForTimeout(650);
  return ok;
}
const failures = [];
const record = (test, ok, detail) => {
  console.log(JSON.stringify({ test, ok, ...detail }));
  if (!ok) failures.push(test);
};
const paneValues = () =>
  page.evaluate(() => {
    const areas = [...document.querySelectorAll("textarea")].map((t) => t.value);
    return { count: areas.length, input: (areas[0] || "").length, output: (areas[1] || "").length, snippet: (areas[1] || "").slice(0, 40) };
  });

// 来源：XML 工具箱的格式化模式（结果 kind 是文本；文本目标才会出现在菜单里）
const PAYLOAD = "<a>hi</a>"
for (const [label, slug] of [["Base64 编解码", "/tools/base64"], ["URL 编解码", "/tools/url-encode"]]) {
  await open("/tools/xml-toolbox");
  const switched = await clickText("格式化", true);
  const typed = await page.evaluate((v) => {
    const ta = document.querySelectorAll("textarea")[0];
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, v);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, PAYLOAD);
  await page.waitForTimeout(200);
  const ran = await clickText("执行", true);
  const sent = await page.evaluate(() => (document.querySelectorAll("textarea")[1] || { value: "" }).value);
  const opened = await clickText("发送到…");
  const menuOpened = await page.evaluate(() => !!document.querySelector(".sendto__summary-text"));
  const picked = await page.evaluate((l) => {
    const item = [...document.querySelectorAll(".sendto__item")].find((el) => (el.innerText || "").includes(l));
    if (!item || item.disabled) return false;
    item.click();
    return true;
  }, label);
  await page.waitForTimeout(300);
  const confirmed = await clickText("继续处理", true);
  await page.waitForTimeout(1200);
  const arrived = await page.evaluate(() => location.pathname);
  const panes = await paneValues();
  const received = await page.evaluate(() => (document.querySelectorAll("textarea")[0] || { value: "" }).value);
  record(
    `G09 目标「${label}」真的收到内容`,
    switched && typed && ran && opened && menuOpened && picked && confirmed && arrived === slug && sent.length > 0 && received.trim() === sent.trim() && panes.output > 0,
    { label, arrived, sent, received: received.slice(0, 40), panes, preconditions: { switched, typed, ran, opened, menuOpened, picked, confirmed } }
  );
}
console.log("SPACE " + task.spaceId);
if (failures.length) {
  console.error("✗ 失败用例：" + failures.join(" / "));
  process.exit(1);
}
console.log("✓ 接收端用例通过（前置条件均已确认）");
