const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml']
const DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const MEDIA_TYPES = ['video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg']
const DATA_TYPES = ['text/csv', 'application/json', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/xml']
const CODE_TYPES = ['application/json', 'application/x-yaml', 'text/yaml', 'text/html', 'text/markdown']

const CONVERSION_MAP = {
  image: {
    // Conversões suportadas no browser via Canvas: saída PNG/JPG/WEBP.
    // Também suportamos PNG/JPG/WebP -> SVG via vetorização (ImageTracer).
    png: ['jpg', 'webp', 'svg'],
    jpg: ['png', 'webp', 'svg'],
    jpeg: ['png', 'webp', 'svg'],
    webp: ['png', 'jpg', 'svg'],
    gif: ['png', 'jpg', 'webp'],
    bmp: ['png', 'jpg', 'webp', 'svg'],
    // SVG pode ser rasterizado (SVG -> PNG/JPG/WEBP). Raster -> SVG usa vetorização local (pode variar por imagem).
    svg: ['png', 'jpg', 'webp'],
  },
  document: {
    pdf: ['docx', 'txt', 'png', 'jpg'],
    docx: ['pdf', 'txt'],
    txt: ['pdf'],
  },
  media: {
    mp4: ['mp3', 'webm', 'gif'],
    webm: ['mp4', 'mp3'],
    mp3: ['wav', 'ogg'],
    wav: ['mp3', 'ogg'],
  },
  data: {
    csv: ['json', 'xlsx', 'xml'],
    json: ['csv', 'xlsx', 'xml'],
    xlsx: ['csv', 'json'],
    xml: ['json', 'csv'],
  },
  code: {
    json: ['yaml'],
    yaml: ['json'],
    html: ['md'],
    md: ['html', 'pdf'],
  },
}

export const detectCategoryByMime = (file) => {
  const { type, name } = file
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  const normalizedType = type.toLowerCase()

  const data = [
    [IMAGE_TYPES, 'image'],
    [DOCUMENT_TYPES, 'document'],
    [MEDIA_TYPES, 'media'],
    [DATA_TYPES, 'data'],
    [CODE_TYPES, 'code'],
  ]

  for (const [list, category] of data) {
    if (list.some((mime) => normalizedType.startsWith(mime) || extension.includes(mime.split('/').pop() ?? ''))) {
      const suggestions = getAvailableTargets(category, extension)
      return { category, mime: normalizedType || extension, suggestions }
    }
  }

  if (!extension) {
    return null
  }

  for (const category of Object.keys(CONVERSION_MAP)) {
    const suggestions = getAvailableTargets(category, extension)
    if (suggestions.length) {
      return { category, mime: extension, suggestions }
    }
  }

  return null
}

export const getAvailableTargets = (category, ext) => {
  const normalized = ext.replace('.', '').toLowerCase()
  return CONVERSION_MAP[category]?.[normalized] ?? []
}

export const validateFileSize = (file, maxSizeMB) => {
  const bytes = maxSizeMB * 1024 * 1024
  return file.size <= bytes
}

export const MAX_UPLOAD_MB = 50
