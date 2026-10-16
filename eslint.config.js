import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import compat from 'eslint-plugin-compat'

/**
 * Lint boundaries mirror the layering rules. Domain code is checked against
 * third-party imports separately by the dependency direction test; here the
 * rules only keep the language level uniform and the React rules honest.
 */
export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      compat,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      // The baseline is Safari 15 (see package.json browserslist). Anything
      // newer fails here rather than at runtime on an older WebView.
      'compat/compat': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'compat/compat': 'off' },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'compat/compat': 'off' },
  },
)
