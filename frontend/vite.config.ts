import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js já está isolado no chunk `three-vendor` (~880 kB é o tamanho
    // intrínseco da lib) — o warning de 500 kB não se aplica a vendors.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown): `codeSplitting.groups` substitui o `manualChunks`
        // deprecado. Separa vendors pesados em chunks próprios.
        codeSplitting: {
          groups: [
            {
              name: 'three-vendor',
              test: /node_modules[\\/](three|three-stdlib|three-mesh-bvh|@react-three)[\\/]/,
              priority: 20,
            },
            {
              name: 'motion',
              test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/,
              priority: 15,
            },
            {
              name: 'viz',
              test: /node_modules[\\/](recharts|pdfjs-dist|victory-vendor|d3-[a-z-]+)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
