import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const port = Number(process.env.PORT || 3000)
const distDir = path.resolve('dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
}

const safeJoin = (root, requestPath) => {
  const decoded = decodeURIComponent(requestPath.split('?')[0] || '/')
  const withoutPrefix = decoded.startsWith('/dist/') ? decoded.slice('/dist/'.length) : decoded
  const normalized = path
    .normalize(withoutPrefix)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '')
  return path.join(root, normalized)
}

const sendFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable')
  createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  try {
    const url = req.url || '/'
    const pathname = url.split('?')[0] || '/'

    // Root -> index.html
    if (pathname === '/' || pathname === '') {
      const filePath = path.join(distDir, 'index.html')
      res.statusCode = 200
      sendFile(res, filePath)
      return
    }

    // Static file
    const candidate = safeJoin(distDir, pathname)
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      res.statusCode = 200
      sendFile(res, candidate)
      return
    }

    // SPA fallback
    const indexPath = path.join(distDir, 'index.html')
    if (existsSync(indexPath)) {
      res.statusCode = 200
      sendFile(res, indexPath)
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found')
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Internal server error')
  }
})

server.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Arclight running on http://0.0.0.0:${port}`)
})
