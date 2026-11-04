const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');

module.exports = defineConfig({
  ...base,
  workers: 2,
  outputDir: 'test-results/qa-audit/browser',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/qa-audit/e2e-results.json' }],
    ['html', { outputFolder: 'test-results/qa-audit/html', open: 'never' }],
  ],
  use: { ...base.use, video: 'on', trace: 'retain-on-failure', screenshot: 'on' },
});
