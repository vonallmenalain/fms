import { useCallback, useEffect, useRef, useState } from 'react';

interface Stand<T> { stapel: T[]; i: number }

/** Marke im History-Eintrag: an ihr erkennt «zurück», welcher Bildschirm gemeint ist. */
interface VerlaufsMarke { fmsTiefe?: number }

const tiefeVon = (zustand: unknown): number => {
  const t = (zustand as VerlaufsMarke | null)?.fmsTiefe;
  return typeof t === 'number' && t >= 0 ? t : 0;
};

/**
 * Der Bildschirmverlauf der Gast-App, aufgehängt am Browser-Verlauf.
 *
 * Ohne das hier hat der Zurück-Knopf des Handys nichts, worauf er zeigen könnte: Die App
 * bleibt die ganze Zeit auf «/», also verlässt der erste Druck die App und zeigt die Seite,
 * die vorher im Tab war. Darum bekommt jeder Bildschirmwechsel einen History-Eintrag mit
 * seiner Tiefe. Zurück heisst dann immer: genau ein Bildschirm zurück — der Knopf in der
 * App und der des Handys tun dasselbe.
 *
 * Der Stapel bleibt beim Zurückgehen vollständig, damit auch «vorwärts» wieder stimmt.
 */
export function useVerlauf<T extends string>(start: T) {
  const [nav, setNav] = useState<Stand<T>>({ stapel: [start], i: 0 });

  // Spiegel für die Knöpfe: Sie müssen den aktuellen Stand kennen, ohne dass jeder
  // Aufrufer neu erzeugt wird (und ohne Seiteneffekt im setState-Aktualisierer).
  const jetzt = useRef(nav);
  jetzt.current = nav;

  useEffect(() => {
    // Der Einstiegseintrag trägt noch keine Marke — nachtragen, sonst landet der erste
    // Rücksprung auf Tiefe 0 statt auf dem Bildschirm, von dem er kam.
    window.history.replaceState({ ...(window.history.state ?? {}), fmsTiefe: 0 }, '');

    const beiZurueck = (e: PopStateEvent) => {
      const stand = jetzt.current;
      const ziel = Math.min(tiefeVon(e.state), stand.stapel.length - 1);
      if (ziel === stand.i) return;
      const neu = { ...stand, i: ziel };
      jetzt.current = neu;
      setNav(neu);
      window.scrollTo(0, 0);
    };

    window.addEventListener('popstate', beiZurueck);
    return () => window.removeEventListener('popstate', beiZurueck);
  }, []);

  /** Einen Bildschirm weiter — legt einen History-Eintrag an. */
  const gehe = useCallback((ziel: T) => {
    const { stapel, i } = jetzt.current;
    if (stapel[i] === ziel) return;
    const neu = { stapel: [...stapel.slice(0, i + 1), ziel], i: i + 1 };
    window.history.pushState({ fmsTiefe: neu.i }, '');
    jetzt.current = neu;
    setNav(neu);
    window.scrollTo(0, 0);
  }, []);

  /**
   * Den aktuellen Bildschirm austauschen, ohne einen Eintrag anzulegen — für Sprünge,
   * die kein eigener Schritt sind: das wiederhergestellte Ticket beim Laden, der Rückwurf
   * auf den Start, wenn die Anmeldung inzwischen geschlossen ist.
   */
  const ersetze = useCallback((ziel: T) => {
    const { stapel, i } = jetzt.current;
    if (stapel[i] === ziel) return;
    const neuerStapel = stapel.slice(0, i + 1);
    neuerStapel[i] = ziel;
    window.history.replaceState({ ...(window.history.state ?? {}), fmsTiefe: i }, '');
    const neu = { stapel: neuerStapel, i };
    jetzt.current = neu;
    setNav(neu);
    window.scrollTo(0, 0);
  }, []);

  /** Genau ein Bildschirm zurück. */
  const zurueck = useCallback(() => {
    if (jetzt.current.i > 0) window.history.back();
  }, []);

  return {
    schritt: nav.stapel[nav.i],
    /** Der Bildschirm, von dem wir hierher kamen — oder null am Anfang des Verlaufs. */
    vorher: nav.i > 0 ? nav.stapel[nav.i - 1] : null,
    gehe,
    ersetze,
    zurueck,
  };
}
