<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

interface Related {
  code: number
  diff: string
}
interface StatusItem {
  code: number
  name: string
  cn: string
  desc: string
  related?: Related[]
}

/** 本地知识索引（RFC 9110 及各扩展 RFC），语义以标准定义为准 */
const STATUSES: StatusItem[] = [
  /* ---------------- 1xx 信息响应 ---------------- */
  { code: 100, name: 'Continue', cn: '继续', desc: '客户端应继续发送请求体。常配合 Expect: 100-continue：客户端先探询服务器是否愿意接收大请求体，收到 100 后再发送。', related: [{ code: 101, diff: '101 是切换协议，100 只是让客户端继续发请求体' }] },
  { code: 101, name: 'Switching Protocols', cn: '协议切换', desc: '服务器同意升级协议，最典型的是 HTTP → WebSocket（Upgrade: websocket）。', related: [{ code: 426, diff: '426 是服务器要求客户端升级（拒绝在当前协议上继续）' }] },
  { code: 102, name: 'Processing', cn: '处理中', desc: 'WebDAV 扩展：服务器已收到请求但尚未完成，定期发送 102 防止客户端超时断开。' },
  { code: 103, name: 'Early Hints', cn: '早期提示', desc: '在最终响应前预先返回 Link 头（如预加载 CSS/JS），让浏览器提前建立连接与下载。' },

  /* ---------------- 2xx 成功 ---------------- */
  { code: 200, name: 'OK', cn: '成功', desc: '请求被正常处理并返回响应体。最常见的成功状态码。', related: [{ code: 204, diff: '204 同样成功但无响应体' }, { code: 201, diff: '201 明确表示创建了新资源' }] },
  { code: 201, name: 'Created', cn: '已创建', desc: '请求成功且创建了新资源（如 POST 建单），响应应带 Location 头指向新资源地址。', related: [{ code: 200, diff: '200 不承诺创建了资源' }] },
  { code: 202, name: 'Accepted', cn: '已接受', desc: '请求已受理但尚未处理完成，用于异步任务：客户端应稍后查询结果。', related: [{ code: 201, diff: '201 表示同步创建已完成' }] },
  { code: 203, name: 'Non-Authoritative Information', cn: '非权威信息', desc: '响应来自缓存或第三方转换后的副本，元信息不保证与源服务器一致。' },
  { code: 204, name: 'No Content', cn: '无内容', desc: '成功但响应体为空，典型如 DELETE 删除成功、PUT 更新成功。', related: [{ code: 205, diff: '205 还要求客户端重置视图/表单' }, { code: 200, diff: '200 通常带响应体' }] },
  { code: 205, name: 'Reset Content', cn: '重置内容', desc: '要求客户端重置发送该请求的表单（如清空输入），响应无体。' },
  { code: 206, name: 'Partial Content', cn: '部分内容', desc: 'Range 请求成功：返回请求的字节区间，响应含 Content-Range，用于断点续传与视频拖动。', related: [{ code: 416, diff: '416 表示请求的区间超出资源大小' }] },
  { code: 207, name: 'Multi-Status', cn: '多状态', desc: 'WebDAV 扩展：一个请求包含多个子操作时，响应体中逐项给出各自的状态。' },
  { code: 208, name: 'Already Reported', cn: '已报告', desc: 'WebDAV 绑定扩展：PROPFIND 枚举中同一资源已上报过，避免重复。' },
  { code: 226, name: 'IM Used', cn: '已使用实例操作', desc: '服务器对响应做了增量编码（Delta encoding，RFC 3229），只传输与上次响应的差异。' },

  /* ---------------- 3xx 重定向 ---------------- */
  { code: 300, name: 'Multiple Choices', cn: '多种选择', desc: '资源有多种表示（不同格式/语言），客户端需自行选择，响应体中列出可选项。' },
  { code: 301, name: 'Moved Permanently', cn: '永久重定向', desc: '资源永久迁移到新 URL。搜索引擎与书签应更新到新地址。', related: [{ code: 302, diff: '302 是临时重定向' }, { code: 308, diff: '308 同为永久但保证方法与请求体不变' }] },
  { code: 302, name: 'Found', cn: '临时重定向', desc: '资源临时位于其他 URL。历史原因浏览器多把 POST 改为 GET 重发，方法不保证保留。', related: [{ code: 307, diff: '307 保证重发时方法与请求体不变' }, { code: 301, diff: '301 是永久迁移' }] },
  { code: 303, name: 'See Other', cn: '以 GET 查看', desc: '响应内容在其他 URL，且必须用 GET 获取。常用于 POST 提交后跳转到结果页（PRG 模式）。', related: [{ code: 302, diff: '302 不强制改为 GET' }] },
  { code: 304, name: 'Not Modified', cn: '未修改', desc: '协商缓存命中：带 If-None-Match/If-Modified-Since 请求时资源未变，无响应体，浏览器用本地缓存。', related: [{ code: 200, diff: '资源有变化时返回 200 并携带完整 body' }] },
  { code: 305, name: 'Use Proxy', cn: '使用代理（已废弃）', desc: '已废弃的状态码：RFC 7231 起标记为 deprecated（因在响应中带内指定代理存在安全隐患），RFC 9110 沿用该结论，服务器不应再生成。', related: [{ code: 306, diff: '306 从未启用，仅保留编号' }] },
  { code: 306, name: '(Unused)', cn: '未使用（保留）', desc: '保留且从未启用的编号：早期草案中曾称 Switch Proxy，但未进入标准，RFC 9110 明确该状态码已不再使用，不应出现在响应中。', related: [{ code: 305, diff: '305 是已废弃的 Use Proxy；306 从未启用' }] },
  { code: 307, name: 'Temporary Redirect', cn: '临时重定向（方法不变）', desc: '资源临时位于其他 URL，且重发请求必须保持原方法与请求体。', related: [{ code: 302, diff: '302 不保证方法保留' }, { code: 308, diff: '308 是永久版本' }] },
  { code: 308, name: 'Permanent Redirect', cn: '永久重定向（方法不变）', desc: '资源永久迁移，且重发请求必须保持原方法与请求体。', related: [{ code: 301, diff: '301 不保证方法保留（POST 可能被改为 GET）' }] },

  /* ---------------- 4xx 客户端错误 ---------------- */
  { code: 400, name: 'Bad Request', cn: '请求错误', desc: '请求语法/结构错误：参数缺失、格式非法、JSON 解析失败等，服务器无法理解。', related: [{ code: 422, diff: '422 格式合法但语义校验失败' }, { code: 409, diff: '409 是与资源当前状态冲突' }] },
  { code: 401, name: 'Unauthorized', cn: '未认证', desc: '缺少或提供了无效的身份凭证。响应应带 WWW-Authenticate 头。名字虽叫 Unauthorized，语义实为 Unauthenticated。', related: [{ code: 403, diff: '403 是已认证但被禁止；401 是未认证' }] },
  { code: 402, name: 'Payment Required', cn: '要求付款', desc: '保留状态码，标准未定义具体语义，偶被用于付费墙。' },
  { code: 403, name: 'Forbidden', cn: '已认证但禁止', desc: '服务器理解请求但拒绝执行：权限不足、IP 被封等。与是否登录无关，身份已确认。', related: [{ code: 401, diff: '401 要求先提供凭证；403 提供了也没用' }, { code: 451, diff: '451 特指法律原因的拒绝' }] },
  { code: 404, name: 'Not Found', cn: '未找到', desc: '服务器找不到请求的资源。也可能资源存在但服务器不愿透露（安全考虑仍回 404）。', related: [{ code: 410, diff: '410 明确表示资源已永久消失' }, { code: 405, diff: '405 是资源存在但不支持该 HTTP 方法' }] },
  { code: 405, name: 'Method Not Allowed', cn: '方法不允许', desc: '资源存在但不支持该 HTTP 方法（如对只读资源 POST）。响应 Allow 头列出可用方法。', related: [{ code: 501, diff: '501 是服务器整体不支持该方法' }] },
  { code: 406, name: 'Not Acceptable', cn: '内容协商失败', desc: '服务器无法生成满足 Accept/Accept-Language 等请求头要求的表示（如客户端只要 XML 而服务器只有 JSON）。', related: [{ code: 415, diff: '415 是请求体的媒体类型服务器不收；406 是响应给不了客户端要的类型' }] },
  { code: 407, name: 'Proxy Authentication Required', cn: '需代理认证', desc: '请求需先通过代理服务器认证，响应带 Proxy-Authenticate 头。', related: [{ code: 401, diff: '401 针对源服务器认证' }] },
  { code: 408, name: 'Request Timeout', cn: '请求超时', desc: '客户端发送请求体过慢，服务器在等待期间超时并关闭连接。', related: [{ code: 504, diff: '504 是网关等上游响应超时' }] },
  { code: 409, name: 'Conflict', cn: '冲突', desc: '请求与资源当前状态冲突：并发覆盖（版本不对）、唯一约束冲突、非空目录删除等。', related: [{ code: 400, diff: '400 是语法层面错误，与状态无关' }, { code: 412, diff: '412 是显式前置条件（If-Match 等）不满足' }] },
  { code: 410, name: 'Gone', cn: '永久消失', desc: '资源已被永久删除且没有新地址，服务器不再期待该地址复活。用于让客户端/爬虫彻底放弃。', related: [{ code: 404, diff: '404 只是当前找不到，不承诺是否曾存在或会回来' }] },
  { code: 411, name: 'Length Required', cn: '需要长度', desc: '服务器要求请求带 Content-Length（不接受分块编码时）。' },
  { code: 412, name: 'Precondition Failed', cn: '前置条件失败', desc: '请求携带的 If-Match/If-Unmodified-Since 等前置条件不满足，常用于乐观并发控制（版本不一致）。', related: [{ code: 428, diff: '428 是服务器强制要求带前置条件' }] },
  { code: 413, name: 'Content Too Large', cn: '载荷过大', desc: '请求体超过服务器愿意处理的上限（原称 Payload Too Large），如上传文件超限。', related: [{ code: 431, diff: '431 是请求头过大而非请求体' }] },
  { code: 414, name: 'URI Too Long', cn: 'URI 过长', desc: '请求行 URI 超过服务器限制，常见于把大量数据拼接在 query string 上。' },
  { code: 415, name: 'Unsupported Media Type', cn: '媒体类型不支持', desc: '请求体的 Content-Type 服务器不支持（如接口只收 application/json 却收到 text/xml）。', related: [{ code: 406, diff: '406 是响应侧协商失败；415 是请求侧类型被拒' }] },
  { code: 416, name: 'Range Not Satisfiable', cn: '区间无法满足', desc: 'Range 请求的字节区间超出资源实际大小，响应带 Content-Range 标明总长。', related: [{ code: 206, diff: '206 表示区间请求成功' }] },
  { code: 417, name: 'Expectation Failed', cn: '期望失败', desc: '请求头 Expect 中的期望无法满足（如服务器不支持 100-continue 流程）。' },
  { code: 418, name: "I'm a teapot", cn: '我是茶壶', desc: '愚人节彩蛋（HTCPCP，超文本咖啡壶控制协议）：茶壶不能煮咖啡。部分项目用作彩蛋接口。' },
  { code: 421, name: 'Misdirected Request', cn: '请求被误发', desc: 'HTTP/2 多路复用下，该连接无法服务于请求的 Host/SNI 组合，客户端应换连接重试。' },
  { code: 422, name: 'Unprocessable Content', cn: '语义验证失败', desc: '请求格式合法（能解析）但语义校验失败：字段取值非法、业务规则不通过（原称 Unprocessable Entity，WebDAV 起源）。', related: [{ code: 400, diff: '400 是语法/结构错误根本解析不了；422 解析得了但内容不合法' }] },
  { code: 423, name: 'Locked', cn: '已锁定', desc: 'WebDAV 扩展：目标资源被锁定，请求无法执行。' },
  { code: 424, name: 'Failed Dependency', cn: '依赖失败', desc: 'WebDAV 扩展（RFC 4918）：当前操作依赖的前一个操作失败，本次请求因此也无法完成。典型场景是 PROPPATCH 中某个属性修改失败时，其余属性修改一并返回 424。', related: [{ code: 423, diff: '423 是资源被锁定；424 是前置操作失败导致的连带失败' }, { code: 507, diff: '507 是服务器存储空间不足' }] },
  { code: 425, name: 'Too Early', cn: '过早', desc: '服务器不愿处理可能被重放的请求（RFC 8470 重放保护），用于早期数据场景。' },
  { code: 426, name: 'Upgrade Required', cn: '需要升级协议', desc: '服务器要求客户端切换到指定协议（如 TLS），响应带 Upgrade 头。', related: [{ code: 101, diff: '101 是服务器同意升级' }] },
  { code: 428, name: 'Precondition Required', cn: '要求前置条件', desc: '服务器要求请求带 If-Match 等前置条件以防丢失更新（先读后写覆盖他人修改）。', related: [{ code: 412, diff: '412 是带了前置条件但不满足' }] },
  { code: 429, name: 'Too Many Requests', cn: '限流（请求过多）', desc: '单位时间请求过多被限流，响应应带 Retry-After 头告知重试等待秒数。', related: [{ code: 503, diff: '503 是服务整体不可用（过载/维护）；429 通常针对单个客户端限流' }] },
  { code: 431, name: 'Request Header Fields Too Large', cn: '请求头过大', desc: '请求头（常是超大 Cookie/JWT）超过服务器限制，可清理 Cookie 或改用其他凭证传递方式。', related: [{ code: 413, diff: '413 是请求体过大' }] },
  { code: 451, name: 'Unavailable For Legal Reasons', cn: '法律原因不可用', desc: '因法律要求（法院命令、审查制度）拒绝提供资源，响应常带 Link 指向说明页面。', related: [{ code: 403, diff: '403 拒绝但不说明原因；451 明确是法律原因' }] },

  /* ---------------- 5xx 服务器错误 ---------------- */
  { code: 500, name: 'Internal Server Error', cn: '服务器内部错误', desc: '服务器端发生未预期的错误（未捕获异常、配置错误）。客户端无从修复，只能重试或反馈。', related: [{ code: 503, diff: '503 是有意的不可用（过载/维护）' }] },
  { code: 501, name: 'Not Implemented', cn: '未实现', desc: '服务器不支持完成请求所需的功能（如不支持的 HTTP 方法或扩展）。', related: [{ code: 405, diff: '405 是该资源不允许此方法，服务器本身支持' }] },
  { code: 502, name: 'Bad Gateway', cn: '上游无效响应', desc: '作为网关/代理时，上游服务器返回了无效响应（连接被重置、响应格式错误）。', related: [{ code: 504, diff: '504 是等上游响应超时；502 是上游有响应但内容无效' }, { code: 503, diff: '503 不涉及上游，是本服务自身不可用' }] },
  { code: 503, name: 'Service Unavailable', cn: '服务不可用', desc: '服务器暂时无法处理请求（过载或停机维护），响应应带 Retry-After。', related: [{ code: 429, diff: '429 是对单客户端限流；503 是服务整体不可用' }] },
  { code: 504, name: 'Gateway Timeout', cn: '上游超时', desc: '作为网关/代理时，等待上游服务器响应超时。', related: [{ code: 502, diff: '502 是上游有回包但无效；504 是根本没等到回包' }] },
  { code: 505, name: 'HTTP Version Not Supported', cn: 'HTTP 版本不支持', desc: '服务器不支持请求行中的 HTTP 版本（如只支持 HTTP/1.1 却收到 HTTP/2 明文语义）。' },
  { code: 506, name: 'Variant Also Negotiates', cn: '变体协商配置错误', desc: '透明内容协商配置错误：选中的变体自身又被配置为参与协商，形成死循环。' },
  { code: 507, name: 'Insufficient Storage', cn: '存储不足', desc: 'WebDAV 扩展：服务器无法存储完成请求所需的资源（磁盘满）。' },
  { code: 508, name: 'Loop Detected', cn: '检测到循环', desc: 'WebDAV 扩展：处理请求时检测到无限循环（如绑定环）。' },
  { code: 510, name: 'Not Extended', cn: '未扩展', desc: '服务器要求请求带指定的扩展声明但请求未包含。' },
  { code: 511, name: 'Network Authentication Required', cn: '需网络认证', desc: '需要先登录所在网络才能访问（公共 Wi-Fi 的强制门户/Captive Portal 页面）。', related: [{ code: 401, diff: '401 是目标服务的认证；511 是接入网络层的认证' }] }
]

