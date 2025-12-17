import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import { buildOutputName } from '../utils/fileHandlers'

GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs'

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
