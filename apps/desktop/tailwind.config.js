/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],

  theme: {
    extend: {
      colors: {
        bg: {
          main: '#313338',
          sidebar: '#2B2D31',
          card: '#1E1F22',
          cardHover: '#35373C',
          surface: '#2B2D31',
          surfaceHover: '#35373C',
          surfaceSelected: '#404249',
        },
        border: {
          subtle: '#383A40',
          hover: '#4E5058',
        },
        text: {
          primary: '#F2F3F5',
          secondary: '#949BA4',
          tertiary: '#80848E',
          muted: '#6D6F78',
        },
        accent: {
          DEFAULT: '#5865F2',
          hover: '#4752C4',
          active: '#3C45A5',
          subtle: 'rgba(88, 101, 242, 0.15)',
          border: 'rgba(88, 101, 242, 0.35)',
        },
        discord: {
          blurple: '#5865F2',
          blurpleHover: '#4752C4',
          red: '#ED4245',
          redHover: '#DA373C',
          green: '#23A55A',
          yellow: '#FEE75C',
          cardCoral: '#E05263',
          cardSlate: '#384259',
          cardIndigo: '#5B6BF0',
          cardTeal: '#2A9D8F',
          cardRust: '#C05621',
          cardPurple: '#70587C',
        },
        status: {
          success: '#23A55A',
          danger: '#ED4245',
          warning: '#FEE75C',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace']
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(0, 0, 0, 0.25)',
        card: '0 4px 12px rgba(0, 0, 0, 0.20)',
        cta: '0 4px 12px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(91, 124, 250, 0.15)',
      }
    }
  },
  plugins: []
};
