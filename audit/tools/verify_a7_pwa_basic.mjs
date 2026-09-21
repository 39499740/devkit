// S13 / G10 PWA 验证：安装入口、离线缓存通知、离线提示条、新版本提示
const BASE = "http://localhost:4322";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify A7 pwa");
const page = task.page("p1");

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

// 1) 首页：安装入口 + 安装引导弹层
await page.goto(BASE + "/?cb=" + Date.now());
await page.waitForTimeout(800);
let s = await page.evaluate(() => ({
  badge: document.querySelector(".pwa-install__badge")?.innerText.trim(),
  hasInstallBtn: [...document.querySelectorAll("button")].some((b) => (b.innerText || "").includes("安装 DevKit"))
}));
line({ test: "S13 首页安装入口", badge: s.badge, hasInstallBtn: s.hasInstallBtn });
await clickText("安装 DevKit");
s = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".pwa-guide__row")].map((e) => e.innerText.replace(/\s+/g, " ").trim());
  return {
    title: document.querySelector(".dk-modal h2, .dk-modal__title")?.innerText.trim() ?? document.querySelector(".dk-modal")?.innerText.slice(0, 40),
    rows,
    features: [...document.querySelectorAll(".pwa-guide__feature-title")].map((e) => e.innerText.trim()),
    manual: document.querySelector(".pwa-guide__manual")?.innerText.replace(/\s+/g, " ").trim(),
    foot: document.querySelector(".pwa-guide__foot")?.innerText.trim()
  };
});
line({ test: "S13 安装引导弹层", features: s.features, checks: s.rows, manual: s.manual, foot: s.foot });
await page.screenshot({ path: EV + "a7-s13-pwa-install.png" });

// 2) Service Worker 注册与离线就绪通知
await page.evaluate(() => {
  document.querySelectorAll(".dk-modal button").forEach((b) => {
    if ((b.innerText || "").includes("暂不")) b.click();
  });
});
await page.waitForTimeout(500);
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg && reg.active) return { scope: reg.scope, state: reg.active.state, controller: !!navigator.serviceWorker.controller };
  await new Promise((r) => setTimeout(r, 3000));
  const reg2 = await navigator.serviceWorker.getRegistration();
  return reg2 ? { scope: reg2.scope, state: reg2.active?.state ?? "installing", controller: !!navigator.serviceWorker.controller } : null;
});
line({ test: "G10 Service Worker", sw });

// 3) 离线提示条：用 CDP 真实断网（不再手动派发 DOM 事件；整页重载后的缓存可用性见 verify_a7_real_offline.mjs）
await page.cdp("Network.enable")
await page.cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.waitForTimeout(1200);
s = await page.evaluate(() => ({
  offline: document.querySelector(".pwastatus__offline")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  tools: [...document.querySelectorAll(".pwastatus__tool")].map((e) => e.innerText.trim())
}));
line({ test: "G10 当前离线提示（CDP 真实断网）", onLine: await page.evaluate(() => navigator.onLine), text: s.offline, cachedTools: s.tools });
await page.screenshot({ path: EV + "a7-g10-pwa-offline.png" });
await page.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page.waitForTimeout(1200);
line({ test: "G10 恢复在线", bannerGone: await page.evaluate(() => !document.querySelector(".pwastatus__offline")) });

console.log("SPACE " + task.spaceId);
