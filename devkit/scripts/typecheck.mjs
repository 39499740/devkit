/**
 * 类型检查入口（替代 `nuxt typecheck`）。
 *
 * 为什么需要这一层：Nuxt 4.5 的 prepare:types 会无条件往生成的 tsconfig 里写
 * `vueCompilerOptions.plugins = ['vue-router/volar/sfc-route-blocks']`，
 * 而本机安装的 vue-router 4.6 已不再导出该子路径，vue-tsc 会直接抛
 * ERR_PACKAGE_PATH_NOT_EXPORTED 退出，看不到任何真实类型错误。
 *
 * 做法：先跑 `nuxt prepare` 生成 .nuxt/tsconfig.*，再把这份插件列表清空后交给
 * `vue-tsc -b --noEmit`。该插件只负责 SFC 里 <route> 自定义块的类型，
 * 本项目用文件路由、没有 <route> 块，清空不影响检查范围。
 * vue-router 恢复导出该子路径（或 Nuxt 不再写它）之后，本脚本可以整体删除。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECTS = ['tsconfig.app.json', 'tsconfig.server.json', 'tsconfig.shared.json', 'tsconfig.node.json']

function run(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit' })
}

const prepare = run('npx', ['nuxt', 'prepare'])
if (prepare.status !== 0) process.exit(prepare.status ?? 1)

let patched = 0
for (const name of PROJECTS) {
  const file = join(root, '.nuxt', name)
  if (!existsSync(file)) continue
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const plugins = json?.vueCompilerOptions?.plugins
  if (!Array.isArray(plugins) || plugins.length === 0) continue
  json.vueCompilerOptions.plugins = []
  writeFileSync(file, JSON.stringify(json, null, 2))
  patched += 1
}
if (patched) console.log(`已清理 ${patched} 份生成配置里的 vueCompilerOptions.plugins（vue-router 未导出该子路径）`)

const check = run('npx', ['vue-tsc', '-b', '--noEmit'])
process.exit(check.status ?? 1)
