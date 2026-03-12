import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // WICHTIG für Home Assistant Ingress (relative Pfade)
  server: {
    proxy: {
      '/api': 'http://localhost:9999',
      '/socket.io': {
        target: 'http://localhost:9999',
        ws: true
      },
      '/uploads': 'http://localhost:9999'
    }
  }
})