/** 详情字段：RFC 出处与常见原因（出处逐条核对 RFC 原文） */
interface StatusDetail {
  rfc: string[]
  causes: string[]
}

const DETAIL: Record<number, StatusDetail> = {
  100: { rfc: ['RFC 9110 §15.2.1'], causes: ['客户端携带 Expect: 100-continue，先探询服务器是否愿意接收请求体', '这是发送大请求体前的正常中间响应，不是错误'] },
  101: { rfc: ['RFC 9110 §15.2.2'], causes: ['客户端发送 Upgrade: websocket 等升级请求，服务器同意切换', 'WebSocket / h2c 协议升级握手成功'] },
  102: { rfc: ['RFC 4918 §11.1'], causes: ['WebDAV 长事务仍在处理，服务器周期性发送 102 保活', '请求涉及多步操作，需要较长时间才能给出最终状态'] },
  103: { rfc: ['RFC 8297 §2'], causes: ['服务器在最终响应前用 Link 头预加载关键资源', '页面内容尚未生成完毕，先回早期提示减少等待'] },

  200: { rfc: ['RFC 9110 §15.3.1'], causes: ['请求正常完成，服务器返回完整响应体', '读取类请求（GET / HEAD）命中并返回资源'] },
  201: { rfc: ['RFC 9110 §15.3.2'], causes: ['POST 创建资源成功，通常带 Location 头指向新资源', 'PUT 新建资源成功'] },
  202: { rfc: ['RFC 9110 §15.3.3'], causes: ['请求已进入异步队列，尚未处理完成', '批量或耗时任务已受理，需轮询或回调获取结果'] },
  203: { rfc: ['RFC 9110 §15.3.4'], causes: ['响应经过转换代理，元数据不是源服务器原样内容', '缓存或中间层对响应做了改写后返回'] },
  204: { rfc: ['RFC 9110 §15.3.5'], causes: ['DELETE / PUT 成功但无需返回内容', '表单提交成功且前端不需要展示响应体'] },
  205: { rfc: ['RFC 9110 §15.3.6'], causes: ['要求重置发送请求的表单或视图状态', '提交完成后需要清空表单再继续操作'] },
  206: { rfc: ['RFC 9110 §15.3.7'], causes: ['客户端发送 Range 头做断点续传或视频拖动', '大文件分片请求，只取指定字节区间'] },
  207: { rfc: ['RFC 4918 §11.1'], causes: ['WebDAV PROPFIND / PROPPATCH 等批量操作需逐项返回状态', '一次请求涉及多个子资源，需要分别报告结果'] },
  208: { rfc: ['RFC 5842 §7.1'], causes: ['WebDAV PROPFIND 中同一资源被多处绑定引用，避免重复列出', 'BIND 操作导致资源在多个路径同时出现'] },
  226: { rfc: ['RFC 3229 §10.4.1'], causes: ['服务器使用 Delta 编码，只回与上次响应的差异', '客户端持有旧版本实例，服务器发送增量更新'] },

  300: { rfc: ['RFC 9110 §15.4.1'], causes: ['同一资源有多种表示（语言 / 格式），需要客户端选择', '服务器未做内容协商，直接列出候选表示'] },
  301: { rfc: ['RFC 9110 §15.4.2'], causes: ['站点换域名或路由永久调整，旧地址跳转到新地址', 'HTTP 强制跳转 HTTPS，或补齐结尾斜杠'] },
  302: { rfc: ['RFC 9110 §15.4.3'], causes: ['登录后临时跳转、灰度或维护页面跳转', '活动页面临时指向其他地址'] },
  303: { rfc: ['RFC 9110 §15.4.4'], causes: ['POST 提交后跳转到结果页（PRG 模式），改用 GET 获取', '避免用户刷新导致重复提交'] },
  304: { rfc: ['RFC 9110 §15.4.5'], causes: ['请求带 If-None-Match / If-Modified-Since，资源未发生变化', '协商缓存命中，浏览器直接使用本地副本'] },
  305: { rfc: ['RFC 9110 §15.4.6（已废弃）'], causes: ['已废弃：历史上要求经指定代理访问资源', '现代实现不应再生成该状态码'] },
  306: { rfc: ['RFC 9110 §15.4.7（保留未用）'], causes: ['保留且从未启用的编号', '不应在任何响应中出现'] },
  307: { rfc: ['RFC 9110 §15.4.8'], causes: ['临时跳转且要求保持原方法与请求体', 'POST 重定向到临时地址时避免方法被改成 GET'] },
  308: { rfc: ['RFC 9110 §15.4.9'], causes: ['永久跳转且要求保持原方法与请求体', '站点永久迁移，同时需要保住 POST 等方法的语义'] },

  400: { rfc: ['RFC 9110 §15.5.1'], causes: ['请求语法错误：JSON 解析失败、参数格式非法', '缺失必填参数或字段类型不符', '请求体被截断，或长度与 Content-Length 不一致'] },
  401: { rfc: ['RFC 9110 §15.5.2'], causes: ['未携带认证凭证，或 Token 过期 / 无效', '凭证格式错误，服务器无法识别', '需要先登录再访问受保护资源'] },
  402: { rfc: ['RFC 9110 §15.5.3（保留）'], causes: ['保留状态码，标准未定义具体语义', '偶被站点用于付费墙或欠费提示'] },
  403: { rfc: ['RFC 9110 §15.5.4'], causes: ['已登录但权限不足，或资源被策略禁止访问', 'IP / User-Agent 被拦截，目录禁止列出', 'CSRF 或 CORS 校验失败'] },
  404: { rfc: ['RFC 9110 §15.5.5'], causes: ['请求路径拼写错误，或结尾斜杠、大小写不一致', '资源已被删除、改名或迁移，引用方仍请求旧地址', '网关、CDN 或反向代理的路由规则未覆盖该路径', '静态资源未随本次发布同步，指纹文件名已变化'] },
  405: { rfc: ['RFC 9110 §15.5.6'], causes: ['对只读资源使用了 POST / PUT / DELETE', '接口只开放 GET，但客户端用错了方法', '反向代理改写了请求方法'] },
  406: { rfc: ['RFC 9110 §15.5.7'], causes: ['客户端 Accept 要求服务器无法生成的媒体类型', 'Accept-Language 只接受未提供的语言', '内容协商配置缺失或过严'] },
  407: { rfc: ['RFC 9110 §15.5.8'], causes: ['请求经过需要认证的代理，但未提供 Proxy-Authorization', '企业代理要求先完成代理登录'] },
  408: { rfc: ['RFC 9110 §15.5.9'], causes: ['客户端发送请求体过慢，服务器等待期间超时', '网络拥塞导致请求迟迟发不完'] },
  409: { rfc: ['RFC 9110 §15.5.10'], causes: ['并发更新覆盖：版本号或 ETag 不匹配', '唯一约束冲突（如用户名已存在）', '删除非空目录等资源状态冲突'] },
  410: { rfc: ['RFC 9110 §15.5.11'], causes: ['资源已被永久删除且没有新地址', '内容下架且不希望再被搜索引擎索引', 'API 旧版本长期下线'] },
  411: { rfc: ['RFC 9110 §15.5.12'], causes: ['服务器要求 Content-Length，但请求未提供', '使用了分块传输而服务器不接受'] },
  412: { rfc: ['RFC 9110 §15.5.13'], causes: ['If-Match / If-Unmodified-Since 等前置条件不满足', '并发修改导致乐观锁校验失败'] },
  413: { rfc: ['RFC 9110 §15.5.14'], causes: ['上传文件或请求体超过服务器上限', '表单携带的数据量超过限制'] },
  414: { rfc: ['RFC 9110 §15.5.15'], causes: ['URL 拼接了过多查询参数或过长路径', '用 GET 传递大量数据，应改用 POST'] },
  415: { rfc: ['RFC 9110 §15.5.16'], causes: ['请求体 Content-Type 不在服务器支持范围内', '接口只收 application/json 却收到表单或 XML', '缺少 Content-Type 头'] },
  416: { rfc: ['RFC 9110 §15.5.17'], causes: ['Range 区间超出资源实际长度', '断点续传时使用了错误的偏移量', '资源在下载过程中被替换为更短的版本'] },
  417: { rfc: ['RFC 9110 §15.5.18'], causes: ['Expect 头中的期望服务器无法满足', '代理不支持 100-continue 流程'] },
  418: { rfc: ['RFC 9110 §15.5.19（保留未用）', 'RFC 2324 §2.3.2（彩蛋出处）'], causes: ['出自愚人节 RFC 2324 的茶壶彩蛋', 'RFC 9110 已将其列为保留、不再分配给其他用途的编号', '部分项目用作彩蛋接口，不应作为正式协议语义'] },
  421: { rfc: ['RFC 9110 §15.5.20'], causes: ['HTTP/2 连接复用了不匹配的 Host / SNI 组合', '同一连接上发往不同域名的请求被误路由', '服务器证书与请求域名不符'] },
  422: { rfc: ['RFC 9110 §15.5.21', '源自 RFC 4918 §11.2'], causes: ['请求体语法正确但语义校验失败', '字段取值非法或业务规则不通过', 'WebDAV 中 XML 指令语义错误'] },
  423: { rfc: ['RFC 4918 §11.3'], causes: ['WebDAV 目标资源被锁定，无法修改', '其他客户端持有写锁且尚未释放'] },
  424: { rfc: ['RFC 4918 §11.4'], causes: ['WebDAV 中前置操作失败，依赖它的操作随之无法完成', 'PROPPATCH 中某个属性修改失败，其余属性一并返回 424'] },
  425: { rfc: ['RFC 8470 §5.2'], causes: ['服务器拒绝处理可能被重放的早期数据（0-RTT）', 'TLS 1.3 早期数据缺少重放保护'] },
  426: { rfc: ['RFC 9110 §15.5.22'], causes: ['服务器要求升级到 TLS 等新协议', '旧协议版本被安全策略禁止'] },
  428: { rfc: ['RFC 6585 §3'], causes: ['服务器要求带 If-Match 等前置条件以防并发覆盖', '请求缺少强制要求的前置条件头'] },
  429: { rfc: ['RFC 6585 §4'], causes: ['单位时间请求过于频繁，触发限流', '爬虫或脚本未遵守速率限制', '共享出口 IP 的其他客户端耗尽配额'] },
  431: { rfc: ['RFC 6585 §5'], causes: ['Cookie 或 JWT 等请求头体积过大', '请求头数量或单个头部超过服务器限制'] },
  451: { rfc: ['RFC 7725 §3'], causes: ['应法律或监管要求拒绝提供资源', '收到法院命令或版权下架通知', '地区性内容合规限制'] },

  500: { rfc: ['RFC 9110 §15.6.1'], causes: ['服务器端未捕获异常或存在代码缺陷', '配置错误（数据库连接、环境变量缺失）', '依赖服务异常导致请求处理中断'] },
  501: { rfc: ['RFC 9110 §15.6.2'], causes: ['服务器尚未实现该请求方法或功能', '代理或网关转发了不被支持的方法', '功能开关关闭或版本过旧'] },
  502: { rfc: ['RFC 9110 §15.6.3'], causes: ['上游服务器返回了无法解析的响应', '上游进程崩溃或连接被重置', '代理配置指向了错误的后端地址'] },
  503: { rfc: ['RFC 9110 §15.6.4'], causes: ['服务器过载或停机维护', '实例正在发布或重启', '连接池、线程池等资源耗尽'] },
  504: { rfc: ['RFC 9110 §15.6.5'], causes: ['网关等待上游响应超时', '后端处理过慢或卡死', '网络链路延迟或丢包'] },
  505: { rfc: ['RFC 9110 §15.6.6'], causes: ['请求使用的 HTTP 版本服务器不支持', '客户端与服务器版本协商失败'] },
  506: { rfc: ['RFC 2295 §8.1'], causes: ['透明内容协商配置错误：选中的变体自身又参与协商', '服务器的协商配置形成循环'] },
  507: { rfc: ['RFC 4918 §11.5'], causes: ['WebDAV 服务器存储空间不足', '配额已满或磁盘写满'] },
  508: { rfc: ['RFC 5842 §7.2'], causes: ['WebDAV 处理请求时检测到绑定环等无限循环', '资源绑定关系形成环路'] },
  510: { rfc: ['RFC 2774 §7'], causes: ['请求缺少服务器要求的扩展声明', '扩展策略未满足（该扩展已废弃，现代实现很少使用）'] },
  511: { rfc: ['RFC 6585 §6'], causes: ['公共 Wi-Fi 强制门户要求先完成网络认证', '接入网络前需要登录或接受使用条款'] }
}

