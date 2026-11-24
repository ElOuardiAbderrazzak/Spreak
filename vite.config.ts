import { defineConfig } from 'vite';

// base './' so the build works from a GitHub Pages sub-path (user.github.io/spreak/)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
