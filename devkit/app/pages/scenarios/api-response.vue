<script setup lang="ts">
/**
 * P0 场景页：接口响应排查。
 *
 * 只做解释与引导：固定的示例、步骤说明、失败对照与入口；计算全部由既有流程页
 * （/workflows/wf-response-check、/workflows/wf-order-snapshot）与单项工具执行。
 * 本页不接收任何输入到 URL 或分享链接；示例数据为无敏感信息的造造样本，
 * 每个输入、每步 note 与输出均在 2026-09-26 用真实 runner（esbuild 打包 + node）逐字核对过。
 */
useSeo({
  title: '接口响应排查：URL / Base64 编码响应解码、取字段与结构校验 · DevKit',
  description:
    '接口响应经过 URL 或 Base64 编码，想取字段并确认结构是否正确？在浏览器本地解码、格式化、按 JSONPath 提取并做 JSON Schema 校验，附已实测示例与常见报错对照。数据只在页面内存中处理，不上传。'
})

const clipboard = useClipboard()

/** ── 示例数据（已实测：真实流程跑通后的逐字拷贝，勿手改）── */
const URL_INPUT =
  '%7B%22code%22%3A0%2C%22message%22%3A%22ok%22%2C%22data%22%3A%7B%22orderId%22%3A%22SO-2026-0926%22%2C%22status%22%3A%22PAID%22%2C%22amount%22%3A199%2C%22items%22%3A%5B%7B%22sku%22%3A%22DK-MUG%22%2C%22qty%22%3A2%7D%2C%7B%22sku%22%3A%22DK-STICKER%22%2C%22qty%22%3A1%7D%5D%7D%7D'
const URL_DECODED =
  '{"code":0,"message":"ok","data":{"orderId":"SO-2026-0926","status":"PAID","amount":199,"items":[{"sku":"DK-MUG","qty":2},{"sku":"DK-STICKER","qty":1}]}}'
const URL_FORMATTED = `{
  "code": 0,
  "message": "ok",
  "data": {
    "orderId": "SO-2026-0926",
    "status": "PAID",
    "amount": 199,
    "items": [
      {
        "sku": "DK-MUG",
        "qty": 2
      },
      {
        "sku": "DK-STICKER",
        "qty": 1
      }
    ]
  }
}`
const RESPONSE_SCHEMA = '{ "type": "object", "required": ["code"], "properties": { "code": { "type": "integer" } } }'

const B64_INPUT =
  'eyJvcmRlciI6eyJvcmRlcklkIjoiU08tMTAyNCIsImJ1eWVyIjoiZGV2a2l0QGV4YW1wbGUuY29tIiwicGFpZCI6dHJ1ZSwiYW1vdW50Ijo1OS45LCJ0YWdzIjpbInVyZ2VudCIsImdpZnQiXSwiYWRkcmVzcyI6eyJjaXR5IjoiSGFuZ3pob3UiLCJ6aXAiOiIzMTAwMDAifX19'
const B64_DECODED =
  '{"order":{"orderId":"SO-1024","buyer":"devkit@example.com","paid":true,"amount":59.9,"tags":["urgent","gift"],"address":{"city":"Hangzhou","zip":"310000"}}}'
const B64_FORMATTED = `{
  "order": {
    "orderId": "SO-1024",
    "buyer": "devkit@example.com",
    "paid": true,
    "amount": 59.9,
    "tags": [
      "urgent",
      "gift"
    ],
    "address": {
      "city": "Hangzhou",
      "zip": "310000"
    }
  }
}`
const B64_ORDER = `{
  "orderId": "SO-1024",
  "buyer": "devkit@example.com",
  "paid": true,
  "amount": 59.9,
  "tags": [
    "urgent",
    "gift"
  ],
  "address": {
    "city": "Hangzhou",
    "zip": "310000"
  }
}`
/** 第 4 步产物节选：真实输出共 73 行（每个字段一对 getter / setter，末尾还有静态嵌套的 Address 类），此处只展示到字段声明 */
const JAVA_EXCERPT = `import java.util.List;

public class Order {
    private String orderId;
    private String buyer;
    private boolean paid;
    private double amount;
    private List<String> tags;
    private Address address;

    // ……以下每个字段各一对 getter / setter，末尾生成静态嵌套类 Address（完整产物 73 行，运行后可整体复制）
}`

