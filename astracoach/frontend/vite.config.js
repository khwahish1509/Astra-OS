import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Read .env from the project root (astracoach/) so frontend and backend
  // share a single .env file. Without this Vite only looks in frontend/
  // and misses VITE_SIMLI_API_KEY and other VITE_ vars.
  envDir: '..',
  // Force Vite/esbuild to pre-bundle simli-client as CJS.
  // simli-client@3.x has no ESM export ("type":"module" is absent, no "exports" field),
  // so without this Vite may fail to resolve named exports and receive `undefined`.
  optimizeDeps: {
    include: ['simli-client'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
