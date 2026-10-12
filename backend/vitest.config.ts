import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Parser workers mexem com pdfjs-dist legacy — evita worker threads extras.
    pool: 'forks',
    testTimeout: 20_000,
  },
});
