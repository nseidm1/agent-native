# Design

Neon-first, matching the cockpit's `[data-theme=neon]` tokens exactly (`app/global.css` `:root`).

- Card: panel gradient, 1 px cyan hairline with inset glow, 12 px corner brackets (top-left, bottom-right),
  uppercase `#8fdcff` title at .08em after a 6 px glowing dot, a 3 px left edge in the tone colour, a status
  glyph (✓ ⚠ ✕) top-right, an 18-20 px bold headline in the tone colour, one sub line, one chip, and a thin
  sparkline or meters.
- Desktop: bands stacked, two columns; size `l` (or a card alone on a band's last row) spans both.
  A card narrower than 360 px (the cockpit's ~600 px column) shrinks its viz and lets the sub and chip wrap.
- Phone (< 560 px): one column, compact 80 px cards (title row, headline with inline viz, sub), collapsible bands.
- The breathing glow stops under `prefers-reduced-motion`. Cards are buttons with full aria-labels.
- The page background is transparent; the cockpit's iframe declares `color-scheme: dark` to match.
