/* ESLint config for the Vite + React frontend. */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'node_modules', 'test-results', 'playwright-report'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    // Allow intentionally-empty catch blocks (e.g. localStorage guards).
    'no-empty': ['error', { allowEmptyCatch: true }],
    // This project intentionally does not use the prop-types package.
    'react/prop-types': 'off',
  },
  overrides: [
    {
      // TypeScript sources use the TS parser + plugin. Props are typed via
      // interfaces, so prop-types stays off; the base no-unused-vars is
      // replaced by the TS-aware version (which understands type-only usage).
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended'],
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
          },
        ],
      },
    },
  ],
}
