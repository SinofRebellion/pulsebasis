import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), stats: resolve(__dirname, 'stats.html') } } },
})
