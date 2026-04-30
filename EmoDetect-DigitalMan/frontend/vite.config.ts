import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    // 人脸注册/识别首次加载模型可能超过数分钟，默认代理超时会导致 ECONNRESET / socket hang up
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        timeout: 600_000,
        proxyTimeout: 600_000,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setTimeout(0)
          })
        },
      },
    },
  },
})