interface DemoStep {
  title: string
  why: string
  note: string
  out?: string
  outLabel?: string
  /** 输出是节选而非完整产物 */
  excerpt?: boolean
  /** 额外参数展示（如第 3 步的默认 Schema） */
  config?: string
  configLabel?: string
}

interface FlowDemo {
  key: 'url' | 'base64'
  label: string
  entryTo: string
  entryName: string
  entryButton: string
  input: string
  inputLabel: string
  decoded: string
  steps: DemoStep[]
}

const urlFlow: FlowDemo = {
  key: 'url',
  label: 'URL 编码响应',
  entryTo: '/workflows/wf-response-check',
  entryName: '接口响应校验',
  entryButton: '用我的数据处理 · URL 编码响应',
  input: URL_INPUT,
  inputLabel: '流程输入（整段 URL 编码后的响应体，粘贴这一段）',
  decoded: URL_DECODED,
  steps: [
    {
      title: '第 1 步 · URL 解码',
      why: '响应体被整体百分号编码过，直接当 JSON 解析会在第一个 % 处就失败。先把 %7B%22… 还原成原文。',
      note: '解码为 152 B 文本',
      out: URL_DECODED,
      outLabel: '第 1 步输出（还原后的响应体）'
    },
    {
      title: '第 2 步 · JSON 格式化（缩进 2 空格）',
      why: '一行压缩 JSON 没法人工核对字段；解析失败会给出「第 X 行第 Y 列」定位，多余逗号、单引号键这类问题在这一步暴露。',
      note: '格式化完成，19 行、265 B',
      out: URL_FORMATTED,
      outLabel: '第 2 步输出'
    },
    {
      title: '第 3 步 · JSON Schema 校验',
      why: '「能解析」不等于「结构正确」。按契约校验必填字段与类型，错误会指到 $.路径。默认 Schema 只约束顶层 code 为 integer；校验自己的契约时，把 Schema 粘进第 3 步参数即可。',
      note: '校验通过，检查了 2 个节点',
      config: RESPONSE_SCHEMA,
      configLabel: '第 3 步默认 Schema',
      out: URL_FORMATTED,
      outLabel: '第 3 步输出（格式化 JSON 原样通过，即流程输出，可复制）'
    }
  ]
}

const b64Flow: FlowDemo = {
  key: 'base64',
  label: 'Base64 快照',
  entryTo: '/workflows/wf-order-snapshot',
  entryName: '订单快照解析',
  entryButton: '用我的数据处理 · Base64 快照',
  input: B64_INPUT,
  inputLabel: '流程输入（整段 Base64，粘贴这一段）',
  decoded: B64_DECODED,
  steps: [
    {
      title: '第 1 步 · Base64 解码',
      why: '快照以 Base64 传输，先还原成 JSON 文本；串里混入非法字符或被截断，这一步会直接报错。',
      note: '解码为 156 B 文本',
      out: B64_DECODED,
      outLabel: '第 1 步输出（还原后的快照原文）'
    },
    {
      title: '第 2 步 · JSON 格式化（缩进 2 空格）',
      why: '解码成功只说明还原了文本，还要确认是合法 JSON；行列定位的报错在这一步出现。',
      note: '格式化完成，16 行、240 B',
      out: B64_FORMATTED,
      outLabel: '第 2 步输出'
    },
    {
      title: '第 3 步 · JSONPath 提取 $.order',
      why: '外层可能有包装字段，只提取目标对象，后续转换不受包装结构影响；字段名区分大小写。',
      note: '匹配 1 项',
      out: B64_ORDER,
      outLabel: '第 3 步输出（$.order 对象）'
    },
    {
      title: '第 4 步 · JSON 转 Java（类名 Order）',
      why: '从真实样本生成实体类：字段名与类型（String / double / boolean / List<String> / 嵌套对象）都来自数据本身，不是模板猜的；嵌套对象生成静态嵌套类（static），Jackson 等按无参构造反射的库可直接使用。',
      note: '生成 Order，73 行、1.5 KB',
      out: JAVA_EXCERPT,
      outLabel: '第 4 步输出（节选，完整产物在流程页运行后可整体复制）',
      excerpt: true
    }
  ]
}

