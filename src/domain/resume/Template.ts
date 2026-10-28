/**
 * @file Template
 * @description The declarative definition of one built-in resume template and
 * the registry the application reads it from. A template is pure data: type
 * tokens, header treatment, spacing and the appearance/page defaults a resume
 * starts with. It never holds content, and it never lays anything out — the
 * materializer flattens it into styled paragraphs and the layout engine works
 * from coordinates alone.
 *
 * Responsibilities:
 * - Declare the template value and its token set
 * - Validate the registry the interface and the use cases look templates up in
 * - Provide the lookup used by `materializeDocument` and by the composition
 *   service that lists templates
 *
 * Constraints:
 * - `fontFamily` must be a family the bundled font registry carries; only the
 *   bundled family is available today.
 * - Templates live in the domain because the application materializer must
 *   import them and application may not import infrastructure (spec section 2.1).
 * - Pure data: no DOM, no storage, no package.
 */

import type { InfoModuleKind } from '../info/InfoModuleKind'
import type { TemplateId } from '../shared/branded-id'
import { asTemplateId } from '../shared/branded-id'
import type { PageSetup } from './PageSetup'
import type { AppearanceSettings } from './AppearanceSettings'
import { TEMPLATE_DEFINITIONS } from './templates'

/** One text role's base style; appearance scales the size and sets line height. */
export interface TextStyleToken {
  /** Must be a family `BundledFontRegistry` carries. */
  readonly fontFamily: string
  /** Base size in points; `appearance.fontScale` multiplies it. */
  readonly fontSize: number
  readonly fontWeight: 400 | 700
  /** Multiple of the font size. */
  readonly lineHeight: number
}

/** The style and spacing decisions a template makes, without any content. */
export interface TemplateTokens {
  readonly name: TextStyleToken
  readonly contact: TextStyleToken
  readonly sectionHeader: TextStyleToken
  readonly entryHeading: TextStyleToken
  readonly entryMeta: TextStyleToken
  readonly entryBody: TextStyleToken
  readonly freeText: TextStyleToken
  readonly headerLayout: 'centered' | 'left' | 'split'
  readonly ruleAfterHeader: boolean
  /** Space before a section, in points. */
  readonly sectionSpacing: number
  /** Space before an entry, in points. */
  readonly entrySpacing: number
  /** Space before a paragraph inside an entry, in points. */
  readonly paragraphSpacing: number
  /** Bullet indent carried to the renderers for a bulleted paragraph, in points. */
  readonly bulletIndent: number
  /** Width share of the first column when the template renders two columns. */
  readonly columnRatio: number
  /** True when the first column is a sidebar that is filled before the body. */
  readonly sidebarMode: boolean
  /** Horizontal gap between the two columns, in points. */
  readonly columnGutter: number
}

export interface TemplateDefinition {
  readonly id: TemplateId
  readonly name: string
  readonly description: string
  readonly supports: { readonly columns: readonly (1 | 2)[] }
  /** Order the sections of a new resume start in. */
  readonly defaultSectionOrder: readonly InfoModuleKind[]
  readonly tokens: TemplateTokens
  readonly defaults: {
    readonly appearance: AppearanceSettings
    readonly pageSetup: PageSetup
  }
}

/** Identifier of the template a resume falls back to when its own is unknown. */
export const DEFAULT_TEMPLATE_ID: TemplateId = asTemplateId('classic-single')

/**
 * Modules a sidebar template draws in its first column. The mapping is part of
 * the template's meaning, so it lives here rather than in the materializer; the
 * layout engine still receives column numbers only.
 */
export const SIDEBAR_MODULE_KINDS: ReadonlySet<InfoModuleKind> = new Set([
  'personal',
  'skill',
  'award',
  'jobIntent',
])

/** Registry order is the order the template gallery lists. */
export const TEMPLATE_REGISTRY: ReadonlyMap<TemplateId, TemplateDefinition> = new Map(
  TEMPLATE_DEFINITIONS.map((template) => [template.id, template]),
)

export function listTemplates(): readonly TemplateDefinition[] {
  return TEMPLATE_DEFINITIONS
}

/** Resolves a template identifier, or null when this build does not carry it. */
export function getTemplate(id: TemplateId): TemplateDefinition | null {
  return TEMPLATE_REGISTRY.get(id) ?? null
}

/**
 * The template a document is rendered with: its own when the registry carries
 * it, the default template otherwise. Rendering always succeeds; the missing
 * template is reported as a missing reference instead of failing the canvas.
 */
export function resolveTemplate(id: TemplateId): TemplateDefinition {
  const template = getTemplate(id)
  if (template !== null) return template
  const fallback = getTemplate(DEFAULT_TEMPLATE_ID)
  if (fallback === null) {
    throw new Error('The default template is not registered; the build is inconsistent.')
  }
  return fallback
}
