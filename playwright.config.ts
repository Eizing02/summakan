import { defineConfig, devices } from '@playwright/test';

const direct3D = process.env.BALANCE_QUEST_RENDERER === 'd3d11';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: { args: direct3D ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
