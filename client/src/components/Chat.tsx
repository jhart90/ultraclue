import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from 'shared';
import { highlightChat, type ChatPlayer } from '../util/highlightChat';
import { ChatCard, type SuggestionResponse } from './ChatCard';
import './Chat.css';

/** A rendered chat item: a plain message, or an event card with the response lines that belong
 *  to it (a suggestion's "cannot disprove" / "no one could disprove" lines fold under its card). */
type Item = { msg: ChatMsg; responses: SuggestionResponse[] };

function responseKind(m: ChatMsg): SuggestionResponse['kind'] | null {
  if (!m.system || m.card) return null;
  if (/ cannot disprove it\.$/.test(m.text)) return 'pass';
  if (/^No one could disprove/.test(m.text)) return 'nobody';
  return null;
}

function groupItems(messages: ChatMsg[]): Item[] {
  const items: Item[] = [];
  let open: Item | null = null; // the latest suggestion card still collecting responses
  for (const m of messages) {
    const kind = responseKind(m);
    if (open && kind) {
      open.responses.push({ text: m.text, kind });
      if (kind === 'nobody') open = null;
      continue;
    }
    if (open && m.card?.kind === 'reveal') {
      open.responses.push({ text: m.text.replace(/ reveals a card to .*$/, ' showed a card'), kind: 'shown' });
      open = null;
    }
    const item: Item = { msg: m, responses: [] };
    items.push(item);
    if (m.card?.kind === 'suggestion') open = item;
    else if (m.card) open = null;
  }
  return items;
}

export function Chat({
  messages,
  onSend,
  players = [],
}: {
  messages: ChatMsg[];
  onSend: (text: string) => void;
  /** Current players, so their names render in their character's colour. */
  players?: ChatPlayer[];
}) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  // "Following": the log sticks to the newest message. Scrolling up more than one message's worth
  // breaks the link; new messages then count up in a pill instead of yanking the reader down.
  const followingRef = useRef(true);
  const seenCountRef = useRef(messages.length);
  const [unread, setUnread] = useState(0);

  const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;
  /** Roughly one full message: the last message's height (plus its margin), at least 40px. */
  const oneMessage = (el: HTMLElement) => {
    const last = el.lastElementChild as HTMLElement | null;
    return Math.max(40, last ? last.offsetHeight + 8 : 40);
  };
  const jumpToLatest = () => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight; // instant, so the scroll handler never mistakes it for the reader
    followingRef.current = true;
    seenCountRef.current = messages.length;
    setUnread(0);
  };

  // Keep the newest message in view by scrolling the log *container* — not scrollIntoView, which
  // also scrolls the page and, on mobile, would yank the whole lobby down to the chat at the bottom.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (followingRef.current) {
      el.scrollTop = el.scrollHeight;
      seenCountRef.current = messages.length;
      setUnread(0);
    } else {
      // Messages only ever append (or the log is trimmed from the front), so anything past what the
      // reader last saw is new to them.
      setUnread(Math.max(0, messages.length - seenCountRef.current));
    }
  }, [messages.length]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = distanceFromBottom(el) <= oneMessage(el);
    if (atBottom && !followingRef.current) {
      followingRef.current = true;
      seenCountRef.current = messages.length;
      setUnread(0);
    } else if (!atBottom && followingRef.current) {
      followingRef.current = false;
      seenCountRef.current = messages.length;
    }
  };

  return (
    <div className="chat">
      <div className="chat__header">Chat</div>
      <div className="chat__logwrap">
        <div className="chat__log" ref={logRef} onScroll={onScroll}>
          {messages.length === 0 && <div className="chat__empty">No messages yet. Say hello!</div>}
          {groupItems(messages).map(({ msg: m, responses }) =>
            m.card ? (
              <div className="chat__msg chat__msg--card" key={m.id}>
                <ChatCard card={m.card} caption={highlightChat(m.text, players)} players={players} responses={responses} />
              </div>
            ) : m.whisper ? (
              <div className="chat__msg chat__msg--whisper" key={m.id}>
                {highlightChat(m.text, players)}
              </div>
            ) : m.system ? (
              <div
                className={`chat__msg chat__msg--sys${/\b(suggests|accuses)\b/.test(m.text) ? ' chat__msg--cased' : ''}`}
                key={m.id}
              >
                {highlightChat(m.text, players)}
              </div>
            ) : (
              <div className="chat__msg" key={m.id}>
                <span className="chat__from">{highlightChat(m.from, players)}:</span> {highlightChat(m.text, players)}
              </div>
            ),
          )}
        </div>
        {unread > 0 && (
          <button className="chat__newpill" onClick={jumpToLatest} title="Jump to the latest message">
            {unread} new {unread === 1 ? 'message' : 'messages'} <span className="chat__newarrow">↓</span>
          </button>
        )}
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) {
            onSend(t);
            setText('');
            jumpToLatest(); // your own message: you obviously want to see it land
          }
        }}
      >
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…  (/w name … to whisper)"
        />
        <button type="submit" className="chat__send">
          Send
        </button>
      </form>
    </div>
  );
}