/** 幂等性属于请求方法（RFC 9110 §9.2.2），不是状态码本身的属性，因此统一如实说明 */
const IDEMPOTENT_NOTE = '取决于请求方法：GET / HEAD / PUT / DELETE / OPTIONS / TRACE 幂等；POST / PATCH 不幂等'

/** RFC 9110 §15.1 明列为「启发式可缓存」的状态码 */
const HEURISTIC_CACHEABLE = new Set([200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501])

function detailOf(code: number): StatusDetail {
  return DETAIL[code] ?? { rfc: [], causes: [] }
}

function classLabel(code: number): string {
  return CATS.find((c) => c.value === String(code)[0])?.label ?? `${String(code)[0]}xx`
}

function directionOf(code: number): string {
  const c = String(code)[0]
  if (c === '4') return '客户端 → 服务器（请求侧问题）'
  if (c === '5') return '服务器 → 客户端（服务端问题）'
  if (c === '1') return '服务器 → 客户端（临时响应）'
  if (c === '2') return '服务器 → 客户端（成功响应）'
  return '服务器 → 客户端（重定向指令）'
}

function cacheOf(code: number): string {
  if (code === 304) return '不单独缓存（用于校验并更新已有缓存，RFC 9110 §15.4.5）'
  if (code === 206) return '可（按 Range 区间缓存，需 Content-Range；RFC 9110 §15.1）'
  if (HEURISTIC_CACHEABLE.has(code)) return '可（启发式缓存，RFC 9110 §15.1）'
  return '默认不缓存（需显式 Cache-Control / Expires 等，RFC 9111 §3）'
}

