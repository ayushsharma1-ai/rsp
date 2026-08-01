import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',       // existing desktop UI (v1)
        mobile: 'mobile.html',    // mobile-native PWA (v2)
        v3: 'v3.html',            // calendar-first redesign (v3 — A/B compare)
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  // Same proxy for `vite preview`, which serves dist/ — the built bundle, not source.
  // Without it every /api call 404s and the production build cannot be smoke-tested
  // at all, so "verified in the browser" could only ever mean the dev server. On the
  // VM nginx does this job (see deploy/nginx.conf); this is the local equivalent.
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
