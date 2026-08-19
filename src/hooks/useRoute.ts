import { useEffect, useState } from 'react';

/**
 * Winziger Router für drei Pfade. Eine Bibliothek wäre hier ~15 KB für nichts —
 * und jedes Kilobyte zählt, wenn 200 Geräte gleichzeitig laden.
 */
export function useRoute(): [string, (pfad: string) => void] {
  const [pfad, setPfad] = useState(() => window.location.pathname);

  useEffect(() => {
    const beiZurueck = () => setPfad(window.location.pathname);
    window.addEventListener('popstate', beiZurueck);
    return () => window.removeEventListener('popstate', beiZurueck);
  }, []);

  const gehe = (ziel: string) => {
    if (ziel === window.location.pathname) return;
    window.history.pushState({}, '', ziel);
    setPfad(ziel);
    window.scrollTo(0, 0);
  };

  return [pfad, gehe];
}
