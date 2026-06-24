import type { GameState, Player } from '../game';

/** Deep clone of game state. Engine actions clone-then-mutate so they behave as pure functions. */
export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function log(state: GameState, text: string): void {
  state.log.push({ id: state.nextLogId++, text });
}

export function getPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function requirePlayer(state: GameState, id: string): Player {
  const p = getPlayer(state, id);
  if (!p) throw new Error(`Unknown player: ${id}`);
  return p;
}

export function currentPlayerId(state: GameState): string {
  return state.turnOrder[state.activeIdx];
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.eliminated);
}

/** Advance activeIdx to the next non-eliminated player in turn order. Bumps `round` whenever the
 *  turn wraps past the end of the order (i.e. everyone has had a turn). */
export function advanceTurn(state: GameState): void {
  const n = state.turnOrder.length;
  for (let k = 1; k <= n; k++) {
    const raw = state.activeIdx + k;
    const idx = raw % n;
    if (!requirePlayer(state, state.turnOrder[idx]).eliminated) {
      if (raw >= n) state.round = (state.round ?? 0) + 1; // wrapped → a full round has completed
      state.activeIdx = idx;
      return;
    }
  }
}
