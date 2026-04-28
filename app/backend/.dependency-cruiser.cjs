// Configuración de dependency-cruiser para el refactor modular v3.
// Durante rounds 6-14 las reglas se ejecutan como warn; en Round 15 se elevan a error
// junto con la activación del pre-commit hook.
//
// Ejecutar:
//   npx depcruise -v .dependency-cruiser.cjs src
//   npx depcruise --output-type dot src | dot -T svg > docs/dependency-graph.svg

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Dependencias circulares degradan testability y deploy.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'info',
      comment: 'Ficheros sin consumer pueden ser código muerto (aceptable durante refactor).',
      from: {
        orphan: true,
        pathNot: [
          'server\\.js$',
          'app\\.js$',
          'container\\.js$',
          '\\.(config|test|spec)\\.js$',
          'bootstrap/',
          '__mocks__',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-server',
      severity: 'error',
      comment: 'Nadie debe importar src/server.js — es el monolito legacy que Round 15 elimina.',
      from: { pathNot: ['server\\.js$'] },
      to: { path: 'server\\.js$' },
    },
    {
      name: 'not-to-spec',
      severity: 'error',
      comment: 'El código de producción no debe depender de tests.',
      from: { pathNot: ['\\.(test|spec)\\.js$', 'tests/'] },
      to: { path: '\\.(test|spec)\\.js$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Código de producción no debe importar devDependencies.',
      from: { path: '^src', pathNot: ['\\.(test|spec)\\.js$', 'tests/'] },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^src',
    tsPreCompilationDeps: false,
    progress: { type: 'none' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
