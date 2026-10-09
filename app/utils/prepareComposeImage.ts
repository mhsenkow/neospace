/**
 * Client-side image prep before Mastodon media upload.
 * Shrinks phone photos so uploads stay fast and kind to instance storage.
 */

export type MediaUploadQuality = 'efficient' | 'balanced' | 'original'

export type PrepareComposeImageResult = {
  file: File
  didOptimize: boolean
  originalBytes: number
  outputBytes: number
}

type QualityPreset = {
  maxDim: number
  /** Re-encode when file is still this large even if under maxDim */
  recompressBytes: number
  quality: number
}

const PRESETS: Record<MediaUploadQuality, QualityPreset> = {
  efficient: { maxDim: 1600, recompressBytes: 900_000, quality: 0.75 },
  balanced: { maxDim: 2048, recompressBytes: 1_500_000, quality: 0.82 },
  /** Only clamp extreme dimensions — keep bytes when already under 4096 */
  original: { maxDim: 4096, recompressBytes: Number.POSITIVE_INFINITY, quality: 0.92 },
}

export function normalizeMediaUploadQuality(raw: unknown): MediaUploadQuality {
  if (raw === 'efficient' || raw === 'balanced' || raw === 'original') return raw
  return 'balanced'
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function supportsWebp(): boolean {
  if (typeof document === 'undefined') return false
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

async function pngHasAlpha(bitmap: ImageBitmap): Promise<boolean> {
  const sample = Math.min(64, bitmap.width, bitmap.height)
  if (sample < 2) return true
  const canvas = document.createElement('canvas')
  canvas.width = sample
  canvas.height = sample
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return true
  ctx.drawImage(bitmap, 0, 0, sample, sample)
  try {
    const { data } = ctx.getImageData(0, 0, sample, sample)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! < 250) return true
    }
    return false
  } catch {
    return true
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })
}

/**
 * Downscale / recompress a still image per quality preset.
 * GIF and non-images are returned unchanged.
 */
export async function prepareComposeImage(
  file: File,
  quality: MediaUploadQuality = 'balanced',
): Promise<PrepareComposeImageResult> {
  const originalBytes = file.size
  const passthrough = (): PrepareComposeImageResult => ({
    file,
    didOptimize: false,
    originalBytes,
    outputBytes: file.size,
  })

  if (!file.type.startsWith('image/') || file.type === 'image/gif') return passthrough()
  if (typeof createImageBitmap === 'undefined') return passthrough()

  const preset = PRESETS[normalizeMediaUploadQuality(quality)]

  try {
    const bitmap = await createImageBitmap(file)
    const needsScale =
      bitmap.width > preset.maxDim || bitmap.height > preset.maxDim
    const needsRecompress = file.size > preset.recompressBytes
    const keepPngAlpha =
      file.type === 'image/png' && (await pngHasAlpha(bitmap))

    if (!needsScale && !needsRecompress) {
      bitmap.close()
      return passthrough()
    }

    // Original + under 4096: never recompress for bytes alone
    if (quality === 'original' && !needsScale) {
      bitmap.close()
      return passthrough()
    }

    const scale = needsScale
      ? preset.maxDim / Math.max(bitmap.width, bitmap.height)
      : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return passthrough()
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    let outType: string
    let outQuality: number | undefined
    let ext: string

    if (keepPngAlpha) {
      outType = 'image/png'
      outQuality = undefined
      ext = '.png'
    } else if (supportsWebp()) {
      outType = 'image/webp'
      outQuality = preset.quality
      ext = '.webp'
    } else {
      outType = 'image/jpeg'
      outQuality = preset.quality
      ext = '.jpg'
    }

    const blob = await toBlob(canvas, outType, outQuality)
    if (!blob || blob.size >= originalBytes) {
      // Encoding didn’t help — keep the original bytes
      return passthrough()
    }

    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    const next = new File([blob], `${base}${ext}`, { type: outType })
    return {
      file: next,
      didOptimize: true,
      originalBytes,
      outputBytes: next.size,
    }
  } catch {
    return passthrough()
  }
}
