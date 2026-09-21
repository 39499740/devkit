// 第二轮验收 · T43 传递类型（按当前模式切换后重测）+ 流程追加只生效一次
// 注意：本脚本只打印观察值、不做断言，按证据口径不计入验收。
// T43 两类结果的断言见 verify_a7_fixes.mjs，SPA 追加只生效一次见 verify_a7_append_once.mjs。
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify fixes round2b");
const page = task.page("p1");

await page.goto(BASE + "/offline-fallback.html?cb=" + Date.now());
await page.waitForTimeout(400);
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  for (const k of await caches.keys()) await caches.delete(k)
});

async function open(path) {
  await page.goto(BASE + path + (path.includes("?") ? "&" : "?") + "cb=" + Date.now());
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
const closeModal = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => ["取消", "暂不"].includes((x.innerText || "").trim()));
    if (b) b.click();
  });
  await page.waitForTimeout(400);
};
const line = (o) => console.log(JSON.stringify(o));
const modalState = () =>
  page.evaluate(() => ({
    summary: document.querySelector(".sendto__summary-text")?.innerText.trim() ?? null,
    contentTag: document.querySelector(".sendto__summary .sendto__tag")?.innerText.trim() ?? null,
    targets: [...document.querySelectorAll(".sendto__item")].map((el) => ({
      text: el.innerText.replace(/\s+/g, " ").trim(),
      disabled: el.disabled
    })).filter((t) => !/步骤/.test(t.text))
  }));

// T43：格式化模式（XML 文本结果）
await open("/tools/xml-toolbox");
await clickText("格式化", true);
await clickText("载入示例");
await clickText("发送到…");
let s = await modalState();
line({ test: "T43 格式化（文本结果）", summary: s.summary, contentTag: s.contentTag, targets: s.targets });
await page.screenshot({ path: EV + "a7-g09-text-payload.png" });
await closeModal();

// T43：XML → JSON 模式（JSON 结果）
await clickText("XML ↔ JSON");
await clickText("发送到…");
s = await modalState();
line({ test: "T43 XML→JSON（JSON 结果）", summary: s.summary, contentTag: s.contentTag, targets: s.targets.slice(0, 3) });
await closeModal();

// ---------- 追加步骤：只生效一次 ----------
await open("/tools/json-format");
await clickText("载入示例");
await clickText("发送到…");
await page.evaluate(() => {
  const item = [...document.querySelectorAll(".sendto__item")].find((el) => (el.innerText || "").includes("订单快照解析"));
  if (item) item.click();
});
await page.waitForTimeout(1400);
const first = await page.evaluate(() => ({
  path: location.pathname,
  steps: [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim())
}));
await open("/workflows");
await page.evaluate(() => {
  const card = [...document.querySelectorAll(".wf__card")].find((c) => (c.innerText || "").includes("订单快照解析"));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => (b.innerText || "").includes("编排")) : null;
  if (btn) btn.click();
});
await page.waitForTimeout(1400);
const second = await page.evaluate(() => ({
  path: location.pathname,
  steps: [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim())
}));
line({ test: "G09 追加步骤只生效一次", firstPath: first.path, firstSteps: first.steps, secondSteps: second.steps });
await page.screenshot({ path: EV + "a7-g09-append-once.png", fullPage: true });

console.log("SPACE " + task.spaceId);
