import { getCard } from '../data';
import { BOARD, coordKey, type Coord, type FloorId } from '../data/board';
import type { GameState } from '../game';
import { type RNG } from '../rng';
import { blockedCells, elevatorFloorAt, pathTo, reachableTiles, roomIdAt } from './movement';
import { advanceTurn, clone, currentPlayerId, getPlayer, log, requirePlayer } from './util';

const FLOOR_NAMES: Record<FloorId, string> = {
  'ground-floor': 'Ground Floor',
  'upper-floor': 'Upper Floor',
  basement: 'Basement',
};

/** The indoor floors a rider can choose from an elevator (every indoor floor but the one they're on). */
export function elevatorOptions(fromFloor: FloorId): FloorId[] {
  return (['ground-floor', 'upper-floor', 'basement'] as FloorId[]).filter((f) => f !== fromFloor);
}

const die = (rng: RNG) => 1 + Math.floor(rng() * 6);

function otherPositions(state: GameState, exceptId: string): Coord[] {
  return state.players.filter((p) => p.id !== exceptId && !p.eliminated).map((p) => p.position);
}

function autoRoll(state: GameState, rng: RNG): void {
  state.lastRoll = [die(rng), die(rng)];
  state.rollSeq = (state.rollSeq ?? 0) + 1;
  state.turnPhase = 'awaitMove';
  const p = requirePlayer(state, currentPlayerId(state));
  log(state, `${p.name} rolls ${state.lastRoll[0]} + ${state.lastRoll[1]} = ${state.lastRoll[0] + state.lastRoll[1]}.`);
}

/** Set up the current player's movement phase: auto-roll in the open, or offer the in-room choice. */
export function beginTurn(state: GameState, rng: RNG): void {
  state.lastMove = undefined;
  const p = requirePlayer(state, currentPlayerId(state));
  if (p.inRoomId) {
    state.turnPhase = 'awaitRoll';
    state.lastRoll = undefined;
  } else {
    autoRoll(state, rng);
  }
}

/** In-room player elects to roll and move out (they may not stay). */
export function rollAndMove(state: GameState, playerId: string, rng: RNG): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'awaitRoll') throw new Error('You cannot roll right now.');
  autoRoll(s, rng);
  return s;
}

/** The room a secret passage leads to from `roomId`, if this room has one. */
export function shortcutDestForRoom(roomId: string | undefined): string | undefined {
  if (!roomId) return undefined;
  const sc = BOARD.shortcuts.find((x) => x.kind === 'room' && (x.aRoomId === roomId || x.bRoomId === roomId));
  if (!sc) return undefined;
  return sc.aRoomId === roomId ? sc.bRoomId : sc.aRoomId;
}

/** Take the secret passage out of the current room — counts as the whole movement phase. */
export function takeShortcut(state: GameState, playerId: string): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'awaitRoll') throw new Error('You can only take a shortcut at the start of your turn.');
  const player = requirePlayer(s, playerId);
  const destRoomId = shortcutDestForRoom(player.inRoomId);
  if (!destRoomId) throw new Error('There is no secret passage from this room.');
  const destRoom = BOARD.rooms[destRoomId];
  const before = player.position;
  player.position = { x: destRoom.tiles[0].x, y: destRoom.tiles[0].y };
  player.inRoomId = destRoomId;
  s.lastMove = { playerId, path: [before, { x: destRoom.tiles[0].x, y: destRoom.tiles[0].y }] };
  s.turnPhase = 'postMove';
  log(s, `${player.name} takes the secret passage to the ${getCard(destRoomId)?.title}.`);
  return s;
}

/** In-room player skips movement (stays put) to go straight to the suspect/accuse phase. */
export function skipMovement(state: GameState, playerId: string): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'awaitRoll') throw new Error('Nothing to skip.');
  s.turnPhase = 'postMove';
  log(s, `${requirePlayer(s, playerId).name} stays in the ${getCard(requirePlayer(s, playerId).inRoomId!)?.title}.`);
  return s;
}

