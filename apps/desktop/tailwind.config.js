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
          main: '#0B0D10',
          secondary: '#101217',
          surface: '#16191F',
          surfaceHover: '#1D2129',
          surfaceSelected: '#202530',
        },
        border: {
          subtle: '#252A34',
          hover: '#323846',
        },
        text: {
          primary: '#F4F6F8',
          secondary: '#9DA5B4',
          tertiary: '#687180',
          muted: '#505764',
        },
        accent: {
          DEFAULT: '#5B7CFA',
          hover: '#6C89FF',
          active: '#4F70EB',
          subtle: 'rgba(91, 124, 250, 0.10)',
          border: 'rgba(91, 124, 250, 0.25)',
        },
        status: {
          success: '#34D399',
          danger: '#F87171',
          warning: '#FBBF24',
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
