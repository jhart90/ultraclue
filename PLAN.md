# Ultra Clue — Architecture & Build Plan

A browser-based, real-time multiplayer murder-mystery board game for up to 8 players on
separate computers. A scaled-up *Clue*: **40 suspects, 40 weapons, 40 rooms** (120 cards),
a tile-based mansion board, hidden hands, and a full Murder → Deal → Movement → Suspect →
Accuse game loop.

This document is the contract for the build. Read it, mark anything you want changed, and
I'll start at Milestone 1.

---

## 1. Core principles

1. **Authoritative server.** The server owns the one true game state. Clients send *intents*
   ("I want to move to tile X"); the server validates, mutates state, and broadcasts results.
   This is non-negotiable for Clue because of **hidden information** — a player must *never*
   receive another player's hand or the contents of the envelope over the wire. The server
   sends each client a **tailored view** containing only what that player is allowed to see.

2. **Pure, testable rules engine.** All game rules (dealing, turn order, suggestion
   resolution, accusation checking, elimination/redistribution) live in `shared/` as pure
   functions with no I/O. The server is a thin transport + validation shell around it. This
   lets us unit-test the entire rulebook without a browser or socket.

3. **Data-driven content.** The 120 cards and the board are JSON/TS data, not hardcoded UI.
   Procedural SVG renders them. An `assets/overrides/` folder lets you drop in real art/text
   that transparently replaces the procedural version by card id.

4. **One deployable.** In production the server serves the built client as static files and
   the Socket.IO endpoint from the same origin/port — a single Railway service, single URL,
   WSS works out of the box.

---

## 2. Tech stack

| Layer      | Choice                                   | Why |
|------------|------------------------------------------|-----|
| Language   | TypeScript everywhere                    | Shared types across client/server eliminate protocol drift |
| Repo       | npm workspaces monorepo                  | `shared/` imported by both sides, one `npm install` |
| Server     | Node 24 + Express + Socket.IO            | Persistent process, rooms, broadcast, reconnection — ideal on Railway |
| Client     | React + Vite                             | Fast dev, component model fits the many screens/overlays |
| Client state | Zustand                                | Minimal boilerplate; one store mirrors the server's tailored view |
| Rendering  | SVG + CSS (board, cards, pieces); CSS 3D for dice | No asset pipeline, themeable, override-friendly |
| Tests      | Vitest                                   | Runs the `shared/` rules engine headlessly |
| Hosting    | Railway.app                              | Persistent Node + native WSS + public URL |

No database in v1 — game state lives in server memory keyed by room code. (A room dies when
empty. Persistence/reconnection-after-refresh is a documented stretch goal, see §9.)

---

## 3. Repository layout

```
clue-ultra/
├─ package.json                # workspaces: shared, server, client
├─ PLAN.md
├─ shared/
│  ├─ src/
│  │  ├─ types.ts              # Card, Player, GameState, Tile, all socket payloads
│  │  ├─ events.ts            # socket event name constants + payload types (the protocol)
│  │  ├─ data/
│  │  │  ├─ suspects.ts       # 40 suspects (surname, color, turnOrder)
│  │  │  ├─ weapons.ts        # 40 weapons (name, phrase)
│  │  │  ├─ rooms.ts          # 40 rooms (name, phrase)
│  │  │  └─ board.ts          # tile grid, room footprints, entrances, start tiles
│  │  ├─ engine/
│  │  │  ├─ setup.ts          # pick envelope, shuffle, deal
│  │  │  ├─ movement.ts       # dice range, reachable tiles (BFS), path finding
│  │  │  ├─ turn.ts           # turn order, phase transitions
│  │  │  ├─ suggest.ts        # clockwise reveal resolution
│  │  │  ├─ accuse.ts         # accusation check, elimination + redistribution
│  │  │  └─ view.ts           # build per-player tailored view (strips hidden data)
│  │  └─ rng.ts               # seedable RNG (deterministic tests)
│  └─ test/                   # Vitest specs for every engine module
├─ server/
│  ├─ src/
│  │  ├─ index.ts             # Express + Socket.IO bootstrap, serves client in prod
│  │  ├─ rooms.ts             # in-memory room registry, room codes
│  │  ├─ handlers.ts          # socket event handlers → call engine → broadcast views
│  │  └─ bots.ts             # bot decision logic (uses the same engine)
│  └─ ...
├─ client/
│  ├─ index.html
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ store.ts             # Zustand store; socket wiring
│  │  ├─ screens/             # Title, Lobby, Game
│  │  ├─ components/          # Board, Tile, Piece, Card, Hand, Chat, DetectiveNotes, Dice, Envelope
│  │  └─ render/              # procedural SVG generators + override resolver
│  └─ ...
└─ assets/
   └─ overrides/
      ├─ suspects/<id>.svg|png
      ├─ weapons/<id>.svg|png
      └─ rooms/<id>.svg|png
```

