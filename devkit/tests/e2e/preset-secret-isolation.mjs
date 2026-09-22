/**
 * e2e（ego-browser，真实页面）：重复添加同一含密钥预设后，两条流程的密钥互不影响。
 *
 * 覆盖 2026-09-22 复审发现的 P1：密钥记录原先只按 stepId 定位，第二条流程写密钥会删掉
 * 第一条的记录（回到第一条流程时密钥与 IV 变空并提示「缺少密钥」）。
 *
 * 跑法：
 *   cd devkit && npm run generate
 *   node tests/e2e/preset-secret-isolation.mjs
 *
 * 脚本自带静态服务器（tests/e2e/static-server.mjs 起 .output/public），跑完自动关闭；
 * 不在 npm test / npm run test:dom 的自动发现范围内（需要构建产物 + 真实浏览器）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', '..', '.output', 'public')
if (!existsSync(publicDir)) {
  console.error('✗ 缺少构建产物，请先执行 npm run generate')
  process.exit(1)
}

const server = spawn(process.execPath, [join(here, 'static-server.mjs'), publicDir, '4399'], { stdio: 'ignore' })
const stopServer = () => server.kill()
process.on('exit', stopServer)
process.on('SIGINT', () => {
  stopServer()
  process.exit(130)
})

// 等静态服务器就绪
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch('http://127.0.0.1:4399/workflows/')
    if (res.ok) break
  } catch {
    /* 还没起来 */
  }
  await new Promise((r) => setTimeout(r, 100))
}

const BASE = 'http://127.0.0.1:4399'
const PRESET = 'AES 响应解密'
const STEP = 'AES-GCM 加解密'

