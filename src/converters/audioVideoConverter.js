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
    case 'mp4':
      return 'video/mp4'
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

const runCommand = async (inputName, outputName, file, args, mime, extraFiles = []) => {
  const ffmpeg = await loadFFmpeg()
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  for (const extra of extraFiles) {
    await ffmpeg.writeFile(extra.name, extra.data)
  }

  try {
    await ffmpeg.exec(['-i', inputName, ...args, outputName])
    const data = await ffmpeg.readFile(outputName)
    const buffer =
      data instanceof Uint8Array
        ? data
        : typeof data === 'string'
          ? new TextEncoder().encode(data)
          : new Uint8Array(data)
    const normalized = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    return new Blob([normalized], { type: mime })
  } finally {
    await Promise.allSettled([
      ffmpeg.deleteFile(inputName),
      ffmpeg.deleteFile(outputName),
      ...extraFiles.map((f) => ffmpeg.deleteFile(f.name)),
    ])
  }
}

const runCommandWithFallbacks = async (inputName, outputName, file, variants, mime, extraFiles = []) => {
  let lastError = null
  for (const args of variants) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await runCommand(inputName, outputName, file, args, mime, extraFiles)
    } catch (error) {
      lastError = error
    }
  }
  const message = lastError && lastError.message ? lastError.message : 'Falha ao converter mídia'
  throw new Error(message)
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
    converted = await runCommand(
      inputName,
      outputName,
      file,
      ['-vn', '-acodec', 'libmp3lame', '-aq', options.bitrate ? `${Math.min(Math.max(Math.round(options.bitrate / 32), 1), 9)}` : '2'],
      mime,
    )
  } else if (fromExt === 'mp4' && target === 'wav') {
    converted = await runCommand(inputName, outputName, file, ['-vn', '-acodec', 'pcm_s16le'], mime)
  } else if (fromExt === 'mp4' && target === 'ogg') {
    converted = await runCommandWithFallbacks(
      inputName,
      outputName,
      file,
      [
        ['-vn', '-c:a', 'libopus', '-b:a', `${options.bitrate ?? 128}k`],
        ['-vn', '-c:a', 'libvorbis', '-q:a', '4'],
      ],
      mime,
    )
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
  } else if (fromExt === 'webm' && target === 'mp4') {
    converted = await runCommandWithFallbacks(
      inputName,
      outputName,
      file,
      [
        ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'],
        ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-movflags', '+faststart'],
        ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'],
      ],
      mime,
    )
  } else if (fromExt === 'mp3' && target === 'wav') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'pcm_s16le'], mime)
  } else if (fromExt === 'mp3' && target === 'ogg') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'libvorbis'], mime)
  } else if (fromExt === 'wav' && target === 'mp3') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'libmp3lame', '-aq', '2'], mime)
  } else if (fromExt === 'wav' && target === 'ogg') {
    converted = await runCommandWithFallbacks(
      inputName,
      outputName,
      file,
      [
        ['-acodec', 'libopus', '-b:a', `${options.bitrate ?? 128}k`],
        ['-acodec', 'libvorbis', '-q:a', '4'],
      ],
      mime,
    )
  } else if (fromExt === 'ogg' && target === 'mp3') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'libmp3lame', '-aq', '2'], mime)
  } else if (fromExt === 'ogg' && target === 'wav') {
    converted = await runCommand(inputName, outputName, file, ['-acodec', 'pcm_s16le'], mime)
  } else if (target === 'mp3' && fromExt === 'webm') {
    converted = await runCommand(inputName, outputName, file, ['-vn', '-acodec', 'libmp3lame'], mime)
  } else if ((fromExt === 'mp3' || fromExt === 'wav' || fromExt === 'ogg') && target === 'mp4') {
    // Áudio -> MP4: cria vídeo estático (duração acompanha o áudio com -shortest)
    const variants = [
      [
        '-f',
        'lavfi',
        '-i',
        'color=c=0x1d1d1d:s=1280x720:r=30',
        '-i',
        inputName,
        '-shortest',
        '-c:v',
        'libx264',
        '-tune',
        'stillimage',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        `${options.bitrate ?? 192}k`,
        '-movflags',
        '+faststart',
      ],
      [
        '-f',
        'lavfi',
        '-i',
        'color=c=0x1d1d1d:s=1280x720:r=30',
        '-i',
        inputName,
        '-shortest',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        '-c:a',
        'aac',
      ],
      [
        '-f',
        'lavfi',
        '-i',
        'color=c=0x1d1d1d:s=1280x720:r=30',
        '-i',
        inputName,
        '-shortest',
        '-c:v',
        'mpeg4',
        '-q:v',
        '5',
        '-c:a',
        'libmp3lame',
      ],
    ]

    try {
      converted = await runCommandWithFallbacks(inputName, outputName, file, variants, mime)
    } catch (error) {
      // Fallback sem lavfi: gera cover.png e usa como vídeo
      if (typeof document === 'undefined') throw error
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#1D1D1D'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      const coverBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar capa'))), 'image/png')
      })
      const coverData = await fetchFile(coverBlob)

      const altVariants = [
        [
          '-loop',
          '1',
          '-i',
          'cover.png',
          '-i',
          inputName,
          '-shortest',
          '-c:v',
          'libx264',
          '-tune',
          'stillimage',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          `${options.bitrate ?? 192}k`,
          '-movflags',
          '+faststart',
        ],
        ['-loop', '1', '-i', 'cover.png', '-i', inputName, '-shortest', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac'],
        ['-loop', '1', '-i', 'cover.png', '-i', inputName, '-shortest', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'],
      ]

      converted = await runCommandWithFallbacks(inputName, outputName, file, altVariants, mime, [{ name: 'cover.png', data: coverData }])
    }
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
