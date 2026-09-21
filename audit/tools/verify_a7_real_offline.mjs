// 真实离线验证：CDP 模拟断网（不是手动派发 DOM 事件）
const BASE = "http://localhost:4323";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify real offline");
const page = task.page("p1");
const line = (o) => console.log(JSON.stringify(o));

await page.goto(BASE + "/tools/sql-format?cb=" + Date.now());
await page.waitForTimeout(3500);
// 等 Service Worker 激活并接管
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg && !reg.active) await new Promise((r) => setTimeout(r, 1500));
  const r2 = await navigator.serviceWorker.getRegistration();
  return { scope: r2?.scope ?? null, state: r2?.active?.state ?? null };
});
await page.reload();
await page.waitForTimeout(2500);
const online = await page.evaluate(() => ({ onLine: navigator.onLine, controller: !!navigator.serviceWorker.controller }));
line({ test: "离线前", sw, ...online });

// 真正断网
await page.cdp("Network.enable")
await page.cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.waitForTimeout(1200);
const offState = await page.evaluate(() => ({
  onLine: navigator.onLine,
  banner: document.querySelector(".pwastatus__offline")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  tools: [...document.querySelectorAll(".pwastatus__tool")].map((e) => e.innerText.trim())
}));
line({ test: "断网后（当前页面）", ...offState });
await page.screenshot({ path: EV + "a7-g10-real-offline.png" });

// 断网下重新加载已缓存页面
await page.reload();
await page.waitForTimeout(3000);
const reloaded = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector("h1")?.innerText ?? null,
  online: navigator.onLine,
  banner: document.querySelector(".pwastatus__offline")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  toolbar: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 6),
  offlineFallback: document.body.innerText.includes("无法加载该页面")
}));
line({ test: "断网后重新加载已缓存页面", ...reloaded });
await page.screenshot({ path: EV + "a7-g10-real-offline-reload.png", fullPage: true });

// 恢复网络
await page.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.waitForTimeout(1200);
line({ test: "恢复网络", onLine: await page.evaluate(() => navigator.onLine), banner: await page.evaluate(() => !!document.querySelector(".pwastatus__offline")) });
console.log("SPACE " + task.spaceId);
