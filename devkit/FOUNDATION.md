# DevKit 工具开发基础（必读）

本文件面向「实现某个工具页组件」的开发者。项目是 Nuxt 4（内置 Vite + Vue 3.5），
所有工具在浏览器本地计算，**禁止伪造结果、禁止展示未真实计算的成功状态**。

## 品牌标识（favicon / PWA / 顶栏）

标识是「工具箱」：实心圆角箱体 + 盖缝 + 中间分格 + 描边提手，24×24 网格、线宽 2.4、圆头圆角；白色 `#FFFFFF` 画在 `#2563EB` 圆角方块上。

- 语义：箱体＝收纳容器（不限行业）；提手＝随身携带（对应纯本地处理、离线可用、可安装为桌面应用）；盖缝与分格＝箱内分格，对应「各类工具各就各位」。
- 不要再换回字母 / 花括号 / 扳手等具象符号：那会把品牌绑死在某个职业上，后续面向非开发用户会失配。
- 唯一真源：`public/pwa-192.png`、`pwa-512.png`（普通版，图形占 62.5%）与两张 `pwa-maskable-*.png`（满幅蓝底、图形收到 72% 安全区）；`nuxt.config.ts` 的 `rel=icon`、`apple-touch-icon`、manifest 与 `og:image` 都引用这些文件名，改图形时不要改名。顶栏用同一个图形的内联 SVG（`components/TopNav.vue`，28×28 方块内 17×17）。
- 生成与替换脚本见 `docs/logo-proposal-20260921/README.md`（`audit/tmp/logo_build.mjs`，依赖 `rsvg-convert` + ImageMagick）；该目录的 `mark.svg` 是标识本体。

## 项目结构

```
devkit/
  app/
    assets/css/main.css      # 设计令牌（CSS 变量，明/暗双主题）
    components/              # 共享组件（勿改，直接用）
      tools/t01-json-format.vue   # 示范工具（必读）
      DkButton.vue DkInput.vue DkSelect.vue DkSegmented.vue DkCheckbox.vue
      DkField.vue DkCollapse.vue DkModal.vue DkEditor.vue DkStatusBar.vue
      DkIcon.vue DkIconButton.vue DkToastHost.vue FileDrop.vue
      SplitPanes.vue JsonTree.vue ToolPageLayout.vue ToolCard.vue
      TopNav.vue SideNav.vue CommandPalette.vue
    composables/
      useToolRun.ts          # G04 待更新模式（见下）
      useToast.ts useClipboard.ts usePrefs.ts useFavorites.ts useRecent.ts usePalette.ts
    utils/
      bytes.ts               # 字节/hex/base64/text 转换工具集（自动导入）
      json.ts                # 大整数安全 JSON（parseJson/stringifyJson/minifyJson/jsonErrorPosition）
    data/tools.ts            # 工具注册表（勿改）
    pages/tools/[slug].vue   # 动态路由，自动加载 components/tools/{id}-{slug}.vue
```

## 工具组件约定

- 文件：`app/components/tools/t{NN}-{slug}.vue`（slug 见 data/tools.ts，必须完全一致）
- Props：`defineProps<{ tool: ToolMeta }>()`（由路由页传入，一般用不到）
- 外壳、页头、收藏、最近使用已由 `pages/tools/[slug].vue` + `ToolPageLayout` 处理，
  **你的组件只写工作区主体**（工具条 + 状态栏 + 编辑器/结果区）
- 不要操作 document/window 于 setup 顶层（SSR 会挂）；事件处理器、onMounted 里可以用
- 中文界面；协议名/算法名/字段名保留英文
- 正文 13-14px，代码用已有的 mono 变量；间距用 8/12/16

## G04 结果待更新模式（所有工具必须遵守）

用户修改输入或影响计算的参数后，旧结果标记「待更新」：保留可查看，但复制/下载禁用，
状态栏出现「重新执行」按钮：

```ts
const sig = () => JSON.stringify([input.value, mode.value, key.value])  // 所有影响输出的值
const run = useToolRun(sig)

function execute() {
  try {
    output.value = /* 真实计算 */
    run.markOk('附加说明（可空）')
  } catch (e) {
    run.markFail(errMessage(e))   // 失败必须保留输入并给出具体修正方向
  }
}

// DkEditor 结果侧传 :stale="run.status.value === 'stale'" 禁用复制下载
// <DkStatusBar :status="run.status.value" :message="..." :retry="execute" />
```

预览型工具（输入即算、无需按钮）可以直接 watch + execute，status 保持 ok。

## 组件 API 速查

### DkEditor（代码编辑器）
```vue
<DkEditor
  v-model="input"                    <!-- 或 :model-value="output" readonly -->
  lang="JSON 输入"                    <!-- 左上角语言标注，可选 -->
  placeholder="..."
  :readonly="true"                   <!-- 结果侧 -->
  :error="errMsg"                    <!-- 红框 + 错误条（可选） -->
  :wrap="true"                       <!-- false 时长行横向滚动 -->
  :height="'calc(60vh - 60px)'"      <!-- CSS 高度 -->
  filename="out.json"                <!-- 下载文件名 -->
  :stale="..."                       <!-- 待更新时禁用复制/下载 -->
  :show-stats="true"                 <!-- 字符/字节/行统计 -->
/>
```

