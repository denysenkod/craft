/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Instrument Sans"', 'sans-serif'],
        body: ['"Instrument Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        surface: {
          0: '#07070A',
          1: '#0D0D12',
          2: '#141419',
          3: '#1C1C22',
          4: '#24242C',
        },
        honey: {
          DEFAULT: '#E8A838',
          dim: '#C48A2A',
        },
        border: {
          DEFAULT: '#2A2A32',
          strong: '#3A3A44',
        },
      },
    },
  },
  plugins: [],
};
