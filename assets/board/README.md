# Board art

Top-down floorplan art painted **onto the board itself**, one file per room, plus textures for the
areas outside rooms. This is separate from `assets/overrides/rooms/`, which holds the square
portrait-style art used on the **cards**. A room can have both, and they look nothing alike: the card
shows the room from inside at eye level, the board shows its floor from above.

```
assets/board/
  rooms/<Room_Name>.png      # e.g. Clock_Tower.png  (matched case-insensitively, like card art)
  textures/<name>.png        # halls, lawn, water, hedge, and other non-room surfaces
```

## How a room file is used

Each image is stretched onto that room's **tile rectangle** on the board — its bounding box, not the
individual tiles. So the image's aspect ratio must equal the room's `width x height` in tiles from the
table below. The Clock Tower is 3 x 5 tiles, so its art must be 3:5 portrait.

Seven rooms are not full rectangles (see *Irregular shapes*). For those, the parts of the bounding box
that are not room tiles are cut out at render time, so paint the whole rectangle and let the cut-outs
fall where they may — or leave those spots visually quiet.

## What the board draws on top

Art has to survive these overlays, so keep the middle of the room calm:

- **Pawns** cluster in the centre of the room, up to 40 of them.
- **Weapon tokens** sit as small pewter circles along the top edge.
- **The room name** currently renders as a white bubble at the room's centre. If the art carries its
  own name plaque (as the reference Trophy Room art does), the built-in label should be suppressed for
  rooms that have board art — a one-line change in `Board.tsx`.
- **Doors** are drawn as small wooden doors or iron gates straddling the wall line, and
  **secret passages** get a staircase icon on their tile. Art can show these too, but the icons land on
  top, so do not put fine detail exactly there.

## Style

Match the reference: vibrant retro-vintage board-game illustration, bold black ink outlines, warm
saturated colour, straight-on top-down floor with the four walls splayed slightly outward so their
inner faces and any wall-mounted objects are visible. Transparent background outside the walls.

Colour and subject should echo that room's **card art** in `assets/overrides/rooms/`, so the two read as
the same place.

## Prompt template

> Top-down floorplan illustration of the **&lt;ROOM NAME&gt;** of a grand murder-mystery mansion, drawn as
> a single board-game tile. Vibrant retro-vintage board game art: bold black ink outlines, warm
> saturated colours, clean flat shading, no photorealism, no text other than the room name.
> The floor is a rectangle **&lt;W&gt; units wide by &lt;H&gt; units tall** (portrait/landscape), seen straight from
> above. The four walls sit just inside the image edges and splay slightly outward, so their inner
> faces and the objects mounted on them are visible.
> Doors: **&lt;door list&gt;**. Each door is an open wooden door on the wall with a pale tiled threshold
> spilling outside it.
> Furnishings hug the walls. The centre of the floor stays open and simple — a plain rug or bare
> floorboards — with the room name lettered on it in a small oval plaque.
> Background outside the walls is pure white (or transparent). Do not draw people.

Fill in the room's numbers from the table, then add two or three lines describing the specific
furniture, and name the palette from its card art.

## Processing new files

Same two passes as card art, minus the frame alignment (board art has no drawn frame):

```bash
python .claude/skills/optimize-image-assets/scripts/optimize_overrides.py assets/board/rooms
```

Generate as large as the tool allows at the right ratio; the optimiser downscales to 900px on the long
edge and converts to WebP.

## Room specifications

Door positions are counted from the top for east/west walls and from the left for north/south walls.
"-> Room" means that door is a connecting door opening straight into the named room, not onto a hall.

