import { buildOutputName } from '../utils/fileHandlers'
import ImageTracer from 'imagetracerjs'

const MIME_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const CANVAS_OUTPUT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const VECTOR_OUTPUT_MIME = 'image/svg+xml'

const clampQuality = (quality) => {
  if (typeof quality !== 'number') return 0.92
  return Math.min(1, Math.max(0.01, quality / 100))
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const pickPreset = (metadata, mode) => {
  const requested = String(metadata?.vectorPreset ?? 'auto').toLowerCase()
  if (requested !== 'auto') return requested
  if (mode === 'photo') return 'detailed'
  if (mode === 'illustration') return 'curvy'
  return 'sharp'
}

const removeWhiteBackground = (imageData, tolerance) => {
  const tol = clamp(Number(tolerance ?? 0), 0, 100)
  if (!tol) return imageData

  const data = imageData.data
  const limit = tol * 3
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const delta = (255 - r) + (255 - g) + (255 - b)
    if (delta <= limit) {
      data[i + 3] = 0
    }
  }
  return imageData
}

const homogenizeColors = (imageData, strength) => {
  const s = clamp(Number(strength ?? 0), 0, 100)
  if (!s) return imageData

  // Quantização por canal: mais "s" => menos níveis => cores mais homogêneas.
  const levels = clamp(Math.round(256 / (1 + s * 0.25)), 8, 256)
  if (levels >= 256) return imageData
  const step = 255 / (levels - 1)

  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    data[i] = Math.round(data[i] / step) * step
    data[i + 1] = Math.round(data[i + 1] / step) * step
    data[i + 2] = Math.round(data[i + 2] / step) * step
  }
  return imageData
}

const buildVectorizeOptions = (metadata) => {
  const mode = metadata?.vectorMode ?? 'logo'
  const colors = clamp(Number(metadata?.vectorColors ?? (mode === 'photo' ? 32 : mode === 'illustration' ? 16 : 2)), 2, 64)
  const detail = clamp(Number(metadata?.vectorDetail ?? (mode === 'logo' ? 9 : 6)), 1, 10)
  const smoothing = clamp(Number(metadata?.vectorSmoothing ?? (mode === 'logo' ? 2 : 3)), 0, 10)
  const blur = clamp(Number(metadata?.vectorBlur ?? 0), 0, 10)
  const enhanceCorners = Boolean(metadata?.vectorEnhanceCorners ?? mode === 'logo')
  const homogenize = clamp(Number(metadata?.vectorHomogenize ?? 0), 0, 100)

  // ltres/qtres menores => mais detalhes (mais lento)
  const threshold = clamp(1.1 - detail * 0.1, 0.1, 1.0)

  const presetName = pickPreset(metadata, mode)
  const base = { ...(ImageTracer.optionpresets?.[presetName] ?? ImageTracer.optionpresets?.default ?? {}) }
  return ImageTracer.checkoptions({
    ...base,
    // Ajustes principais
    numberofcolors: colors,
    colorquantcycles: 3,
    colorsampling: mode === 'logo' ? 0 : 2,
    // Precisão
    ltres: threshold,
    qtres: threshold,
    pathomit: clamp(Math.round(1 + smoothing * 2), 1, 50),
    roundcoords: clamp(Math.round(smoothing / 3), 0, 3),
    rightangleenhance: enhanceCorners,
    blurradius: blur,
    blurdelta: blur ? 20 : 0,
    // Aumenta o "corte" de cores muito pequenas (ajuda a reduzir variações em logos coloridos).
    mincolorratio: clamp(homogenize / 5000, 0, 0.03),
    // Saída
    viewbox: true,
    desc: false,
    // Ajuda em logos
    linefilter: mode === 'logo',
    strokewidth: 0,
  })
}

const readFile = async (file) => {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = (error) => {
      URL.revokeObjectURL(url)
      reject(error)
    }
    image.src = url
  })
}

const canUseCanvas = () => typeof document !== 'undefined'

