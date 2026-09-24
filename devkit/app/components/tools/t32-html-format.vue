<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()
const { prefs } = usePrefs()

const input = ref('')
const output = ref('')
const lang = ref<'html' | 'css' | 'js'>('html')
const indent = ref<'2' | '4' | 'tab'>(prefs.value.defaultIndent)
const newline = ref<'lf' | 'crlf'>('lf')
const attrBreak = ref<'keep' | 'each'>('keep')
const keepBlank = ref<'yes' | 'no'>('no')
const errDetail = ref('')
const errLine = ref(0)
const inputEditor = ref<{ $el?: HTMLElement }>()
const fileInput = ref<HTMLInputElement>()

const SAMPLES: Record<'html' | 'css' | 'js', string> = {
  html: '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><title>测试</title></head><body><div id="app" class="main"><h1>标题</h1><p>跨行文本\n第二行内容</p><img src="a.png" alt="图"><br><input type="text" value="x"><span>行内</span></div><script>const a = 1;\n  console.log(a);' + '</' + 'script></body></html>',
  css: '.card{padding:1.5rem 10px;margin:0 auto;color:#333}.card .title{font-size:18px;font-weight:700}/* 分组注释 */@media (max-width:600px){.card{padding:8px}.card .title{font-size:14px}}@import url("a.css");',
  js: 'const app={name:"DevKit",version:1};function greet(u){const msg=`hi ${u.name}, v${app.version}`;if(u.active){console.log(msg);return true}else{return false}}/* 块注释 */const re=/ab+c/gi;const ratio=a/b/c;greet({name:"陈立",active:true});'
}

// ---------- 保守格式化器（宁可少改，不可改坏；逻辑已用 node --check 验证） ----------
function countChar(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}
function curLine(src: string, pos: number): number {
  let n = 1
  for (let k = 0; k < pos; k++) if (src[k] === '\n') n++
  return n
}

// ----- HTML -----
const VOID_ELEMS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_ELEMS = new Set(['script', 'style', 'pre', 'textarea'])

interface FmtOpts {
  eol: string
  attrEach: boolean
  keepBlank: boolean
}

function findTagEnd(src: string, lt: number): number {
  let j = lt + 1
  let quote: string | null = null
  while (j < src.length) {
    const c = src[j]!
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return j + 1
    j++
  }
  return src.length
}

function parseTag(rawTag: string): { name: string; attrs: string[]; selfClosed: boolean } | null {
  const m = /^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rawTag)
  if (!m) return null
  const name = m[1]!.toLowerCase()
  const selfClosed = /\/\s*>$/.test(rawTag)
  const rest = rawTag.slice(m[0].length).replace(/\/?>$/, '')
  const attrs: string[] = []
  let i = 0
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i]!)) i++
    if (i >= rest.length) break
    const start = i
    while (i < rest.length && !/[\s=]/.test(rest[i]!)) i++
    let attr = rest.slice(start, i)
    let j = i
    while (j < rest.length && /\s/.test(rest[j]!)) j++
    if (rest[j] === '=') {
      j++
      while (j < rest.length && /\s/.test(rest[j]!)) j++
      if (rest[j] === '"' || rest[j] === "'") {
        const q = rest[j]!
        j++
        const vs = j
        while (j < rest.length && rest[j] !== q) j++
        attr += '=' + q + rest.slice(vs, j) + q
        j++
      } else {
        const vs = j
        while (j < rest.length && !/\s/.test(rest[j]!)) j++
        attr += '=' + rest.slice(vs, j)
      }
    }
    if (attr) attrs.push(attr)
    i = j
  }
  return { name, attrs, selfClosed }
}

