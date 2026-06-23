import wordmark from '../../../ultra_clue_wordmark.png';
import './Wordmark.css';

// The Ultra Clue logo wordmark, used wherever the game title appears on screen.
export function Wordmark({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <img src={wordmark} alt="Ultra Clue" className={`wordmark wordmark--${size} ${className}`} draggable={false} />;
}
