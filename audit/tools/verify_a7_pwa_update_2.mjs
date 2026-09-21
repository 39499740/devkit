// G10 阶段二：新版本提示 → 稍后 → 重新提示 → 立即更新（真实 SW waiting 状态）
const BASE = "http://localhost:4322";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace(18);
const page = task.page("p1");

function line(o) {
  console.log(JSON.stringify(o));
}

const modalText = () =>
  page.evaluate(() => {
    const el = document.querySelector(".pwastatus__update");
    return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
  });

const clickModal = (label) =>
  page.evaluate((l) => {
    const btns = [...document.querySelectorAll("button")].filter((b) => (b.innerText || "").trim() === l);
    const btn = btns[btns.length - 1];
    if (!btn) return false;
    btn.click();
    return true;
  }, label);

// 关闭可能还开着的安装弹层
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "暂不");
  if (b) b.click();
});
await page.waitForTimeout(400);

let text = await modalText();
if (!text) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  });
  await page.waitForTimeout(3000);
  text = await modalText();
}
line({ test: "G10 新版本提示", modal: text, hasWaiting: await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting) });
await page.screenshot({ path: EV + "a7-g10-pwa-update.png" });

line({ test: "G10 点「稍后」", clicked: await clickModal("稍后"), closed: !(await modalText()) });

// 重新加载后应再次提示
await page.reload();
await page.waitForTimeout(2500);
text = await modalText();
line({ test: "G10 刷新后重新提示", modal: text ? text.slice(0, 60) : null });

const clicked = await clickModal("立即更新");
line({ test: "G10 点「立即更新」", clicked });
await page.waitForTimeout(4000);
line({
  test: "G10 更新后状态",
  modal: (await modalText()) ? "still-visible" : "gone",
  sw: await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { waiting: !!reg?.waiting, state: reg?.active?.state ?? null, controller: !!navigator.serviceWorker.controller };
  })
});
console.log("SPACE " + task.spaceId);