function formatHtml(src: string, unit: string, opts: FmtOpts): string {
  const out: string[] = []
  const stack: { name: string; line: number }[] = []
  // 小写化只做一次：循环内每个标签都 src.toLowerCase() 会让整段扫描退化成 O(n·m)。
  // 开标签名已统一小写（parseTag），闭标签检索用小写副本即可保持大小写不敏感。
  const lowerSrc = src.toLowerCase()
  let depth = 0
  let i = 0
  let line = 1
  const pad = (d: number) => unit.repeat(Math.max(0, d))
  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('')
  }
  const openTag = (tagText: string, name: string, attrs: string[], selfClosed: boolean): string[] => {
    if (!opts.attrEach || !attrs.length) return [pad(depth) + tagText]
    const ls = [pad(depth) + `<${name}`]
    for (const a of attrs) ls.push(pad(depth) + unit + a)
    ls.push(pad(depth) + (selfClosed ? '/>' : '>'))
    return ls
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i)
    const seg = lt < 0 ? src.slice(i) : src.slice(i, lt)
    if (seg.trim()) {
      for (const l of seg.split('\n')) {
        const t = l.trim()
        if (t) out.push(pad(depth) + t.replace(/\s+/g, ' '))
      }
    }
    if (opts.keepBlank) {
      const blanks = (seg.match(/\n[ \t]*\n/g) ?? []).length
      for (let b = 0; b < blanks; b++) pushBlank()
    }
    line += countChar(seg, '\n')
    if (lt < 0) break

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt)
      const stop = end < 0 ? src.length : end + 3
      const raw = src.slice(lt, stop)
      for (const l of raw.split('\n')) out.push(l.replace(/^[ \t]+/, ''))
      line += countChar(raw, '\n')
      i = stop
      continue
    }
    if (src[lt + 1] === '!') {
      const end = src.indexOf('>', lt)
      const stop = end < 0 ? src.length : end + 1
      out.push(pad(0) + src.slice(lt, stop).replace(/\s+/g, ' '))
      i = stop
      continue
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt)
      if (end < 0) throw new Error(`第 ${line} 行：标签缺少 ">"`)
      const name = src.slice(lt + 2, end).trim().toLowerCase()
      let idx = -1
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.name === name) {
          idx = k
          break
        }
      }
      if (idx < 0) throw new Error(`第 ${line} 行：</${name}> 没有对应的开始标签`)
      if (idx !== stack.length - 1) {
        const u = stack[stack.length - 1]!
        throw new Error(`第 ${u.line} 行：<${u.name}> 未闭合（在第 ${line} 行的 </${name}> 之前）`)
      }
      stack.pop()
      depth--
      out.push(pad(depth) + `</${name}>`)
      i = end + 1
      continue
    }
    const end = findTagEnd(src, lt)
    const rawTag = src.slice(lt, end)
    const parsed = parseTag(rawTag)
    if (!parsed) throw new Error(`第 ${line} 行：无法解析标签 ${rawTag.slice(0, 24)}`)
    const { name, attrs, selfClosed } = parsed
    const tagText = rawTag.replace(/\s+/g, ' ').replace(/\s+>/, '>').replace(/\/>$/, '/>').trim()
    line += countChar(rawTag, '\n')
    i = end
    if (selfClosed || VOID_ELEMS.has(name)) {
      for (const l of openTag(tagText, name, attrs, selfClosed)) out.push(l)
      continue
    }
    const closeIdx = lowerSrc.indexOf(`</${name}`, i)
    const inner = closeIdx < 0 ? null : src.slice(i, closeIdx)
    if (
      inner !== null &&
      !inner.includes('<') &&
      !inner.includes('\n') &&
      !opts.attrEach &&
      pad(depth).length + tagText.length + inner.trim().length + name.length + 3 <= 100
    ) {
      const gt = src.indexOf('>', closeIdx)
      out.push(pad(depth) + tagText + inner.trim() + `</${name}>`)
      i = gt + 1
      continue
    }
    for (const l of openTag(tagText, name, attrs, selfClosed)) out.push(l)
    depth++
    stack.push({ name, line })
    if (RAW_ELEMS.has(name)) {
      const closeRe = new RegExp(`</\\s*${name}\\s*>`, 'i')
      const cm = closeRe.exec(src.slice(i))
      if (!cm) throw new Error(`第 ${line} 行：<${name}> 未闭合`)
      const content = src.slice(i, i + cm.index)
      const ls = content.split('\n')
      while (ls.length && ls[0]!.trim() === '') ls.shift()
      while (ls.length && ls[ls.length - 1]!.trim() === '') ls.pop()
      for (const l of ls) out.push(l)
      line += countChar(content, '\n')
      depth--
      stack.pop()
      out.push(pad(depth) + `</${name}>`)
      i = i + cm.index + cm[0].length
    }
  }
  if (stack.length) {
    const u = stack[0]!
    throw new Error(`第 ${u.line} 行：<${u.name}> 未闭合`)
  }
  while (out.length && out[0]!.trim() === '') out.shift()
  while (out.length && out[out.length - 1]!.trim() === '') out.pop()
  return out.join(opts.eol) + opts.eol
}

