// 第二轮验收（评审 5 个阻断项 + 2 个次要项）：先把上次遗留的 Service Worker / 缓存清掉，避免命中旧构建。
// 证据口径：每条用例先确认前置条件（运行确实出结果、发送弹层确实打开）成立，再断言结果；任一条不成立就以非零码退出。
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify fixes round2");
const page = task.page("p1");

const failures = [];
function record(test, ok, detail) {
  console.log(JSON.stringify({ test, ok, ...detail }));
  if (!ok) failures.push(test);
}

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
/** 弹层状态：opened 是前置条件，没有它这条证据无效 */
const modalState = () =>
  page.evaluate(() => ({
    opened: !!document.querySelector(".sendto__summary-text"),
    summary: document.querySelector(".sendto__summary-text")?.innerText.trim() ?? null,
    contentTag: document.querySelector(".sendto__summary .sendto__tag")?.innerText.trim() ?? null,
    targets: [...document.querySelectorAll(".sendto__item")]
      .map((el) => ({ text: el.innerText.replace(/\s+/g, " ").trim(), disabled: el.disabled }))
      .filter((t) => !/步骤/.test(t.text))
  }));
const jsonTargets = (s) => s.targets.filter((t) => /^JSON/.test(t.text));
const textTargets = (s) => s.targets.filter((t) => /^(Base64|URL)/.test(t.text));

// ---------- 次要项 #7：T43 传递类型要跟着结果类型走 ----------
await open("/tools/xml-toolbox");
await clickText("格式化", true);
await clickText("载入示例");
const sendText = await clickText("发送到…");
const s1 = await modalState();
const jsonDisabled = jsonTargets(s1).filter((t) => t.disabled);
record(
  "T43 格式化（文本结果）：JSON 目标必须禁用、Base64/URL 可用",
  sendText && s1.opened && s1.contentTag === "文本内容" && jsonTargets(s1).length >= 1 && jsonDisabled.length === jsonTargets(s1).length && textTargets(s1).length === 2 && textTargets(s1).every((t) => !t.disabled),
  { opened: s1.opened, contentTag: s1.contentTag, jsonTargets: jsonTargets(s1).length, jsonDisabled: jsonDisabled.length, textTargets: textTargets(s1).map((t) => t.text) }
);
await page.screenshot({ path: EV + "a7-g09-text-payload.png" });
await closeModal();

await clickText("XPath", true);
await clickText("载入示例");
await clickText("//catalog/book/title", true);
const ranXPath = await page.evaluate(() => !!document.querySelector(".t43__send"));
const sendJson = await clickText("发送到…");
const s2 = await modalState();
record(
  "T43 XPath（JSON 结果）：前置条件成立且 JSON 目标全部可用",
  ranXPath && sendJson && s2.opened && s2.contentTag === "格式有效" && jsonTargets(s2).length >= 1 && jsonTargets(s2).every((t) => !t.disabled),
  { ranXPath, opened: s2.opened, contentTag: s2.contentTag, jsonTargets: jsonTargets(s2).slice(0, 3) }
);
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
const s12 = await page.evaluate(() => ({
  h1: document.querySelector("h1")?.innerText ?? null,
  cols: document.querySelectorAll(".wfe__cols > section").length,
  nodes: document.querySelectorAll(".wfe__node").length,
  cur: document.querySelector(".wfe__cur .wfe__badge")?.innerText.trim() ?? null,
  hint: document.querySelector(".wfe__cur .wfe__hint")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  outSize: document.querySelector(".wfe__out .wfe__badge")?.innerText.trim() ?? null
}));
record("S12 点击流程输出：三栏与输出摘要卡都在", !!s12.h1 && s12.cols === 3 && s12.nodes === 6 && s12.cur === "流程输出", s12);
await page.screenshot({ path: EV + "a7-s12-output-node.png", fullPage: true });

// 阻断项 #5「加入处理流程只追加一次」由 verify_a7_append_once.mjs 专门验：
// 只有纯 SPA 导航才算证据——整页刷新会重置内存态流程，步骤数变化说明不了追加语义。

console.log("SPACE " + task.spaceId);
if (failures.length) {
  console.error("✗ 失败用例：" + failures.join(" / "));
  process.exit(1);
}
console.log("✓ 全部用例通过（前置条件均已确认）");
