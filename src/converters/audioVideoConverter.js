import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import { buildOutputName } from '../utils/fileHandlers'

let ffmpegInstance = null

const loadFFmpeg = async () => {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg()
    await ffmpegInstance.load()
  }
  return ffmpegInstance
}

const determineMime = (format) => {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
      return 'audio/ogg'
    case 'webm':
      return 'video/webm'
    case 'gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

const runCommand = async (inputName, outputName, file, args, mime) => {
  const ffmpeg = await loadFFmpeg()
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  await ffmpeg.exec(['-i', inputName, ...args, outputName])
  const data = await ffmpeg.readFile(outputName)
  await ffmpeg.deleteFile(inputName)
  await ffmpeg.deleteFile(outputName)
  const buffer =
    data instanceof Uint8Array
      ? data
      : typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data)
  const normalized = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Blob([normalized], { type: mime })
}

export const convertMedia = async (job) => {
  const { file, options } = job
  const fromExt = file.name.split('.').pop()?.toLowerCase() ?? ''
  const target = options.targetFormat.toLowerCase()
  const inputName = `input-${Date.now()}.${fromExt}`
  const outputName = `output-${Date.now()}.${target}`
  const mime = determineMime(target)

  let converted
  if (fromExt === 'mp4' && target === 'mp3') {
    converted = await runCommand(inputName, outputName, file, [
      '-vn',
      '-acodec',
      'libmp3lame',
      '-aq',
      options.bitrate ? `${Math.min(Math.max(Math.round(options.bitrate / 32), 1), 9)}` : '2',
    ], mime)
  } else if (fromExt === 'mp4' && target === 'gif') {
    converted = await runCommand(
      inputName,
      outputName,
      file,
      ['-vf', `fps=${options.frameRate ?? 12},scale=${options.width ?? 480}:-1:flags=lanczos`, '-loop', '0'],
      mime,
    )
  } else if (fromExt === 'mp4' && target === 'webm') {
    converted = await runCommand(
      inputName,
      outputName,
      file,
      ['-c:v', 'libvpx-vp9', '-b:v', `${options.bitrate ?? 1200}k`, '-c:a', 'libopus'],
      mime,
    )
  } else if (fromExt === 'mp3' && target === 'wav') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'pcm_s16le'], mime)
  } else if (fromExt === 'mp3' && target === 'ogg') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'libvorbis'], mime)
  } else if (target === 'mp3' && fromExt === 'webm') {
    converted = await runCommand(inputName, outputName, file, ['-vn', '-acodec', 'libmp3lame'], mime)
  } else {
    throw new Error('Conversão de mídia não suportada para esta combinação')
  }

  return {
    jobId: job.id,
    blob: converted,
    outputName: buildOutputName(file.name, target),
    details: `${fromExt.toUpperCase()} → ${target.toUpperCase()}`,
  }
}
