// A7 新增页面功能验证（ego-browser / computer use）——生产构建静态服务 + 缓存穿透
const BASE = "http://localhost:4321";
const EV = "/Users/hao/WebstormProjects/web_tools/audit/evidence/";
const task = await taskSpace("verify A7 pages");
const page = task.page("p1");

async function open(path) {
  await page.goto(BASE + path + (path.includes("?") ? "&" : "?") + "cb=" + Date.now());
  await page.waitForTimeout(700);
}

async function clickText(label) {
  const ok = await page.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText || "").trim().includes(l));
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
  await page.waitForTimeout(500);
  return ok;
}

function line(o) {
  console.log(JSON.stringify(o));
}

const common = () =>
  page.evaluate(() => ({
    status: document.querySelector(".statusbar")?.innerText.replace(/\s+/g, " ") ?? null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
  }));

// 1) T42
await open("/tools/sql-format");
await clickText("载入示例");
let s = await page.evaluate(() => ({
  out: document.querySelectorAll("textarea")[1]?.value ?? "",
  inLen: document.querySelectorAll("textarea")[0]?.value.length ?? 0
}));
let c = await common();
line({ test: "T42 SQL 格式化", status: c.status, inputChars: s.inLen, outFirst: s.out.split("\n")[0], outHasSelect: s.out.includes("SELECT"), outLines: s.out.split("\n").length, overflowX: c.overflowX });
await clickText("压缩");
s = await page.evaluate(() => ({ out: document.querySelectorAll("textarea")[1]?.value ?? "" }));
line({ test: "T42 压缩", single: !s.out.includes("\n"), outLen: s.out.length });
await page.screenshot({ path: EV + "a7-t42-sql-format.png", fullPage: true });

// 2) T43
await open("/tools/xml-toolbox");
await clickText("载入示例");
c = await common();
const x = await page.evaluate(() => ({
  matchBadge: document.querySelector(".t43__badge")?.innerText.trim(),
  items: [...document.querySelectorAll(".t43__item-path")].map((e) => e.innerText.trim()),
  marks: document.querySelectorAll(".t43__hit").length,
  values: [...document.querySelectorAll(".t43__item-value")].map((e) => e.innerText.trim())
}));
line({ test: "T43 XPath 查询", status: c.status, matchBadge: x.matchBadge, paths: x.items, highlightCount: x.marks, values: x.values, overflowX: c.overflowX });
await page.screenshot({ path: EV + "a7-t43-xml-xpath.png", fullPage: true });

// 3) T44 JSONPath
await open("/tools/jsonpath-query");
await clickText("载入示例");
c = await common();
let r = await page.evaluate(() => ({
  rows: [...document.querySelectorAll(".t44__pathrow")].map((el) => el.innerText.replace(/\s+/g, " ").trim()),
  result: document.querySelectorAll("textarea")[1]?.value ?? ""
}));
line({ test: "T44 JSONPath", status: c.status, rowCount: r.rows.length, rows: r.rows.slice(0, 4), resultFirst: r.result.split("\n")[1], overflowX: c.overflowX });
await page.screenshot({ path: EV + "a7-t44-jsonpath.png", fullPage: true });
await clickText("JMESPath");
r = await page.evaluate(() => ({
  rows: [...document.querySelectorAll(".t44__pathrow")].map((el) => el.innerText.replace(/\s+/g, " ").trim()),
  expr: document.querySelector(".t44__expr-input")?.value
}));
line({ test: "T44 JMESPath", expr: r.expr, rowCount: r.rows.length, sample: r.rows[0] });

// 4) T45 JSON Schema
await open("/tools/json-schema");
await clickText("载入示例");
c = await common();
const v = await page.evaluate(() => ({
  errors: [...document.querySelectorAll(".t45__error-head")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
  schemaPaths: [...document.querySelectorAll(".t45__error-sub")].map((e) => e.innerText.trim()),
  foot: document.querySelectorAll(".t45__panelfoot")[1]?.innerText.replace(/\s+/g, " ").trim()
}));
line({ test: "T45 校验示例", status: c.status, errorCount: v.errors.length, errors: v.errors, schemaPaths: v.schemaPaths, foot: v.foot, overflowX: c.overflowX });
await page.screenshot({ path: EV + "a7-t45-json-schema.png", fullPage: true });
await clickText("从 JSON 生成 Schema");
const g = await page.evaluate(() => ({
  schema: (document.querySelectorAll("textarea")[1]?.value ?? "").slice(0, 120),
  status: document.querySelectorAll(".t45__panelfoot")[0]?.innerText.replace(/\s+/g, " ").trim()
}));
line({ test: "T45 生成 Schema", schemaHead: g.schema, foot: g.status });

console.log("SPACE " + task.spaceId);
