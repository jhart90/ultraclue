import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from 'shared';
import './Chat.css';

export function Chat({ messages, onSend }: { messages: ChatMsg[]; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="chat">
      <div className="chat__header">Chat</div>
      <div className="chat__log">
        {messages.length === 0 && <div className="chat__empty">No messages yet. Say hello!</div>}
        {messages.map((m) => (
          <div className="chat__msg" key={m.id}>
            <span className={m.from === 'System' ? 'chat__from chat__from--sys' : 'chat__from'}>
              {m.from}:
            </span>{' '}
            {m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) {
            onSend(t);
            setText('');
          }
        }}
      >
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
        />
        <button type="submit" className="chat__send">
          Send
        </button>
      </form>
    </div>
  );
}