---

## 4. Data model (key types)

```ts
type CardType = 'suspect' | 'weapon' | 'room';
interface Card { id: string; type: CardType; title: string; phrase: string; }
interface Suspect extends Card { color: string; turnOrder: number; }      // turnOrder 1..40
interface RoomDef extends Card { tiles: TileCoord[]; entrances: TileCoord[]; }

interface Tile { x: number; y: number; kind: 'passage' | 'room' | 'wall'; roomId?: string; }
interface Board { width: number; height: number; tiles: Tile[]; startTiles: Record<string,TileCoord>; }

interface Player {
  id: string; name: string; suspectId: string; color: string;
  isBot: boolean; isHost: boolean;
  hand: string[];           // card ids (server-only; stripped from others' views)
  position: TileCoord; inRoomId?: string;
  eliminated: boolean; connected: boolean;
}

type Phase = 'lobby' | 'setup' | 'play' | 'ended';
type TurnPhase = 'movement' | 'suggest' | 'accuse' | 'awaiting-reveal' | 'turn-end';

interface GameState {
  code: string; phase: Phase;
  players: Player[]; turnOrder: string[]; activePlayerIdx: number; turnPhase: TurnPhase;
  envelope: { suspectId: string; weaponId: string; roomId: string }; // server-only
  lastRoll?: [number, number];
  currentSuggestion?: Suggestion;   // who suggested, the 3 cards, who's being queried
  suspectedCards: { suspectId?: string; weaponId?: string };  // pieces moved onto board
  winnerId?: string;
  log: LogEntry[]; chat: ChatMsg[];
}
```

**Tailored view (`view.ts`):** for player P, return GameState with: only P's `hand` populated
(others = count only), `envelope` removed, and any in-flight reveal card shown only if P is
the suggester. Everything else (positions, who is revealing, dice, chat, log) is public.

---

## 5. Networking protocol (Socket.IO events)

**Client → Server (intents):**
`createGame`, `joinGame{code,name}`, `setSlot{idx,status}`, `pickSuspect{suspectId}`,
`startGame`, `chat{text}`, `rollAndMove{toTile}` / `rollDice`, `stayMove{toTile}`,
`skipMovement`, `makeSuggestion{suspectId,weaponId}`, `makeAccusation{suspectId,weaponId,roomId}`,
`revealCard{cardId}`, `noMatch`, `endTurn`.

**Server → Client:**
`youAre{playerId}`, `state{tailoredView}` (the workhorse — full resync after every change),
`diceRolled{values}` (drives animation), `revealRequest{cards}` (private, to the queried
player), `cardRevealed{cardId}` (private, to the suggester only), `error{msg}`.

Design choice: **full tailored-state broadcast on every change**, not fine-grained diffs.
Game state is small; this is simpler and bug-resistant. We optimize only if needed.

---

## 6. Game flow / state machine

```
LOBBY
  Host opens game → 8 slots, default OPEN. Host sets each slot OPEN/CLOSED/BOT.
  Players join open slots, pick a suspect (locks turn-order rank), chat enabled.
  Host presses START GAME (≥ valid players).
        │
SETUP (instant, server-side)
  1. Murder: randomly draw 1 suspect + 1 weapon + 1 room → envelope (hidden).
  2. Deal: shuffle remaining 117 → deal as evenly as possible round-robin.
  3. Turn order: sort players by their suspect's turnOrder rank.
  4. Place each player piece on its suspect's start tile.
        │
PLAY  (loop over turnOrder, skipping eliminated)
  MOVEMENT
    not in room → auto-roll 2 dice; highlight reachable tiles (BFS, no diagonals,
                  passes through tiles, can't pass through occupied tiles); click dest →
                  animate path @ 0.3s/tile.
    in room     → [ROLL/MOVE] forced reroll+move  |  [skip → SUSPECT/ACCUSE].
  CHOICE
    not in a room after move → [ACCUSE] | [END TURN].
    in a room                → [SUGGEST] | [ACCUSE].
  SUGGEST
    pick suspect + weapon (room = current). Move that suspect piece + weapon token here.
    Query players clockwise from next player: each reveals one matching card (privately to
    suggester) or passes. First reveal ends the turn immediately; if none match, turn ends.
  ACCUSE
    pick suspect + weapon + room. Reveal envelope cards one-by-one to accuser only.
    All 3 match → winnerId, game ENDED. Any mismatch → player eliminated:
      remove from turn order, shuffle their hand, redistribute to remaining players.
      (If only one player remains → they win by default.)
        │
ENDED → show result + the envelope to everyone. Host can return to a fresh lobby.
```

