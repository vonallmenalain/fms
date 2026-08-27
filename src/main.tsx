import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Service Worker anmelden — er macht die App ohne Netz startfähig.
 *
 * Erst nach `load`, damit das Herunterladen des Standes nicht mit dem ersten
 * Zeichnen um die Leitung streitet. Und nur im gebauten Stand: Im
 * Entwicklungsbetrieb liefert Vite die Module einzeln aus, ein
 * Zwischenspeicher davor würde nur alte Fassungen festhalten. `dist/sw.js`
 * entsteht beim Bau — siehe scripts/sw-vorlage.js.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Scheitert die Anmeldung (privates Fenster, abgeschaltet, kein HTTPS),
    // läuft die App wie bisher weiter — nur eben nicht offline.
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
