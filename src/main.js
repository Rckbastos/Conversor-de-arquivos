import { detectCategoryByMime, MAX_UPLOAD_MB, validateFileSize } from './utils/validations'
import { readFileAsDataUrl, downloadConverted } from './utils/fileHandlers'
import { convertImage } from './converters/imageConverter'
import { convertDocument } from './converters/documentConverter'
import { convertMedia } from './converters/audioVideoConverter'
import { convertDataFile } from './converters/dataConverter'
import {
  deleteResultsForSession,
  getConvertedResult,
  isIndexedDbAvailable,
  purgeOldResults,
  putConvertedResult,
} from './utils/historyStore'

const app = document.getElementById('app')
const logoUrl = new URL('./archlight_logo.png', import.meta.url).href

if (!app) {
  throw new Error('Elemento raiz não encontrado')
}

const HISTORY_KEY = 'archlight_history_v1'
const SESSION_ID_KEY = 'archlight_session_id_v1'
const HISTORY_WINDOW_MS = 20 * 60 * 1000

// Correção para deploys antigos: se o usuário já teve PWA/Service Worker ativo,
// ele pode manter assets antigos em cache e "não atualizar" o layout.
const maybeCleanupLegacyPwa = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return
    if (localStorage.getItem('archlight_pwa_cleanup_v1') === 'done') return

    const regs = await navigator.serviceWorker.getRegistrations()
    if (!regs.length) {
      localStorage.setItem('archlight_pwa_cleanup_v1', 'done')
      return
    }

    await Promise.allSettled(regs.map((r) => r.unregister()))
    const keys = await caches.keys()
    await Promise.allSettled(keys.map((k) => caches.delete(k)))

    localStorage.setItem('archlight_pwa_cleanup_v1', 'done')

    // Recarrega só uma vez para pegar os assets novos.
    if (sessionStorage.getItem('archlight_pwa_reloaded_v1') !== '1') {
      sessionStorage.setItem('archlight_pwa_reloaded_v1', '1')
      location.reload()
    }
  } catch {
    // ignore
  }
}

maybeCleanupLegacyPwa()

const sessionId =
  sessionStorage.getItem(SESSION_ID_KEY) ||
  (() => {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    sessionStorage.setItem(SESSION_ID_KEY, id)
    return id
  })()

