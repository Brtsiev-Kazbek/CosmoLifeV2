import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/vitest/**/*.test.ts'],
    // Node, not jsdom: sim/ and procgen/ are render-free by rule, and a DOM here would
    // let a stray render import pass unnoticed.
    environment: 'node',
  },
});
