/**
 * Scoped to the console: `app/globals.css` (the landing page's styling) is a
 * frozen, pre-compiled Tailwind v4 output with no `@import "tailwindcss"` or
 * `@tailwind` directive in it, so this plugin passes it through untouched —
 * Tailwind's PostCSS plugin only activates on files that carry its own
 * directives. Only `app/console/console.css` (which does import Tailwind)
 * gets real utility generation. This is deliberate: the landing page must
 * keep rendering exactly as committed, byte for byte.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