app.innerHTML = `
  <div class="page">
    <div class="stack">
        <header class="card">
          <div class="card-header">
            <div>
              <div style="display:flex; align-items:center; gap:12px">
                <img src="${logoUrl}" alt="ARCHLIGHT" style="width:52px;height:52px;object-fit:contain;filter:drop-shadow(0 14px 22px rgba(0,0,0,.5))" />
                <h1 class="title" style="font-size:30px; letter-spacing:1.4px">ARCHLIGHT</h1>
              </div>
            </div>
            <span class="badge">Seguro</span>
          </div>
          <div class="tabs" style="margin-top:12px">
            <button class="tab active" id="tab-convert" type="button">Converter</button>
            <button class="tab" id="tab-history" type="button">
              Histórico <span class="tab-badge" id="history-count">0</span>
            </button>
          </div>
        </header>

      <main class="grid grid-two" id="view-convert">
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
            <div style="margin-top:10px" class="history-list" id="file-list"></div>
            <div style="margin-top:10px; display:flex; justify-content:center; gap:10px; flex-wrap:wrap">
              <button id="clear-files" class="btn btn-secondary" type="button">Remover arquivos</button>
            </div>
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
            <div id="vector-panel" style="margin-top:12px; display:none">
              <p class="text-muted" style="margin:0 0 8px; font-weight:700">Vetorização (PNG/JPG → SVG)</p>
              <label class="label" for="vector-mode">Perfil</label>
              <select id="vector-mode" class="select">
                <option value="logo">Logo (2 cores, mais preciso)</option>
                <option value="illustration">Ilustração (16 cores)</option>
                <option value="photo">Foto (32 cores)</option>
              </select>
              <div style="margin-top:10px">
                <label class="label" for="vector-colors">Quantidade de cores</label>
                <div class="slider-row">
                  <input type="range" id="vector-colors" min="2" max="64" value="2" />
                  <span class="text-muted" id="vector-colors-value">2</span>
                </div>
              </div>
              <div style="margin-top:10px">
                <label class="label" for="vector-detail">Detalhe</label>
                <div class="slider-row">
                  <input type="range" id="vector-detail" min="1" max="10" value="9" />
                  <span class="text-muted" id="vector-detail-value">9</span>
                </div>
              </div>
              <div style="margin-top:10px">
                <label class="label" for="vector-maxside">Tamanho máximo (performance)</label>
                <select id="vector-maxside" class="select">
                  <option value="1024">1024px (rápido)</option>
                  <option value="1800" selected>1800px (equilibrado)</option>
                  <option value="3000">3000px (mais detalhado)</option>
                  <option value="4096">4096px (muito pesado)</option>
                </select>
              </div>

              <details class="details" style="margin-top:12px">
                <summary>Configurações avançadas</summary>
                <div style="margin-top:12px" class="stack">
                  <div>
                    <label class="label" for="vector-preset">Preset do traçado</label>
                    <select id="vector-preset" class="select">
                      <option value="auto" selected>Auto (recomendado)</option>
                      <option value="sharp">Sharp (arestas mais nítidas)</option>
                      <option value="detailed">Detailed (mais detalhes, mais pesado)</option>
                      <option value="smoothed">Smoothed (mais suave)</option>
                      <option value="posterized3">Posterized (estilo “cartaz”)</option>
                    </select>
                  </div>

                  <div class="toggle-row">
                    <label class="toggle" style="display:flex; align-items:center; gap:10px">
                      <input type="checkbox" id="vector-bg" />
                      Remover fundo branco (transparente)
                    </label>
                    <label class="toggle" style="display:flex; align-items:center; gap:10px">
                      <input type="checkbox" id="vector-corners" checked />
                      Aprimorar cantos (logos)
                    </label>
                    <label class="toggle" style="display:flex; align-items:center; gap:10px">
                      <input type="checkbox" id="vector-embed" />
                      Manter gradiente (SVG com imagem embutida)
                    </label>
                  </div>

                  <div>
                    <label class="label" for="vector-bg-tol">Tolerância do fundo</label>
                    <div class="slider-row">
                      <input type="range" id="vector-bg-tol" min="0" max="100" value="18" />
                      <span class="text-muted" id="vector-bg-tol-value">18</span>
                    </div>
                  </div>

                  <div>
                    <label class="label" for="vector-smooth">Suavização (menos pontos)</label>
                    <div class="slider-row">
                      <input type="range" id="vector-smooth" min="0" max="10" value="2" />
                      <span class="text-muted" id="vector-smooth-value">2</span>
                    </div>
                  </div>

                  <div>
                    <label class="label" for="vector-homog">Homogeneizar cores (reduz variações)</label>
                    <div class="slider-row">
                      <input type="range" id="vector-homog" min="0" max="100" value="40" />
                      <span class="text-muted" id="vector-homog-value">40</span>
                    </div>
                  </div>

                  <div>
                    <label class="label" for="vector-blur">Pré-blur (reduz ruído)</label>
                    <div class="slider-row">
                      <input type="range" id="vector-blur" min="0" max="10" value="0" />
                      <span class="text-muted" id="vector-blur-value">0</span>
                    </div>
                  </div>

                  <p class="text-muted" style="margin:0">
                    Dica: para “perfeito”, use <b>Logo</b>, aumente o tamanho máximo e evite imagens com muitos detalhes.
                  </p>
                </div>
              </details>
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

      <main class="grid" id="view-history" style="display:none">
        <section class="card stack">
          <div class="card-header">
            <div>
              <p class="text-muted" style="text-transform:uppercase;font-weight:700;font-size:12px">Histórico</p>
              <h2 class="title">Últimos 20 minutos</h2>
              <p class="text-muted" style="margin:6px 0 0">
                O histórico expira automaticamente. Se suportado pelo navegador, o arquivo convertido pode ser baixado mesmo após recarregar a página.
              </p>
            </div>
            <button id="clear-history" class="btn btn-secondary" type="button" style="padding:10px 12px">Limpar</button>
          </div>
          <div class="history-list" id="history-list"></div>
        </section>
      </main>
    </div>
  </div>
`