// ----- CSS -----
function formatCss(src: string, unit: string, opts: FmtOpts): string {
  const out: string[] = []
  let depth = 0
  const openLines: number[] = []
  let buf = ''
  let i = 0
  let line = 1
  let inStr: string | null = null
  let pendingBlank = false
  let sawNewline = false
  const pad = (d: number) => unit.repeat(Math.max(0, d))

  function pushOut(s: string) {
    if (opts.keepBlank && pendingBlank) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      pendingBlank = false
    }
    out.push(s)
  }
  function emitDecl(term: string) {
    const decl = buf.replace(/\s+/g, ' ').trim()
    buf = ''
    if (!decl) return
    const ci = decl.indexOf(':')
    const text = ci >= 0 ? `${decl.slice(0, ci).trim()}: ${decl.slice(ci + 1).trim()}` : decl
    pushOut(pad(depth) + text + term)
  }
  function flushSelector() {
    const sel = buf.replace(/\s+/g, ' ').trim()
    buf = ''
    if (!sel) throw new Error(`第 ${line} 行：“{” 前缺少选择器`)
    pushOut(pad(depth) + sel + ' {')
  }

  while (i < src.length) {
    const c = src[i]!
    if (c === '\n') {
      line++
      if (sawNewline) pendingBlank = true
      sawNewline = true
      buf += inStr ? c : ' '
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      buf += inStr ? c : ' '
      i++
      continue
    }
    sawNewline = false
    if (inStr) {
      buf += c
      if (c === '\\' && i + 1 < src.length) {
        buf += src[i + 1]!
        i += 2
        continue
      }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      buf += c
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      const comment = src.slice(i, stop)
      line += countChar(comment, '\n')
      if (buf.trim()) {
        buf += comment
      } else {
        buf = ''
        pushOut(pad(depth) + comment.replace(/\s+/g, ' ').trim())
      }
      i = stop
      continue
    }
    if (c === '{') {
      flushSelector()
      depth++
      openLines.push(line)
      i++
      continue
    }
    if (c === '}') {
      if (depth === 0) throw new Error(`第 ${line} 行：出现多余的 “}”`)
      emitDecl(';')
      depth--
      openLines.pop()
      pushOut(pad(depth) + '}')
      i++
      continue
    }
    if (c === ';') {
      emitDecl(';')
      i++
      continue
    }
    buf += c
    i++
  }
  if (inStr) throw new Error(`第 ${line} 行：字符串 ${inStr} 未闭合`)
  if (depth > 0) throw new Error(`第 ${openLines[0]} 行：“{” 未闭合`)
  if (buf.trim()) throw new Error(`第 ${line} 行：末尾有未结束的内容（缺少 “}” 或 “;”）`)
  while (out.length && out[0] === '') out.shift()
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join(opts.eol) + opts.eol
}

// ----- JS（状态机跳过字符串/模板/${}/注释/正则） -----
const REGEX_PREV_CHARS = new Set(['=', '(', '[', '{', ',', ':', ';', '!', '&', '|', '?', '^', '%', '+', '-', '*', '<', '>', '~'])
const REGEX_PREV_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void', 'throw', 'yield', 'await', 'new', 'do', 'else'])
const OBJ_PREV_CHARS = new Set(['=', '(', '[', ',', ':', '!', '&', '|', '?', '^', '%', '+', '-', '*', '<', '>', '~'])

interface OpenEntry {
  ch: string
  obj: boolean
  line: number
  outLine: number
}

