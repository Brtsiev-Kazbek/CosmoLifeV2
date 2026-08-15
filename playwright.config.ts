import { defineConfig } from '@playwright/test';

/**
 * Scripted run configuration.
 *
 * Two viewports, because the interface has to be legible at both and a layout that works
 * at 1280x720 can overlap at 960x540. Chromium is pre-installed in the environment, so
 * `playwright install` is never run.
 */
export default defineConfig({
  testDir: './tests/playwright',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: {
      // The environment ships its own Chromium build, which need not match the revision
      // this Playwright version would download. Point at it explicitly rather than
      // fetching a second browser.
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      // WebGL in headless Chromium needs software rasterisation, and SwiftShader is what
      // makes the screenshots match what a real GPU draws closely enough to review.
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    },
  },
  projects: [
    { name: 'wide', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'narrow', use: { viewport: { width: 960, height: 540 } } },
  ],
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
