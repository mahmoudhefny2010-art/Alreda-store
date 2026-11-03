const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3100', channel: 'chrome', screenshot: 'only-on-failure' },
  webServer: { command: 'node src/server.js', url: 'http://127.0.0.1:3100', reuseExistingServer: false,
    // Synthetic contact configuration; tests never message a real business.
    env: { PORT: '3100', HOST: '127.0.0.1', NODE_ENV: 'test', WHATSAPP_PHONE: '15550100100',
      DATABASE_URL: '', DIRECT_URL: '', DATABASE_REQUIRED: 'false',
      CHECKOUT_ENABLED: 'false', CHECKOUT_ORIGIN: '', CHECKOUT_SHIPPING_RATES: '{}',
      CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' } },
});
