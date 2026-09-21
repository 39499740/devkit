// G10 阶段一：注册 SW、让页面被 SW 接管、并验证安装条件三项均已就绪
const BASE = "http://localhost:4322";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify A7 update");
const page = task.page("p1");

await page.goto(BASE + "/?cb=" + Date.now());
await page.waitForTimeout(3000);
await page.reload();
await page.waitForTimeout(2500);

const s = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return {
    sw: reg ? { scope: reg.scope, state: reg.active?.state ?? null, waiting: !!reg.waiting, installing: !!reg.installing } : null,
    controller: !!navigator.serviceWorker.controller,
    manifest: !!document.querySelector('link[rel="manifest"]'),
    manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null
  };
});
console.log(JSON.stringify({ test: "阶段一 SW 接管", ...s }));

// 打开安装引导弹层，确认三项检查
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").includes("安装 DevKit"));
  if (btn) btn.click();
});
await page.waitForTimeout(600);
console.log(
  JSON.stringify({
    test: "S13 条件检查",
    rows: await page.evaluate(() => [...document.querySelectorAll(".pwa-guide__row")].map((e) => e.innerText.replace(/\s+/g, " ").trim()))
  })
);
await page.screenshot({ path: EV + "a7-s13-pwa-install.png" });
console.log("SPACE " + task.spaceId);
