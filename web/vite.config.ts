import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = {
  // 本機開發時，前端的 /api 會轉給 http://localhost:8787（api 的 dev server）
  '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
};

export default defineConfig({
  // 相對路徑：部署到 GitHub Pages 的 https://帳號.github.io/repo名/ 也能正常載入
  base: './',
  plugins: [react()],
  server: {
    host: true, // 同一個 Wi-Fi 的手機也能連進來測試
    port: 5173,
    proxy: apiProxy,
  },
  preview: { host: true, port: 4173, proxy: apiProxy },
  // Firestore SDK 本身就有 ~500 kB，只在 Firebase 模式才會載入
  build: { chunkSizeWarningLimit: 700 },
});
