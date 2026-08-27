import { useEffect, useState } from 'react';

/**
 * Hat das Gerät gerade Netz?
 *
 * Seit die App auch ohne Verbindung startet (Service Worker + dauerhafter
 * Firestore-Zwischenspeicher), muss sie das auch sagen können: Sonst steht die eigene
 * Anmeldung auf dem Schirm, als wäre alles in Ordnung, während jeder Tipp ins Leere
 * läuft — Buchen geht ausschliesslich online, siehe src/firebase.ts.
 *
 * `navigator.onLine` ist bewusst grob: Es meldet «online», sobald irgendeine Verbindung
 * besteht, auch in einem WLAN ohne Internet. Für den Fall, um den es hier geht —
 * Flugmodus, Funkloch, Handy ohne Empfang im Schulhaus — stimmt es zuverlässig, und
 * mehr verspricht die Anzeige auch nicht.
 */
export function useVerbindung(): { offline: boolean } {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);

  useEffect(() => {
    const wieder = () => setOffline(false);
    const weg = () => setOffline(true);
    window.addEventListener('online', wieder);
    window.addEventListener('offline', weg);
    // Zwischen dem ersten Zeichnen und diesem Effekt kann sich die Lage geändert haben.
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', wieder);
      window.removeEventListener('offline', weg);
    };
  }, []);

  return { offline };
}
