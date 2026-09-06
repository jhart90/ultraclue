import { getCard, WEAPONS, ROOMS, type AnyCard } from 'shared';
import { WEAPON_GLYPHS } from '../render/weaponGlyphs';
import { readableOnDark } from '../render/colorUtils';
import './CardName.css';

// How a card's name is written anywhere it appears as text (chat, pop-ups, choosers, lists):
//  - a room is lettered the way its nameplate on the board is: black Georgia bold in a white
//    bubble with a dark outline, so the name reads as "that place on the map";
//  - a weapon carries its pewter board-token glyph just before the word;
//  - a suspect is bold in their piece colour, lightened to read on the app's dark backgrounds
//    (pass `plain` where the name sits on a coloured pill and the tint would clash).

/** A room name drawn as the board's nameplate bubble. */
export function RoomName({ title }: { title: string }) {
  return <span className="roomplate">{title}</span>;
}

/** The pewter silhouette used for this weapon's token on the board, at text size. */
export function WeaponIcon({ id }: { id: string }) {
  const g = WEAPON_GLYPHS[id];
  return (
    <svg className="weaponname__icon" viewBox="-8 -8 16 16" aria-hidden="true">
      {g ? (
        <>
          {g.thick && <path d={g.thick} fill="none" stroke="#4b4e54" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
          {g.thick && <path d={g.thick} fill="none" stroke="#c9cdd3" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />}
          {g.d && <path d={g.d} fill="#b9bdc5" stroke="#4b4e54" strokeWidth={0.7} strokeLinejoin="round" />}
          {g.lines && <path d={g.lines} fill="none" stroke="#4b4e54" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />}
        </>
      ) : (
        <circle r={6.5} fill="#b9bdc5" stroke="#4b4e54" />
      )}
    </svg>
  );
}

/** A weapon name with its token glyph in front. */
export function WeaponName({ id, title }: { id: string; title: string }) {
  return (
    <span className="weaponname">
      <WeaponIcon id={id} />
      {title}
    </span>
  );
}

/** Any card's name, styled by its type. Unknown ids fall back to the id as plain text. */
export function CardName({ id, card, plain }: { id?: string; card?: AnyCard; plain?: boolean }) {
  const c = card ?? (id ? getCard(id) : undefined);
  if (!c) return <>{id}</>;
  if (c.type === 'room') return <RoomName title={c.title} />;
  if (c.type === 'weapon') return <WeaponName id={c.id} title={c.title} />;
  return (
    <strong className="suspectname" style={plain ? undefined : { color: readableOnDark(c.color) }}>
      {c.title}
    </strong>
  );
}

// Lower-cased title -> card, for text that names cards in prose (chat lines, pop-up sentences).
const BY_TITLE = new Map<string, AnyCard>();
for (const w of WEAPONS) BY_TITLE.set(w.title.toLowerCase(), w);
for (const r of ROOMS) BY_TITLE.set(r.title.toLowerCase(), r);

/** The weapon or room whose title this is (case-insensitive), if any. */
export function weaponOrRoomByTitle(title: string): AnyCard | undefined {
  return BY_TITLE.get(title.toLowerCase());
}
