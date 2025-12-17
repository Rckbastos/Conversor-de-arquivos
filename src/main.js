import { detectCategoryByMime, MAX_UPLOAD_MB, validateFileSize } from './utils/validations'
import { readFileAsDataUrl, downloadConverted } from './utils/fileHandlers'
import { convertImage } from './converters/imageConverter'
import { convertDocument } from './converters/documentConverter'
import { convertMedia } from './converters/audioVideoConverter'
import { convertDataFile } from './converters/dataConverter'

const app = document.getElementById('app')

if (!app) {
  throw new Error('Elemento raiz não encontrado')
}

app.innerHTML = `
  <div class="page">
    <div class="stack">
      <header class="card">
        <div class="card-header">
          <div>
            <p class="text-muted" style="letter-spacing:0.3em;text-transform:uppercase;font-weight:700;font-size:12px">Conversor</p>
            <h1 class="title">Conversor Universal</h1>
            <p class="subtitle">Escolha o arquivo, selecione o formato de destino e faça o download.</p>
          </div>
          <span class="badge">Local · Offline · Seguro</span>
        </div>
      </header>

      <main class="grid grid-two">
        <section class="card stack">
          <div class="card-header">
            <div>
              <p class="text-muted" style="text-transform:uppercase;font-weight:700;font-size:12px">Passo 1</p>
              <h2 class="title">Upload e opções</h2>
            </div>
          </div>
          <div class="upload-area" id="drop-area">
            <p class="title" style="font-size:16px">Arraste ou clique para selecionar</p>
            <p class="text-muted">Limite ${MAX_UPLOAD_MB}MB · múltiplos arquivos</p>
            <input type="file" id="file-input" multiple style="margin-top:12px" />
            <p class="text-muted" style="margin-top:8px" id="selected-file">Nenhum arquivo selecionado.</p>
          </div>
          <div class="card">
            <div class="card-header">
              <div>
                <p class="text-muted" style="text-transform:uppercase;font-weight:700;font-size:12px">Formato</p>
                <h3 class="title" style="font-size:16px" id="format-label">Selecione o destino</h3>
              </div>
            </div>
            <label class="label" for="format-select">Converter para</label>
            <select id="format-select" class="select"></select>
            <div style="margin-top:12px">
              <label class="label" for="quality-range">Qualidade (imagens)</label>
              <div class="slider-row">
                <input type="range" id="quality-range" min="1" max="100" value="90" />
                <span class="text-muted" id="quality-value">90%</span>
              </div>
            </div>
          </div>
          <button id="convert-btn" class="btn btn-primary" disabled>Converter</button>
        </section>

        <section class="stack">
          <div class="card">
            <div class="card-header">
              <div>
                <p class="text-muted" style="text-transform:uppercase;font-weight:700;font-size:12px">Status</p>
                <h3 class="title" style="font-size:16px">Prévia e download</h3>
              </div>
            </div>
            <div class="grid" style="gap:10px;grid-template-columns:1fr 1fr">
              <div>
                <p class="text-muted" style="font-weight:700;font-size:12px">Antes</p>
                <div class="preview-box" id="preview-before">Selecione um arquivo.</div>
              </div>
              <div>
                <p class="text-muted" style="font-weight:700;font-size:12px">Depois</p>
                <div class="preview-box" id="preview-after">Aguardando conversão.</div>
              </div>
            </div>
            <div style="margin-top:12px">
              <p class="text-muted" id="status-text">Aguardando arquivo.</p>
            </div>
            <button id="download-btn" class="btn btn-secondary" disabled>Baixar arquivo convertido</button>
          </div>
          <div class="card">
            <p class="title" style="font-size:14px;margin:0">Dicas rápidas</p>
            <ul class="text-muted" style="margin:8px 0 0; padding-left:18px; line-height:1.4">
              <li>Use formatos sugeridos após o upload.</li>
              <li>Qualidade afeta apenas JPG/WEBP.</li>
              <li>Para dados, converta CSV/JSON/XLSX/XML/YAML.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  </div>
`

const fileInput = document.getElementById('file-input')
const dropArea = document.getElementById('drop-area')
const selectedFileLabel = document.getElementById('selected-file')
const formatSelect = document.getElementById('format-select')
const formatLabel = document.getElementById('format-label')
const qualityRange = document.getElementById('quality-range')
const qualityValue = document.getElementById('quality-value')
const convertBtn = document.getElementById('convert-btn')
const downloadBtn = document.getElementById('download-btn')
const statusText = document.getElementById('status-text')
const previewBefore = document.getElementById('preview-before')
const previewAfter = document.getElementById('preview-after')