export const convertImage = async (job) => {
  if (!canUseCanvas()) {
    throw new Error('Canvas API indisponível para conversão de imagens')
  }

  const { file, options } = job
  const targetFormat = options.targetFormat.toLowerCase()
  const mime = MIME_MAP[targetFormat]
  if (!mime) {
    throw new Error(
      `Formato de destino não suportado para imagens: ${targetFormat}. Use PNG, JPG, WEBP ou SVG.`,
    )
  }

  const image = await readFile(file)

  const aspectRatio = image.width / image.height
  let targetWidth = options.width || image.width
  let targetHeight = options.height || image.height

  if (options.maintainAspectRatio && options.width && !options.height) {
    targetHeight = Math.round(targetWidth / aspectRatio)
  }

  if (options.maintainAspectRatio && options.height && !options.width) {
    targetWidth = Math.round(targetHeight * aspectRatio)
  }

  // Raster -> SVG (vetorização)
  if (mime === VECTOR_OUTPUT_MIME) {
    // Para logos com gradiente, a vetorização "perfeita" não é garantida.
    // Este modo mantém a aparência original embutindo a imagem em um SVG.
    if (options?.metadata?.vectorEmbedRaster) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Contexto 2D não pôde ser inicializado')
      }

      canvas.width = targetWidth
      canvas.height = targetHeight
      ctx.imageSmoothingEnabled = true
      if ('imageSmoothingQuality' in ctx) {
        ctx.imageSmoothingQuality = 'high'
      }
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

      const dataUrl = canvas.toDataURL('image/png')
      const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">
  <image href="${dataUrl}" width="${targetWidth}" height="${targetHeight}" preserveAspectRatio="none" />
</svg>`
      const blob = new Blob([svgString], { type: VECTOR_OUTPUT_MIME })
      const outputName = buildOutputName(file.name, 'svg')
      return {
        jobId: job.id,
        blob,
        outputName,
        previewUrl: URL.createObjectURL(blob),
        details: `SVG (imagem embutida) · ${targetWidth}x${targetHeight}`,
      }
    }

    // Limite de tamanho para evitar travamentos em imagens muito grandes
    const maxSide = clamp(Number(options?.metadata?.vectorMaxSide ?? 1800), 512, 4096)
    const maxDim = Math.max(targetWidth, targetHeight)
    const scaleFactor = maxDim > maxSide ? maxDim / maxSide : 1
    const traceWidth = Math.max(1, Math.round(targetWidth / scaleFactor))
    const traceHeight = Math.max(1, Math.round(targetHeight / scaleFactor))

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Contexto 2D não pôde ser inicializado')
    }

    const mode = options?.metadata?.vectorMode ?? 'logo'
    ctx.imageSmoothingEnabled = mode !== 'logo'
    if (mode !== 'logo' && 'imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = 'high'
    }

    canvas.width = traceWidth
    canvas.height = traceHeight
    ctx.drawImage(image, 0, 0, traceWidth, traceHeight)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (options?.metadata?.vectorRemoveBg) {
      removeWhiteBackground(imageData, options?.metadata?.vectorBgTolerance)
    }
    if (options?.metadata?.vectorHomogenize) {
      homogenizeColors(imageData, options?.metadata?.vectorHomogenize)
    }
    const vectorOptions = buildVectorizeOptions(options?.metadata)
    // Se a imagem foi reduzida para performance, mantemos a escala original no SVG.
    vectorOptions.scale = scaleFactor
    const svgString = ImageTracer.imagedataToSVG(imageData, vectorOptions)
    const blob = new Blob([svgString], { type: VECTOR_OUTPUT_MIME })
    const outputName = buildOutputName(file.name, 'svg')
    return {
      jobId: job.id,
      blob,
      outputName,
      previewUrl: URL.createObjectURL(blob),
      details: `SVG vetorizado · ${targetWidth}x${targetHeight} · ${vectorOptions.numberofcolors} cores`,
    }
  }

  if (!CANVAS_OUTPUT_MIMES.has(mime)) {
    throw new Error(`Conversão para ${targetFormat.toUpperCase()} não é suportada no navegador.`)
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Contexto 2D não pôde ser inicializado')
  }

  canvas.width = targetWidth
  canvas.height = targetHeight
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  let quality = clampQuality(options.quality)
  if (options.smartCompression && targetFormat === 'jpg') {
    quality = Math.max(0.6, quality - 0.1)
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('Falha ao gerar blob de imagem'))
          return
        }
        resolve(result)
      },
      mime,
      quality,
    )
  })

  const outputName = buildOutputName(file.name, targetFormat)

  return {
    jobId: job.id,
    blob,
    outputName,
    previewUrl: URL.createObjectURL(blob),
    details: `${targetWidth}x${targetHeight} · Qualidade ${(quality * 100).toFixed(0)}%`,
  }
}
