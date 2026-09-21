// 第二轮验收（评审 5 个阻断项 + 2 个次要项）：先清掉上次遗留的 Service Worker / 缓存，避免命中旧构建
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify fixes round2");
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
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "取消" || (x.innerText || "").trim() === "暂不");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
};
const line = (o) => console.log(JSON.stringify(o));

// ---------- 次要项 #7：T43 传递类型要跟着结果类型走 ----------
await open("/tools/xml-toolbox");
await clickText("载入示例");
await clickText("发送到…");
let s = await page.evaluate(() => ({
  summary: document.querySelector(".sendto__summary-text")?.innerText.trim(),
  tags: [...document.querySelectorAll(".sendto__summary .sendto__tag")].map((e) => e.innerText.trim()),
  compat: [...document.querySelectorAll(".sendto__item")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter((t) => !/步骤/.test(t))
}));
line({ test: "T43 格式化（XML 文本）", summary: s.summary, tags: s.tags, targets: s.compat });
await closeModal();
await clickText("XPath");
await clickText("查询");
await clickText("发送到…");
s = await page.evaluate(() => ({
  summary: document.querySelector(".sendto__summary-text")?.innerText.trim(),
  tags: [...document.querySelectorAll(".sendto__summary .sendto__tag")].map((e) => e.innerText.trim()),
  targets: [...document.querySelectorAll(".sendto__item")].map((e) => e.innerText.replace(/\s+/g, " ").trim()).filter((t) => !/步骤/.test(t))
}));
line({ test: "T43 XPath（JSON 结果）", summary: s.summary, tags: s.tags, targets: s.targets.slice(0, 4) });
await closeModal();

// ---------- 阻断项 #4：点击「流程输出」不再清空界面 ----------
await open("/workflows/wf-order-snapshot");
await page.evaluate(() => {
  const ta = document.querySelectorAll("textarea")[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, btoa(JSON.stringify({ order: { id: "o-1001", total: 199.5, items: [{ sku: "A-1", qty: 2 }] } })));
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(300);
await clickText("运行全部", true);
await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".wfe__node")];
  const last = nodes[nodes.length - 1];
  if (last) last.click();
});
await page.waitForTimeout(700);
s = await page.evaluate(() => ({
  h1: document.querySelector("h1")?.innerText ?? null,
  cols: document.querySelectorAll(".wfe__cols > section").length,
  nodes: document.querySelectorAll(".wfe__node").length,
  cur: document.querySelector(".wfe__cur .wfe__badge")?.innerText.trim() ?? null,
  hint: document.querySelector(".wfe__cur .wfe__hint")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  outSize: document.querySelector(".wfe__out .wfe__badge")?.innerText.trim() ?? null
}));
line({ test: "S12 点击流程输出", ...s, ok: !!s.h1 && s.cols === 3 && s.nodes === 6 && s.cur === "流程输出" });
await page.screenshot({ path: EV + "a7-s12-output-node.png", fullPage: true });

// ---------- 阻断项 #5：「加入处理流程」只追加一次 ----------
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
  count: document.querySelectorAll(".wfe__node-name").length,
  nodes: [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim())
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
  count: document.querySelectorAll(".wfe__node-name").length,
  nodes: [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim())
}));
line({ test: "G09 加入处理流程只追加一次", firstPath: first.path, firstCount: first.count, secondCount: second.count, firstNodes: first.nodes, secondNodes: second.nodes });
await page.screenshot({ path: EV + "a7-g09-append-once.png", fullPage: true });

console.log("SPACE " + task.spaceId);
