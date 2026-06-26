import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy the bridge so `fetch('/order')` is same-origin (no CORS).
const BRIDGE = process.env.BRIDGE_URL ?? 'http://localhost:3010'

export default defineConfig({
  plugins: [react()],
  // @solana/web3.js v1 expects a Node-style `global`; map it to the browser global.
  define: { global: 'globalThis' },
  server: {
    port: 5173,
    proxy: {
      '/order':      BRIDGE,
      '/autonomous': BRIDGE,
      '/health':     BRIDGE,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
