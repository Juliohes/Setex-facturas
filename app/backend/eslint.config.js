// ESLint flat config — Node 20 + Express
// Reglas alineadas con refactor modular v3 (ADR-0004).
//
// Arquitectura por capas: enforced por tests/architecture.test.js (linter Node
// puro, sin dependencias rotas). El plugin eslint-plugin-boundaries fue
// descartado en Round 6 por incompatibilidad con ESLint 10 flat config.

module.exports = [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'off',
      'no-throw-literal': 'error',
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'indent': 'off',
      'linebreak-style': 'off',
      'comma-dangle': 'off',
    },
  },
  // Exención para src/server.legacy.js — el monolito de 4308 líneas conservado
  // post-swap v2.0.0-rc1 (2026-04-22) para rollback rápido. Se elimina cuando
  // estemos cómodos (ROADMAP Q3). El nuevo src/server.js tiene <60 líneas y ya
  // no necesita exención.
  {
    files: ['src/server.legacy.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
];
