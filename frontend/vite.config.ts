import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const onVercel = process.env.VERCEL === '1'
const railwayBackend = (process.env.VITE_API_BASE_URL ?? '').trim()
/** On Vercel, /api is proxied to Railway; the browser uses same-origin paths (no CORS). */
const useVercelApiProxy = onVercel && railwayBackend.length > 0

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: useVercelApiProxy
    ? { 'import.meta.env.VITE_API_USE_PROXY': JSON.stringify('true') }
    : undefined,
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
