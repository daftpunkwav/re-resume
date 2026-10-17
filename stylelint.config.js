/**
 * The CSS baseline is checked separately from JavaScript: eslint-plugin-compat
 * does not inspect CSS, so without this config "no post-Safari-15 CSS" would be
 * an unenforced promise.
 */
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-no-unsupported-browser-features'],
  rules: {
    /**
     * Feature support is judged against the shared browserslist targets in
     * package.json (safari >= 15, chrome >= 118) — the same source
     * eslint-plugin-compat reads. The bundler states the Safari 15 baseline
     * separately, as build.target in vite.config.ts.
     */
    'plugin/no-unsupported-browser-features': [true, { ignorePartialSupport: true }],
    /**
     * The modern range syntax `(width <= 900px)` is what the rule asks for, and
     * it needs Safari 16.4. The WebView baseline is Safari 15, so the legacy
     * `(max-width: 900px)` form is the correct one here, not a lapse.
     */
    'media-feature-range-notation': null,
    'custom-property-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
      { message: 'custom properties are kebab-case, e.g. --surface-raised' },
    ],
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
      { message: 'class names are kebab-case' },
    ],
  },
}
