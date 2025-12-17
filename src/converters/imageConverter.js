import { buildOutputName } from '../utils/fileHandlers'

const MIME_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

const clampQuality = (quality) => {
  if (typeof quality !== 'number') return 0.92
  return Math.min(1, Math.max(0.01, quality / 100))
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
    throw new Error(`Formato de destino não suportado: ${targetFormat}`)
  }

  const image = await readFile(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Contexto 2D não pôde ser inicializado')
  }

  const aspectRatio = image.width / image.height
  let targetWidth = options.width || image.width
  let targetHeight = options.height || image.height

  if (options.maintainAspectRatio && options.width && !options.height) {
    targetHeight = Math.round(targetWidth / aspectRatio)
  }

  if (options.maintainAspectRatio && options.height && !options.width) {
    targetWidth = Math.round(targetHeight * aspectRatio)
  }

  canvas.width = targetWidth
  canvas.height = targetHeight
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  let quality = clampQuality(options.quality)
  if (options.smartCompression && targetFormat === 'jpg') {
    quality = Math.max(0.6, quality - 0.1)
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
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
