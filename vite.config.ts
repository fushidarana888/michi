import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/michi/' : '/',
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'app.html'),
    },
  },
})
