# Card art

The picture for every card in the deck — 40 suspects, 40 weapons, 40 rooms — lives here, plus a
downscaled twin of each under `thumbs/`. The client globs this folder at build time
(`client/src/render/overrides.ts`); anything found here is drawn instead of the procedural
placeholder SVG, so a missing file degrades to the generated card rather than breaking.

```
assets/cards/
  suspects/<card-id or title-slug>.webp
  weapons/<card-id or title-slug>.webp
  rooms/<card-id or title-slug>.webp
  thumbs/{suspects,weapons,rooms}/<same basename>.webp
```

A file matches either the card **id** (`suspect-saffron.webp`) or the slugified **title**
(`admiral_navy.webp` for "Admiral Navy") — whichever is handier. Matching is case-insensitive, so
`Boat_House.webp` finds the room `boat_house`. Ids are listed in `shared/src/data/`.

Titles are the source of truth: if a card is renamed, rename its file to the new slug (or fall back
to the id). Never leave a filename carrying a retired name.

New art arrives as multi-megabyte PNGs. Don't commit those — the `optimize-image-assets` skill
despeckles, aligns the drawn frame, shrinks to a 900px WebP and rebuilds the thumbnail, and it runs
automatically on every turn via the `Stop` hook in `.claude/settings.json`.
