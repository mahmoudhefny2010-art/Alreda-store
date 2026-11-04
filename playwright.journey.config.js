const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e', testMatch: 'qa-journey.spec.js', workers: 1,
  timeout: 120000, expect: { timeout: 15000 },
  outputDir: 'test-results/qa-audit/journey/browser',
  reporter: [['list'], ['json', { outputFile: 'test-results/qa-audit/journey/results.json' }]],
  use: { channel: 'chrome', viewport: { width: 1365, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
