import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Screens open at the top: a reload must not have the browser restore an old scroll position
// (the title screen in particular always starts fully scrolled up).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
