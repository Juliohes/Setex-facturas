// ESLint flat config — Node 20 + Express
// Reglas profesionales alineadas con Strangler-Fig roadmap.
// max-lines: 500 obliga a partir módulos grandes (server.js actual exento durante refactor).

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
      // --- Calidad ---
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off', // Permitido: logging inicial antes de tener winston up
      'prefer-const': 'error',
      'no-var': 'error',

      // --- Tamaño (Strangler-Fig) ---
      // server.js está en proceso de refactor; se le da exención temporal.
      // El resto de archivos: máximo 500 líneas, funciones 80 líneas.
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],

      // --- Seguridad / buenas prácticas ---
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'off', // Permite claridad en algunos casos
      'no-throw-literal': 'error',

      // --- Estilo (alineado con Prettier) ---
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'indent': 'off', // Prettier se encarga
      'linebreak-style': 'off',
      'comma-dangle': 'off',
    },
  },
  // Exención temporal para server.js durante el refactor Strangler-Fig.
  // Al completar los 22 pasos, eliminar esta exención.
  {
    files: ['src/server.js'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
];