const mode = ref<'url' | 'base64'>('url')
const current = computed<FlowDemo>(() => (mode.value === 'url' ? urlFlow : b64Flow))
const other = computed<FlowDemo>(() => (mode.value === 'url' ? b64Flow : urlFlow))

function copySample() {
  clipboard.copy(current.value.input, '示例输入')
}

/** ── 常见失败：报错文案均为真实执行器实测输出（2026-09-26）── */
const failures = [
  {
    scope: 'URL 编码输入',
    where: '第 1 步',
    err: 'URL 解码失败：存在非法的百分号编码（例如单独的 % 或 %ZZ）',
    why: '响应体里有单独的 % 或不完整的 %XX。可先用「URL 编解码」工具试解码，定位坏字符。'
  },
  {
    scope: '两种输入',
    where: '第 2 步',
    err: 'JSON 解析失败：第 1 行第 26 列附近：属性名必须用双引号（常见于多余逗号或使用了单引号/无引号键）',
    why: '解码成功但不是合法 JSON：多余逗号、单引号键、内容被截断都在这里暴露，报错带行列定位，按定位回原文检查。'
  },
  {
    scope: 'URL 编码输入',
    where: '第 3 步',
    err: '校验失败 · 1 个错误：$.code [required] 缺少必填字段 / $.code [type] 应为 integer，当前为 string',
    why: '缺 code 字段或类型不符。默认 Schema 只约束顶层 code；要校验完整契约，把你的 Schema 粘进第 3 步参数再运行。'
  },
  {
    scope: 'Base64 输入',
    where: '第 1 步',
    err: 'Base64 中包含非法字符',
    why: 'Base64 串混入了换行以外的不合法字符，或复制时被截断 / 拼接。重新完整复制一次再试。'
  },
  {
    scope: 'Base64 输入',
    where: '第 3 步',
    err: '匹配 0 项：检查表达式与字段名（区分大小写）',
    why: '解码后的顶层没有 order 字段。改第 3 步的 JSONPath 表达式（如 $.result），或先看第 2 步的实际结构。'
  },
  {
    scope: 'Base64 输入',
    where: '第 4 步',
    err: 'JSON 转 Java 需要顶层对象；当前结果是标量或数组，请先用 JSONPath 提取出对象',
    why: '$.order 是字符串或数组，无法生成有字段的 Java 类。先检查第 3 步的输出，再提取其中的对象。'
  }
]

/** ── 相关单项工具（slug 与 app/data/tools.ts 一致）── */
const tools = [
  { slug: 'url-encode', name: 'URL 编解码', desc: '百分号编码还原与编码', icon: 'link' },
  { slug: 'base64', name: 'Base64 编解码', desc: '文本与文件的 Base64 编解码', icon: 'binary' },
  { slug: 'json-format', name: 'JSON 格式化', desc: '格式化、压缩并校验 JSON', icon: 'braces' },
  { slug: 'jsonpath-query', name: 'JSONPath 查询', desc: 'JSONPath / JMESPath 提取数据', icon: 'list-filter' },
  { slug: 'json-schema', name: 'JSON Schema', desc: '生成 Schema 或校验 JSON', icon: 'file-code' },
  { slug: 'json2java', name: 'JSON 转 Java 类', desc: '生成 POJO 或 record', icon: 'coffee' }
]
</script>

