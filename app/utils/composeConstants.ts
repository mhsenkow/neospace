/** Shared compose / media attachment limits (defaults when instance config is unknown). */

/** Mastodon media description soft limit (common default). */
export const MEDIA_ALT_MAX = 1500

export const DEFAULT_MAX_ATTACHMENTS = 4
export const DEFAULT_MAX_FILE_BYTES = 40 * 1024 * 1024
export const DEFAULT_UPLOAD_TIMEOUT_MS = 25_000
export const MAX_UPLOAD_TIMEOUT_MS = 120_000
export const UPLOAD_TIMEOUT_MS_PER_MB = 5_000

export const COMPOSE_IMAGE_ACCEPT =
  /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/i

export const COMPOSE_MEDIA_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime'

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
