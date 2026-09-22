/** 临时静态服务器：给 P1 复验的 ego-browser 用例提供 .output/public（审计后删除） */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'

const root = process.argv[2]
const port = Number(process.argv[3] ?? 4399)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = join(root, path)
    let info = await stat(file).catch(() => null)
    if (info?.isDirectory()) {
      file = join(file, 'index.html')
      info = await stat(file).catch(() => null)
    }
    if (!info) {
      file = join(root, '200.html')
      info = await stat(file).catch(() => null)
    }
    if (!info) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    })
    res.end(await readFile(file))
  } catch (e) {
    res.writeHead(500)
    res.end(String(e))
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`))
