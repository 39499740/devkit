import { isAnalyticsHostAllowed, normalizeHostEntry, parseAnalyticsHosts } from '../app/utils/analytics-host.ts'
import { check, eq } from './helpers.mjs'

const HOSTS = parseAnalyticsHosts('www.t502.fun,t502.fun')

export const cases = [
  eq('解析白名单：去空格、转小写', parseAnalyticsHosts(' WWW.T502.fun ; t502.fun '), ['www.t502.fun', 't502.fun']),
  eq('规范化：去协议 / 路径 / 端口 / 通配符', normalizeHostEntry('https://*.T502.fun:443/abc'), 't502.fun'),
  check('正式域名允许上报', () => isAnalyticsHostAllowed('www.t502.fun', HOSTS) === true),
  check('同站子域也允许', () => isAnalyticsHostAllowed('preview.www.t502.fun', HOSTS) === true),
  // 回归：2026-09-22 的事故——COS 默认域名渲染同一份 HTML，把源站地址计进了统计报表
  check('COS 源站域名被挡住', () => isAnalyticsHostAllowed('devkit-1252844153.cos.ap-beijing.myqcloud.com', HOSTS) === false),
  check('带端口的源站域名也被挡住', () => isAnalyticsHostAllowed('devkit-1252844153.cos.ap-beijing.myqcloud.com:8080', HOSTS) === false),
  check('相似域名不误放行', () => isAnalyticsHostAllowed('t502.fun.evil.com', HOSTS) === false),
  check('localhost 不在白名单内（开发环境另有 import.meta.dev 闸门）', () => isAnalyticsHostAllowed('localhost', HOSTS) === false),
  check('空 hostname 一律拒绝', () => isAnalyticsHostAllowed('', HOSTS) === false),
  check('白名单为空 = 不限制（临时预览域名场景）', () => isAnalyticsHostAllowed('anything.example.com', []) === true)
]
