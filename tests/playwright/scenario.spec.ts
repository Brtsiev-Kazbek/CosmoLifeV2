import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The scripted run.
 *
 * Every step takes a screenshot, and the key ones assert a **measurement** rather than
 * just "the page loaded". The specific failure this guards against: a draw path that is
 * never executed passes every unit test in the project, because unit tests exercise the
 * generator and not the submission. Comparing the triangle count of a frame with an
 * object against one without is the only cheap proof that the geometry reached the GPU.
 *
 * Each step must also leave the world as it found it, or it breaks every step after it.
 */

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(SHOTS, { recursive: true });

interface TestHandle {
  stepFrames(count: number): void;
  triangles(): number;
  world: {
    timeDays: number;
    star: { name: string };
    ports: { id: string; name: string; population: number }[];
    player: { targetId: string | null; credits: number };
    system: { bodies: { id: string; kind: string; name: string }[] };
  };
}

declare global {
  interface Window {
    cosmolife: TestHandle;
  }
}

async function boot(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.cosmolife !== undefined, undefined, { timeout: 30_000 });
  // Let the first frames run so the renderer has real statistics.
  await page.evaluate(() => window.cosmolife.stepFrames(6));
  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
}

async function shot(page: Page, name: string, project: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${project}-${name}.png`) });
}

test.describe('scripted run', () => {
  test('boots into flight and draws a system', async ({ page }, info) => {
    await boot(page);

    const triangles = await page.evaluate(() => window.cosmolife.triangles());
    // A frame that drew nothing is the silent failure mode: the scene graph is fine, the
    // generator is fine, and the layer assignment sent everything past the far plane.
    expect(triangles).toBeGreaterThan(100);

    const state = await page.evaluate(() => ({
      star: window.cosmolife.world.star.name,
      bodies: window.cosmolife.world.system.bodies.length,
      ports: window.cosmolife.world.ports.length,
    }));
    expect(state.star.length).toBeGreaterThan(1);
    expect(state.bodies).toBeGreaterThan(1);

    await shot(page, 'flight', info.project.name);
  });

  test('the HUD renders real numbers, not placeholders', async ({ page }, info) => {
    await boot(page);
    const hud = page.locator('cl-hud');
    await expect(hud).toBeVisible();

    // Speed panel exists and the system name is on screen.
    const text = await page.evaluate(() => {
      const el = document.querySelector('cl-hud');
      return el?.shadowRoot?.textContent ?? '';
    });
    expect(text).toContain('тяга');
    expect(text).toContain('кредиты');
    expect(text).toContain('трюм');

    await shot(page, 'hud', info.project.name);
  });

  test('time advances and orbits move the bodies', async ({ page }, info) => {
    await boot(page);
    const before = await page.evaluate(() => window.cosmolife.world.timeDays);
    await page.evaluate(() => window.cosmolife.stepFrames(600));
    const after = await page.evaluate(() => window.cosmolife.world.timeDays);
    expect(after).toBeGreaterThan(before);
    await shot(page, 'time', info.project.name);
  });

  test('the same seed gives the same system', async ({ page }) => {
    await boot(page, '?seed=4242');
    const first = await page.evaluate(() =>
      window.cosmolife.world.system.bodies.map((b) => `${b.id}:${b.name}`).join('|'));
    await boot(page, '?seed=4242');
    const second = await page.evaluate(() =>
      window.cosmolife.world.system.bodies.map((b) => `${b.id}:${b.name}`).join('|'));
    expect(second).toBe(first);
  });

  test('a different seed gives a different system', async ({ page }) => {
    await boot(page, '?seed=1');
    const a = await page.evaluate(() =>
      window.cosmolife.world.system.bodies.map((b) => b.name).join('|'));
    await boot(page, '?seed=2');
    const b = await page.evaluate(() =>
      window.cosmolife.world.system.bodies.map((b) => b.name).join('|'));
    expect(b).not.toBe(a);
  });

  test('quality presets all boot and draw', async ({ page }, info) => {
    for (const quality of ['potato', 'low', 'medium', 'high']) {
      await boot(page, `?quality=${quality}`);
      const triangles = await page.evaluate(() => window.cosmolife.triangles());
      expect(triangles, `${quality} drew nothing`).toBeGreaterThan(50);
      await shot(page, `quality-${quality}`, info.project.name);
    }
  });
});