const fileInput = document.getElementById('file-input')
const dropArea = document.getElementById('drop-area')
const fileList = document.getElementById('file-list')
const clearFilesBtn = document.getElementById('clear-files')
const formatSelect = document.getElementById('format-select')
const formatLabel = document.getElementById('format-label')
const qualityRange = document.getElementById('quality-range')
const qualityValue = document.getElementById('quality-value')
const vectorPanel = document.getElementById('vector-panel')
const vectorMode = document.getElementById('vector-mode')
const vectorColors = document.getElementById('vector-colors')
const vectorColorsValue = document.getElementById('vector-colors-value')
const vectorDetail = document.getElementById('vector-detail')
const vectorDetailValue = document.getElementById('vector-detail-value')
const vectorMaxSide = document.getElementById('vector-maxside')
const vectorPreset = document.getElementById('vector-preset')
const vectorRemoveBg = document.getElementById('vector-bg')
const vectorBgTol = document.getElementById('vector-bg-tol')
const vectorBgTolValue = document.getElementById('vector-bg-tol-value')
const vectorCorners = document.getElementById('vector-corners')
const vectorEmbed = document.getElementById('vector-embed')
const vectorSmooth = document.getElementById('vector-smooth')
const vectorSmoothValue = document.getElementById('vector-smooth-value')
const vectorHomog = document.getElementById('vector-homog')
const vectorHomogValue = document.getElementById('vector-homog-value')
const vectorBlur = document.getElementById('vector-blur')
const vectorBlurValue = document.getElementById('vector-blur-value')
const convertBtn = document.getElementById('convert-btn')
const downloadBtn = document.getElementById('download-btn')
const statusText = document.getElementById('status-text')
const previewBefore = document.getElementById('preview-before')
const previewAfter = document.getElementById('preview-after')
const tabConvert = document.getElementById('tab-convert')
const tabHistory = document.getElementById('tab-history')
const viewConvert = document.getElementById('view-convert')
const viewHistory = document.getElementById('view-history')
const historyCount = document.getElementById('history-count')
const historyList = document.getElementById('history-list')
const clearHistoryBtn = document.getElementById('clear-history')

let currentFiles = []
let detectedCategory = null
let resultBlob = null
const resultCache = new Map()

const readHistory = () => {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeHistory = (items) => {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(items))
  } catch {
    // ignore
  }
}

const purgeOldHistory = () => {
  const now = Date.now()
  const items = readHistory().filter((it) => typeof it?.at === 'number' && now - it.at <= HISTORY_WINDOW_MS)
  writeHistory(items)
  return items
}

const formatRelativeTime = (timestamp) => {
  const diff = Math.max(0, Date.now() - timestamp)
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `agora`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  return `há ${hours} h`
}

const setHistoryCount = (count) => {
  if (!historyCount) return
  historyCount.textContent = String(count)
}

