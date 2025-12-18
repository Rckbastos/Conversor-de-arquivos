import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { buildOutputName } from '../utils/fileHandlers'

// Resolve automaticamente:
// - Dev: /dist/main.js -> /dist/pdf.worker.min.mjs
// - Prod: /main.js -> /pdf.worker.min.mjs
GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href

const toPdfBlob = (bytes) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new Blob([buffer], { type: 'application/pdf' })
}

const pdfFromText = async (text, outputName, jobId) => {
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontSize = 12
  const lines = text.split('\n')
  let cursor = page.getHeight() - 50
  const { width, height } = page.getSize()

  for (const line of lines) {
    if (cursor <= 50) {
      page = pdfDoc.addPage([width, height])
      cursor = page.getHeight() - 50
    }
    const chunks = line.match(/.{1,90}/g) ?? ['']
    for (const chunk of chunks) {
      page.drawText(chunk, {
        x: 50,
        y: cursor,
        size: fontSize,
        font,
        maxWidth: width - 100,
      })
      cursor -= fontSize + 4
    }
  }

  const pdfBytes = await pdfDoc.save()
  return {
    jobId,
    blob: toPdfBlob(pdfBytes),
    outputName,
  }
}

const extractPdfText = async (file) => {
  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text +=
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ') + '\n'
  }
  return text.trim()
}

const pdfPageToImage = async (file, targetFormat, jobId) => {
  if (typeof document === 'undefined') {
    throw new Error('Renderização de PDF em imagem requer ambiente com DOM')
  }

  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D indisponível para PDF')
  await page.render({ canvasContext: context, viewport, canvas }).promise

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Falha ao converter página'))
        return
      }
      resolve(result)
    }, targetFormat === 'jpg' ? 'image/jpeg' : 'image/png')
  })

  const outputName = buildOutputName(file.name, targetFormat)
  return {
    jobId,
    blob,
    outputName,
    previewUrl: URL.createObjectURL(blob),
    details: `Página 1 · ${viewport.width}x${viewport.height}`,
  }
}

const docxFromText = async (text) => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n</Types>`,
  )
  zip
    .folder('_rels')
    ?.file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n</Relationships>`,
    )

  const word = zip.folder('word')
  word
    ?.folder('_rels')
    ?.file(
      'document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    )

  const escapeXml = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&apos;')

  const paragraphs = String(text)
    .split('\n')
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('')

  word?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`,
  )

  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' })
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

export const convertDocument = async (job) => {
  const { file, options } = job
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const target = options.targetFormat.toLowerCase()

  if (extension === 'pdf') {
    if (target === 'txt') {
      const text = await extractPdfText(file)
      return {
        jobId: job.id,
        blob: new Blob([text], { type: 'text/plain' }),
        outputName: buildOutputName(file.name, 'txt'),
        details: `${text.length} caracteres extraídos`,
      }
    }
    if (target === 'png' || target === 'jpg') {
      return pdfPageToImage(file, target, job.id)
    }
    if (target === 'docx') {
      const text = await extractPdfText(file)
      const docxBlob = await docxFromText(text)
      return {
        jobId: job.id,
        blob: docxBlob,
        outputName: buildOutputName(file.name, 'docx'),
        details: `${text.length} caracteres`,
      }
    }
  }

  if (extension === 'docx') {
    const arrayBuffer = await file.arrayBuffer()
    if (target === 'pdf') {
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      const outputName = buildOutputName(file.name, 'pdf')
      return pdfFromText(value, outputName, job.id)
    }
    if (target === 'txt') {
      const { value } = await mammoth.extractRawText({ arrayBuffer })
      return {
        jobId: job.id,
        blob: new Blob([value], { type: 'text/plain' }),
        outputName: buildOutputName(file.name, 'txt'),
        details: `${value.length} caracteres`,
      }
    }
  }

  if (extension === 'txt') {
    const text = await file.text()
    if (target === 'pdf') {
      const outputName = buildOutputName(file.name, 'pdf')
      return pdfFromText(text, outputName, job.id)
    }
  }

  throw new Error('Conversão de documento não implementada para esta combinação')
}