function formatJs(src: string, unit: string, opts: FmtOpts): string {
  const lines: string[] = []
  let cur = ''
  const openStack: OpenEntry[] = []
  let i = 0
  let state: 'code' | 'sq' | 'dq' | 'tpl' | 'tplExpr' | 'lineComment' | 'blockComment' | 'regex' | 'regexClass' = 'code'
  let prevSig = ''
  let wordBuf = ''
  let litStart = 1
  let pendingBlank = false
  let sawNewline = false

  const indentOf = () => {
    const braces = openStack.filter((s) => s.ch === '{' || s.ch === '${').length
    const top = openStack[openStack.length - 1]
    const hang = top && (top.ch === '(' || top.ch === '[') && top.outLine < lines.length ? 1 : 0
    return unit.repeat(Math.max(0, braces + hang))
  }
  function pushLine() {
    const t = cur.replace(/\s+$/, '')
    cur = ''
    if (!t) return
    if (opts.keepBlank && pendingBlank) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('')
      pendingBlank = false
    }
    lines.push(indentOf() + t)
  }
  function canBreakStatement(): boolean {
    if (!openStack.length) return true
    const top = openStack[openStack.length - 1]!
    return (top.ch === '{' && !top.obj) || top.ch === '${'
  }

  while (i < src.length) {
    const c = src[i]!
    const next = src[i + 1]

    if (state === 'code' || state === 'tplExpr') {
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        if (c === '\n') {
          if (sawNewline) pendingBlank = true
          sawNewline = true
        }
        if (cur && !/\s$/.test(cur)) cur += ' '
        i++
        continue
      }
      sawNewline = false
      if (c === '/' && next === '/') {
        state = 'lineComment'
        cur += '//'
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        state = 'blockComment'
        cur += '/*'
        i += 2
        continue
      }
      if (c === "'" || c === '"') {
        state = c === "'" ? 'sq' : 'dq'
        litStart = curLine(src, i)
        cur += c
        i++
        continue
      }
      if (c === '`') {
        state = 'tpl'
        litStart = curLine(src, i)
        cur += c
        i++
        continue
      }
      if (c === '/' && (REGEX_PREV_CHARS.has(prevSig) || (wordBuf && REGEX_PREV_WORDS.has(wordBuf)))) {
        state = 'regex'
        litStart = curLine(src, i)
        cur += c
        i++
        continue
      }
      if (c === '{') {
        const obj = OBJ_PREV_CHARS.has(prevSig) || (!!wordBuf && REGEX_PREV_WORDS.has(wordBuf))
        if (cur && /[A-Za-z0-9_$]$/.test(cur)) cur += ' '
        cur += '{'
        // 模板表达式内不换行（换行会改变模板字符串内容）
        if (state === 'code') pushLine()
        openStack.push({ ch: '{', obj, line: curLine(src, i), outLine: lines.length })
        i++
        continue
      }
      if (c === '}') {
        const top = openStack[openStack.length - 1]
        if (!top || (top.ch !== '{' && top.ch !== '${')) throw new Error(`第 ${curLine(src, i)} 行：出现多余的 “}”`)
        if (top.ch === '${') {
          // 回到模板字符串：绝不换行
          openStack.pop()
          cur += '}'
          state = 'tpl'
          i++
          continue
        }
        if (state === 'tplExpr') {
          openStack.pop()
          cur += '}'
          i++
          continue
        }
        if (cur.trim()) pushLine()
        openStack.pop()
        cur += '}'
        const rest = src.slice(i + 1)
        const kw = /^[ \t]*(else|catch|finally|while)\b/.exec(rest)
        const op = /^[ \t]*[)`,;.\]:+\-*%&|<>=?]/.exec(rest)
        if (!kw && !op) pushLine()
        else if (kw && !/\s$/.test(cur)) cur += ' '
        i++
        continue
      }
      if (c === '(' || c === '[') {
        openStack.push({ ch: c, obj: false, line: curLine(src, i), outLine: lines.length })
        cur += c
        i++
        continue
      }
      if (c === ')' || c === ']') {
        const want = c === ')' ? '(' : '['
        const top = openStack[openStack.length - 1]
        if (!top || top.ch !== want) throw new Error(`第 ${curLine(src, i)} 行：出现多余的 “${c}”`)
        openStack.pop()
        cur += c
        i++
        continue
      }
      if (c === ';') {
        cur += c
        if (canBreakStatement()) pushLine()
        i++
        continue
      }
      if (c === ',') {
        cur += c
        const top = openStack[openStack.length - 1]
        if (state === 'code' && top && top.ch === '{' && top.obj) pushLine()
        i++
        continue
      }
      cur += c
      if (/[A-Za-z0-9_$]/.test(c)) wordBuf += c
      else wordBuf = ''
      prevSig = c
      i++
      continue
    }

    if (state === 'lineComment') {
      if (c === '\n') {
        pushLine()
        state = 'code'
      } else cur += c
      i++
      continue
    }
    if (state === 'blockComment') {
      if (c === '*' && next === '/') {
        cur += '*/'
        i += 2
        if (/^\s*\/\*[\s\S]*\*\/\s*$/.test(cur)) pushLine()
        state = 'code'
        continue
      }
      cur += c
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      if (c === '\n') throw new Error(`第 ${litStart} 行：字符串未闭合`)
      if (c === '\\') {
        cur += c + (next ?? '')
        i += 2
        continue
      }
      cur += c
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"')) state = 'code'
      i++
      continue
    }
    if (state === 'tpl') {
      if (c === '\\') {
        cur += c + (next ?? '')
        i += 2
        continue
      }
      cur += c
      if (c === '`') {
        state = 'code'
        i++
        continue
      }
      if (c === '$' && next === '{') {
        cur += '{'
        openStack.push({ ch: '${', obj: false, line: curLine(src, i), outLine: lines.length })
        state = 'tplExpr'
        i += 2
        continue
      }
      i++
      continue
    }
    if (state === 'regex' || state === 'regexClass') {
      if (c === '\n') throw new Error(`第 ${litStart} 行：正则字面量未闭合`)
      if (c === '\\') {
        cur += c + (next ?? '')
        i += 2
        continue
      }
      cur += c
      if (state === 'regex' && c === '[') state = 'regexClass'
      else if (state === 'regexClass' && c === ']') state = 'regex'
      else if (state === 'regex' && c === '/') {
        state = 'code'
        let j = i + 1
        while (j < src.length && /[a-z]/.test(src[j]!)) {
          cur += src[j]!
          j++
        }
        i = j
        continue
      }
      i++
      continue
    }
    i++
  }

  if (state === 'sq' || state === 'dq') throw new Error(`第 ${litStart} 行：字符串未闭合`)
  if (state === 'tpl') throw new Error(`第 ${litStart} 行：模板字符串未闭合`)
  if (state === 'regex' || state === 'regexClass') throw new Error(`第 ${litStart} 行：正则字面量未闭合`)
  if (state === 'blockComment') throw new Error(`第 ${litStart} 行：块注释未闭合`)
  pushLine()
  if (openStack.length) {
    const top = openStack[0]!
    throw new Error(`第 ${top.line} 行：“${top.ch}” 未闭合`)
  }
  while (lines.length && lines[0]!.trim() === '') lines.shift()
  return lines.join(opts.eol) + opts.eol
}