const CATS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部' },
  { value: '1', label: '1xx 信息' },
  { value: '2', label: '2xx 成功' },
  { value: '3', label: '3xx 重定向' },
  { value: '4', label: '4xx 客户端错误' },
  { value: '5', label: '5xx 服务器错误' }
]

const COMMON_CODES = [200, 301, 400, 401, 403, 404, 409, 429, 500]

const query = ref('')
const cat = ref('all')
const selected = ref<number | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return STATUSES.filter((s) => {
    if (cat.value !== 'all' && String(s.code)[0] !== cat.value) return false
    if (!q) return true
    return String(s.code).includes(q) || s.name.toLowerCase().includes(q) || s.cn.includes(q) || s.desc.toLowerCase().includes(q)
  })
})

const selectedItem = computed(() => STATUSES.find((s) => s.code === selected.value) ?? null)

function classOf(code: number): string {
  return `${String(code)[0]}xx`
}

function pickCommon(code: number) {
  query.value = ''
  cat.value = 'all'
  selected.value = selected.value === code ? null : code
}

function clearAll() {
  query.value = ''
  cat.value = 'all'
  selected.value = null
}
</script>

<template>
  <div class="t36">
    <div class="t36__toolbar">
      <div class="t36__search">
        <DkIcon class="t36__search-icon" name="search" :size="14" />
        <DkInput v-model="query" mono placeholder="搜索：数字（404 / 42）、中文名（未认证）、英文名（Gateway）或描述关键词" />
      </div>
      <span class="tertiary t36__count">命中 {{ filtered.length }} / {{ STATUSES.length }}</span>
      <DkButton size="sm" variant="ghost" :disabled="!query && cat === 'all' && selected === null" @click="clearAll">清空条件</DkButton>
    </div>

    <div class="t36__chips">
      <span class="t36__chips-label">分类</span>
      <button
        v-for="c in CATS"
        :key="c.value"
        class="t36__chip"
        :class="{ 't36__chip--active': cat === c.value }"
        @click="cat = c.value"
      >
        {{ c.label }}
      </button>
      <span class="t36__chips-sep"></span>
      <span class="t36__chips-label">常用</span>
      <button
        v-for="c in COMMON_CODES"
        :key="c"
        class="t36__chip t36__chip--code mono"
        :class="[`t36__chip--c${String(c)[0]}`, { 't36__chip--active': selected === c }]"
        @click="pickCommon(c)"
      >
        {{ c }}
      </button>
    </div>

    <div class="t36__list" role="list">
      <div v-for="s in filtered" :key="s.code" class="t36__item" :class="{ 't36__item--open': selected === s.code }">
        <button class="t36__row" role="listitem" @click="selected = selected === s.code ? null : s.code">
          <span class="t36__code mono" :class="`t36__code--c${String(s.code)[0]}`">{{ s.code }}</span>
          <span class="t36__name">{{ s.name }}</span>
          <span class="t36__cn">{{ s.cn }}</span>
          <span class="t36__desc-one">{{ s.desc.split('。')[0] }}{{ s.desc.includes('。') ? '。' : '' }}</span>
          <DkIcon class="t36__chev" name="chevron-down" :size="14" />
        </button>
        <div v-if="selected === s.code" class="t36__detail">
          <div class="t36__facts">
            <div class="t36__fact">
              <span class="t36__fact-k">分类</span>
              <span class="t36__fact-v">{{ classLabel(s.code) }}</span>
            </div>
            <div class="t36__fact">
              <span class="t36__fact-k">方向</span>
              <span class="t36__fact-v">{{ directionOf(s.code) }}</span>
            </div>
            <div class="t36__fact">
              <span class="t36__fact-k">是否可缓存</span>
              <span class="t36__fact-v">{{ cacheOf(s.code) }}</span>
            </div>
            <div class="t36__fact">
              <span class="t36__fact-k">是否幂等</span>
              <span class="t36__fact-v">{{ IDEMPOTENT_NOTE }}</span>
            </div>
            <div class="t36__fact t36__fact--wide">
              <span class="t36__fact-k">RFC 参考</span>
              <span class="t36__fact-v">{{ detailOf(s.code).rfc.join('；') }}</span>
            </div>
          </div>
          <div class="t36__detail-row">
            <span class="t36__detail-k">含义</span>
            <span class="t36__detail-v">{{ s.desc }}</span>
          </div>
          <div v-if="detailOf(s.code).causes.length" class="t36__detail-row">
            <span class="t36__detail-k">常见原因</span>
            <ul class="t36__causes">
              <li v-for="(cause, i) in detailOf(s.code).causes" :key="i">{{ i + 1 }}. {{ cause }}</li>
            </ul>
          </div>
          <div v-if="s.related && s.related.length" class="t36__detail-row">
            <span class="t36__detail-k">相近状态区别</span>
            <ul class="t36__rel">
              <li v-for="r in s.related" :key="r.code">
                <button class="t36__rel-link mono" :class="`t36__code--c${String(r.code)[0]}`" title="查看该状态码" @click="selected = r.code; query = ''; cat = 'all'">{{ r.code }}</button>
                <span>{{ r.diff }}</span>
              </li>
            </ul>
          </div>
          <p class="t36__disclaimer">「方向」表示该状态码的语义归属：4xx 归因于请求侧，5xx 归因于服务端；状态码本身都随响应返回。幂等性属于请求方法而非状态码，同一个状态码也可能出现在非幂等请求上。</p>
        </div>
      </div>
      <div v-if="!filtered.length" class="t36__empty">
        <DkIcon name="search" :size="18" />
        <p>没有匹配「{{ query || '当前筛选' }}」的状态码。可尝试换关键词（如 404、未认证、Gateway），或点击「清空条件」查看全部 {{ STATUSES.length }} 条。</p>
        <DkButton size="sm" variant="secondary" @click="clearAll">清空条件</DkButton>
      </div>
    </div>

    <div v-if="selectedItem" class="t36__pinned">
      <span class="t36__code mono" :class="`t36__code--c${String(selectedItem.code)[0]}`">{{ selectedItem.code }}</span>
      <span class="t36__pinned-name">{{ selectedItem.name }} · {{ selectedItem.cn }}</span>
      <span class="grow"></span>
      <span class="tertiary">{{ classOf(selectedItem.code) }}</span>
      <DkIconButton title="收起详情" @click="selected = null">
        <DkIcon name="x" :size="14" />
      </DkIconButton>
    </div>

    <p class="t36__note tertiary">
      <DkIcon name="info" :size="13" />
      本页是本地知识索引，不反映任何线上接口状态；点击列表行展开分类、方向、缓存与幂等属性、RFC 参考、常见原因及相近状态码区别。
    </p>
  </div>