/** Move the active piece to a chosen, reachable destination tile. */
export function moveTo(state: GameState, playerId: string, dest: Coord): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'awaitMove' || !s.lastRoll) throw new Error('You cannot move right now.');

  const player = requirePlayer(s, playerId);
  const steps = s.lastRoll[0] + s.lastRoll[1];
  const blocked = blockedCells(BOARD, otherPositions(s, playerId));
  const reach = new Set(reachableTiles(BOARD, player.position, steps, blocked).map(coordKey));
  if (!reach.has(coordKey(dest))) throw new Error('That square is out of range.');

  const path = pathTo(BOARD, player.position, dest, steps, blocked);
  player.position = { x: dest.x, y: dest.y };
  s.lastMove = { playerId, path };

  // Stepped into an elevator? Stop, and let them choose a floor to ride to (then continue moving).
  const elevFloor = elevatorFloorAt(BOARD, dest);
  if (elevFloor) {
    player.inRoomId = undefined;
    const used = Math.max(0, path.length - 1);
    s.elevatorRide = { fromFloor: elevFloor, stepsLeft: Math.max(0, steps - used) };
    s.turnPhase = 'awaitElevator';
    log(s, `${player.name} steps into the elevator.`);
    return s;
  }

  player.inRoomId = roomIdAt(BOARD, dest);
  s.turnPhase = 'postMove';
  const where = player.inRoomId ? `enters the ${getCard(player.inRoomId)?.title}` : 'moves';
  log(s, `${player.name} ${where}.`);
  return s;
}

/** Ride the elevator to a chosen floor, emerge at its exit, and continue with any steps left. */
export function chooseFloor(state: GameState, playerId: string, floor: FloorId, rng: RNG): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'awaitElevator' || !s.elevatorRide) throw new Error('You are not in the elevator.');
  if (!elevatorOptions(s.elevatorRide.fromFloor).includes(floor)) throw new Error('You cannot ride to that floor.');

  const elev = BOARD.elevators.find((e) => e.floor === floor);
  if (!elev) throw new Error('No elevator there.');
  const player = requirePlayer(s, playerId);
  const before = player.position;
  player.position = { x: elev.exit.x, y: elev.exit.y };
  player.inRoomId = undefined;
  s.lastMove = { playerId, path: [before, { x: elev.exit.x, y: elev.exit.y }] };

  const stepsLeft = s.elevatorRide.stepsLeft;
  log(s, `${player.name} rides the elevator to the ${FLOOR_NAMES[floor]}.`);
  s.elevatorRide = undefined;

  if (stepsLeft > 0) {
    s.lastRoll = [stepsLeft, 0];
    s.turnPhase = 'awaitMove';
  } else {
    s.turnPhase = 'postMove';
  }
  void rng;
  return s;
}

/** Reachable destination tiles for the active player right now (for highlighting). */
export function activeReachable(state: GameState): Coord[] {
  if (state.turnPhase !== 'awaitMove' || !state.lastRoll) return [];
  const player = getPlayer(state, currentPlayerId(state));
  if (!player) return [];
  const steps = state.lastRoll[0] + state.lastRoll[1];
  const blocked = blockedCells(BOARD, otherPositions(state, player.id));
  return reachableTiles(BOARD, player.position, steps, blocked);
}

/** Advance to the next active player and set up their movement phase. Used after a turn's actions
 *  conclude it (movement end, suggestion resolved, wrong accusation). */
export function concludeTurn(state: GameState, rng: RNG): void {
  advanceTurn(state);
  beginTurn(state, rng);
}

/** End the current turn and set up the next player's movement phase. */
export function endTurn(state: GameState, playerId: string, rng: RNG): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  if (s.turnPhase !== 'postMove') throw new Error('Finish moving before ending your turn.');
  advanceTurn(s);
  beginTurn(s, rng);
  return s;
}

/** Advance past the current player unconditionally (used for stuck bots / disconnects). */
export function passTurn(state: GameState, playerId: string, rng: RNG): GameState {
  const s = clone(state);
  if (currentPlayerId(s) !== playerId) throw new Error('Not your turn.');
  advanceTurn(s);
  beginTurn(s, rng);
  return s;
}

/** Start tile for a suspect. */
export function startTileOf(suspectId: string): Coord {
  const s = BOARD.starts.find((st) => st.suspectId === suspectId);
  return s ? { x: s.tile.x, y: s.tile.y } : { x: 0, y: 0 };
}
