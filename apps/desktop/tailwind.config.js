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
        tellas: {
          deep: '#050505',
          bg: '#0A0A0A',
          surface: '#111111',
          card: '#171717',
          hover: '#1F1F1F',
          active: '#2A2A2A',

          text: '#FAFAFA',
          'text-2': '#D4D4D4',
          muted: '#8A8A8A',
          disabled: '#5C5C5C',

          divider: '#1A1A1A',
          border: '#262626',
          'border-hover': '#3A3A3A',
          'border-strong': '#525252',

          accent: '#FFFFFF',
          'accent-hover': '#E5E5E5',
          'accent-active': '#CCCCCC',
          'on-accent': '#0A0A0A',
          'accent-subtle': 'rgba(255,255,255,0.06)',
          'accent-border': 'rgba(255,255,255,0.20)',
          ring: 'rgba(255,255,255,0.35)',

          online: '#23A55A',
          danger: '#EF4444',
          'danger-hover': '#DC2626',
          host: '#FBBF24',

          tile: {
            1: '#1C1C1C',
            2: '#242424',
            3: '#2C2C2C',
            4: '#343434',
            5: '#3C3C3C',
            6: '#444444',
          },
        },
        bg: {
          main: '#0A0A0A',
          sidebar: '#111111',
          card: '#171717',
          cardHover: '#1F1F1F',
          surface: '#111111',
          surfaceHover: '#1F1F1F',
          surfaceSelected: '#2A2A2A',
        },
        border: {
          subtle: '#262626',
          hover: '#3A3A3A',
        },
        text: {
          primary: '#FAFAFA',
          secondary: '#D4D4D4',
          tertiary: '#8A8A8A',
          muted: '#5C5C5C',
        },
        accent: {
          DEFAULT: '#FFFFFF',
          hover: '#E5E5E5',
          active: '#CCCCCC',
          subtle: 'rgba(255, 255, 255, 0.06)',
          border: 'rgba(255, 255, 255, 0.20)',
        },
        discord: {
          blurple: '#FFFFFF',
          blurpleHover: '#E5E5E5',
          red: '#EF4444',
          redHover: '#DC2626',
          green: '#23A55A',
          yellow: '#FBBF24',
          cardCoral: '#1C1C1C',
          cardSlate: '#242424',
          cardIndigo: '#2C2C2C',
          cardTeal: '#343434',
          cardRust: '#3C3C3C',
          cardPurple: '#444444',
        },
        status: {
          success: '#23A55A',
          danger: '#EF4444',
          warning: '#FBBF24',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace']
      },
      boxShadow: {
        subtle: '0 1px 2px rgba(0, 0, 0, 0.40)',
        card: '0 4px 12px rgba(0, 0, 0, 0.50)',
        cta: '0 4px 12px rgba(0, 0, 0, 0.35)',
      }
    }
  },
  plugins: []
};
