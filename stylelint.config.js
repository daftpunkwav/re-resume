/**
 * The CSS baseline is checked separately from JavaScript: eslint-plugin-compat
 * does not inspect CSS, so without this config "no post-Safari-15 CSS" would be
 * an unenforced promise.
 */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
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
