import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.PLAYWRIGHT_CHANNEL,
      },
    },
  ],
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js apps/client --host 127.0.0.1 --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === 'true',
      env: {
        ...process.env,
        VITE_GAME_SERVER_URL: 'ws://127.0.0.1:2568',
      },
    },
  ],
});
