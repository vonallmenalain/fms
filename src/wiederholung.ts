/**
 * Schutz gegen Andrang auf ein einzelnes Angebot.
 * Tippen viele Personen gleichzeitig auf dasselbe Fach, zielen alle Transaktionen auf
 * dasselbe Firestore-Dokument; das SDK gibt intern nach wenigen Versuchen auf. Diese
 * äussere Wiederholung fängt das ab — mit Streuung, damit die Versuche nicht erneut im
 * Gleichschritt zurückkommen. Siehe docs/05-last-und-performance.md §5.
 */

const WARTEZEITEN_MS = [120, 300, 700, 1500];

export class AusgebuchtFehler extends Error {
  readonly name = 'AusgebuchtFehler';
  constructor(public angebotId: string) {
    super(`Angebot ${angebotId} ist ausgebucht`);
  }
}

/** Der Server hat den Schreibvorgang abgelehnt — meist, weil die Anmeldung geschlossen ist. */
export class RechteFehler extends Error {
  readonly name = 'RechteFehler';
  constructor() { super('Schreibvorgang vom Server abgelehnt'); }
}

const streuung = (ms: number) => ms * (0.6 + Math.random() * 0.8);

export async function mitWiederholung<T>(vorgang: () => Promise<T>): Promise<T> {
  let letzter: unknown;
  for (let versuch = 0; versuch <= WARTEZEITEN_MS.length; versuch++) {
    try {
      return await vorgang();
    } catch (fehler) {
      // Fachliche Ergebnisse nicht wiederholen.
      if (fehler instanceof AusgebuchtFehler || fehler instanceof RechteFehler) throw fehler;
      letzter = fehler;
      if (versuch === WARTEZEITEN_MS.length) break;
      await new Promise((r) => setTimeout(r, streuung(WARTEZEITEN_MS[versuch])));
    }
  }
  throw letzter;
}

/**
 * Ein Vorgang pro Gerät: verhindert, dass ein doppelter Tipp zwei Transaktionen
 * gleichzeitig startet und sich das Gerät selbst behindert.
 */
let laufend: Promise<unknown> = Promise.resolve();

export function nacheinander<T>(vorgang: () => Promise<T>): Promise<T> {
  const naechster = laufend.then(vorgang, vorgang);
  laufend = naechster.catch(() => undefined);
  return naechster as Promise<T>;
}