### DkSegmented / DkSelect / DkInput / DkCheckbox
```vue
<DkSegmented v-model="mode" size="sm|md" :options="[{value,label,title?}]" />
<DkSelect v-model="v" :options="[{value,label}]" />
<DkInput v-model="text" placeholder mono :error="!!err" />
<DkCheckbox v-model="flag" label="忽略空白" />
```

### DkField（参数字段：label/help/error；密钥字段用 secret 提供显隐）
```vue
<DkField label="密钥" help="16 字节，Hex 或 UTF-8" :error="keyErr" secret>
  <template #default="{ revealed }">
    <DkInput v-model="key" :type="revealed ? 'text' : 'password'" mono />
  </template>
</DkField>
```

### DkButton / DkIconButton
`variant: primary|secondary|ghost|danger`，`size: sm|md`，`:loading`，`:disabled`

### DkStatusBar
`<DkStatusBar :status="run.status.value" :message="..." :meta="['SHA-256','耗时 2ms']" :retry="execute" />`
status: idle|ok|error|stale|running

### SplitPanes（左右分栏，可拖动，小屏自动纵向）
```vue
<SplitPanes :initial="50" :min="25" :max="75">
  <template #left>...</template>
  <template #right>...</template>
</SplitPanes>
```

### FileDrop（文件拖入，G02）
```vue
<FileDrop :multiple="false" accept="image/*" :max-size="100*1024*1024" hint="..."
  @files="(fs) => ..." @reject="(reason) => toast.warning(reason)" />
```

### DkCollapse（说明卡片，放工具底部用法说明——可选）

> 2026-09-20 起改为**常显卡片**（不再折叠、不再有手风琴交互）：`title` 作为卡片标题，默认插槽内容始终可见。`defaultOpen` 保留仅为兼容旧调用点。
### DkModal（弹层，:open.sync + @close；danger 确认框）
### DkIcon（图标名见 DkIcon.vue 的 icons 表；常用：copy/download/play/refresh/eye/lock/shield/hash/clock 等）

## 常用 composables / utils（全部自动导入）

```ts
const toast = useToast(); toast.success('已复制') / toast.error(...) / toast.warning(...)
const { copy } = useClipboard(); await copy(text, '结果')   // 失败自动降级提示
const { prefs } = usePrefs()   // codeFontSize, editorWrap, defaultIndent

// app/utils/bytes.ts（自动导入）
byteLength(s) lineCount(s) charCount(s) formatBytes(n)
bytesToHex / hexToBytes(hex) -> {bytes, error?}
bytesToBase64 / base64ToBytes -> {bytes, error?}
textToBytes / bytesToText(bytes) -> {text, error?}   // 非 UTF-8 会报 error
looksLikeText(bytes)
downloadText(filename, text, mime?) / downloadBlob(filename, blob)
errMessage(e)   // app/composables/useToolRun.ts
```

## 可用依赖（已安装）

- `sm-crypto`：SM2/SM3/SM4（`import { sm2, sm3, sm4 } from 'sm-crypto'`）
- `js-yaml`：YAML（`import yaml from 'js-yaml'`）
- `diff`：文本差异（`import { diffLines, diffWords } from 'diff'`）
- `qrcode`：二维码生成（`import QRCode from 'qrcode'`）
- `jsqr`：二维码识别（`import jsQR from 'jsqr'`）
- `spark-md5`：MD5（`import SparkMD5 from 'spark-md5'`）
- WebCrypto（浏览器原生）：`crypto.subtle.digest('SHA-256', bytes)`、`crypto.subtle.encrypt({name:'AES-GCM',...})`、HMAC。只能在客户端事件回调中使用。

## 数据真实性红线

1. 所有输出由真实计算产生；示例数据要与输出一致（自算或使用公认测试向量）
2. 不得 trim/改换行/改编码除非用户可见地选择
3. 解码成功 ≠ 验签成功 ≠ 校验通过，文案必须区分
4. 失败保留输入，定位具体字段
5. 字符数/字节数/文件大小从实际数据推导（UTF-8 字节用 byteLength）

## 验证

dev server 运行在 http://localhost:3000（日志 /tmp/devkit-dev.log）。
默认监听所有网卡，局域网内可用 `http://<本机局域网IP>:3000` 访问；只想本机访问用 `npm run dev:local`
（或 DEVKIT_HOST=localhost）。端口/地址在 nuxt.config.ts 的 `devServer` 中，改动后需重启 `nuxt dev`
才会重新绑定（配置文件热更新只会软重启 Nuxt，不会换监听地址）。
写完后 `curl -s http://localhost:3000/tools/<slug> | grep 工具名` 确认 200 且无编译错误，
并 `tail -30 /tmp/devkit-dev.log` 查无 WARN/ERROR（Vue Router 警告除外）。
