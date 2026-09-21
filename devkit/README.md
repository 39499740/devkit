# DevKit · 开发者本地工具箱

面向 Java、Web、Vue 开发者的浏览器本地工具箱。输入、转换、摘要、加解密与文件处理全部在用户设备上执行；纯静态部署，无账号、无云端历史。

技术栈：**Nuxt 4**（内置 Vite + Vue 3.5）+ TypeScript，零后端。

## 快速开始

```bash
npm install
npm run dev        # 开发（默认 3000 端口）
npm run build      # SSR 构建
npm run generate   # 静态站点生成（可部署到任意静态托管）
npm run preview    # 预览构建产物
npm run typecheck  # 类型检查
npm test           # 引擎回归测试（Node，无额外依赖）
npm run test:dom   # DOM 用例（真实浏览器，需 ego-browser）
```

## 功能范围

- **45 个工具**（T01–T45）：数据格式（JSON/YAML/CSV/SQL 格式化/XML 工具箱与 XPath/JSONPath 与 JMESPath 查询/JSON Schema 生成与校验）、编码与文本（Base64/URL/Unicode/去重/命名/差异/正则）、摘要与加密（MD5/SHA/HMAC/AES/SM2/SM3/SM4 国密）、时间与标识（时间戳/UUID/Cron/日期差）、Java 开发（JSON 转 Java/转义/Properties/YAML/堆栈/Maven）、Web / Vue（TS 类型/SFC 模板/CSS 单位/颜色/SVG/格式化）、接口辅助（JWT/URL 参数/curl 转换/状态码）、文件与图片（摘要/图片压缩/二维码/编码转换/Base64）
- **系统页**：首页、分类列表、全局搜索（⌘K 命令面板）、收藏、最近使用、处理流程（`/workflows` 列表 + `/workflows/[id]` 三栏编排与逐步运行）、偏好设置、隐私说明、帮助、404、离线状态
- **共享交互**：结果待更新（stale）模式、文件处理反馈、剪贴板降级、跨工具内存传递（「发送到…」路由弹层，含加入处理流程）、PWA 安装引导与离线 / 新版本提示、明暗主题、响应式（桌面/移动）

## 设计原则

1. 所有结果由真实计算产生，不伪造、不展示未验证的成功状态
2. 输入内容不默认持久化；本地只保存偏好、收藏标识与工具访问时间
3. 修改输入后旧结果标记「待更新」，禁用复制下载
4. 解码成功 ≠ 验签成功 ≠ 校验通过，文案严格区分
5. 密钥不是口令，不做隐式密码派生
6. 复制内容不含行号、偏移或展示性换行

## 目录结构

```
app/
  components/        # 共享 UI 组件（Dk* 前缀）与 tools/ 工具页组件
  composables/       # 偏好/收藏/最近/Toast/剪贴板/待更新模式等
  utils/             # 字节转换、大整数安全 JSON、SQL / XML / JSONPath / JMESPath / JSON Schema / 流程引擎
  data/tools.ts      # 45 个工具注册表（路由/搜索/分类）
  pages/             # 系统页 + tools/[slug] 动态工具页 + workflows/ 处理流程页
docs/                # 设计任务书与设计审查文档（父目录）
```

工具组件开发规范见 [FOUNDATION.md](./FOUNDATION.md)。

## 设计稿

视觉基准来自 `../design.pen`（明暗双主题变量、8 个分类色、编辑器/状态栏/导航组件），代码中的 CSS 变量与 design.pen 中的设计变量一一对应。
