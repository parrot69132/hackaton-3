/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lumon: {
          bg: '#0a1a22',
          panel: '#0f2630',
          line: '#1d4a5c',
          text: '#d6f0f7',
          dim: '#7aa7b5',
          cyan: '#7fd8e8',
          wo: '#6ee7b7',
          fc: '#93c5fd',
          dr: '#fca5a5',
          ma: '#fcd34d',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
