import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.MAKORA_API_URL || `http://localhost:${process.env.WRANGLER_PORT || '8787'}`

// When VITE_APP_API_BASE is empty string, the app-only worker serves
// routes at the root, so we proxy API paths directly (no /app prefix).
const appApiBase = process.env.VITE_APP_API_BASE

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // Main dashboard API → full worker /agent
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/agent'),
      },
      // Self-service app API → /app/* on the full worker
      '/app/': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
      // Standalone mode: proxy /status, /tick, etc. to app-only worker
      // Activate by running: VITE_APP_API_BASE="" npm run dev
      ...(appApiBase === '' ? {
        '/status': { target: apiTarget, changeOrigin: true, secure: false },
        '/tick': { target: apiTarget, changeOrigin: true, secure: false },
        '/config': { target: apiTarget, changeOrigin: true, secure: false },
        '/health': { target: apiTarget, changeOrigin: true, secure: false },
      } : {}),
    },
  },
})
