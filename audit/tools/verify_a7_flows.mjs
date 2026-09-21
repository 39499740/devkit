// S11 / S12 / G09 / S13 / G10 验证（ego-browser / computer use）
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify A7 flows");
const page = task.page("p1");

async function open(path) {
  await page.goto(BASE + path + (path.includes("?") ? "&" : "?") + "cb=" + Date.now());
  await page.waitForTimeout(700);
}

async function clickText(label, exact = false) {
  const ok = await page.evaluate(
    ({ l, ex }) => {
      const btns = [...document.querySelectorAll("button, a")];
      const btn = btns.find((b) => {
        const t = (b.innerText || "").trim();
        return ex ? t === l : t.includes(l);
      });
      if (!btn) return false;
      btn.click();
      return true;
    },
    { l: label, ex: exact }
  );
  await page.waitForTimeout(600);
  return ok;
}

function line(o) {
  console.log(JSON.stringify(o));
}

// S11 流程列表
await open("/workflows");
let s = await page.evaluate(() => ({
  title: document.querySelector("h1")?.innerText,
  cards: [...document.querySelectorAll(".wf__card-name")].map((e) => e.innerText.trim()),
  chains: [...document.querySelectorAll(".wf__chain")].map((e) => e.innerText.replace(/\s+/g, " ").trim().slice(0, 90)),
  runEmpty: document.querySelector(".wf__empty")?.innerText.replace(/\s+/g, " ").slice(0, 80) ?? null,
  navCount: [...document.querySelectorAll(".sidenav__item")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
}));
line({ test: "S11 列表", title: s.title, cards: s.cards, nav: s.navCount.filter((t) => t.includes("处理流程")), runEmpty: s.runEmpty, overflowX: s.overflowX });
line({ test: "S11 步骤链", chains: s.chains });

// 运行第一条流程
await clickText("运行", true);
s = await page.evaluate(() => ({
  runs: [...document.querySelectorAll(".wf__run")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  foot: document.querySelector(".wf__runs-foot")?.innerText.replace(/\s+/g, " ").trim(),
  cardFoot: document.querySelector(".wf__run-info")?.innerText.replace(/\s+/g, " ").trim()
}));
line({ test: "S11 运行真实流程", runCount: s.runs.length, first: s.runs[0], foot: s.foot, cardFoot: s.cardFoot });
await page.screenshot({ path: EV + "a7-s11-workflows.png", fullPage: true });

// S12 编排页
await open("/workflows/wf-order-snapshot");
s = await page.evaluate(() => ({
  title: document.querySelector("h1")?.innerText,
  desc: document.querySelector(".wfe__desc")?.innerText,
  nodes: [...document.querySelectorAll(".wfe__node-name")].map((e) => e.innerText.trim()),
  lib: document.querySelectorAll(".wfe__lib-item").length,
  chainMark: document.querySelector(".wfe__chain .wfe__badge")?.innerText.trim(),
  overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
}));
line({ test: "S12 初始状态", title: s.title, desc: s.desc, nodes: s.nodes, libCount: s.lib, chainMark: s.chainMark, overflowX: s.overflowX });

// 填入 Base64 输入并运行全部
await page.evaluate(() => {
  const ta = document.querySelectorAll("textarea")[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, btoa(JSON.stringify({ order: { id: "o-1001", total: 199.5, items: [{ sku: "A-1", qty: 2 }] } })));
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(300);
await open("/workflows/wf-order-snapshot");
await page.evaluate(() => {
  const ta = document.querySelectorAll("textarea")[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, btoa(JSON.stringify({ order: { id: "o-1001", total: 199.5, items: [{ sku: "A-1", qty: 2 }] } })));
  ta.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(300);
await clickText("运行全部", true);
s = await page.evaluate(() => ({
  ops: document.querySelector(".wfe__ops-count")?.innerText.trim(),
  chainMark: document.querySelector(".wfe__chain .wfe__badge")?.innerText.trim(),
  dots: [...document.querySelectorAll(".wfe__node-dot")].map((e) => e.className.replace("wfe__node-dot", "").trim()),
  marks: [...document.querySelectorAll(".wfe__node-marks")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  console: document.querySelector(".wfe__console")?.innerText.replace(/\s+/g, " ").slice(0, 200),
  out: document.querySelectorAll(".wfe__node-sub")[document.querySelectorAll(".wfe__node-sub").length - 1]?.innerText
}));
line({ test: "S12 运行全部", ops: s.ops, chainMark: s.chainMark, dots: s.dots, lastNode: s.out, console: s.console });
line({ test: "S12 步骤耗时", marks: s.marks.filter(Boolean).slice(0, 4) });
await page.screenshot({ path: EV + "a7-s12-workflow-editor.png", fullPage: true });

// 单步运行最后一步
await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".wfe__node")];
  nodes[nodes.length - 2].click();
});
await page.waitForTimeout(400);
await clickText("重试此步", true);
s = await page.evaluate(() => ({
  cur: document.querySelector(".wfe__cur .wfe__badge")?.innerText.trim(),
  console: document.querySelector(".wfe__console")?.innerText.replace(/\s+/g, " ").slice(0, 160),
  stat: document.querySelector(".wfe__stat")?.innerText.replace(/\s+/g, " ").trim()
}));
line({ test: "S12 单步运行", current: s.cur, console: s.console, stat: s.stat });

console.log("SPACE " + task.spaceId);
