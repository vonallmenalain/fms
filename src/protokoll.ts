/**
 * Protokoll — wer hat wann was gebucht.
 *
 * Ein Eintrag je Vorgang, in einer eigenen Sammlung `log`. Für die Administration ist das
 * der Nachweis, was am Morgen tatsächlich passiert ist: welches Gerät, welche Art von
 * Client, um welche Uhrzeit, wie viele Plätze und wie viele Slots.
 *
 * DREI ENTSCHEIDE, die verhindern, dass das Protokoll die Anmeldung ausbremst:
 *
 * 1. **Ausserhalb der Transaktion, ohne `await`.** Der Eintrag wird erst geschrieben,
 *    nachdem die Buchung schon durch ist. Er liegt damit nicht auf dem kritischen Pfad:
 *    Die Person sieht ihre Buchung genau gleich schnell wie vorher, und eine abgelehnte
 *    oder verlorene Protokollzeile kann eine gültige Buchung nie zurücknehmen.
 * 2. **Eigenes Dokument je Eintrag, mit Zufalls-ID.** Es gibt kein heisses Dokument, auf
 *    das sich der Andrang bündelt — genau der Engpass aus docs/05 §5. 200 gleichzeitige
 *    Einträge sind 200 unabhängige Schreibvorgänge auf 200 verschiedene Dokumente.
 * 3. **Abschaltbar zur Laufzeit** über `config/app.protokoll`, wie der Live-Zähler.
 *    Falls es am Eventmorgen wider Erwarten klemmt, ist der Schalter in Reichweite.
 *
 * Fehler werden bewusst geschluckt: Ein Protokoll, das eine Buchung scheitern lässt,
 * wäre schlimmer als gar keines.
 */
import { addDoc, collection, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { BlockId } from './programm';

export type Vorgang = 'gebucht' | 'gewechselt' | 'freigegeben' | 'erfasst' | 'uebernommen';

export const VORGANG_TEXT: Record<Vorgang, string> = {
  gebucht: 'gebucht',
  gewechselt: 'gewechselt',
  freigegeben: 'freigegeben',
  erfasst: 'am Stand erfasst',
  uebernommen: 'ins Konto übernommen',
};

/** Was bei einem einzelnen Vorgang passiert ist — der Teil, den die Buchung kennt. */
export interface Vorgangsnotiz {
  vorgang: Vorgang;
  block: BlockId | null;
  angebot: string | null;
  /** Das vorher gewählte Angebot — nur beim Wechseln und beim Freigeben gesetzt. */
  vorher: string | null;
  /** Gruppengrösse: so viele Plätze hat dieser Vorgang bewegt. */
  plaetze: number;
  /** Wie viele der vier Slots dieser Client NACH dem Vorgang hält. */
  slots: number;
}

export interface LogEintrag extends Vorgangsnotiz {
  zeitpunkt: Timestamp | null;
  /** Buchungs-ID: bei Gästen die anonyme Geräte-ID, bei Erfassungen die Dokument-ID. */
  client: string;
  art: 'gast' | 'admin';
  geraet: string;
}

/**
 * Grobe Geräteart, aus der User-Agent-Zeile: «iPhone · Safari», «Android · Chrome».
 *
 * Bewusst ohne Versionsnummern und ohne die vollständige Zeile — das Fachkonzept sagt
 * «keine Personendaten», und für die Frage «womit kommen die Leute?» genügt die Familie.
 * Für die Administration ist genau das der Wert: Ob am Info-Stand ein iPhone-Problem
 * oder ein Android-Problem vorliegt, sieht man in dieser Spalte in zwei Sekunden.
 */
export function geraeteArt(): string {
  // Im Lasttest läuft derselbe Buchungskode unter Node (siehe scripts/andrangtest.mjs).
  // Geprüft wird auf `window`, nicht auf `navigator`: Node bringt seit Version 21 selbst
  // ein `navigator` mit — die Zeile stand sonst als «unbekannt · unbekannt» im Protokoll.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'Server · Node';
  const ua = navigator.userAgent ?? '';
  const tippt = navigator.maxTouchPoints ?? 0;

  const system =
    /iPhone|iPod/.test(ua) ? 'iPhone'
    // Ein iPad meldet sich seit iPadOS 13 als «Macintosh» — nur die Berührungspunkte
    // verraten es. Ohne diese Zeile stünde die halbe Tablet-Nutzung als «Mac» im Protokoll.
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && tippt > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'unbekannt';

  // Reihenfolge ist hier alles: Edge nennt sich «Chrome», und Chrome nennt sich «Safari».
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'unbekannt';

  return `${system} · ${browser}`;
}

/**
 * Laufzeitschalter aus `config/app.protokoll`. Er wird von useAppConfig gesetzt — dort
 * hört ohnehin schon ein Listener zu, ein zweiter nur fürs Protokoll wäre verschwendet.
 * Voreinstellung `true`: Ein Protokoll, das erst nach dem Laden der Steuerung zu
 * schreiben beginnt, hätte ausgerechnet am Anfang ein Loch.
 */
let schreiben = true;

export function protokollSchalter(an: boolean): void {
  schreiben = an;
}

/**
 * Einen Vorgang festhalten. Kehrt sofort zurück — der Schreibvorgang läuft nebenher.
 *
 * Wer den Browser in derselben Zehntelsekunde schliesst, verliert diese eine Zeile; die
 * Buchung selbst ist zu diesem Zeitpunkt längst bestätigt. Das ist der bewusste Tausch:
 * ein Protokoll, das nichts kostet, gegen ein Protokoll, das lückenlos garantiert ist.
 */
export function protokolliere(client: string, art: 'gast' | 'admin', notiz: Vorgangsnotiz): void {
  if (!schreiben) return;
  void addDoc(collection(db, 'log'), {
    zeitpunkt: serverTimestamp(),
    client,
    art,
    geraet: geraeteArt(),
    ...notiz,
  }).catch(() => {
    // Still. Die Buchung ist durch; das Protokoll ist die Nebensache, nicht die Hauptsache.
  });
}
