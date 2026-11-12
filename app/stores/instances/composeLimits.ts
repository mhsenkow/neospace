/**
 * Compose-side limits derived from a connected instance's cached configuration.
 */

import type { ConnectedInstanceInfo } from '~/utils/instanceInfo'
import {
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_FILE_BYTES,
  MEDIA_ALT_MAX,
} from '~/utils/composeConstants'

/** Media attachment limits from an instance configuration (defaults when unknown). */
export function composeMediaLimitsFrom(info: ConnectedInstanceInfo | null | undefined): {
  maxAttachments: number
  maxFileBytes: number
  altMax: number
} {
  const maxAttachments =
    typeof info?.maxMediaAttachments === 'number' &&
    info.maxMediaAttachments >= 1 &&
    info.maxMediaAttachments <= 20
      ? info.maxMediaAttachments
      : DEFAULT_MAX_ATTACHMENTS
  const imageLimit =
    typeof info?.imageSizeLimit === 'number' && info.imageSizeLimit > 0
      ? info.imageSizeLimit
      : DEFAULT_MAX_FILE_BYTES
  const videoLimit =
    typeof info?.videoSizeLimit === 'number' && info.videoSizeLimit > 0
      ? info.videoSizeLimit
      : imageLimit
  const maxFileBytes = Math.max(imageLimit, videoLimit)
  const altMax =
    typeof info?.mediaDescriptionLimit === 'number' &&
    info.mediaDescriptionLimit >= 100
      ? info.mediaDescriptionLimit
      : MEDIA_ALT_MAX
  return { maxAttachments, maxFileBytes, altMax }
}
