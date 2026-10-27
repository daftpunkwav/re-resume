/**
 * @file Icon
 * @description Inline stroke icons. They inherit currentColor so a single set
 * works in every theme, and inline SVG keeps an icon from becoming a network
 * request or a font dependency.
 *
 * Constraints:
 * - Decorative by default: the glyph is hidden from assistive technology and
 *   the control that owns it carries the accessible name.
 * - Every path is drawn on a 24-unit grid with a 1.8 stroke, so icons look like
 *   one family at any size.
 */

export const ICON_NAMES = [
  'plus',
  'close',
  'check',
  'alert',
  'info',
  'settings',
  'chevron-down',
  'chevrons-left',
  'panel-left',
  'id-card',
  'pen',
  'message-square',
  'keyboard',
  'palette',
  'plug',
  'database',
  'sun',
  'moon',
  'monitor',
] as const

export type IconName = (typeof ICON_NAMES)[number]

const PATHS: Readonly<Record<IconName, string>> = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 3l9 17H3zM12 9v5M12 17.5v.5',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 005 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9.5a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevrons-left': 'M11 6l-6 6 6 6M19 6l-6 6 6 6',
  'panel-left': 'M3 4h18v16H3zM9 4v16',
  'id-card': 'M3 5h18v14H3zM7 10h4M7 14h4M14 10h3M14 14h3',
  pen: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  'message-square': 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  keyboard:
    'M3 6h18v12H3zM6 9.5h.5M9.5 9.5h.5M13 9.5h.5M16.5 9.5h1M6 12.5h.5M9.5 12.5h.5M13 12.5h.5M16.5 12.5h1M8 15.5h8',
  palette:
    'M12 3a9 9 0 100 18h1.5a2 2 0 001.2-3.6 1.8 1.8 0 011.2-3.2H18A3 3 0 0021 11a8 8 0 00-9-8zM7.5 11v.5M10 8v.5M14.5 8v.5',
  plug: 'M9 3v6M15 3v6M7 9h10v3a5 5 0 01-10 0zM12 17v4',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
}

export interface IconProps {
  readonly name: IconName
  readonly size?: number
}

export function Icon({ name, size = 16 }: IconProps) {
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
