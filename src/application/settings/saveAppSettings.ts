/**
 * @file saveAppSettings
 * @description Applies a partial preference change and stores the result.
 *
 * Responsibilities:
 * - Merge the patch onto the stored value
 * - Clamp numeric ranges and round the interface scale to its step
 * - Reject an enumeration value this build does not know
 *
 * Constraints:
 * - Out-of-range numbers are clamped, not rejected: a slider that reaches the
 *   end must stay a working control. Enumeration values are rejected because
 *   there is no closest legal value to converge on.
 */

import { DomainError } from '../../domain/shared/DomainError'
import {
  clampCanvasZoom,
  clampPanelWidth,
  clampUiScale,
  DEFAULT_APP_SETTINGS,
  isColorSchemePreference,
  isDensity,
  isMotionPreference,
  isPanelMode,
  isThemeId,
} from '../../domain/settings/AppSettings'
import type { AppSettings, PanelPreferences } from '../../domain/settings/AppSettings'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'

export interface SaveAppSettingsDeps {
  readonly settings: AppSettingsRepository
}

function invalidSettings(detail: string): DomainError {
  return new DomainError('invalidSettings', `拒绝保存设置：${detail}`, {
    entity: 'appSettings',
    id: 'default',
    blockers: [],
  })
}

function rejectUnknownEnum(field: string): never {
  throw invalidSettings(`${field} 不是本版本认识的取值。`)
}

function validateThemeId(value: unknown): AppSettings['themeId'] {
  if (!isThemeId(value)) rejectUnknownEnum('themeId')
  return value
}

function validateColorScheme(value: unknown): AppSettings['colorScheme'] {
  if (!isColorSchemePreference(value)) rejectUnknownEnum('colorScheme')
  return value
}

function validateDensity(value: unknown): AppSettings['density'] {
  if (!isDensity(value)) rejectUnknownEnum('density')
  return value
}

function validateMotion(value: unknown): AppSettings['motion'] {
  if (!isMotionPreference(value)) rejectUnknownEnum('motion')
  return value
}

function validatePanels(patch: AppSettings['panels']): PanelPreferences {
  if (!isPanelMode(patch.right)) rejectUnknownEnum('panels.right')
  return {
    right: patch.right,
    rightWidth: clampPanelWidth(patch.rightWidth),
    collapsed: patch.collapsed,
  }
}

/**
 * Builds the stored value from the current one and a patch. The panel block is
 * replaced as a whole: a partial panel patch would leave the other fields to be
 * guessed, and the panel layout is one preference, not three.
 */
function mergeSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = {
    themeId: patch.themeId === undefined ? current.themeId : validateThemeId(patch.themeId),
    colorScheme:
      patch.colorScheme === undefined
        ? current.colorScheme
        : validateColorScheme(patch.colorScheme),
    density: patch.density === undefined ? current.density : validateDensity(patch.density),
    motion: patch.motion === undefined ? current.motion : validateMotion(patch.motion),
    uiScale: patch.uiScale === undefined ? current.uiScale : clampUiScale(patch.uiScale),
    canvasZoom:
      patch.canvasZoom === undefined ? current.canvasZoom : clampCanvasZoom(patch.canvasZoom),
    panels:
      patch.panels === undefined ? current.panels : validatePanels(patch.panels),
    sampleDataSeeded:
      patch.sampleDataSeeded === undefined
        ? current.sampleDataSeeded
        : patch.sampleDataSeeded,
    lastConversationId:
      patch.lastConversationId === undefined
        ? current.lastConversationId
        : patch.lastConversationId,
    activeProviderId:
      patch.activeProviderId === undefined
        ? current.activeProviderId
        : patch.activeProviderId,
  }
  return next
}

export async function saveAppSettings(
  deps: SaveAppSettingsDeps,
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = (await deps.settings.read()) ?? DEFAULT_APP_SETTINGS
  const next = mergeSettings(current, patch)
  await deps.settings.write(next)
  return next
}