| Room | Section | Tiles | Size (w x h) | Shape | Doors |
| --- | --- | --- | --- | --- | --- |
| Armory | basement | 15 | 5 x 3 | rectangle | E 1st of 3 rows; S 2nd of 5 cols |
| Ballroom | ground floor | 70 | 10 x 7 | rectangle | W 2nd of 7 rows; E 4th of 7 rows; S 3rd of 10 cols |
| Billiard Room | ground floor | 40 | 10 x 4 | rectangle | N 2nd of 10 cols; E 3rd of 4 rows |
| Boat House | grounds | 16 | 4 x 4 | rectangle | W 4th of 4 rows; S 3rd of 4 cols |
| Boiler Room | basement | 21 | 7 x 3 | rectangle | W 1st of 3 rows; E 1st of 3 rows; S 5th of 7 cols |
| Boudoir | upper floor | 24 | 6 x 4 | rectangle | N 5th of 6 cols; E 2nd of 4 rows -> Master Suite; S 3rd of 6 cols |
| Bunker | basement | 15 | 5 x 3 | rectangle | W 2nd of 3 rows |
| Cemetery | grounds | 26 | 6 x 5 | irregular | E 3rd of 5 rows; S 6th of 6 cols |
| Chapel | basement | 32 | 7 x 8 | irregular | N 4th of 7 cols; W 3rd of 8 rows; E 3rd of 8 rows |
| Clock Tower | upper floor | 15 | 3 x 5 | rectangle | E 3rd of 5 rows; S 1st of 3 cols |
| Courtyard | grounds | 42 | 9 x 6 | irregular | W 2nd of 6 rows; E 2nd of 6 rows; S 5th of 9 cols |
| Den | upper floor | 18 | 6 x 3 | rectangle | E 2nd of 3 rows; S 3rd of 6 cols |
| Dining Room | ground floor | 25 | 5 x 5 | rectangle | N 3rd of 5 cols; S 3rd of 5 cols |
| Drawing Room | ground floor | 24 | 8 x 3 | rectangle | W 1st of 3 rows; E 1st of 3 rows; S 6th of 8 cols |
| Gallery | upper floor | 42 | 14 x 3 | rectangle | N 1st of 14 cols; E 2nd of 3 rows; S 7th of 14 cols |
| Gazebo | grounds | 12 | 4 x 4 | irregular | N 3rd of 4 cols; E 2nd of 4 rows; S 3rd of 4 cols |
| Greenhouse | grounds | 24 | 6 x 4 | rectangle | N 3rd of 6 cols; W 4th of 4 rows; S 5th of 6 cols |
| Gymnasium | basement | 44 | 11 x 4 | rectangle | N 5th of 11 cols; E 2nd of 4 rows; S 8th of 11 cols -> Sauna |
| Hedge Maze | grounds | 9 | 3 x 3 | rectangle | N 1st of 3 cols; E 2nd of 3 rows |
| Kitchen | ground floor | 25 | 5 x 5 | rectangle | E 2nd of 5 rows -> Pantry; W 3rd of 5 rows -> Dining Room; S 3rd of 5 cols |
| Laboratory | basement | 36 | 9 x 4 | rectangle | E 2nd of 4 rows; W 3rd of 4 rows; S 5th of 9 cols |
| Library | upper floor | 35 | 7 x 5 | rectangle | E 1st of 5 rows; E 3rd of 5 rows -> Study; S 4th of 7 cols |
| Lounge | ground floor | 15 | 5 x 3 | rectangle | N 2nd of 5 cols; E 2nd of 3 rows |
| Master Suite | upper floor | 56 | 10 x 6 | irregular | N 4th of 10 cols; E 2nd of 6 rows; W 6th of 6 rows |
| Music Room | ground floor | 25 | 5 x 5 | rectangle | N 2nd of 5 cols; E 3rd of 5 rows |
| Pantry | ground floor | 9 | 3 x 3 | rectangle | S 2nd of 3 cols |
| Parlour | ground floor | 35 | 7 x 5 | rectangle | W 3rd of 5 rows; S 4th of 7 cols; E 5th of 5 rows |
| Planetarium | upper floor | 30 | 9 x 4 | irregular | E 2nd of 4 rows; W 3rd of 4 rows; S 5th of 9 cols |
| Rose Garden | grounds | 30 | 6 x 5 | rectangle | W 1st of 5 rows; E 4th of 5 rows; S 4th of 6 cols |
| Sauna | basement | 22 | 11 x 2 | rectangle | E 1st of 2 rows; W 2nd of 2 rows |
| Smoking Room | ground floor | 21 | 7 x 3 | rectangle | W 1st of 3 rows; E 1st of 3 rows |
| Solarium | upper floor | 18 | 6 x 3 | rectangle | E 3rd of 3 rows |
| Stables | grounds | 30 | 6 x 5 | rectangle | E 2nd of 5 rows; W 4th of 5 rows; S 4th of 6 cols |
| Study | upper floor | 24 | 6 x 4 | rectangle | E 4th of 4 rows |
| Theatre | ground floor | 35 | 7 x 5 | rectangle | E 3rd of 5 rows; W 5th of 5 rows; S 4th of 7 cols |
| Trophy Room | upper floor | 24 | 8 x 3 | rectangle | N 5th of 8 cols; S 4th of 8 cols |
| Veranda | ground floor | 30 | 6 x 5 | rectangle | N 4th of 6 cols; E 3rd of 5 rows; S 3rd of 6 cols |
| Walk-in Closet | upper floor | 4 | 2 x 2 | rectangle | N 1st of 2 cols -> Master Suite |
| Wine Cellar | basement | 36 | 9 x 4 | rectangle | W 2nd of 4 rows; E 2nd of 4 rows; S 4th of 9 cols |
| Workshop | basement | 28 | 8 x 4 | irregular | W 1st of 4 rows; N 3rd of 8 cols; S 4th of 8 cols |

### Irregular shapes

`X` is a room tile; `.` inside the box is not part of the room. The Cemetery's gaps are grave plots and
the Courtyard's is the fountain — both are obstacles pieces walk around, so the art can show them as
solid features.

```
Cemetery (6x5)   Chapel (7x8)   Courtyard (9x6)   Gazebo (4x4)
XXXXXX           ..XXX..        XXXXXXXXX         .XX.
X.XX.X           ..XXX..        XXXXXXXXX         XXXX
XXXXXX           XXXXXXX        XX....XXX         XXXX
X.XX.X           XXXXXXX        XX....XXX         .XX.
XXXXXX           ..XXX..        XX....XXX
                 ..XXX..        XXXXXXXXX
                 ..XXX..
                 ..XXX..

Master Suite (10x6)   Planetarium (9x4)   Workshop (8x4)
XXXXXXXXXX            .XXXXXX..           XXXXXXXX
XXXXXXXXXX            XXXXXXXXX           XXXXXXXX
XXXXXXXXXX            XXXXXXXXX           XXXXXXXX
XXXXXXXXXX            .XXXXXX..           ....XXXX
XXXXXXXX..
XXXXXXXX..
```

### Secret passages

These rooms have a passage on one tile, marked with a staircase icon at render time. Keep that corner
uncluttered, or paint a hatch or opening there.

| Room | Tile (col, row) | Story |
| --- | --- | --- |
| Chapel | see board data | Down through the crypt -> Cemetery |
| Clock Tower | 1st col, 1st row | Down the weight shaft -> Boiler Room |
| Theatre / Workshop | — | The trapdoor under the stage |
| Boat House / Bunker | — | The smugglers' tunnel |
| Master Suite / Wine Cellar | — | The priest hole |
| Trophy Room / Armory | — | Behind the bear |
| Smoking Room / Stables | — | The old coal chute |
| Laboratory / Gazebo | — | Dr Orchid's poison garden |
