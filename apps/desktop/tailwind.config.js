/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        discord: {
          blurple: '#5865F2',
          blurpleHover: '#4752C4',
          blurpleActive: '#3C45A5',
          green: '#23A55A',
          greenHover: '#1F9250',
          yellow: '#F0B232',
          red: '#DA373C',
          redHover: '#BE2F34',
          dark: '#313338',
          sidebar: '#2B2D31',
          server: '#1E1F22',
          black: '#111214',
          card: '#232428',
          input: '#1E1F22',
          hover: '#35373C',
          active: '#404249',
          textPrimary: '#F2F3F5',
          textMuted: '#949BA4',
          textChannel: '#80848E'
        },
        dark: {
          900: '#111214',
          800: '#1E1F22',
          700: '#2B2D31',
          600: '#313338'
        },
        brand: {
          purple: '#5865F2',
          cyan: '#06B6D4',
          neon: '#23A55A',
          rose: '#DA373C'
        }
      },
      fontFamily: {
        sans: ['"gg sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
};