const renderHistory = () => {
  if (!historyList) return
  const items = purgeOldHistory()
  setHistoryCount(items.length)

  if (!items.length) {
    historyList.innerHTML = '<div class="text-muted">Nenhuma conversão nos últimos 20 minutos.</div>'
    return
  }

  historyList.innerHTML = ''
  items.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'history-item'

    const canDownload = Boolean(item?.cacheId) && (resultCache.has(item.cacheId) || item?.persisted === true)
    row.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${item.outputName ?? 'arquivo'}</div>
        <div class="text-muted" style="margin-top:2px">
          ${item.inputName ?? 'origem'} → ${String(item.targetFormat ?? '').toUpperCase()}
          · ${formatRelativeTime(item.at)}
        </div>
        ${item.details ? `<div class="text-muted" style="margin-top:2px">${item.details}</div>` : ''}
      </div>
      <button class="btn btn-primary" type="button" data-history-download="${item.cacheId ?? ''}" ${canDownload ? '' : 'disabled'}
        style="padding:10px 12px; border-radius:12px">
        Baixar
      </button>
    `
    historyList.appendChild(row)
  })
}

const addToHistory = (entry) => {
  const items = purgeOldHistory()
  items.unshift(entry)
  writeHistory(items)
  setHistoryCount(items.length)
  renderHistory()
}

const setActiveTab = (tab) => {
  const isHistory = tab === 'history'
  if (tabConvert) tabConvert.classList.toggle('active', !isHistory)
  if (tabHistory) tabHistory.classList.toggle('active', isHistory)
  if (viewConvert) viewConvert.style.display = isHistory ? 'none' : ''
  if (viewHistory) viewHistory.style.display = isHistory ? '' : 'none'
  if (isHistory) renderHistory()
}

function handleTargetUi() {
  const target = formatSelect?.value
  if (vectorPanel) {
    vectorPanel.style.display = target === 'svg' ? 'block' : 'none'
  }
}

const clearResult = () => {
  resultBlob = null
  downloadBtn.disabled = true
  previewAfter.textContent = 'Aguardando conversão.'
}

const resetAll = () => {
  currentFiles = []
  detectedCategory = null
  clearResult()
  if (fileInput) fileInput.value = ''
  if (fileList) fileList.innerHTML = ''
  previewBefore.textContent = 'Selecione um arquivo.'
  formatSelect.innerHTML = ''
  formatLabel.textContent = 'Selecione o destino'
  statusText.textContent = 'Aguardando arquivo.'
  convertBtn.disabled = true
}

tabConvert?.addEventListener('click', () => setActiveTab('convert'))
tabHistory?.addEventListener('click', () => setActiveTab('history'))
clearHistoryBtn?.addEventListener('click', () => {
  writeHistory([])
  setHistoryCount(0)
  renderHistory()
  if (isIndexedDbAvailable()) {
    deleteResultsForSession(sessionId).catch(() => {})
  }
})

const renderFileList = () => {
  if (!fileList) return
  if (!currentFiles.length) {
    fileList.innerHTML = '<div class="text-muted">Nenhum arquivo selecionado.</div>'
    return
  }
  fileList.innerHTML = ''
  currentFiles.forEach((file, index) => {
    const item = document.createElement('div')
    item.className = 'history-item'
    item.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${file.name}</div>
        <div class="text-muted">${Math.round(file.size / 1024)} KB</div>
      </div>
      <button class="btn btn-secondary" type="button" data-index="${index}" style="padding:8px 10px;border-radius:10px">
        Remover
      </button>
    `
    fileList.appendChild(item)
  })
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
  handleTargetUi()
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
  renderFileList()
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
  if (qualityValue) qualityValue.textContent = `${qualityRange.value}%`
})

formatSelect?.addEventListener('change', () => handleTargetUi())

vectorColors?.addEventListener('input', () => {
  if (vectorColorsValue) vectorColorsValue.textContent = String(vectorColors.value)
})

vectorDetail?.addEventListener('input', () => {
  if (vectorDetailValue) vectorDetailValue.textContent = String(vectorDetail.value)
})

vectorMode?.addEventListener('change', () => {
  const mode = vectorMode.value
  if (!vectorColors || !vectorDetail || !vectorSmooth || !vectorHomog) return
  if (mode === 'logo') {
    vectorColors.value = '2'
    vectorDetail.value = '9'
    vectorSmooth.value = '2'
    vectorHomog.value = '60'
  } else if (mode === 'illustration') {
    vectorColors.value = '16'
    vectorDetail.value = '7'
    vectorSmooth.value = '3'
    vectorHomog.value = '35'
  } else {
    vectorColors.value = '32'
    vectorDetail.value = '6'
    vectorSmooth.value = '4'
    vectorHomog.value = '15'
  }
  if (vectorColorsValue) vectorColorsValue.textContent = String(vectorColors.value)
  if (vectorDetailValue) vectorDetailValue.textContent = String(vectorDetail.value)
  if (vectorSmoothValue) vectorSmoothValue.textContent = String(vectorSmooth.value)
  if (vectorHomogValue) vectorHomogValue.textContent = String(vectorHomog.value)
})

vectorBgTol?.addEventListener('input', () => {
  if (vectorBgTolValue) vectorBgTolValue.textContent = String(vectorBgTol.value)
})

vectorSmooth?.addEventListener('input', () => {
  if (vectorSmoothValue) vectorSmoothValue.textContent = String(vectorSmooth.value)
})

