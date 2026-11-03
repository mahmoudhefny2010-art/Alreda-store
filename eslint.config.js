const js = require('@eslint/js');
const globals = require('globals');
module.exports = [
  { ignores: ['node_modules/**', '.npm-cache/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node } },
  { files: ['src/public/js/**/*.js', 'tests/e2e/**/*.js'], languageOptions: { sourceType: 'script', globals: globals.browser } },
  { files: ['tests/**/*.test.js'], languageOptions: { globals: { afterAll: 'readonly', beforeAll: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly' } } },
];

