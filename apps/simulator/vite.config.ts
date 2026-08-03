import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Alias to the contracts SOURCE, like the runner PWA does. The published
    // entry point is CommonJS, and Rollup cannot see its named exports — the
    // simulator imports real values (the vehicle list and its labels), not just
    // types, so it has to read the TypeScript directly.
    alias: {
      '@events/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { port: 4001 },
})
