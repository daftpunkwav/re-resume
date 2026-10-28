/**
 * @file icons
 * @description The stroke icons the conversation surface needs beyond the
 * shared set. They live in the feature because the design system owns one icon
 * family and a feature may add the glyphs its own controls need.
 *
 * Constraints:
 * - Decorative by default: the control that owns the glyph carries the label.
 * - Same 24-unit grid and stroke as the shared icons, so the two families read
 *   as one.
 */

export const FEATURE_ICON_NAMES = [
  'send',
  'stop',
  'copy',
  'trash',
  'pin',
  'pin-off',
  'pencil',
  'refresh',
  'wrench',
  'check-circle',
  'alert-circle',
  'chevron-right',
  'chevron-down',
  'undo',
  'link',
  'clipboard',
  'sparkles',
  'quote',
  'clock',
  'plug',
] as const

export type FeatureIconName = (typeof FEATURE_ICON_NAMES)[number]

const PATHS: Readonly<Record<FeatureIconName, string>> = {
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  pin: 'M9 4h6l-1 6 4 3H6l4-3zM12 13v7',
  'pin-off': 'M9 4h6l-1 6 4 3H6l4-3zM12 13v7M4 4l16 16',
  pencil: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  refresh: 'M20 11a8 8 0 10-2 6M20 5v6h-6',
  wrench: 'M14 6a4 4 0 105 5l-9 9-3-3zM6 21l-3-3',
  'check-circle': 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6',
  'alert-circle': 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v5M12 16.5v.5',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  undo: 'M9 7L4 12l5 5M4 12h9a6 6 0 016 6v1',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.3 1.3M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.3-1.3',
  clipboard: 'M9 5h6v3H9zM8 5H6v16h12V5h-2M9 12h6M9 16h4',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z',
  quote: 'M7 8H4v6h4l-2 5M17 8h-3v6h3l-2 5',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  plug: 'M9 3v6M15 3v6M7 9h10v3a5 5 0 01-10 0zM12 17v4',
}

export interface FeatureIconProps {
  readonly name: FeatureIconName
  readonly size?: number
}

export function FeatureIcon({ name, size = 16 }: FeatureIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
