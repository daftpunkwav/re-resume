# Bundled fonts

This directory ships verbatim into the build output (`public/` is copied to
`dist/`, which is the Tauri `frontendDist`), so the license travels with the
fonts in every distributed package. The font files themselves live in
`src/assets/fonts/` because they enter the bundle through Vite asset imports.

## Noto Sans SC

The default font face the application measures and draws with. The subset
variant ("SubsetOTF/SC") is the region-specific cut for Simplified Chinese
distributed by the Noto CJK project.

- Source: <https://github.com/notofonts/noto-cjk>, path `Sans/SubsetOTF/SC/`
- Pinned revision: `165c01b46ea533872e002e0785ff17e44f6d97d8` (last commit
  touching the font files, 2021-04-30)
- Files: `src/assets/fonts/NotoSansSC-Regular.otf` (weight 400),
  `src/assets/fonts/NotoSansSC-Bold.otf` (weight 700)
- License: SIL Open Font License 1.1, see [LICENSE](./LICENSE). Redistribution
  and bundling with this application are permitted under that license; the
  license file must ship with the fonts in the build output.

## Noto Sans Symbols 2

The fallback face: the characters the faces above do not cover are measured and
drawn with this family instead of with whatever the system substitutes for
them. The two faces are picked per run by what their character maps cover, so a
line that mixes Han text and a symbol is measured and drawn with one face each.

- Source: <https://github.com/notofonts/notofonts.github.io>, path
  `fonts/NotoSansSymbols2/unhinted/otf/`
- Pinned revision: `42af67ccd12bc0e31ed85384bf73e39248265374`
- File: `src/assets/fonts/NotoSansSymbols2-Regular.otf` (weight 400)
- License: SIL Open Font License 1.1, see [LICENSE](./LICENSE), the same terms
  as the faces above. The font ships with the application under that license
  and the license file travels with it in the build output.

The fallback has no bold face: a bold run that falls back to it is drawn with
this regular face, which is the face its advances were measured with.
