import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 백엔드 개발 서버(기본 8787)로 프록시 - 정적 데이터는 public/data에서 즉시 로드되고
// AI/KOSIS API는 백엔드 실패 시에도 대시보드가 동작하도록 별도 처리됨
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        timeout: 30000
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
