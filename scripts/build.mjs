import { rm, mkdir, copyFile, writeFile, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import esbuild from 'esbuild'

const distDir = new URL('../dist/', import.meta.url)

const copyDir = async (srcDirUrl, destDirUrl) => {
  const entries = await readdir(srcDirUrl, { withFileTypes: true })
  await mkdir(destDirUrl, { recursive: true })
  await Promise.all(
    entries.map(async (entry) => {
      const src = new URL(`./${entry.name}`, srcDirUrl)
      const dest = new URL(`./${entry.name}`, destDirUrl)
      if (entry.isDirectory()) {
        await copyDir(src, dest)
        return
      }
      if (entry.isFile()) {
        await copyFile(src, dest)
      }
    }),
  )
}

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: 'dist/main.js',
})

// Copiar CSS
await copyFile(new URL('../src/index.css', import.meta.url), new URL('../dist/index.css', import.meta.url))

// Copiar assets estáticos (public/)
await copyDir(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url))

// Copiar worker do PDF.js
const workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)
const workerDest = new URL('../dist/pdf.worker.min.mjs', import.meta.url)
await mkdir(dirname(workerDest.pathname), { recursive: true })
await copyFile(workerSrc, workerDest)

// Gerar HTML de produção dentro do dist/
const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arclight</title>
    <link rel="icon" href="./archlight_logo.png" />
    <link rel="stylesheet" href="./index.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`

await writeFile(new URL('../dist/index.html', import.meta.url), html)

console.log('Build concluído: dist/index.html, dist/main.js, dist/index.css, dist/pdf.worker.min.mjs')
