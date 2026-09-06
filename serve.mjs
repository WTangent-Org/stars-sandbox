/**
 * 纯静态文件服务器：托管 dist/ 目录（星球模拟器单机版构建产物）。
 * 用法: PORT=8321 node serve.mjs
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = 'dist'
const PORT = Number(process.env.PORT ?? 8321)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (p === '/') p = '/index.html'
    const file = normalize(join(ROOT, p))
    if (!file.startsWith(normalize(ROOT))) {
      res.writeHead(403)
      res.end()
      return
    }
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(PORT, () => {
  console.log(`[星球模拟器] 静态服务已启动: http://127.0.0.1:${PORT}`)
})
