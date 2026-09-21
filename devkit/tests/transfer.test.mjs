import { dropPayload, stashPayload, takePayload, TRANSFER_TTL_MS, hasPendingPayload, pendingTargetKey } from '../app/utils/transfer.ts'
import { check, eq } from './helpers.mjs'

export const cases = [
  check('取一次即消费（回归：带 intent 的载荷不会重复生效）', () => {
    dropPayload()
    stashPayload('{"a":1}', 'json-format', 'json', { intent: { workflowId: 'wf-1', stepType: 'json-format' }, target: 'wf-1' })
    const first = takePayload('wf-1')
    const second = takePayload('wf-1')
    return first !== null && first.intent?.workflowId === 'wf-1' && second === null && !hasPendingPayload()
  }),
  check('目标不符时不消费，留给真正的目标', () => {
    dropPayload()
    stashPayload('x', 'base64', 'text', { target: 'jsonpath-query' })
    const wrong = takePayload('json-schema')
    const right = takePayload('jsonpath-query')
    return wrong === null && right !== null && right.text === 'x'
  }),
  check('无目标时任意消费者可一次取走', () => {
    dropPayload()
    stashPayload('t', 'json-format', 'text')
    const a = takePayload()
    const b = takePayload()
    return a !== null && b === null
  }),
  check('过期载荷自动失效', () => {
    dropPayload()
    stashPayload('old', 'json-format', 'json')
    const realNow = Date.now
    Date.now = () => realNow() + TRANSFER_TTL_MS + 1
    try {
      const got = takePayload()
      return got === null && !hasPendingPayload()
    } finally {
      Date.now = realNow
    }
  }),
  check('dropPayload 清空载荷与目标', () => {
    stashPayload('x', 'a', 'text', { target: 'b' })
    dropPayload()
    return takePayload('b') === null && pendingTargetKey() === null
  }),
  eq('载荷保留来源与类型', (() => {
    dropPayload()
    stashPayload('{"k":1}', 'json-format', 'json')
    const p = takePayload()
    return p ? [p.from, p.kind] : null
  })(), ['json-format', 'json'])
]
void check
