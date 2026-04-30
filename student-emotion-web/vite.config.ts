import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // `rc-util` 会从 `react-is` 按命名导入 ForwardRef/isMemo。
    // react-is 是 CJS 包，需强制预构建成 ESM 兼容格式，避免白屏报错。
    // 一些 CJS/UMD 依赖在浏览器原生 ESM 下会触发 default/命名导出报错，显式预构建避免白屏。
    include: [
      'react-is',
      'classnames',
      'dayjs',
      'dayjs/plugin/advancedFormat',
      'dayjs/plugin/customParseFormat',
      'dayjs/plugin/weekday',
      'dayjs/plugin/localeData',
      'dayjs/plugin/weekOfYear',
      'dayjs/plugin/weekYear',
      'dayjs/plugin/quarterOfYear',
    ],
  },
  server: {
    proxy: {
      // 本地开发：前端请求 /api → student-emotion-web/backend（默认 5001）
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
      },
    },
  },
})
