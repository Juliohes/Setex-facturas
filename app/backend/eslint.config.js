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
  // Exención de tamaño para src/server.legacy.js — el monolito 4308 líneas
  // preservado tras el swap a v3 (FASE 1B Etapa 6, 2026-04-28) por si hay que
  // hacer rollback rápido. Se eliminará en Q3 tras 30 días de v3 estable
  // en producción (ROADMAP Q3).
  {
    files: ['src/server.legacy.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
];