</template>

<style scoped>
.t36 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t36__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t36__search {
  flex: 1;
  min-width: 240px;
  position: relative;
  display: flex;
  align-items: center;
}
.t36__search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-tertiary);
  pointer-events: none;
}
.t36__search :deep(.dk-input) {
  padding-left: 30px;
}
.t36__count {
  font-size: 12px;
  white-space: nowrap;
}
.t36__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.t36__chips-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-right: 2px;
}
.t36__chips-sep {
  width: 1px;
  height: 16px;
  background: var(--border-strong);
  margin: 0 6px;
}
.t36__chip {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
}
.t36__chip:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
.t36__chip--active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.t36__chip--code {
  font-size: 12px;
}
.t36__list {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t36__item + .t36__item {
  border-top: 1px solid var(--border);
}
.t36__item--open {
  background: var(--surface-subtle);
}
.t36__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 9px 14px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.t36__row:hover {
  background: var(--surface-hover);
}
.t36__code {
  flex-shrink: 0;
  width: 40px;
  font-weight: 600;
  font-size: 13px;
}
.t36__code--c1 {
  color: var(--text-secondary);
}
.t36__code--c2 {
  color: var(--ok);
}
.t36__code--c3 {
  color: var(--accent);
}
.t36__code--c4 {
  color: var(--warn);
}
.t36__code--c5 {
  color: var(--error);
}
.t36__name {
  flex-shrink: 0;
  color: var(--text-primary);
  font-weight: 500;
  min-width: 150px;
}
.t36__cn {
  flex-shrink: 0;
  color: var(--text-secondary);
  width: 130px;
}
.t36__desc-one {
  flex: 1;
  min-width: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t36__chev {
  flex-shrink: 0;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.t36__item--open .t36__chev {
  transform: rotate(180deg);
}
.t36__detail {
  padding: 2px 14px 12px 66px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t36__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 4px 18px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}
.t36__fact {
  display: flex;
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}
.t36__fact--wide {
  grid-column: 1 / -1;
}
.t36__fact-k {
  flex-shrink: 0;
  width: 72px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.t36__fact-v {
  color: var(--text-primary);
  font-size: 12.5px;
  line-height: 1.6;
  min-width: 0;
}
.t36__causes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.t36__causes li {
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}
.t36__disclaimer {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.t36__detail-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
}
.t36__detail-k {
  flex-shrink: 0;
  width: 84px;
  font-size: 12px;
  color: var(--text-tertiary);
  padding-top: 1px;
}
.t36__detail-v {
  color: var(--text-secondary);
  line-height: 1.65;
  min-width: 0;
}
.t36__rel {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.t36__rel li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
}
.t36__rel-link {
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 0 6px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.t36__rel-link:hover {
  border-color: var(--accent);
}
.t36__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
  text-align: center;
}
.t36__empty p {
  max-width: 420px;
  line-height: 1.7;
  margin: 0;
}
.t36__pinned {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  font-size: 13px;
}
.t36__pinned-name {
  color: var(--text-primary);
  font-weight: 500;
}
.t36__note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}
</style>
