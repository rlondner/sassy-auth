import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        sidebar: {
          bg: 'var(--sidebar-bg)',
          fg: 'var(--sidebar-fg)',
          'active-fg': 'var(--sidebar-active-fg)',
          'active-border': 'var(--sidebar-active-border)',
        },
        // Raw palette tokens for direct use
        'surface-container-highest': '#e0e3f1',
        'surface-container-high': '#dce9ff',
        'on-surface': '#0b1c30',
        'on-surface-variant': '#464555',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
        'inverse-surface': '#213145',
        'primary-fixed': '#e2dfff',
        'primary-fixed-dim': '#c3c0ff',
      },
      fontSize: {
        'headline-lg': ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700' }],
        'headline-md': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
        'headline-sm': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        'body-lg': ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }],
        'body-md': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '400' }],
        'label-md': ['0.75rem', { lineHeight: '1rem', fontWeight: '600' }],
        'label-sm': ['0.6875rem', { lineHeight: '0.875rem', fontWeight: '700' }],
      },
      spacing: {
        'pane-nav': '260px',
        'container-padding': '24px',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 4px)',
        xl: 'calc(var(--radius) + 8px)',
        '2xl': 'calc(var(--radius) + 12px)',
      },
    },
  },
  plugins: [],
}

export default config
