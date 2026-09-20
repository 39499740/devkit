# DevKit · 开发者本地工具箱

面向 Java / Web / Vue 开发者的**纯浏览器本地**工具箱：输入、转换、摘要、加解密与文件处理全部在用户设备上执行——无账号、无云端历史、无后端。

技术栈：**Nuxt 4**（内置 Vite + Vue 3.5）+ TypeScript，可静态部署到任意托管。

## 功能

**41 个工具，8 个分类：**

| 分类 | 内容 |
| --- | --- |
| 数据格式 | JSON、YAML、CSV 等结构化数据的格式化、校验与转换 |
| 编码与文本 | Base64、URL、Unicode 等编码转换与文本批量处理 |
| 摘要与加密 | MD5、SHA、HMAC、AES 与国密 SM2 / SM3 / SM4，全部本地计算 |
| 时间与标识 | 时间戳、UUID、Cron 与日期时间差计算 |
| Java 开发 | JSON 转 Java、转义、配置转换、堆栈整理与依赖声明转换 |
| Web / Vue | TypeScript 类型、Vue 组件模板、CSS 单位、颜色与前端格式化 |
| 接口辅助 | JWT、URL 参数、请求代码转换与 HTTP 状态码速查 |
| 文件与图片 | 文件摘要、图片压缩、二维码与文件编码转换 |

**系统页**：首页、分类列表、全局搜索（⌘K 命令面板）、收藏、最近使用、偏好设置、隐私说明、帮助、404、离线状态。

**共享交互**：结果待更新（stale）模式、文件处理反馈、剪贴板降级、跨工具内存传递、明暗主题、响应式（桌面 / 移动）。

## 快速开始

```bash
cd devkit
npm install
npm run dev        # 开发，默认 http://localhost:3000
npm run build      # SSR 构建
npm run generate   # 静态站点生成
npm run typecheck  # 类型检查
```

## 目录结构

```
devkit/
  app/
    components/     # 共享 UI 组件（Dk* 前缀）与 tools/ 下 41 个工具页组件
    composables/    # 偏好 / 收藏 / 最近 / Toast / 剪贴板 / 待更新模式
    utils/          # 字节转换、大整数安全 JSON
    data/tools.ts   # 41 个工具注册表（路由 / 搜索 / 分类）
    pages/          # 系统页 + tools/[slug] 动态工具页
  public/           # PWA 图标与离线兜底页
docs/               # 设计任务书、设计审查报告与设计校验材料
audit/              # 设计 / 实现审查记录（各轮 FIXES、审计报告、爬取日志与截图证据）
.spec-workflow/     # 规格工作流模板
```

工具组件开发规范见 [`devkit/FOUNDATION.md`](devkit/FOUNDATION.md)，应用说明见 [`devkit/README.md`](devkit/README.md)。

## 设计原则

1. 所有结果由真实计算产生，不伪造、不展示未验证的成功状态
2. 输入内容不默认持久化；本地只保存偏好、收藏标识与工具访问时间
3. 修改输入后旧结果标记「待更新」，禁用复制与下载
4. 解码成功 ≠ 验签成功 ≠ 校验通过，文案严格区分
5. 密钥不是口令，不做隐式密码派生
6. 复制内容不含行号、偏移或展示性换行

## 设计稿

视觉基准为 pen.dev 设计文件 `design.pen`（明暗双主题变量、8 个分类色、编辑器 / 状态栏 / 导航组件），代码中的 CSS 变量与设计变量一一对应。该文件约 23MB 且为二进制格式，**不纳入版本控制**，仅本地保留；仓库内以 `docs/` 下的设计任务书与审查报告作为设计依据。

## 许可

[MIT](LICENSE)
