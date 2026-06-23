# Override assets

Drop your own art here to replace the procedural placeholders for any card. Files are matched
by card **id** (wired up in milestone M1):

```
assets/overrides/
  suspects/<suspect-id>.svg   (or .png)
  weapons/<weapon-id>.svg
  rooms/<room-id>.svg
```

If a matching file exists for a card id, it is used instead of the generated SVG. Card ids will
be listed in `shared/src/data/` once the datasets land in M1. Text overrides (titles/phrases)
will be supported via an `overrides.json` in this folder.