vectorHomog?.addEventListener('input', () => {
  if (vectorHomogValue) vectorHomogValue.textContent = String(vectorHomog.value)
})

vectorBlur?.addEventListener('input', () => {
  if (vectorBlurValue) vectorBlurValue.textContent = String(vectorBlur.value)
})

clearFilesBtn?.addEventListener('click', () => resetAll())

fileList?.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const index = target.getAttribute('data-index')
  if (index === null) return
  const idx = Number(index)
  if (Number.isNaN(idx)) return
  currentFiles.splice(idx, 1)
  renderFileList()
  clearResult()
  if (currentFiles.length) {
    updateFormats(currentFiles[0])
    await showPreviewBefore(currentFiles[0])
    statusText.textContent = 'Pronto para converter.'
  } else {
    resetAll()
  }
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
        metadata:
          targetFormat === 'svg'
            ? {
                vectorMode: vectorMode?.value ?? 'logo',
                vectorColors: Number(vectorColors?.value ?? 16),
                vectorDetail: Number(vectorDetail?.value ?? 7),
                vectorMaxSide: Number(vectorMaxSide?.value ?? 1800),
                vectorPreset: vectorPreset?.value ?? 'auto',
                vectorRemoveBg: Boolean(vectorRemoveBg?.checked),
                vectorBgTolerance: Number(vectorBgTol?.value ?? 18),
                vectorEnhanceCorners: Boolean(vectorCorners?.checked),
                vectorEmbedRaster: Boolean(vectorEmbed?.checked),
                vectorSmoothing: Number(vectorSmooth?.value ?? 3),
                vectorHomogenize: Number(vectorHomog?.value ?? 0),
                vectorBlur: Number(vectorBlur?.value ?? 0),
              }
            : undefined,
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

    const cacheId = result.jobId || job.id
    resultCache.set(cacheId, result)
    let persisted = false
    if (isIndexedDbAvailable()) {
      try {
        persisted = await putConvertedResult({
          id: cacheId,
          sessionId,
          at: Date.now(),
          outputName: result.outputName,
          details: result.details,
          blob: result.blob,
        })
      } catch {
        persisted = false
      }
    }

    addToHistory({
      at: Date.now(),
      inputName: file.name,
      inputType: file.type || file.name.split('.').pop()?.toLowerCase(),
      targetFormat,
      outputName: result.outputName,
      details: result.details,
      cacheId,
      persisted,
    })
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

historyList?.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const cacheId = target.getAttribute('data-history-download')
  if (!cacheId) return
  const inMemory = resultCache.get(cacheId)
  if (inMemory) {
    downloadConverted(inMemory)
    return
  }

  ;(async () => {
    const items = purgeOldHistory()
    const item = items.find((it) => it.cacheId === cacheId)
    if (!item) {
      statusText.textContent = 'Esse item do histórico expirou.'
      return
    }

    if (!isIndexedDbAvailable()) {
      statusText.textContent = 'Download indisponível após refresh neste navegador.'
      return
    }

    try {
      const stored = await getConvertedResult(cacheId)
      if (!stored || stored.sessionId !== sessionId) {
        statusText.textContent = 'Arquivo do histórico não está mais disponível.'
        return
      }
      if (typeof stored.at === 'number' && Date.now() - stored.at > HISTORY_WINDOW_MS) {
        statusText.textContent = 'Esse item do histórico expirou.'
        return
      }
      downloadConverted({
        jobId: cacheId,
        blob: stored.blob,
        outputName: stored.outputName || item.outputName,
      })
    } catch {
      statusText.textContent = 'Falha ao recuperar arquivo do histórico.'
    }
  })()
})

// Inicializar histórico (expurgo + contagem) e manter expiração funcionando
setHistoryCount(purgeOldHistory().length)
if (isIndexedDbAvailable()) {
  purgeOldResults(HISTORY_WINDOW_MS).catch(() => {})
}
setInterval(() => {
  if (viewHistory && viewHistory.style.display !== 'none') {
    renderHistory()
  } else {
    setHistoryCount(purgeOldHistory().length)
  }
}, 60_000)
