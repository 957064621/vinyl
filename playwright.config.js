import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  // Performance profiles run one browser at a time for deterministic long-task measurement.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        contextOptions: { reducedMotion: 'no-preference' }
      }
    },
    {
      name: 'mobile-reduce',
      use: {
        ...devices['Pixel 5'],
        contextOptions: { reducedMotion: 'reduce' }
      }
    }
  ]
});