// ---------- 执行 ----------
const indentUnit = computed(() => (indent.value === 'tab' ? '\t' : indent.value === '4' ? '    ' : '  '))
const eol = computed(() => (newline.value === 'crlf' ? '\r\n' : '\n'))
const fmtOpts = computed<FmtOpts>(() => ({ eol: eol.value, attrEach: attrBreak.value === 'each', keepBlank: keepBlank.value === 'yes' }))

const sig = () => JSON.stringify([input.value, lang.value, indent.value, newline.value, attrBreak.value, keepBlank.value])
const run = useToolRun(sig)

const langLabel = computed(() => (lang.value === 'html' ? 'HTML' : lang.value === 'css' ? 'CSS' : 'JavaScript'))
const pairNote = computed(() => {
  if (run.status.value !== 'ok') return ''
  return lang.value === 'html' ? '标签配对正确' : '括号配对正确'
})

function execute() {
  errLine.value = 0
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    errDetail.value = ''
    return
  }
  try {
    const srcText = input.value
    output.value =
      lang.value === 'html'
        ? formatHtml(srcText, indentUnit.value, fmtOpts.value)
        : lang.value === 'css'
          ? formatCss(srcText, indentUnit.value, fmtOpts.value)
          : formatJs(srcText, indentUnit.value, fmtOpts.value)
    errDetail.value = ''
    run.markOk(`仅格式化源码文本，不执行 JS；保守缩进，不改写语义`)
  } catch (e) {
    output.value = ''
    errDetail.value = errMessage(e)
    const m = /第 (\d+) 行/.exec(errDetail.value)
    errLine.value = m ? Number(m[1]) : 0
    run.markFail(errDetail.value)
  }
}

