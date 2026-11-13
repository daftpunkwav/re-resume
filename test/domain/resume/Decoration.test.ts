/**
 * @file Decoration.test
 * @description The appearance-to-decoration mapping both renderers share: the
 * accent resolves to its hex, the minimal template ignores the accent, and the
 * heading style passes through.
 */

import { describe, expect, it } from 'vitest'

import { DECORATION_INK, decorationColor, resolveDecoration } from '../../../src/domain/resume/Decoration'
import { listTemplates, resolveTemplate } from '../../../src/domain/resume/Template'
import { asTemplateId } from '../../../src/domain/shared/branded-id'
import { appearanceFor } from '../../../src/domain/resume/templates/tokens'

const APPEARANCE = appearanceFor('blue', 'accentBar', 12)

describe('resolveDecoration', () => {
  it('maps the accent colour to its hex and carries the heading style', () => {
    const decoration = resolveDecoration(APPEARANCE, resolveTemplate(asTemplateId('classicSingle')))

    expect(decoration).toEqual({ accent: '#2563eb', headingStyle: 'accentBar' })
  })

  it('leaves the accent unset for the template that ignores it', () => {
    const minimal = listTemplates().find((template) => template.id === 'minimal')
    expect(minimal).toBeDefined()
    if (minimal === undefined) return

    const decoration = resolveDecoration(APPEARANCE, minimal)

    expect(decoration.accent).toBeNull()
    expect(decoration.headingStyle).toBe('accentBar')
  })

  it('maps every accent token to a hex colour', () => {
    for (const accentColor of ['ink', 'blue', 'teal', 'green', 'amber', 'rose'] as const) {
      const decoration = resolveDecoration(
        { ...APPEARANCE, accentColor },
        resolveTemplate(asTemplateId('classicSingle')),
      )
      expect(decoration.accent).toMatch(/^#[0-9a-f]{6}$/u)
    }
  })
})

describe('decorationColor', () => {
  it('falls back to ink when the accent is absent', () => {
    expect(decorationColor(null)).toBe(DECORATION_INK)
    expect(decorationColor('#2563eb')).toBe('#2563eb')
  })
})
