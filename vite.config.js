import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  server: {
    port: 5173,
    proxy: {
      // IMPORTANT: this must match whatever folder name you actually used
      // under C:\xampp\htdocs\ for the PHP api/ folder — e.g. if you copied
      // api/ into C:\xampp\htdocs\sarms-reactt\api\, this must say
      // 'http://localhost/sarms-reactt', not 'sarms-react'. A mismatch here
      // fails silently: the app loads, but every API call 404s.
      '/api': {
        target: 'http://localhost/sarms-react',
        changeOrigin: true,
        rewrite: (path) => path,
      }
    }
  },

  // Force Vite to not cache — fixes stale bundle issues
  optimizeDeps: {
    force: true,
  },
})
