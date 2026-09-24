# The mark

The striped sun on the horizon with the tuning needle through it: the sunset is the dial.

- `mark.svg`: the master, 512. The source of `public/icons/icon-{192,512}.png`. With its tile's
  corners squared (`rx="0"`), it also makes `src/app/apple-icon.png` (180) and
  `public/icons/icon-maskable-512.png`, because iOS and Android cut their own corners.
- `mark-small.svg`: the same drawing cut down for 16–48 px. It is `src/app/icon.svg` as is, and the
  16/32/48 PNGs inside `src/app/favicon.ico`. `src/app/(app)/lib/logo-mark.tsx` draws it without the tile.
- `og-card.html`: `src/app/opengraph-image.png`, a 1200×630 screenshot from headless Chrome.

Raster exports come from sharp (it is already in the tree through Next) plus a hand-built PNG-in-ICO.
This is a one-time export, not a build step: re-export after changing a source.
