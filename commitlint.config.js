// Commitlint config — alineada con ADR-0001 y convención establecida por
// Julio en los PRs previos (fix, feat, docs, chore, refactor, test, sync,
// release).
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'fix',
        'feat',
        'docs',
        'chore',
        'refactor',
        'test',
        'perf',
        'style',
        'build',
        'ci',
        'revert',
        'sync',
        'release',
      ],
    ],
    'subject-max-length': [2, 'always', 100],
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
