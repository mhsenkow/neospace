/** Shared compose / media attachment limits (defaults when instance config is unknown). */

/** Mastodon media description soft limit (common default). */
export const MEDIA_ALT_MAX = 1500

export const DEFAULT_MAX_ATTACHMENTS = 4
export const DEFAULT_MAX_FILE_BYTES = 40 * 1024 * 1024
export const DEFAULT_UPLOAD_TIMEOUT_MS = 25_000
export const MAX_UPLOAD_TIMEOUT_MS = 20 * 60_000
/** Budget ~10s per MB (a 0.1MB/s floor) so slow mobile links finish big videos. */
export const UPLOAD_TIMEOUT_MS_PER_MB = 10_000

export const COMPOSE_IMAGE_ACCEPT =
  /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp3|ogg|opus|wav|x-wav|wave|vnd\.wave|flac|x-flac|aac|mp4|x-m4a|m4a|3gpp|webm))$/i

export const COMPOSE_MEDIA_ACCEPT = [
  'image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif',
  'video/mp4,video/webm,video/quicktime',
  'audio/mpeg,audio/ogg,audio/wav,audio/flac,audio/aac,audio/mp4,audio/x-m4a,audio/webm',
].join(',')

/** Image types every supported browser can render in an <img> thumbnail (HEIC/HEIF can't). */
export const COMPOSE_PREVIEWABLE_IMAGE = /^image\/(jpeg|png|gif|webp|avif)$/i

/** Emoji for the non-thumbnail attachment tile. */
export function composeAttachmentIcon(mime: string): string {
  if (/^audio\//i.test(mime)) return '🎵'
  if (/^image\//i.test(mime)) return '🖼️'
  return '🎬'
}

/** Hard ceiling used by the “original” upload preset (extreme phone/raw edges). */
export const COMPOSE_MAX_IMAGE_DIMENSION = 4096

export type { MediaUploadQuality } from '~/utils/prepareComposeImage'
export {
  formatByteSize,
  normalizeMediaUploadQuality,
  prepareComposeImage,
} from '~/utils/prepareComposeImage'

/** Scale upload timeout from file size (big videos need more than 25s). */
export function uploadTimeoutForBytes(
  bytes: number,
  baseMs = DEFAULT_UPLOAD_TIMEOUT_MS,
): number {
  const mb = Math.max(0, bytes) / (1024 * 1024)
  return Math.min(MAX_UPLOAD_TIMEOUT_MS, baseMs + Math.ceil(mb) * UPLOAD_TIMEOUT_MS_PER_MB)
}
