<script setup lang="ts">
/**
 * P0 场景页：配置格式迁移（JSON → YAML）。
 *
 * 本页只做解释与引导：示例数据与真实运行输出固定写在页面里（可预渲染，不依赖
 * 客户端存储），计算仍由既有流程 /workflows/wf-config-convert 与单项工具执行。
 * 页面不接收任何用户输入：真实数据不经过本页，不进入 URL 或分享链接。
 *
 * 页面里的示例输出由与页面同一份执行器代码驱动验证后抄录（esbuild 打包
 * app/workflow/runner.ts + presets.ts 后 node 运行 runWorkflow，js-yaml 独立回读
 * 逐字段核对），不是示意文本；常见失败区引用的报错文案均来自真实运行结果。
 */
useSeo({
  title: 'JSON 配置转 YAML：迁移与核对 · DevKit',
  description:
    '把 JSON 配置转成 YAML 并核对字段、数组与布尔值没有被静默改写：三步本地流程、真实可运行示例与核对清单，数据只在浏览器内存中处理，不上传。'
})

const clipboard = useClipboard()

/** 示例数据（无敏感信息）：覆盖布尔、数组、嵌套对象、数字样式字符串与超出安全范围的大整数 */
const SAMPLE_JSON = `{
  "app": {
    "name": "inventory-api",
    "version": "2.4.1",
    "buildNumber": "20260926",
    "replicas": 3,
    "timeoutMs": 8000,
    "debug": false
  },
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "name": "inventory",
    "readonly": true,
    "pool": { "minIdle": 2, "maxOpen": 16 }
  },
  "featureFlags": {
    "fastSearch": true,
    "legacyExport": false,
    "grayPercent": 25
  },
  "upstream": {
    "endpoint": "https://example.internal/api",
    "retry": { "attempts": 3, "backoffMs": [100, 400, 1600] },
    "traceId": "123456789012345678"
  },
  "snowflakeSample": 1234567890123456789,
  "notes": "示例配置：核对字段、数组与布尔值转换后是否保持原样"
}`

/** 上面示例经「配置格式互转」流程三步后的真实输出（逐字抄录自运行结果） */
const SAMPLE_YAML = `app:
  name: inventory-api
  version: 2.4.1
  buildNumber: '20260926'
  replicas: 3
  timeoutMs: 8000
  debug: false
database:
  host: 127.0.0.1
  port: 5432
  name: inventory
  readonly: true
  pool:
    minIdle: 2
    maxOpen: 16
featureFlags:
  fastSearch: true
  legacyExport: false
  grayPercent: 25
upstream:
  endpoint: https://example.internal/api
  retry:
    attempts: 3
    backoffMs:
      - 100
      - 400
      - 1600
  traceId: '123456789012345678'
snowflakeSample: 1234567890123456789
notes: 示例配置：核对字段、数组与布尔值转换后是否保持原样
`

/** 三步的真实运行提示（note），逐字抄录 */
const STEP_NOTES = [
  { step: '第 1 步 · JSON 格式化', note: '格式化完成，39 行、780 B' },
  {
    step: '第 2 步 · JSON → YAML',
    note: 'JSON 已转为 YAML；1 个数值超出 JS 安全范围（如 $.snowflakeSample），已按原文输出以保留精度；部分工具按数值解析时仍可能丢失精度（超出安全整数范围的数值尤其如此）'
  },
  { step: '第 3 步 · 下载标记', note: '将导出为 config.yaml，585 B' }
]

const FACTS = [
  { name: '输入', desc: 'JSON 配置文本：对象 / 数组，支持布尔、数字样式的字符串、超出 JS 安全整数范围的大整数（转换上限 1000 层嵌套）' },
  { name: '产出', desc: '2 空格缩进的 YAML 文本；流程页可整体复制，或下载为 config.yaml' },
  { name: '步骤', desc: '3 步：JSON 格式化 → JSON 转 YAML → 下载标记，全部在浏览器本地运行' },
  { name: '反方向', desc: 'YAML → JSON 不在本流程内：用「JSON / YAML 转换」单项工具（也适合回读核对）' }
]

