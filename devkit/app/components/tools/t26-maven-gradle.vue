<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()

const input = ref('')
const output = ref('')
const source = ref<'maven' | 'gradle'>('maven')
const target = ref<'groovy' | 'kotlin' | 'maven'>('groovy')
const errDetail = ref('')
const manual = ref<{ level: 'error' | 'warn'; text: string }[]>([])

const SCOPE_MAP: Record<string, string> = {
  compile: 'implementation',
  provided: 'compileOnly',
  test: 'testImplementation',
  runtime: 'runtimeOnly',
}
const CONFIG_TO_SCOPE: Record<string, string | null> = {
  implementation: null,
  api: null,
  compileOnly: 'provided',
  testImplementation: 'test',
  runtimeOnly: 'runtime',
}

const targetOptions = computed(() =>
  source.value === 'maven'
    ? [
        { value: 'groovy', label: 'Gradle Groovy' },
        { value: 'kotlin', label: 'Gradle Kotlin' },
      ]
    : [{ value: 'maven', label: 'Maven XML' }],
)

watch(source, (s) => {
  if (s === 'maven') {
    if (target.value === 'maven') target.value = 'groovy'
  } else {
    target.value = 'maven'
  }
})

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\s*>([\\s\\S]*?)</${name}\\s*>`).exec(block)
  return m ? m[1]!.trim() : null
}

/* ---------------- Maven XML -> Gradle ---------------- */

function mavenToGradle(text: string): { lines: string[]; ok: number } | null {
  const depRe = /<dependency\b[^>]*>([\s\S]*?)<\/dependency\s*>/g
  const deps: { config: string; coord: string }[] = []
  let blocks = 0
  let m: RegExpExecArray | null
  while ((m = depRe.exec(text)) !== null) {
    blocks++
    const block = m[1]!
    const g = tag(block, 'groupId')
    const a = tag(block, 'artifactId')
    const v = tag(block, 'version')
    const scope = tag(block, 'scope') ?? 'compile'
    const classifier = tag(block, 'classifier')
    if (!g || !a) {
      manual.value.push({ level: 'error', text: `第 ${blocks} 个 <dependency> 缺少 groupId / artifactId，已跳过` })
      continue
    }
    if (v && /\$\{[^}]*\}/.test(v)) {
      manual.value.push({ level: 'error', text: `检测到 Maven 属性引用 ${v}（${g}:${a}），请替换为实际值后再转换` })
      continue
    }
    if (scope === 'system') {
      manual.value.push({ level: 'error', text: `${g}:${a} 使用 system scope，无 Gradle 等价，请手动处理` })
      continue
    }
    if (scope === 'import') {
      manual.value.push({ level: 'error', text: `${g}:${a} 使用 import scope，属于 dependencyManagement（BOM 导入），不在此处理` })
      continue
    }
    const config = SCOPE_MAP[scope]
    if (!config) {
      manual.value.push({ level: 'error', text: `${g}:${a} 的 scope "${scope}" 无法识别，请手动处理` })
      continue
    }
    let coord: string
    if (!v) {
      coord = classifier ? `${g}:${a}:\${version}:${classifier}` : `${g}:${a}:\${version}`
      manual.value.push({ level: 'warn', text: `${g}:${a} 缺少 version，已用 \${version} 占位，请补全` })
    } else if (classifier) {
      coord = `${g}:${a}:${v}:${classifier}`
    } else {
      coord = `${g}:${a}:${v}`
    }
    deps.push({ config, coord })
  }
  if (!blocks) return null
  if (!deps.length) return { lines: [], ok: 0 }
  if (target.value === 'kotlin') {
    return {
      lines: deps.map((d) => `    ${d.config}("${d.coord}")`),
      ok: deps.length,
    }
  }
  return {
    lines: deps.map((d) => `    ${d.config} '${d.coord}'`),
    ok: deps.length,
  }
}

/* ---------------- Gradle -> Maven XML ---------------- */

const GRADLE_LINE_RE =
  /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|platform|enforcedPlatform)\s*\(?\s*['"]([^'"]+)['"]/

const GRADLE_DECL_RE =
  /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|platform|enforcedPlatform|compile|testCompile|provided|classpath|kapt|ksp)\b/

function gradleToMaven(text: string): { deps: { g: string; a: string; v: string | null; c: string | null; scope: string | null }[]; ok: number } | null {
  const deps: { g: string; a: string; v: string | null; c: string | null; scope: string | null }[] = []
  let matched = 0
  let projectDeps = 0
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim() || /^\s*(\/\/|\/\*)/.test(line)) continue
    const projectM = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\s*\(?\s*project\s*\(/.exec(line)
    if (projectM) {
      matched++
      projectDeps++
      manual.value.push({ level: 'error', text: `project(...) 依赖（${projectM[1]}）无 Maven 坐标等价，请手动处理` })
      continue
    }
    const m = GRADLE_LINE_RE.exec(line)
    if (!m) {
      if (GRADLE_DECL_RE.test(line)) {
        matched++
        manual.value.push({ level: 'error', text: `不支持的依赖声明（已跳过）："${line.trim()}"；仅支持字符串坐标 g:a:version[:classifier] 或 project(...)` })
      }
      continue
    }
    matched++
    const config = m[1]!
    let coord = m[2]!
    if (config === 'platform' || config === 'enforcedPlatform') {
      manual.value.push({ level: 'error', text: `${config}('...') 属于 BOM / platform 导入，对应 Maven dependencyManagement，不在此处理` })
      continue
    }
    if (coord.includes('$')) {
      manual.value.push({ level: 'error', text: `检测到 Gradle 变量引用（${config} '${coord}'），请替换为实际值后再转换` })
      continue
    }
    const at = coord.lastIndexOf('@')
    if (at >= 0) {
      manual.value.push({ level: 'warn', text: `已忽略打包类型 "${coord.slice(at + 1)}"（${coord}）` })
      coord = coord.slice(0, at)
    }
    const parts = coord.split(':')
    if (parts.length < 2 || parts.length > 4 || parts.some((p) => !p)) {
      manual.value.push({ level: 'error', text: `无法解析的依赖坐标："${coord}"（期望 g:a:version[:classifier]）` })
      continue
    }
    const scope = CONFIG_TO_SCOPE[config]
    if (scope === undefined) {
      manual.value.push({ level: 'error', text: `configuration "${config}" 无直接 Maven scope 等价，请手动处理` })
      continue
    }
    const g = parts[0]!
    const a = parts[1]!
    let version: string | null = null
    let cls: string | null = null
    if (parts.length === 2) {
      manual.value.push({ level: 'warn', text: `${g}:${a} 缺少 version，已用 \${version} 占位，请补全` })
    } else if (parts.length === 3) {
      version = parts[2]!
    } else {
      version = parts[2]!
      cls = parts[3]!
    }
    deps.push({ g, a, v: version, c: cls, scope: scope ?? null })
  }
  if (!matched) return null
  return { deps, ok: deps.length }
}

function buildMavenXml(deps: { g: string; a: string; v: string | null; c: string | null; scope: string | null }[]): string {
  const lines: string[] = ['<dependencies>']
  for (const d of deps) {
    lines.push('    <dependency>')
    lines.push(`        <groupId>${xmlEscape(d.g)}</groupId>`)
    lines.push(`        <artifactId>${xmlEscape(d.a)}</artifactId>`)
    lines.push(`        <version>${d.v ? xmlEscape(d.v) : '${version}'}</version>`)
    if (d.c) lines.push(`        <classifier>${xmlEscape(d.c)}</classifier>`)
    if (d.scope) lines.push(`        <scope>${xmlEscape(d.scope)}</scope>`)
    lines.push('    </dependency>')
  }
  lines.push('</dependencies>')
  return lines.join('\n') + '\n'
}

const SAMPLE = `<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <version>3.2.5</version>
    </dependency>
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <version>1.18.32</version>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <version>5.10.2</version>
        <scope>test</scope>
    </dependency>