function locateLine() {
  const line = errLine.value
  if (!line) return
  const el = inputEditor.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!el) return
  const ls = input.value.split('\n')
  let pos = 0
  for (let k = 0; k < line - 1 && k < ls.length; k++) pos += ls[k]!.length + 1
  const end = pos + (ls[line - 1]?.length ?? 0)
  el.focus()
  el.setSelectionRange(pos, end)
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
  el.scrollTop = Math.max(0, (line - 1) * lh - el.clientHeight / 2)
}

function triggerImport() {
  fileInput.value?.click()
}
function onImport(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  f.text().then((t) => {
    input.value = t
    const ext = f.name.toLowerCase().split('.').pop() ?? ''
    if (ext === 'css') lang.value = 'css'
    else if (ext === 'js' || ext === 'mjs' || ext === 'cjs') lang.value = 'js'
    else if (ext === 'html' || ext === 'htm') lang.value = 'html'
    execute()
  })
}

function loadSample() {
  input.value = SAMPLES[lang.value]
  execute()
}

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
  <div class="t32">
    <div class="t32__toolbar">
      <DkSegmented
        :model-value="lang"
        :options="[
          { value: 'html', label: 'HTML' },
          { value: 'css', label: 'CSS' },
          { value: 'js', label: 'JS' }
        ]"
        @update:model-value="lang = $event as any"
      />
      <span class="grow"></span>
      <input ref="fileInput" type="file" accept=".html,.htm,.css,.js,.mjs,.cjs,.txt,.vue,.json" class="t32__file" @change="onImport" />
      <DkButton size="sm" variant="ghost" title="从本地导入源码文件（内容保留在本地，不上传）" @click="triggerImport">导入文件</DkButton>
      <DkButton size="sm" variant="ghost" title="载入当前语言的压缩示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" title="清空输入与结果" @click="input = ''; execute()">清空</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        格式化
      </DkButton>
      <span class="t32__kbd tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <div class="t32__params">
      <div class="t32__opt">
        <span class="t32__opt-label">缩进</span>
        <DkSegmented
          size="sm"
          :model-value="indent"
          :options="[
            { value: '2', label: '2 空格' },
            { value: '4', label: '4 空格' },
            { value: 'tab', label: 'Tab' }
          ]"
          @update:model-value="indent = $event as any"
        />
      </div>
      <div class="t32__opt">
        <span class="t32__opt-label">换行</span>
        <DkSegmented
          size="sm"
          :model-value="newline"
          :options="[
            { value: 'lf', label: 'LF' },
            { value: 'crlf', label: 'CRLF' }
          ]"
          @update:model-value="newline = $event as 'lf' | 'crlf'"
        />
      </div>
      <div class="t32__opt" :class="{ 't32__opt--off': lang !== 'html' }" :title="lang !== 'html' ? '属性换行仅对 HTML 生效，CSS / JS 无属性概念' : '每行一个属性会展开开标签'">
        <span class="t32__opt-label">属性换行</span>
        <DkSegmented
          size="sm"
          :model-value="attrBreak"
          :options="[
            { value: 'keep', label: '保持' },
            { value: 'each', label: '每行一个' }
          ]"
          @update:model-value="attrBreak = $event as 'keep' | 'each'"
        />
      </div>
      <div class="t32__opt">
        <span class="t32__opt-label">保留空行</span>
        <DkSegmented
          size="sm"
          :model-value="keepBlank"
          :options="[
            { value: 'no', label: '否' },
            { value: 'yes', label: '是' }
          ]"
          @update:model-value="keepBlank = $event as 'no' | 'yes'"
        />
      </div>
      <span class="grow"></span>
    </div>

    <div v-if="run.status.value === 'error'" class="t32__banner t32__banner--error">
      <DkIcon name="alert-circle" :size="13" />
      <span>{{ errDetail }}（格式化已停止，未输出部分结果）</span>
      <span class="grow"></span>
      <DkButton v-if="errLine" size="sm" variant="ghost" @click="locateLine">定位第 {{ errLine }} 行</DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[langLabel, pairNote || '自实现保守格式化器']"
      :retry="execute"
    />

    <div class="t32__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            ref="inputEditor"
            v-model="input"
            :lang="`${langLabel} 输入`"
            placeholder="粘贴压缩过的源码，或点击「载入示例」"
            :error="run.status.value === 'error' ? errDetail : undefined"
            :height="'calc(58vh - 60px)'"
            :filename="lang === 'html' ? 'input.html' : lang === 'css' ? 'input.css' : 'input.js'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            lang="格式化结果"
            placeholder="格式化结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(58vh - 60px)'"
            :filename="lang === 'html' ? 'formatted.html' : lang === 'css' ? 'formatted.css' : 'formatted.js'"
          />
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="格式化规则（保守策略：宁可少改，不可改坏）">
      <p>仅重排空白与缩进，不改变标签、属性、文本内容与字符编码；HTML 不做标签闭合修复，CSS 不做属性合并，JS 不执行也不做压缩混淆。改选项后需重新点击「格式化」。</p>
      <h4>通用选项</h4>
      <ul>
        <li>换行：输出使用 LF 或 CRLF；保留空行：保留源码中的连续空行（<code>是</code> 时）。</li>
        <li>属性换行「每行一个」仅对 HTML 生效：把开标签的每个属性单独成行并缩进一级；CSS / JS 无属性概念，该选项置灰。</li>
        <li>导入文件：从本地 <code>.html/.css/.js</code> 等文本文件读入；内容只在浏览器内存中处理，不上传。</li>
      </ul>
      <h4>HTML</h4>
      <ul>
        <li>开标签缩进 +1、闭标签 -1；void 元素（br / img / input 等）与自闭合标签不增加缩进。</li>
        <li><code>&lt;pre&gt;</code> / <code>&lt;textarea&gt;</code> / <code>&lt;script&gt;</code> / <code>&lt;style&gt;</code> 内容原样保留；跨行文本保持行结构。</li>
        <li>纯文本短内容（如 <code>&lt;span&gt;行内&lt;/span&gt;</code>）保持单行；开启属性换行后开标签一律展开。</li>
        <li>标签不配对时报「第 N 行：&lt;div&gt; 未闭合」并保留输入，可用「定位第 N 行」跳到出错行。</li>
      </ul>
      <h4>CSS</h4>
      <ul>
        <li>选择器后 <code>{</code> 换行并 +1 缩进，<code>}</code> 对齐回退；每条声明一行；@media 嵌套按深度缩进。</li>
        <li>字符串与注释原样保留；括号不配对报「第 N 行：“{” 未闭合」。</li>
      </ul>
      <h4>JS</h4>
      <ul>
        <li>括号深度保守缩进；状态机跳过单/双引号字符串、模板字符串（含 <code>${}</code> 嵌套）、<code>//</code> 与 <code>/* */</code> 注释、正则字面量（<code>=</code> <code>(</code> <code>,</code> <code>[</code> <code>:</code> 后的 <code>/</code> 视为正则起点），防止字符串里的 <code>{}</code> 干扰计数。</li>
        <li><code>} else {</code> / <code>});</code> / <code>do…while</code> 保持同行；对象字面量成员按行展开。</li>
        <li>本工具仅格式化源码文本，不执行 JS，也不是压缩 / 混淆工具。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t32 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t32__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t32__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t32__opt--off {
  opacity: 0.45;
  pointer-events: none;
}
.t32__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t32__params {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.t32__file {
  display: none;
}
.t32__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.55;
}
.t32__banner--error {
  background: var(--error-soft);
  color: var(--error);
}
.t32__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t32__panes {
  min-height: 320px;
}
</style>
