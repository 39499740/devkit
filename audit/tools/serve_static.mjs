// 本地静态服务（仅用于验收巡检，替代 python -m http.server，避免 keep-alive 连接被重置）
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = process.argv[2] || process.cwd()
const PORT = Number(process.argv[3] || 4321)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
}

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ''))
  if (file.endsWith('/')) file = join(file, 'index.html')
  try {
    const st = await stat(file)
    if (st.isDirectory()) file = join(file, 'index.html')
  } catch {
    /* 落到下面的读取失败分支 */
  }
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(buf)
  } catch {
    try {
      const buf = await readFile(join(ROOT, '404.html'))
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end(buf)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  }
}).listen(PORT, () => console.log(`static ${ROOT} on http://localhost:${PORT}`))
