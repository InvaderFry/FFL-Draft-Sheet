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
}
