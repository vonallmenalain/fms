// src/wiederholung.ts — Schutz gegen Andrang auf ein einzelnes Angebot.
//
// Tippen 60 Personen gleichzeitig auf «Sport · 27Fd», zielen 60 Transaktionen auf dasselbe
// Firestore-Dokument. Firestore reiht sie auf und gibt intern nach 5 Versuchen auf. Diese
// äussere Wiederholung fängt das ab — mit Streuung, damit die Versuche nicht erneut im
// Gleichschritt zurückkommen. Siehe docs/05-last-und-performance.md §5.

const WARTEZEITEN_MS = [120, 300, 700, 1500];   // Summe ~2.6 s im schlechtesten Fall

/** Fehler, der NICHT wiederholt werden soll: das Angebot ist wirklich voll. */
export class AusgebuchtFehler extends Error {
  constructor(public angebotId: string) {
    super(`Angebot ${angebotId} ist ausgebucht`);
  }
}

const streuung = (ms: number) => ms * (0.6 + Math.random() * 0.8);   // ±40 %

export async function mitWiederholung<T>(vorgang: () => Promise<T>): Promise<T> {
  let letzterFehler: unknown;

  for (let versuch = 0; versuch <= WARTEZEITEN_MS.length; versuch++) {
    try {
      return await vorgang();
    } catch (fehler) {
      // Ausgebucht ist ein Ergebnis, kein Fehler — sofort nach oben durchreichen.
      if (fehler instanceof AusgebuchtFehler) throw fehler;

      letzterFehler = fehler;
      if (versuch === WARTEZEITEN_MS.length) break;
      await new Promise((r) => setTimeout(r, streuung(WARTEZEITEN_MS[versuch])));
    }
  }
  throw letzterFehler;
}

// --- Ein Vorgang pro Gerät -------------------------------------------------
// Verhindert, dass ein doppelter Tipp zwei Transaktionen gleichzeitig startet und das
// Gerät sich selbst behindert.

let laufend: Promise<unknown> = Promise.resolve();

export function nacheinander<T>(vorgang: () => Promise<T>): Promise<T> {
  const naechster = laufend.then(vorgang, vorgang);
  laufend = naechster.catch(() => undefined);
  return naechster as Promise<T>;
}
