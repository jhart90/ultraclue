import { useStore } from './store';
import { Title } from './screens/Title';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';
import { Gallery } from './screens/Gallery';

export function App() {
  const screen = useStore((s) => s.screen);

  switch (screen) {
    case 'lobby':
      return <Lobby />;
    case 'game':
      return <Game />;
    case 'gallery':
      return <Gallery />;
    default:
      return <Title />;
  }
}
