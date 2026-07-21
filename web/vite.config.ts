import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 개발 시에는 Go 백엔드(:8080)로 API를 프록시한다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
