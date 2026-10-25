/**
 * @file Icon
 * @description Inline stroke icons. They inherit currentColor so a single set
 * works in every theme, and inline SVG keeps an icon from becoming a network
 * request or a font dependency.
 */

export const ICON_NAMES = [
  'library',
  'document',
  'settings',
  'plus',
  'search',
  'trash',
  'check',
  'chevron-down',
  'chevron-right',
  'sun',
  'moon',
  'monitor',
  'undo',
  'redo',
  'freeze',
  'copy',
  'close',
  'alert',
  'info',
  'sparkle',
  'layout',
  'edit',
  'export',
] as const

export type IconName = (typeof ICON_NAMES)[number]

const PATHS: Readonly<Record<IconName, string>> = {
  library: 'M4 5h16v14H4zM4 9h16M9 9v10',
  document: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 005 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9.5a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  check: 'M4 12l5 5L20 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  undo: 'M4 9h11a5 5 0 010 10h-5M4 9l4-4M4 9l4 4',
  redo: 'M20 9H9a5 5 0 000 10h5M20 9l-4-4M20 9l-4 4',
  freeze: 'M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M12 7l-2.5-2.5M12 7l2.5-2.5M12 17l-2.5 2.5M12 17l2.5 2.5',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  close: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3l9 17H3zM12 9v5M12 17.5v.5',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5v.5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  layout: 'M3 4h18v16H3zM3 10h18M9 10v10',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  export: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5',
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