</dependencies>`

const SAMPLE_GRADLE = `dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web:3.2.5'
    implementation("com.google.guava:guava:33.1.0-jre")
    compileOnly 'org.projectlombok:lombok:1.18.32'
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'
    runtimeOnly 'com.mysql:mysql-connector-j:8.4.0'
}`

const sig = () => JSON.stringify([input.value, source.value, target.value])
const run = useToolRun(sig)

function execute() {
  manual.value = []
  errDetail.value = ''
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    return
  }
  try {
    if (source.value === 'maven') {
      const res = mavenToGradle(input.value)
      if (!res) {
        errDetail.value = '未找到 <dependency>...</dependency> 块；请确认粘贴的是 Maven 依赖声明 XML（<dependencies> 片段即可）'
        run.markFail(errDetail.value)
        return
      }
      if (!res.ok) {
        errDetail.value = `${manual.value.length} 条依赖全部需要人工处理，没有可自动转换的内容（见下方清单）`
        run.markFail(errDetail.value)
        return
      }
      output.value = `dependencies {\n${res.lines.join('\n')}\n}\n`
      run.markOk(
        manual.value.length
          ? `已转换 ${res.ok} 条依赖；另有 ${manual.value.length} 条需人工处理（见下方清单）`
          : `已转换 ${res.ok} 条依赖`,
      )
    } else {
      const res = gradleToMaven(input.value)
      if (!res) {
        errDetail.value =
          '未找到可解析的依赖声明行；支持 implementation / api / compileOnly / runtimeOnly / testImplementation 等，形如 implementation("g:a:v") 或 implementation \'g:a:v\''
        run.markFail(errDetail.value)
        return
      }
      if (!res.ok) {
        errDetail.value = `${manual.value.length} 条声明全部需要人工处理，没有可自动转换的内容（见下方清单）`
        run.markFail(errDetail.value)
        return
      }
      output.value = buildMavenXml(res.deps)
      run.markOk(
        manual.value.length
          ? `已转换 ${res.ok} 条依赖；另有 ${manual.value.length} 条需人工处理（见下方清单）`
          : `已转换 ${res.ok} 条依赖`,
      )
    }
  } catch (e) {
    errDetail.value = errMessage(e)
    run.markFail(errDetail.value)
  }
}

watch([source, target], execute)

const outFilename = computed(() =>
  target.value === 'maven' ? 'pom-dependencies.xml' : target.value === 'kotlin' ? 'build.gradle.kts' : 'build.gradle',
)

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t26">
    <div class="t26__toolbar">
      <div class="t26__opt">
        <span class="t26__opt-label">源格式</span>
        <DkSegmented
          :model-value="source"
          :options="[
            { value: 'maven', label: 'Maven XML' },
            { value: 'gradle', label: 'Gradle' },
          ]"
          @update:model-value="source = $event as any"
        />
      </div>
      <DkIcon name="chevron-right" :size="14" class="t26__arrow" />
      <div class="t26__opt">
        <span class="t26__opt-label">目标格式</span>
        <DkSegmented
          :model-value="target"
          :options="targetOptions"
          @update:model-value="target = $event as any"
        />
      </div>
      <span class="grow"></span>
      <DkButton
        size="sm"
        variant="ghost"
        @click="input = source === 'maven' ? SAMPLE : SAMPLE_GRADLE; execute()"
      >
        载入示例
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        转换
      </DkButton>
      <span class="t26__kbd tertiary">⌘/Ctrl + Enter</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="['本地转换，不查询网络、不下载依赖']"
      :retry="execute"
    />

    <div class="t26__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="source === 'maven' ? 'Maven XML 输入' : 'Gradle DSL 输入'"
            :placeholder="source === 'maven' ? '粘贴 Maven <dependencies> 片段（只提取 <dependency> 块，不要求完整 pom）' : '粘贴 Gradle 依赖声明（Groovy 或 Kotlin DSL 均可）'"
            :height="'calc(56vh - 60px)'"
            :filename="source === 'maven' ? 'dependencies.xml' : 'build.gradle'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="target === 'maven' ? 'Maven XML 输出' : target === 'kotlin' ? 'Gradle Kotlin 输出' : 'Gradle Groovy 输出'"
            placeholder="转换结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :error="run.status.value === 'error' ? errDetail : ''"
            :height="'calc(56vh - 60px)'"
            :filename="outFilename"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="manual.length && (run.status.value === 'ok' || run.status.value === 'stale' || run.status.value === 'error')" class="t26__manual">
      <div class="t26__section-title">需人工处理清单（本工具不猜测，请逐条确认）</div>
      <ul class="t26__manual-list">
        <li v-for="(it, i) in manual" :key="i" :class="it.level === 'error' ? 't26__manual--err' : 't26__manual--warn'">
          {{ it.text }}
            </li>
      </ul>
    </div>

    <DkCollapse title="用法说明">
      <ul>
        <li>Maven scope 映射：compile → implementation、provided → compileOnly、test → testImplementation、runtime → runtimeOnly（implementation 输出不带 scope，Maven 默认 compile）。</li>
        <li>system scope 无 Gradle 等价；import scope 属于 dependencyManagement（BOM），二者都会进入「需人工处理清单」，不会静默丢弃。</li>
        <li>classifier 转为紧凑坐标 'group:artifact:version:classifier'；缺少 version 时用 <code>${version}</code> 占位并列入清单；Maven 属性引用 <code>${xxx}</code> 与 Gradle 变量引用会报错并要求替换为实际值。</li>
        <li>反向 Gradle → Maven：解析 implementation / api / compileOnly / runtimeOnly / testImplementation 的字符串坐标（Groovy 与 Kotlin DSL 均可），顺序为 <code>group:artifact:version[:classifier]</code>；project(...)、platform/BOM 导入、map 形式（如 <code>implementation group: 'x', name: 'y'</code>）与版本目录（<code>libs.xxx</code>）等无法直接转换的声明都会逐条列入清单，不再静默丢弃。</li>
        <li>全部在浏览器本地用正则解析（不依赖 DOMParser），不查询网络、不下载依赖、不校验坐标是否真实存在。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t26 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t26__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t26__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t26__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t26__arrow {
  color: var(--text-tertiary);
}
.t26__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t26__panes {
  min-height: 320px;
}
.t26__manual {
  border: 1px solid var(--warn, #d4a72c);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.t26__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.t26__manual-list {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
  font-size: 12.5px;
  line-height: 1.7;
}
.t26__manual--err {
  color: var(--error);
}
.t26__manual--warn {
  color: var(--warn, #b45309);
}
</style>
