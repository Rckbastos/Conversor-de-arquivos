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

const cacheControlFor = (ext) => {
  // Como os assets não têm hash no nome (main.js/index.css), não podemos usar cache "immutable".
  // Se cachear agressivo, o deploy pode ficar preso numa versão antiga no browser.
  if (ext === '.html') return 'no-cache'
  if (ext === '.js' || ext === '.mjs' || ext === '.css') return 'no-cache'
  return 'public, max-age=86400'
}

const sendFile = (req, res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const st = statSync(filePath)
  const lastModified = st.mtime.toUTCString()

  if (req.headers['if-modified-since'] === lastModified) {
    res.statusCode = 304
    res.end()
    return
  }

  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', cacheControlFor(ext))
  res.setHeader('Last-Modified', lastModified)
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
      sendFile(req, res, filePath)
      return
    }

    // Static file
    const candidate = safeJoin(distDir, pathname)
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      res.statusCode = 200
      sendFile(req, res, candidate)
      return
    }

    // SPA fallback
    const indexPath = path.join(distDir, 'index.html')
    if (existsSync(indexPath)) {
      res.statusCode = 200
      sendFile(req, res, indexPath)
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
