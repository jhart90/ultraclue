import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './PopOut.css';

// A panel "popped out" into its own browser window, Roll67-style. The window is a blank page of
// ours that borrows every stylesheet the app has loaded (and keeps borrowing as Vite hot-swaps
// them), and the panel is rendered into it through a React portal — so it stays part of the same
// React tree, reads the same store and receives the same updates as it did in the dock.

interface PopOutOptions {
  /** Names the window (`popout-<name>`), so opening the same panel again reuses it. */
  name: string;
  /** The new window's title bar. */
  title: string;
  width: number;
  height: number;
  /** Called when the person closes the window themselves (or the browser refused to open one). */
  onClose: () => void;
}

/** Open (while `open`) a window for a panel; `container` is where to portal the panel, `focus`
 *  brings the window to the front. Closing the window from its own chrome calls `onClose`. */
export function usePopOut(open: boolean, { name, title, width, height, onClose }: PopOutOptions) {
  const winRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // Centre it over this window; browsers clamp anything off-screen.
    const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - width) / 2));
    const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - height) / 2));
    const w = window.open('', `popout-${name}`, `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!w) {
      onCloseRef.current(); // blocked: stay in the dock
      return;
    }
    winRef.current = w;
    const doc = w.document;
    // A window of this name may already exist (a panel popped out, put back and popped out again
    // before the browser finished closing it): start it from blank either way.
    doc.head.innerHTML = '';
    doc.body.innerHTML = '';
    doc.title = title;
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    doc.head.appendChild(charset);
    // Relative URLs in the borrowed styles (fonts, textures) resolve as they do for the app.
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.appendChild(base);

    // Mirror the app's stylesheets. In development Vite injects <style> blocks and rewrites them on
    // the fly; in production they are <link>s. Either way, re-copy whenever the app's head changes.
    const copied: Node[] = [];
    const sync = () => {
      for (const n of copied) n.parentNode?.removeChild(n);
      copied.length = 0;
      for (const el of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
        const clone = doc.importNode(el, true);
        doc.head.appendChild(clone);
        copied.push(clone);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    const root = doc.createElement('div');
    root.className = 'popout';
    doc.body.className = 'popout-body';
    doc.body.appendChild(root);
    setContainer(root);

    // The person closing the window brings the panel back into the dock; us closing it must not.
    let closing = false;
    const onHide = () => {
      if (!closing) onCloseRef.current();
    };
    w.addEventListener('pagehide', onHide);
    // No orphaned windows if this page goes away.
    const closeWith = () => w.close();
    window.addEventListener('pagehide', closeWith);

    return () => {
      closing = true;
      observer.disconnect();
      w.removeEventListener('pagehide', onHide);
      window.removeEventListener('pagehide', closeWith);
      setContainer(null);
      winRef.current = null;
      if (!w.closed) w.close();
    };
  }, [open, name, title, width, height]);

  const focus = useCallback(() => winRef.current?.focus(), []);
  return { container, focus };
}

/** Render `children` into a popped-out window's container (nothing while there is none). */
export function PopOut({ container, children }: { container: HTMLElement | null; children: ReactNode }) {
  return container ? createPortal(children, container) : null;
}
