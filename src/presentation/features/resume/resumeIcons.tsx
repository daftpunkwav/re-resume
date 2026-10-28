/**
 * @file resumeIcons
 * @description The few glyphs the resume studio needs beyond the shared icon
 * set. They are private to the feature so the shared set stays a stable
 * vocabulary rather than growing for one panel's verbs.
 */

const PATHS = {
  undo: 'M9 7L4 12l5 5M4 12h9a5 5 0 010 10h-1',
  redo: 'M15 7l5 5-5 5M20 12h-9a5 5 0 000 10h1',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 6.2A9.8 9.8 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.7M6.2 7.4A17 17 0 002 12s4 6 10 6a9.8 9.8 0 004.1-.9M9.9 9.9a3 3 0 004.2 4.2',
  grip: 'M9 6h.5M9 12h.5M9 18h.5M15 6h.5M15 12h.5M15 18h.5',
  lock: 'M6 11h12v9H6zM9 11V7a3 3 0 016 0v4',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z',
  save: 'M5 4h11l4 4v12H5zM8 4v6h8V4M8 20v-6h8v6',
  chevron: 'M9 6l6 6-6 6',
} as const

export type ResumeIconName = keyof typeof PATHS

export function ResumeIcon({
  name,
  size = 14,
}: {
  readonly name: ResumeIconName
  readonly size?: number
}) {
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