const script = `
const task = await taskSpace("devkit p1 verify");
const page = task.page("p1");
const BASE = ${JSON.stringify(BASE)};
const out = { steps: [], asserts: [] };
const ok = (name, pass, detail) => out.asserts.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000, label = "未命名") => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let v = null;
    try { v = fn(); } catch (_) {}
    if (v) return v;
    await sleep(100);
  }
  throw new Error("等待超时");
};

// ① 在列表页点「添加」并走完风险确认
async function addPreset() {
  await page.goto(BASE + "/workflows/");
  const res = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 10000, label = "未命名") => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { let v = null; try { v = fn(); } catch (_) {} if (v) return v; await sleep(100); }
      throw new Error("等待超时：" + label);
    };
    const card = await waitFor(() => [...document.querySelectorAll(".wf__preset")].find((el) => el.textContent.includes(${JSON.stringify(PRESET)})));
    const add = [...card.querySelectorAll("button")].find((b) => b.textContent.includes("添加"));
    if (!add) throw new Error("没找到添加按钮");
    add.click();
    const confirm = await waitFor(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "我已知晓并添加"), 4000, "风险确认弹窗").catch(() => null);
    if (confirm) {
      const box = document.querySelector('input[type="checkbox"]');
      if (box && !box.checked) box.click();
      await sleep(200);
      if (confirm.disabled) throw new Error("勾选后确认按钮仍不可用");
      confirm.click();
    }
    await waitFor(() => location.pathname.startsWith("/workflows/wf-"), 10000, "跳转到编排页");
    return location.pathname + (confirm ? " (经确认)" : " (未弹确认)");
  });
  out.steps.push("添加预设 -> " + res);
  return res;
}

async function snapshot() {
  return await page.evaluate(() => {
    const wf = JSON.parse(localStorage.getItem("devkit-workflows-v2") || "{}");
    const sec = JSON.parse(localStorage.getItem("devkit-workflow-secrets-v1") || "{}");
    const mine = (wf.items || []).filter((w) => w.name.includes(${JSON.stringify(PRESET)}));
    return {
      workflows: mine.map((w) => ({ id: w.id, steps: w.steps.map((s) => s.id) })),
      secrets: (sec.items || []).map((s) => ({ workflowId: s.workflowId, stepId: s.stepId, fields: s.fields }))
    };
  });
}

// ② 在编排页选中加解密步骤并填写密钥 / IV
async function fill(id, key, iv) {
  await page.goto(BASE + "/workflows/" + id);
  const res = await page.evaluate(async (args) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 10000, label = "未命名") => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { let v = null; try { v = fn(); } catch (_) {} if (v) return v; await sleep(100); }
      throw new Error("等待超时：" + label);
    };
    const node = await waitFor(() => [...document.querySelectorAll("div.wfe__node")].find((el) => el.textContent.includes(${JSON.stringify(STEP)})), 10000, "编排页的加解密步骤节点");
    node.click();
    const keyInput = await waitFor(() => document.querySelector('input[aria-label="密钥"]'), 10000, "密钥输入框");
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(keyInput, args.key);
    await sleep(200);
    const ivInput = await waitFor(() => document.querySelector('input[aria-label^="IV"]'), 10000, "IV 输入框");
    set(ivInput, args.iv);
    await sleep(400);
    const sec = JSON.parse(localStorage.getItem("devkit-workflow-secrets-v1") || "{}");
    const mine = (sec.items || []).filter((s) => s.workflowId === args.id);
    return {
      records: mine.map((s) => ({ stepId: s.stepId, fields: s.fields })),
      keyShown: document.querySelector('input[aria-label="密钥"]').value,
      missing: document.body.textContent.includes("缺少密钥")
    };
  }, { id, key, iv });
  return res;
}

// ③ 删除一条流程里的加解密步骤
async function deleteStep(id) {
  await page.goto(BASE + "/workflows/" + id);
  return await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 10000, label = "未命名") => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { let v = null; try { v = fn(); } catch (_) {} if (v) return v; await sleep(100); }
      throw new Error("等待超时：" + label);
    };
    const node = await waitFor(() => [...document.querySelectorAll("div.wfe__node")].find((el) => el.textContent.includes(${JSON.stringify(STEP)})), 10000, "待删除的步骤节点");
    const del = node.querySelector('button[title="删除该步骤"]');
    if (!del) throw new Error("没找到删除按钮");
    del.click();
    await sleep(400);
    const wf = JSON.parse(localStorage.getItem("devkit-workflows-v2") || "{}");
    const sec = JSON.parse(localStorage.getItem("devkit-workflow-secrets-v1") || "{}");
    return {
      steps: (wf.items || []).filter((w) => w.id === location.pathname.split("/").pop()).map((w) => w.steps.length),
      secrets: (sec.items || []).map((s) => ({ workflowId: s.workflowId, stepId: s.stepId }))
    };
  });
}

try {
  await page.goto(BASE + "/workflows/");
  await page.evaluate(() => localStorage.clear());
  await sleep(300);
  const first = await addPreset();
  const second = await addPreset();
  ok("两次添加都进入编排页", first.startsWith("/workflows/wf-") && second.startsWith("/workflows/wf-"), first + " / " + second);

  const snap = await snapshot();
  const a = snap.workflows[0];
  const b = snap.workflows[1];
  ok("列表里出现两条同名预设流程", snap.workflows.length === 2, JSON.stringify(snap.workflows.map((w) => w.id)));
  ok("两条流程 ID 不同", a && b && a.id !== b.id, (a && a.id) + " / " + (b && b.id));
  ok("两条流程的步骤 ID 不重复", a && b && a.steps.every((s, i) => s !== b.steps[i]), JSON.stringify(a && a.steps));

  const fillA = await fill(a.id, "0123456789abcdef0123456789abcdef", "00112233445566778899aabb");
  ok("第一条流程写入自己的密钥", fillA.records.length === 1 && fillA.records[0].fields.key === "0123456789abcdef0123456789abcdef", JSON.stringify(fillA.records));

  const fillB = await fill(b.id, "ffffffffffffffffffffffffffffffff", "ffeeddccbbaa998877665544");
  const afterB = await snapshot();
  const recA = afterB.secrets.find((s) => s.workflowId === a.id);
  const recB = afterB.secrets.find((s) => s.workflowId === b.id);
  ok("第二条流程写入后，第一条的密钥仍在", !!recA && recA.fields.key === "0123456789abcdef0123456789abcdef", JSON.stringify(recA));
  ok("第一条的 IV 仍在", !!recA && recA.fields.iv === "00112233445566778899aabb", JSON.stringify(recA));
  ok("第二条流程用自己的密钥", !!recB && recB.fields.key === "ffffffffffffffffffffffffffffffff", JSON.stringify(recB));
  ok("密钥记录共两条", afterB.secrets.length === 2, afterB.secrets.length);

  await page.goto(BASE + "/workflows/" + a.id);
  const backA = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 10000, label = "未命名") => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { let v = null; try { v = fn(); } catch (_) {} if (v) return v; await sleep(100); }
      throw new Error("等待超时：" + label);
    };
    const node = await waitFor(() => [...document.querySelectorAll("div.wfe__node")].find((el) => el.textContent.includes(${JSON.stringify(STEP)})), 10000, "第一条流程的加解密步骤");
    node.click();
    const input = await waitFor(() => document.querySelector('input[aria-label="密钥"]'), 10000, "第一条流程的密钥输入框");
    await sleep(200);
    return { key: input.value, missing: document.body.textContent.includes("缺少密钥") };
  });
  ok("回到第一条流程仍显示自己的密钥", backA.key === "0123456789abcdef0123456789abcdef", JSON.stringify(backA));
  ok("第一条流程不再提示缺少密钥", backA.missing === false, JSON.stringify(backA));

  const del = await deleteStep(b.id);
  const afterDel = await snapshot();
  ok("删除第二条流程的步骤后，第一条的密钥不受影响", !!afterDel.secrets.find((s) => s.workflowId === a.id), JSON.stringify(afterDel.secrets));
  ok("被删步骤的密钥记录同时清掉", !afterDel.secrets.find((s) => s.workflowId === b.id), JSON.stringify(del.secrets));
} catch (e) {
  ok("用例执行完成", false, String(e && e.message ? e.message : e));
}

console.log("P1RESULT " + JSON.stringify(out));
await task.finish({ keep: [] });
`

const proc = spawnSync('ego-browser', ['nodejs'], { input: script, encoding: 'utf8', timeout: 240000 })
stopServer()
const raw = `${proc.stdout || ''}\n${proc.stderr || ''}`
if (proc.error) {
  console.error('✗ 浏览器执行失败：' + proc.error.message)
  process.exit(1)
}
const line = raw
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l.startsWith('P1RESULT '))
if (!line) {
  console.error('✗ 没拿到结果，尾部输出：\n' + raw.slice(-1500))
  process.exit(1)
}
const out = JSON.parse(line.slice('P1RESULT '.length))
for (const s of out.steps) console.log('· ' + s)
let failed = 0
for (const a of out.asserts) {
  if (!a.pass) failed += 1
  console.log(`${a.pass ? '✅' : '❌'} ${a.name}${a.detail ? '  → ' + a.detail : ''}`)
}
console.log(failed ? `\n✗ ${failed} 条断言失败` : '\n✓ P1 复验全部通过')
process.exit(failed ? 1 : 0)
