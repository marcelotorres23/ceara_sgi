import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// PWA ja configurado em F0: o checklist de saida (F6) precisa operar offline no patio.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icone-maskable.svg', 'icone-192.png', 'icone-180.png'],
      manifest: {
        name: 'SGI Ceara',
        short_name: 'SGI',
        description: 'Sistema de Gestao Integrada - Ceara Alimentos',
        lang: 'pt-BR',
        theme_color: '#16469D',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // o checklist e o que o motorista abre: atalho direto na tela inicial do celular
        shortcuts: [
          { name: 'Executar checklist', short_name: 'Checklist', url: '/checklist' },
          { name: 'Portaria', short_name: 'Portaria', url: '/portaria' },
        ],
        icons: [
          { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          // maskable com zona segura: sem ele o Android recorta o simbolo no icone redondo
          { src: '/icone-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, host: true },
});
