import { useStore } from './store';
import { Title } from './screens/Title';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';
import { Gallery } from './screens/Gallery';
import { SeatPicker } from './components/SeatPicker';

export function App() {
  const screen = useStore((s) => s.screen);
  const seatPick = useStore((s) => s.seatPick);

  const view = (() => {
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
  })();

  return (
    <>
      {view}
      {seatPick && <SeatPicker />}
    </>
  );
}
