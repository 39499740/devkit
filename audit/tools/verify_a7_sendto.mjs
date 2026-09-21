// G09「发送到…」弹层验证：分组、兼容标记、真实传递到目标工具
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify A7 send");
const page = task.page("p1");

const cb = "cb=" + Date.now();

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

// 在 JSON 格式化页生成结果
await page.goto(BASE + "/tools/json-format?" + cb);
await page.waitForTimeout(700);
await clickText("载入示例");
let s = await page.evaluate(() => ({
  out: (document.querySelectorAll("textarea")[1]?.value ?? "").split("\n")[0],
  sendBtn: [...document.querySelectorAll("button")].some((b) => (b.innerText || "").includes("发送到"))
}));
line({ test: "G09 前置：已生成结果", out: s.out, hasSendButton: s.sendBtn });

await clickText("发送到…");
s = await page.evaluate(() => ({
  summary: document.querySelector(".sendto__summary-text")?.innerText.trim(),
  tags: [...document.querySelectorAll(".sendto__summary .sendto__tag")].map((e) => e.innerText.trim()),
  groups: [...document.querySelectorAll(".sendto__group")].map((e) => e.innerText.trim()),
  items: [...document.querySelectorAll(".sendto__item")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  foot: document.querySelector(".sendto__foot-note")?.innerText.replace(/\s+/g, " ").trim(),
  newFlow: !!document.querySelector(".sendto__newflow-input")
}));
line({ test: "G09 弹层内容", summary: s.summary, tags: s.tags, groups: s.groups, foot: s.foot, newFlow: s.newFlow });
line({ test: "G09 路由项", items: s.items });
await page.screenshot({ path: EV + "a7-g09-sendto.png", fullPage: false });

// 选中 JSONPath 查询并继续
const picked = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".sendto__item")].find((el) => (el.innerText || "").includes("JSONPath 查询"));
  if (!item) return false;
  item.click();
  return true;
});
await page.waitForTimeout(300);
await clickText("继续处理", true);
await page.waitForTimeout(1200);
s = await page.evaluate(() => ({
  url: location.pathname,
  source: document.querySelector(".t44__source-text")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  memoryTag: document.querySelector(".t44__source .t44__badge")?.innerText.trim() ?? null,
  inputLen: document.querySelectorAll("textarea")[0]?.value.length ?? 0,
  rows: document.querySelectorAll(".t44__pathrow").length,
  status: document.querySelector(".statusbar")?.innerText.replace(/\s+/g, " ").trim()
}));
line({ test: "G09 传递到 JSONPath 查询", picked, ...s });
await page.screenshot({ path: EV + "a7-g09-transfer-result.png", fullPage: true });

console.log("SPACE " + task.spaceId);