let currentFiles = []
let detectedCategory = null
let resultBlob = null

const clearResult = () => {
  resultBlob = null
  downloadBtn.disabled = true
  previewAfter.textContent = 'Aguardando conversão.'
}

const updateFormats = (file) => {
  const info = detectCategoryByMime(file)
  detectedCategory = info?.category ?? null
  const suggestions = info ? info.suggestions : []
  formatSelect.innerHTML = ''
  suggestions.forEach((s) => {
    const option = document.createElement('option')
    option.value = s
    option.textContent = s.toUpperCase()
    formatSelect.appendChild(option)
  })
  formatLabel.textContent = info ? `${info.mime.toUpperCase()} →` : 'Selecione o destino'
  convertBtn.disabled = suggestions.length === 0
}

const showPreviewBefore = async (file) => {
  const info = detectCategoryByMime(file)
  if (info?.category === 'image') {
    const data = await readFileAsDataUrl(file)
    previewBefore.innerHTML = `<img src="${data}" style="max-width:100%;height:auto;border-radius:8px" alt="Prévia" />`
  } else if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
    const text = await file.text()
    previewBefore.textContent = text.slice(0, 500) || 'Prévia indisponível.'
  } else {
    previewBefore.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`
  }
}

const getConverter = (category) => {
  switch (category) {
    case 'image':
      return convertImage
    case 'document':
      return convertDocument
    case 'media':
      return convertMedia
    case 'data':
    case 'code':
      return convertDataFile
    default:
      throw new Error('Categoria não suportada')
  }
}

const handleFiles = async (files) => {
  if (!files?.length) return
  const valid = []
  for (const file of Array.from(files)) {
    if (!validateFileSize(file, MAX_UPLOAD_MB)) {
      statusText.textContent = `Arquivo ${file.name} excede ${MAX_UPLOAD_MB}MB.`
      continue
    }
    valid.push(file)
  }
  if (!valid.length) return
  currentFiles = valid
  selectedFileLabel.textContent = `${valid.length} arquivo(s) selecionado(s): ${valid.map((f) => f.name).join(', ')}`
  clearResult()
  updateFormats(valid[0])
  await showPreviewBefore(valid[0])
  statusText.textContent = 'Pronto para converter.'
}

fileInput?.addEventListener('change', (event) => {
  const target = event.target
  handleFiles(target.files)
})

dropArea?.addEventListener('dragover', (event) => {
  event.preventDefault()
  dropArea.classList.add('dragging')
})

dropArea?.addEventListener('dragleave', () => dropArea.classList.remove('dragging'))

dropArea?.addEventListener('drop', (event) => {
  event.preventDefault()
  dropArea.classList.remove('dragging')
  handleFiles(event.dataTransfer?.files ?? null)
})

qualityRange?.addEventListener('input', () => {
  qualityValue.textContent = `${qualityRange.value}%`
})

convertBtn?.addEventListener('click', async () => {
  if (!currentFiles.length || !detectedCategory) return
  const targetFormat = formatSelect.value
  if (!targetFormat) return
  statusText.textContent = 'Convertendo...'
  convertBtn.disabled = true
  try {
    const converter = getConverter(detectedCategory)
    const file = currentFiles[0]
    const job = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      file,
      category: detectedCategory,
      options: {
        targetFormat,
        quality: Number(qualityRange.value),
        maintainAspectRatio: true,
        smartCompression: true,
      },
    }
    const result = await converter(job)
    resultBlob = result
    downloadBtn.disabled = false
    statusText.textContent = 'Conversão concluída.'
    if (result.previewUrl) {
      previewAfter.innerHTML = `<img src="${result.previewUrl}" style="max-width:100%;height:auto;border-radius:8px" alt="Resultado" />`
    } else {
      previewAfter.textContent = `${result.outputName} (${Math.round(result.blob.size / 1024)} KB)`
    }
  } catch (error) {
    statusText.textContent = (error && error.message) || 'Falha na conversão'
    resultBlob = null
    downloadBtn.disabled = true
  } finally {
    convertBtn.disabled = false
  }
})

downloadBtn.addEventListener('click', () => {
  if (resultBlob) {
    downloadConverted(resultBlob)
  }
})
