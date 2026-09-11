import wordmark from '../../../40_alibis_wordmark_black_transparent.png';
import wordmarkTrimmed from '../../../40_alibis_wordmark_title.webp';
import './Wordmark.css';

// The 40 Alibis logo wordmark, used wherever the game title appears on screen. The title-screen
// size uses art cropped tight to the letters so the layout can sit the blood drop on the tagline.
export function Wordmark({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const src = size === 'lg' ? wordmarkTrimmed : wordmark;
  return <img src={src} alt="40 Alibis" className={`wordmark wordmark--${size} ${className}`} draggable={false} />;
}
