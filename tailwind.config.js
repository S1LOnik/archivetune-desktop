/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Material You dynamic color tokens (set at runtime via CSS vars)
        primary: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-primary)' : `color-mix(in srgb, var(--md-primary) calc(${opacityValue} * 100%), transparent)`,
        'on-primary': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-on-primary)' : `color-mix(in srgb, var(--md-on-primary) calc(${opacityValue} * 100%), transparent)`,
        'primary-container': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-primary-container)' : `color-mix(in srgb, var(--md-primary-container) calc(${opacityValue} * 100%), transparent)`,
        'on-primary-container': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-on-primary-container)' : `color-mix(in srgb, var(--md-on-primary-container) calc(${opacityValue} * 100%), transparent)`,
        secondary: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-secondary)' : `color-mix(in srgb, var(--md-secondary) calc(${opacityValue} * 100%), transparent)`,
        'secondary-container': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-secondary-container)' : `color-mix(in srgb, var(--md-secondary-container) calc(${opacityValue} * 100%), transparent)`,
        tertiary: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-tertiary)' : `color-mix(in srgb, var(--md-tertiary) calc(${opacityValue} * 100%), transparent)`,
        'tertiary-container': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-tertiary-container)' : `color-mix(in srgb, var(--md-tertiary-container) calc(${opacityValue} * 100%), transparent)`,
        surface: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-surface)' : `color-mix(in srgb, var(--md-surface) calc(${opacityValue} * 100%), transparent)`,
        'surface-variant': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-surface-variant)' : `color-mix(in srgb, var(--md-surface-variant) calc(${opacityValue} * 100%), transparent)`,
        'on-surface': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-on-surface)' : `color-mix(in srgb, var(--md-on-surface) calc(${opacityValue} * 100%), transparent)`,
        'on-surface-variant': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-on-surface-variant)' : `color-mix(in srgb, var(--md-on-surface-variant) calc(${opacityValue} * 100%), transparent)`,
        'surface-container': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-surface-container)' : `color-mix(in srgb, var(--md-surface-container) calc(${opacityValue} * 100%), transparent)`,
        'surface-container-high': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-surface-container-high)' : `color-mix(in srgb, var(--md-surface-container-high) calc(${opacityValue} * 100%), transparent)`,
        'surface-container-highest': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-surface-container-highest)' : `color-mix(in srgb, var(--md-surface-container-highest) calc(${opacityValue} * 100%), transparent)`,
        outline: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-outline)' : `color-mix(in srgb, var(--md-outline) calc(${opacityValue} * 100%), transparent)`,
        'outline-variant': ({ opacityValue }) => opacityValue === undefined ? 'var(--md-outline-variant)' : `color-mix(in srgb, var(--md-outline-variant) calc(${opacityValue} * 100%), transparent)`,
        error: ({ opacityValue }) => opacityValue === undefined ? 'var(--md-error)' : `color-mix(in srgb, var(--md-error) calc(${opacityValue} * 100%), transparent)`,
      },
      fontFamily: {
        sans: ['Google Sans', 'Noto Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '28px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