const STEPS = [
  {
    icon: 'braces',
    title: '第 1 步 · JSON 格式化',
    why: '先把文本真正解析成结构，而不是直接做字符串替换。语法错误在这一步暴露，报错带行列定位；重复键在这里告警（后出现的键会覆盖前者）；后面两步拿到的必然是一份解析成功的结构。'
  },
  {
    icon: 'file-code',
    title: '第 2 步 · JSON → YAML',
    why: '类型保真规则在这一步生效：像数字的字符串自动加引号（buildNumber: \'20260926\'），布尔保持 true / false，超出安全范围的大整数按原文文本输出并附告警——这些正是「不被静默改写」的核对点。'
  },
  {
    icon: 'download',
    title: '第 3 步 · 下载标记',
    why: '只把导出文件名定为 config.yaml，不改变内容。真正的文件落盘只发生在你点「下载」的那一刻，由浏览器完成；点之前数据一直只在页面内存里。'
  }
]

/** 完成的定义：核对关键字段、数组与布尔值没有被静默改写 */
const CHECKLIST = [
  { name: '布尔值', desc: 'debug: false、readonly: true 保持无引号的 true / false，没有变成字符串' },
  { name: '数组', desc: 'backoffMs 的 100 / 400 / 1600 元素与顺序原样保留，仍是列表' },
  { name: '字符串类型', desc: "buildNumber: '20260926'、traceId: '123456789012345678' 带引号——不带引号的数字样式值会被 YAML 读取方当成数字" },
  { name: '大整数', desc: 'snowflakeSample: 1234567890123456789 按原文输出（第 2 步 note 同时告警：下游按数值解析仍可能丢精度）' }
]

const FAILURES = [
  {
    title: 'JSON 语法错误（缺括号、多余逗号、单引号）',
    desc: '第 1 步失败并中断。示例：删掉一个右花括号后运行，提示「JSON 解析失败：第 5 行第 3 列附近：对象属性之间缺少逗号或右花括号」。即使手动关闭「失败时中断流程」让剩余步骤跑完，「流程输出」也会停用复制 / 下载，不会把未转换的原始输入当成 config.yaml 存盘。'
  },
  {
    title: '粘贴的是 YAML，却按 JSON → YAML 方向运行',
    desc: '第 1 步 JSON 解析失败，提示「JSON 解析失败：出现意外字符，不是合法的 JSON」。需要的是先走 YAML → JSON（单项工具），再进入本流程。'
  },
  {
    title: '输入为空',
    desc: '点「运行全部」会提示「请先填写或接收流程输入」，不会产生任何步骤结果，也不会显示成成功。'
  },
  {
    title: '重复键',
    desc: '不是失败：流程继续，第 1 步 note 告警「检测到重复键：…（后出现的键覆盖前者）」。迁移配置前应先改掉重复键，否则结果以最后一次取值为准。'
  },
  {
    title: '超出安全整数范围的大整数',
    desc: '不是失败：YAML 文本按原文输出以保留精度，但第 2 步 note 明确告警——下游若按数值解析（而非字符串）仍可能丢失精度，需要消费方约定读取方式。'
  },
  {
    title: '嵌套超过转换上限',
    desc: '本流程最多转换 1000 层嵌套。超过时第 1 步就会明确失败并提示减少嵌套，不会等到 YAML 转换时才出现因运行环境而异的栈溢出。'
  }
]

const RELATED_TOOLS = [
  { slug: 'json-format', name: 'JSON 格式化', desc: '单独校验、格式化 / 压缩 JSON，重复键与行列定位' },
  { slug: 'json-yaml', name: 'JSON / YAML 转换', desc: '双向转换：也用于把结果 YAML 转回 JSON 做回读核对' },
  { slug: 'json-diff', name: 'JSON 差异比较', desc: '把 YAML 转回 JSON 后与原文件做结构化差异比较' },
  { slug: 'properties-yaml', name: 'Properties / YAML 转换', desc: 'Java properties 配置迁移到 YAML 的相邻场景' }
]

async function copySample() {
  await clipboard.copy(SAMPLE_JSON, '示例 JSON')
}
</script>

