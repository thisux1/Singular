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
      // Recomendado pela doc ao usar includeDependenciesRecursively:false —
      // evita chunks inválidos/circulares por ordem de execução.
      preserveEntrySignatures: 'allow-extension',
      output: {
        strictExecutionOrder: true,
        // Vite 8 (rolldown): `codeSplitting.groups` substitui o `manualChunks`
        // deprecado. Separa vendors pesados em chunks próprios.
        codeSplitting: {
          /* `includeDependenciesRecursively: false`: sem isso cada grupo
             ENGOLHE a closure de dependências (react, zustand, helpers
             compartilhados) e todo chunk que precisa delas baixa o vendor
             inteiro — foi assim que os ~880 kB do three ficaram eager em
             todas as rotas. Top-level: não existe a opção por grupo. */
          includeDependenciesRecursively: false,
          groups: [
            /* react/react-dom precisam de grupo próprio e PRIORIDADE MAIOR
               que three-vendor: sem isso o rolldown coloca o runtime
               compartilhado dentro do chunk do three (closure do
               @react-three) e TODA rota baixa os ~880 kB — o lazy-load
               do SingularityCanvas fica inútil. */
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
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
