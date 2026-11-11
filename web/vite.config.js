import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// API_PROXY=https://pusaka-two.vercel.app npx vite: the dev server forwards /api to a deployment (no `vercel dev` needed)
export default defineConfig({
  plugins: [react()],
  server: process.env.API_PROXY ? { proxy: { '/api': { target: process.env.API_PROXY, changeOrigin: true } } } : undefined,
})
