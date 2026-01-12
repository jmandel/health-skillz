import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ehr-connect': 'http://localhost:8000',
      '/skill.zip': 'http://localhost:8000',
      '/health-record-assistant.md': 'http://localhost:8000',
    },
  },
});