<template>
  <div class="scp">
    <header class="scp__head">
      <div class="scp__title">
        <span class="scp__icon"><DkIcon name="workflow" :size="17" /></span>
        <div>
          <h1 class="scp__name">接口响应排查</h1>
          <p class="scp__desc">
            拿到一段经过 URL 编码或 Base64 编码的接口响应：先还原，再取字段，并确认结构对不对。
          </p>
        </div>
      </div>
      <NuxtLink to="/workflows" class="scp__local" title="查看全部处理流程">
        <DkIcon name="shield-check" :size="13" />
        本地处理 · 输入不上传
      </NuxtLink>
    </header>

    <section class="panel">
      <!-- ① 一句话问题、支持的输入与产出 -->
      <section class="io">
        <div class="io__col">
          <div class="io__head">
            <DkIcon name="corner-down-left" :size="14" style="color: var(--accent)" />
            <h2 class="card__title">支持的输入</h2>
          </div>
          <div class="io__chips">
            <span class="io__chip">URL 编码的 JSON 响应体</span>
            <span class="io__chip">Base64 编码的 JSON 快照</span>
            <span class="io__chip io__chip--soft">明文 JSON（直接用单项工具，不必进流程）</span>
          </div>
        </div>
        <DkIcon name="arrow-right" :size="16" class="io__arrow" />
        <div class="io__col">
          <div class="io__head">
            <DkIcon name="clipboard" :size="14" style="color: var(--ok)" />
            <h2 class="card__title">得到的产出（全部可复制）</h2>
          </div>
          <div class="io__chips">
            <span class="io__chip">还原并格式化的 JSON</span>
            <span class="io__chip">JSONPath 提取的目标字段</span>
            <span class="io__chip">Schema 校验结论（含错误路径）</span>
            <span class="io__chip">Java 实体类（Base64 路线）</span>
          </div>
        </div>
      </section>

      <!-- ②③ 示例数据 + 处理步骤（按输入编码二选一） -->
      <section class="demo">
        <div class="demo__head">
          <span class="badge badge--demo"><DkIcon name="sparkles" :size="12" />示例数据</span>
          <h2 class="card__title">先跑一个真实示例</h2>
          <span class="grow"></span>
          <DkSegmented
            v-model="mode"
            size="sm"
            :options="[
              { value: 'url', label: 'URL 编码响应' },
              { value: 'base64', label: 'Base64 快照' }
            ]"
            aria-label="选择输入编码"
          />
        </div>
        <p class="demo__hint">
          示例为无敏感信息的造造数据，输入与每步输出均用本站真实流程实测核对（2026-09-26）。按你的输入编码选一种；
          进入流程页后把示例粘进「流程输入」，点「运行全部」即可复现下面的每一步。
        </p>

        <div class="demo__input">
          <div class="demo__input-head">
            <span class="demo__label">{{ current.inputLabel }}</span>
            <span class="grow"></span>
            <DkButton size="sm" @click="copySample">
              <DkIcon name="copy" :size="12" />复制示例输入
            </DkButton>
          </div>
          <pre class="mono demo__code demo__code--wrap">{{ current.input }}</pre>
          <p class="demo__decoded">
            解码后原文：<code class="mono">{{ current.decoded }}</code>
          </p>
        </div>

        <ol class="demo__steps">
          <li v-for="s in current.steps" :key="s.title" class="step">
            <div class="step__head">
              <span class="step__dot"><DkIcon name="circle-check" :size="13" /></span>
              <span class="step__title">{{ s.title }}</span>
              <span class="badge badge--ok">{{ s.note }}</span>
            </div>
            <p class="step__why">{{ s.why }}</p>
            <p v-if="s.config" class="step__config">
              {{ s.configLabel }}：<code class="mono">{{ s.config }}</code>
            </p>
            <div v-if="s.out" class="step__out">
              <div class="step__out-head">
                <span class="step__out-label">{{ s.outLabel }}</span>
                <span v-if="s.excerpt" class="badge badge--soft">节选</span>
              </div>
              <pre class="mono demo__code">{{ s.out }}</pre>
            </div>
          </li>
        </ol>
      </section>

      <!-- ④ 用我的数据处理 -->
      <section class="cta">
        <div class="cta__text">
          <h2 class="cta__title">用我的数据处理</h2>
          <p class="cta__desc">
            进入「{{ current.entryName }}」流程页（{{ current.steps.length }} 个步骤已配好）：粘贴你的响应，
            点「运行全部」。数据只在页面内存中传递，离开即清除。
          </p>
        </div>
        <div class="cta__actions">
          <NuxtLink :to="current.entryTo">
            <DkButton variant="primary" size="md">
              <DkIcon name="play" :size="13" />{{ current.entryButton }}
            </DkButton>
          </NuxtLink>
          <NuxtLink :to="other.entryTo">
            <DkButton size="md">
              <DkIcon name="arrow-right" :size="13" />我的输入是{{ other.label }}（{{ other.entryName }}）
            </DkButton>
          </NuxtLink>
        </div>
      </section>

      <!-- ⑤ 常见失败原因 -->
      <section class="fails">
        <div class="fails__head">
          <DkIcon name="alert-triangle" :size="14" style="color: var(--warn)" />
          <h2 class="card__title">常见失败原因</h2>
          <span class="grow"></span>
          <span class="fails__note">报错文案均来自真实执行器的实测运行，可直接对照</span>
        </div>
        <div class="fails__scroll">
          <table class="fails__table">
            <thead>
              <tr>
                <th>你会看到的报错</th>
                <th>出现在</th>
                <th>原因与下一步</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in failures" :key="f.err">
                <td class="mono fails__err">{{ f.err }}</td>
                <td>
                  <span class="fails__scope">{{ f.scope }}</span>
                  <span class="fails__where">{{ f.where }}</span>
                </td>
                <td>{{ f.why }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 数据处理说明 + 相关单项工具入口 -->
      <section class="tools">
        <div class="tools__privacy">
          <div class="card__head">
            <DkIcon name="shield-check" :size="14" style="color: var(--accent)" />
            <h2 class="card__title">数据处理说明</h2>
          </div>
          <p class="card__body">
            示例与你的数据都只在页面内存中逐级传递，不上传服务器，也不会进入 URL 或分享链接（本页不接收任何输入）。
            保存在本机浏览器的只有流程配置（localStorage）与运行记录（仅状态、耗时与步骤摘要，不含输入输出）；
            本场景两条流程均不含密钥步骤。详见<NuxtLink to="/privacy" class="card__inline">本地处理与隐私</NuxtLink>。
          </p>
        </div>
        <div class="tools__grid-wrap">
          <div class="card__head">
            <DkIcon name="grid" :size="14" style="color: var(--cat-format)" />
            <h2 class="card__title">相关单项工具</h2>
            <span class="grow"></span>
            <span class="tools__note">只做一步时直接用工具，不必进流程</span>
          </div>
          <div class="tools__grid">
            <NuxtLink v-for="t in tools" :key="t.slug" :to="`/tools/${t.slug}`" class="tools__item">
              <span class="tools__icon"><DkIcon :name="t.icon" :size="14" /></span>
              <span class="tools__info">
                <span class="tools__name">{{ t.name }}</span>
                <span class="tools__desc">{{ t.desc }}</span>
              </span>
              <DkIcon name="chevron-right" :size="14" class="tools__go" />
            </NuxtLink>
          </div>
        </div>
      </section>
    </section>

    <section class="outro">
      <div>
        <h2 class="outro__title">换个方式查结构</h2>
        <p class="outro__desc">响应没经过编码？直接从「JSON 格式化」开始；要核对两份响应的差异，用「JSON 差异比较」。</p>
      </div>
      <div class="outro__actions">
        <NuxtLink to="/tools/json-format">
          <DkButton variant="primary" size="sm"><DkIcon name="braces" :size="13" />JSON 格式化</DkButton>
        </NuxtLink>
        <NuxtLink to="/tools/json-diff">
          <DkButton size="sm"><DkIcon name="git-compare" :size="13" />JSON 差异比较</DkButton>
        </NuxtLink>
        <NuxtLink to="/workflows">
          <DkButton size="sm"><DkIcon name="workflow" :size="13" />全部处理流程</DkButton>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scp {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.scp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.scp__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.scp__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.scp__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.scp__desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.scp__local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.scp__local:hover {
  text-decoration: none;
  color: var(--accent);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 28px 30px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.card__head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.card__title {
  font-size: 13px;
  font-weight: 600;
}
.card__body {
  margin-top: 9px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.card__inline {
  color: var(--accent);
}

/* ① 输入 / 产出 */
.io {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 16px;
  align-items: center;
}
.io__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.io__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.io__arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.io__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.io__chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-primary);
}
.io__chip--soft {
  color: var(--text-secondary);
}

/* ②③ 示例 + 步骤 */
.demo {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.demo__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.demo__hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.7;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.badge--warn {
  background: var(--warn-soft);
  color: var(--warn);
}
.badge--soft {
  background: var(--surface-subtle);
  color: var(--text-secondary);
}
.badge--demo {
  background: var(--accent-soft);
  color: var(--accent);
}
.demo__input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.demo__input-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.demo__label {
  font-size: 12px;
  font-weight: 500;
}
.demo__code {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--editor-bg);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-secondary);
  overflow-x: auto;
}
.demo__code--wrap {
  white-space: pre-wrap;
  word-break: break-all;
}
.demo__decoded {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.7;
  word-break: break-all;
}
.demo__steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.step__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.step__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ok-soft);
  color: var(--ok);
  flex-shrink: 0;
}
.step__title {
  font-size: 12.5px;
  font-weight: 600;
}
.step__why {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.step__config {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-tertiary);
  word-break: break-all;
}
.step__out {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.step__out-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.step__out-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ④ CTA */
.cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border: 1px solid var(--accent-ring);
  border-radius: 10px;
  background: var(--accent-soft);
  flex-wrap: wrap;
}
.cta__title {
  font-size: 14px;
  font-weight: 700;
}
.cta__desc {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  max-width: 560px;
}
.cta__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* ⑤ 常见失败 */
.fails {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fails__head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.fails__note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.fails__scroll {
  overflow-x: auto;
}
.fails__table {
  width: 100%;
  min-width: 720px;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  font-size: 12px;
}
.fails__table th,
.fails__table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.fails__table thead th {
  background: var(--surface-subtle);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.fails__table tbody tr:last-child td {
  border-bottom: none;
}
.fails__err {
  font-size: 11px;
  color: var(--error);
  word-break: break-all;
  width: 42%;
}
.fails__scope,
.fails__where {
  display: block;
  font-size: 11px;
}
.fails__scope {
  color: var(--text-primary);
  font-weight: 500;
}
.fails__where {
  color: var(--text-tertiary);
  margin-top: 2px;
}
.fails__table td:last-child {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* 数据说明 + 工具入口 */
.tools {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) minmax(380px, 7fr);
  gap: 20px;
  align-items: start;
}
.tools__privacy,
.tools__grid-wrap {
  padding: 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.tools__grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tools__note {
  font-size: 11px;
  color: var(--text-tertiary);
}
.tools__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.tools__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-secondary);
}
.tools__item:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}
.tools__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.tools__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.tools__name {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 500;
}
.tools__desc {
  font-size: 10.5px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tools__go {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.outro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-top: 4px;
}
.outro__title {
  font-size: 13.5px;
  font-weight: 600;
}
.outro__desc {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.outro__actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
@media (max-width: 1000px) {
  .io {
    grid-template-columns: 1fr;
  }
  .io__arrow {
    transform: rotate(90deg);
    align-self: center;
  }
  .tools {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .tools__grid {
    grid-template-columns: 1fr;
  }
  .scp__head {
    flex-direction: column;
    align-items: flex-start;
  }
  .cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .outro {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