<template>
  <div class="scn">
    <header class="scn__head">
      <div class="scn__title">
        <span class="scn__icon"><DkIcon name="file-code" :size="17" /></span>
        <div>
          <h1 class="scn__name">配置格式迁移</h1>
          <p class="scn__desc">
            把 JSON 配置转成 YAML，并核对关键字段、数组与布尔值没有被静默改写——全部在浏览器本地完成。
          </p>
        </div>
      </div>
      <span class="scn__badge"><DkIcon name="shield-check" :size="13" />本地处理 · 输入不上传</span>
    </header>

    <section class="scn__panel">
      <h2 class="scn__sec-title">这个问题与输入产出</h2>
      <div class="scn__facts">
        <article v-for="f in FACTS" :key="f.name" class="scn__fact">
          <span class="scn__fact-name">{{ f.name }}</span>
          <p class="scn__fact-desc">{{ f.desc }}</p>
        </article>
      </div>
    </section>

    <section class="scn__panel">
      <div class="scn__sec-head">
        <h2 class="scn__sec-title">示例数据</h2>
        <span class="scn__badge scn__badge--soft">示例数据 · 无敏感信息</span>
        <span class="grow"></span>
        <DkButton size="sm" variant="ghost" @click="copySample">
          <DkIcon name="copy" :size="12" />复制示例 JSON
        </DkButton>
      </div>
      <p class="scn__lead">
        左侧是一段虚构的服务配置（示例数据），右侧是它经过「配置格式互转」流程后的<strong>真实运行输出</strong>，
        不是示意文本。示例刻意包含了最容易在迁移中被改写的几类值：布尔、数组、数字样式的字符串、超出安全范围的大整数。
      </p>
      <div class="scn__io">
        <div class="scn__io-col">
          <div class="scn__io-head">
            <span class="scn__io-label">输入 · JSON</span>
            <span class="scn__badge scn__badge--mini">示例数据</span>
          </div>
          <pre class="scn__code mono" v-text="SAMPLE_JSON"></pre>
        </div>
        <div class="scn__io-col">
          <div class="scn__io-head">
            <span class="scn__io-label">输出 · YAML（流程第 3 步的真实结果）</span>
            <span class="scn__badge scn__badge--mini scn__badge--ok">真实运行输出</span>
          </div>
          <pre class="scn__code mono" v-text="SAMPLE_YAML"></pre>
        </div>
      </div>
      <div class="scn__notes">
        <div v-for="n in STEP_NOTES" :key="n.step" class="scn__note">
          <span class="scn__note-step">{{ n.step }}</span>
          <span class="scn__note-text">{{ n.note }}</span>
        </div>
      </div>
      <p class="scn__foot">
        想自己跑一遍：复制示例 JSON，进入流程页粘贴到「流程输入」，点「运行全部」。想核对自己的数据是否被改写：对照下方核对清单，
        或把输出 YAML 用「JSON / YAML 转换」转回 JSON 后做差异比较。
      </p>
    </section>

    <section class="scn__panel">
      <h2 class="scn__sec-title">处理步骤与每一步为什么需要</h2>
      <div class="scn__steps">
        <article v-for="s in STEPS" :key="s.title" class="scn__step">
          <span class="scn__step-icon"><DkIcon :name="s.icon" :size="14" /></span>
          <div class="scn__step-body">
            <h3 class="scn__step-title">{{ s.title }}</h3>
            <p class="scn__step-why">{{ s.why }}</p>
          </div>
        </article>
      </div>
      <div class="scn__check">
        <div class="scn__check-head">
          <DkIcon name="list-checks" :size="14" style="color: var(--ok)" />
          <h3 class="scn__sec-title">转换后核对清单（怎么算迁移完成）</h3>
        </div>
        <div class="scn__check-grid">
          <div v-for="c in CHECKLIST" :key="c.name" class="scn__check-row">
            <span class="scn__check-name">{{ c.name }}</span>
            <p class="scn__check-desc">{{ c.desc }}</p>
          </div>
        </div>
        <p class="scn__foot">
          能下载 config.yaml，并且上面四类值都与原文件一致，才算完成——下载下来的就是右侧这份 YAML 的同款结果。
        </p>
      </div>
    </section>

    <section class="scn__cta">
      <div class="scn__cta-text">
        <h2 class="scn__cta-title">用你的数据完成迁移</h2>
        <p class="scn__cta-desc">
          进入「配置格式互转」流程页，把 JSON 粘贴到「流程输入」后点「运行全部」。你的数据不经过本页，也不进入 URL 或分享链接。
        </p>
      </div>
      <NuxtLink to="/workflows/wf-config-convert" class="scn__cta-btn">
        <DkButton variant="primary"><DkIcon name="play" :size="13" />用我的数据处理</DkButton>
      </NuxtLink>
    </section>

    <section class="scn__panel">
      <h2 class="scn__sec-title">常见失败原因</h2>
      <div class="scn__fails">
        <article v-for="f in FAILURES" :key="f.title" class="scn__fail">
          <span class="scn__fail-title"><DkIcon name="alert-triangle" :size="13" />{{ f.title }}</span>
          <p class="scn__fail-desc">{{ f.desc }}</p>
        </article>
      </div>
    </section>

    <section class="scn__panel">
      <h2 class="scn__sec-title">数据处理说明</h2>
      <ul class="scn__privacy">
        <li>输入与每一步的中间结果只在本次页面内存中顺序传递，离开页面即清除，不发送到任何服务器。</li>
        <li>本页与流程页都不把你的数据写进 URL、分享链接或站点统计；本页只有固定示例，不接收输入。</li>
        <li>localStorage 只保存流程定义与运行记录摘要（状态、耗时），不保存输入、输出或中间结果。</li>
        <li>唯一的文件落盘发生在你点「下载」时，由浏览器生成本地文件。</li>
      </ul>
    </section>

    <section class="scn__panel">
      <h2 class="scn__sec-title">相关单项工具</h2>
      <div class="scn__tools">
        <NuxtLink v-for="t in RELATED_TOOLS" :key="t.slug" :to="`/tools/${t.slug}`" class="scn__tool">
          <span class="scn__tool-name">{{ t.name }}</span>
          <span class="scn__tool-desc">{{ t.desc }}</span>
          <DkIcon name="arrow-right" :size="13" class="scn__tool-arrow" />
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scn {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.scn__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.scn__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.scn__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--cat-format-soft);
  color: var(--cat-format);
  flex-shrink: 0;
}
.scn__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.scn__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.scn__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 11px;
  border-radius: 13px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.scn__badge--soft {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.scn__badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.scn__badge--mini {
  height: 19px;
  padding: 0 7px;
  font-size: 11px;
  border-radius: 10px;
}
.scn__panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px 26px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.scn__sec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.scn__sec-title {
  font-size: 14px;
  font-weight: 700;
}
.scn__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.scn__fact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.scn__fact-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.scn__fact-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.scn__lead {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.scn__io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.scn__io-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.scn__io-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.scn__io-label {
  font-size: 12px;
  font-weight: 600;
}
.scn__code {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--editor-bg);
  font-size: 12px;
  line-height: 1.75;
  color: var(--text-primary);
  overflow: auto;
  max-height: 460px;
  white-space: pre;
}
.scn__notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.scn__note {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
}
.scn__note-step {
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.scn__note-text {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  word-break: break-word;
}
.scn__foot {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.8;
}
.scn__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scn__step {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 13px 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.scn__step-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--cat-format-soft);
  color: var(--cat-format);
  flex-shrink: 0;
}
.scn__step-body {
  min-width: 0;
}
.scn__step-title {
  font-size: 12.5px;
  font-weight: 600;
}
.scn__step-why {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.scn__check {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.scn__check-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scn__check-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.scn__check-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 9px;
  min-width: 0;
}
.scn__check-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ok);
}
.scn__check-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  word-break: break-word;
}
.scn__cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 26px;
  background: var(--accent-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.scn__cta-title {
  font-size: 15px;
  font-weight: 700;
}
.scn__cta-desc {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  max-width: 640px;
}
.scn__cta-btn {
  flex-shrink: 0;
  display: inline-flex;
}
.scn__fails {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.scn__fail {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.scn__fail-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--error);
}
.scn__fail-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.75;
  word-break: break-word;
}
.scn__privacy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0 0 0 2px;
  list-style: none;
}
.scn__privacy li {
  position: relative;
  padding-left: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.scn__privacy li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0.72em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
}
.scn__tools {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.scn__tool {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-width: 0;
}
.scn__tool:hover {
  border-color: var(--accent);
}
.scn__tool-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}
.scn__tool-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.scn__tool-arrow {
  margin-top: 4px;
  color: var(--text-tertiary);
}
@media (max-width: 1000px) {
  .scn__facts,
  .scn__tools {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .scn__io {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .scn__cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .scn__fails,
  .scn__check-grid {
    grid-template-columns: 1fr;
  }
  .scn__code {
    font-size: 11.5px;
  }
}
@media (max-width: 560px) {
  .scn__facts,
  .scn__tools {
    grid-template-columns: 1fr;
  }
  .scn__head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
