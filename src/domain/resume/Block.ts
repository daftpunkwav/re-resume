/**
 * @file Block
 * @description One unit of resume content. BlockContent is made entirely of
 * references and text — never a coordinate — so a block can be moved to any
 * layout without rewriting its meaning.
 */

import type { ProfileFields } from '../catalog/Profile'
import type {
  AssetId,
  BlockId,
  ClaimId,
  ExperienceId,
  VariantId,
} from '../shared/branded-id'
import type { BlockLayout } from './Layout'
import type { TextStyle } from './TextStyle'

export interface Block {
  readonly id: BlockId
  readonly content: BlockContent
  readonly layout: BlockLayout
  /**
   * Text style; named textStyle because it governs text only — graphics and
   * dividers have no style source in v1. Null = not customized; layout falls
   * back to DEFAULT_TEXT_STYLE.
   */
  readonly textStyle: TextStyle | null
}

export type BlockContent =
  | TextContent
  | ProfileContent
  | ExperienceContent
  | DividerContent
  | GraphicContent

export interface TextContent {
  readonly type: 'text'
  readonly text: string
}

/**
 * Renders the user's profile. Values are COPIED inline at insertion time and
 * never live-read: Profile is a global singleton, and a live reference would
 * silently change every resume on a profile edit.
 */
export interface ProfileContent extends ProfileFields {
  readonly type: 'profile'
  /** Profile.version when copied. A larger current version only means
   *  "offer a sync" — it never propagates automatically. */
  readonly refVersion: number
}

export interface ExperienceContent {
  readonly type: 'experience'
  readonly experienceId: ExperienceId
  readonly variantId: VariantId
  /** Experience.factVersion at creation or last sync; the basis for stale detection. */
  readonly refVersion: number
  /** Claims referenced by this block, used for provenance display and export gating. */
  readonly claimIds: readonly ClaimId[]
}

export interface DividerContent {
  readonly type: 'divider'
}

export interface GraphicContent {
  readonly type: 'graphic'
  readonly assetId: AssetId
}

export function isTextContent(content: BlockContent): content is TextContent {
  return content.type === 'text'
}

export function isProfileContent(content: BlockContent): content is ProfileContent {
  return content.type === 'profile'
}

export function isExperienceContent(
  content: BlockContent,
): content is ExperienceContent {
  return content.type === 'experience'
}

/** True for the block types a resume must carry before it can be frozen. */
export function isSubstantiveContent(content: BlockContent): boolean {
  return content.type === 'text' || content.type === 'profile' || content.type === 'experience'
}
