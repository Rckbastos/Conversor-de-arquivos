import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import yaml from 'js-yaml'
import TurndownService from 'turndown'
import { marked } from 'marked'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { DOMParser as XmldomParser } from '@xmldom/xmldom'
import { buildOutputName } from '../utils/fileHandlers'

const turndown = new TurndownService()

const getDomParser = () => {
  if (typeof DOMParser !== 'undefined') return DOMParser
  return XmldomParser
}

const jsonToXml = (data) => {
  const build = (value, tag = 'item') => {
    if (Array.isArray(value)) {
      return value.map((item) => build(item, tag)).join('\n')
    }
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value)
        .map(([key, val]) => `<${key}>${build(val, key)}</${key}>`)
        .join('\n')
    }
    return String(value)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${build(data, 'root')}`
}

const parseXml = (text) => {
  const Parser = getDomParser()
  const parser = new Parser()
  const doc = parser.parseFromString(text, 'application/xml')
  const error = doc.querySelector?.('parsererror')
  if (error) {
    throw new Error('XML inválido')
  }
  return doc
}

const xmlToJson = (xml) => {
  const traverse = (node) => {
    if (node.children.length === 0) {
      return node.textContent ?? ''
    }
    const obj = {}
    node.childNodes.forEach((child) => {
      if (child.nodeType === 1) {
        const el = child
        obj[el.nodeName] = traverse(el)
      }
    })
    return obj
  }
  return traverse(xml.documentElement)
}

const markdownToPdf = async (markdown, outputName, jobId) => {
  const html = await Promise.resolve(marked.parse(markdown))
  const text = html.replace(/<[^>]+>/g, '')
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontSize = 12
  let cursor = page.getHeight() - 40
  const { width, height } = page.getSize()
  const lines = text.split('\n')
  for (const line of lines) {
    if (cursor <= 40) {
      page = pdfDoc.addPage([width, height])
      cursor = page.getHeight() - 40
    }
    page.drawText(line, { x: 40, y: cursor, size: fontSize, font, maxWidth: width - 80 })
    cursor -= fontSize + 4
  }
  const pdfBytes = await pdfDoc.save()
  return {
    jobId,
    blob: toBlob(pdfBytes, 'application/pdf'),
    outputName,
  }
}

const toBlob = (data, type) => {
  const buffer =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data.slice(0)
  return new Blob([buffer], { type })
}

const ensureArray = (value) => {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return [value]
  return [{ value }]
}

export const convertDataFile = async (job) => {
  const { file, options } = job
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const target = options.targetFormat.toLowerCase()
  const outputName = buildOutputName(file.name, target)

  if (extension === 'csv') {
    const text = await file.text()
    const parsed = Papa.parse(text, { header: true })
    if (target === 'json') {
      return {
        jobId: job.id,
        blob: new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }),
        outputName,
      }
    }
    if (target === 'xlsx') {
      const sheet = XLSX.utils.json_to_sheet(parsed.data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, 'Planilha')
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      return {
        jobId: job.id,
        blob: toBlob(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        outputName,
      }
    }
    if (target === 'xml') {
      const xml = jsonToXml(parsed.data)
      return {
        jobId: job.id,
        blob: new Blob([xml], { type: 'text/xml' }),
        outputName,
      }
    }
  }

  if (extension === 'json') {
    const json = JSON.parse(await file.text())
    if (target === 'csv') {
      const csv = Papa.unparse(ensureArray(json))
      return {
        jobId: job.id,
        blob: new Blob([csv], { type: 'text/csv' }),
        outputName,
      }
    }
    if (target === 'xlsx') {
      const sheet = XLSX.utils.json_to_sheet(ensureArray(json))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, 'Planilha')
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      return {
        jobId: job.id,
        blob: toBlob(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        outputName,
      }
    }
    if (target === 'xml') {
      const xml = jsonToXml(json)
      return {
        jobId: job.id,
        blob: new Blob([xml], { type: 'text/xml' }),
        outputName,
      }
    }
    if (target === 'yaml') {
      const yamlText = yaml.dump(json)
      return { jobId: job.id, blob: new Blob([yamlText], { type: 'text/yaml' }), outputName }
    }
  }

  if (extension === 'yaml' || extension === 'yml') {
    const yamlText = await file.text()
    const json = yaml.load(yamlText)
    if (target === 'json') {
      return { jobId: job.id, blob: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), outputName }
    }
  }

  if (extension === 'html' && target === 'md') {
    const markdown = turndown.turndown(await file.text())
    return { jobId: job.id, blob: new Blob([markdown], { type: 'text/markdown' }), outputName }
  }

  if (extension === 'md') {
    const markdown = await file.text()
    if (target === 'html') {
      const html = await Promise.resolve(marked.parse(markdown))
      return { jobId: job.id, blob: new Blob([html], { type: 'text/html' }), outputName }
    }
    if (target === 'pdf') {
      return markdownToPdf(markdown, outputName, job.id)
    }
  }

  if (extension === 'xml') {
    const xml = parseXml(await file.text())
    if (target === 'json') {
      const json = xmlToJson(xml)
      return { jobId: job.id, blob: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), outputName }
    }
    if (target === 'csv') {
    const json = ensureArray(xmlToJson(xml))
    const csv = Papa.unparse(json)
      return { jobId: job.id, blob: new Blob([csv], { type: 'text/csv' }), outputName }
    }
  }

  if (extension === 'xlsx') {
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data)
    const firstSheet = workbook.SheetNames[0]
    const sheet = workbook.Sheets[firstSheet]
    const json = XLSX.utils.sheet_to_json(sheet)
    if (target === 'csv') {
      const csv = Papa.unparse(json)
      return { jobId: job.id, blob: new Blob([csv], { type: 'text/csv' }), outputName }
    }
    if (target === 'json') {
      return {
        jobId: job.id,
        blob: new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
        outputName,
      }
    }
  }

  throw new Error('Conversão de dados/código não suportada para esta combinação')
}
