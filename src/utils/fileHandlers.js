import { saveAs } from 'file-saver'
export const readFileAsDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const readFileAsText = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export const downloadConverted = (result) => {
  saveAs(result.blob, result.outputName)
}

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`
}

export const buildOutputName = (name, targetFormat) => {
  const baseName = name.split('.').slice(0, -1).join('.') || name
  return `${baseName}.${targetFormat}`
}

const HISTORY_KEY = 'universal-converter-history'

export const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch (error) {
    console.error('Erro ao carregar histórico', error)
    return []
  }
}

export const persistHistory = (entries) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
  } catch (error) {
    console.error('Erro ao salvar histórico', error)
  }
}
