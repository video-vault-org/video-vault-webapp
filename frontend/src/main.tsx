import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error: unknown) => {
    console.error('Service worker registration failed:', error);
    window.dispatchEvent(new Event('vault:worker-error'));
  });