---

## 7. The board (the hard part — flagged honestly)

Classic Clue has 9 rooms; **40 is a large mansion**. Plan:

- A single hand-authored **board JSON** (~`board.ts`) on a grid roughly **32×32**. Rooms are
  rectangular footprints arranged in a mansion layout (wings/floors-as-regions), each with
  1+ entrance tiles opening onto a connective hallway network. 40 start tiles, one per suspect,
  ringing the perimeter.
- I'll generate this **programmatically with a layout script** (rooms placed in a grid of
  zones, hallways carved between them, entrances auto-placed), then hand-tune, rather than
  place 1000+ tiles by hand. The output is static JSON the engine consumes.
- Movement uses **BFS over passable tiles** for range/reachability and **shortest-path** for
  the animation route. No "secret passages" in v1 (documented stretch goal).

This is the single biggest content task and gets its **own milestone (M5)** so we can iterate
on the layout visually before wiring movement to it.

---

## 8. Milestones (each ends in something runnable/testable)

- **M0 — Scaffold.** Monorepo, workspaces, TS configs, Vite+Express dev setup, Socket.IO
  handshake, a "hello" round-trip, Railway config. *Done = `npm run dev`, two browsers connect.*
- **M1 — Content & data.** 40/40/40 card datasets (names, colors, turn order, phrases) +
  procedural SVG card renderer + override resolver. *Done = a gallery page renders all 120 cards.*
- **M2 — Rules engine + tests.** `setup/turn/suggest/accuse/view` pure functions, full Vitest
  suite. No UI. *Done = `npm test` green for a scripted 3-player game.*
- **M3 — Title + Lobby + networking.** Create/join by room code, 8 slots with OPEN/CLOSED/BOT,
  suspect picking, chat, host START. *Done = real cross-browser lobby.*
- **M4 — Hand, Detective Notes, Chat in-game.** Hand viewer (flip/reorder), the 14-state
  Detective Notes grid overlay, live chat. *Done = post-deal a player sees only their hand + notes.*
- **M5 — Board layout + rendering.** Generate + render the 40-room mansion, pieces, weapon
  tokens, envelope space, start positions. *Done = board renders, pieces sit on start tiles.*
- **M6 — Turn loop: movement.** Dice (3D CSS), reachable-tile highlighting, click-to-move,
  0.3s/tile path animation, in-room ROLL/MOVE vs skip. *Done = players take movement turns.*
- **M7 — Suggest & Accuse.** Full suggestion resolution with private reveals, piece-summoning,
  accusation vs envelope, elimination + hand redistribution, win/lose end screen. *Done = a full
  game is winnable end-to-end.*
- **M8 — Bots.** Computer players for BOT slots (move toward rooms, suggest, track notes,
  accuse when confident) using the shared engine. *Done = a human can play vs bots.*
- **M9 — Polish + deploy.** Reconnection, transitions/sound hooks, responsive layout, deploy to
  Railway with a live URL. *Done = you send friends a link and play.*

I'll pause for your review at the end of each milestone.

---

## 9. Open questions / stretch goals (not blocking M0–M2)

- **Reconnect after refresh:** v1 keeps state in server memory; a refresh currently drops the
  player. Proposed: short-lived rejoin token so a refresh re-attaches to the same seat. (M9)
- **Spectators / mid-game join:** out of scope for v1 (Clue hands are fixed at deal).
- **Secret passages / multi-floor board:** out of scope v1; the board format leaves room for it.
- **Mobile layout:** target desktop first; M9 makes it usable on tablets.
- **Card phrases/names:** I'll auto-generate thematically (color surnames per spec). You can
  override any of the 120 via `assets/overrides/` + a text override file. Tell me if you have a
  specific naming scheme in mind.

---

## 10. First action on approval

Start **M0**: scaffold the monorepo, get two browsers exchanging a Socket.IO message, and add
the Railway deploy config — so the skeleton is live before we pour in content.
