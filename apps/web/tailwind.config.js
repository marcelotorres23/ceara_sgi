/** @type {import('tailwindcss').Config} */
// Tokens da marca Ceara Alimentos (GUIA-MARCA-001). Nenhuma cor fora desta paleta.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ceara: {
          azul: '#16469D',
          ouro: '#F3AE00',
          fundo: '#09409D',
          texto: '#141414',
          texto2: '#5A5A5A',
          nevoa: '#F2F4F8',
          verde: '#1E7A44',
          vermelho: '#C0392B',
          borda: '#E3E7EE',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Calibri', 'Arial', 'sans-serif'],
        display: ['Poppins', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        h1: ['24px', { lineHeight: '1.3', fontWeight: '700' }],
        h2: ['18px', { lineHeight: '1.35', fontWeight: '700' }],
        h3: ['15px', { lineHeight: '1.4', fontWeight: '600' }],
        corpo: ['14px', { lineHeight: '1.5' }],
        legenda: ['12px', { lineHeight: '1.45' }],
        tabela: ['13px', { lineHeight: '1.4' }],
      },
      borderRadius: { card: '10px' },
      boxShadow: { card: '0 1px 2px rgba(20,20,20,0.04), 0 2px 8px rgba(20,20,20,0.05)' },
      keyframes: {
        'sla-pulso': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(192,57,43,0.45)' },
          '50%': { boxShadow: '0 0 0 4px rgba(192,57,43,0)' },
        },
      },
      animation: { 'sla-pulso': 'sla-pulso 1.8s ease-in-out infinite' },
    },
  },
  plugins: [],
};
