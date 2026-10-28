import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { datumIso } from '../programm';
import type { Buchung } from '../buchung';
import { gleicheBuchung, leereWahl } from '../buchung';

interface Stand { uid: string; buchung: Buchung | null }

/**
 * Die eigene Anmeldung — so, dass die Auswahl in jedem Fall auf dem Schirm steht.
 *
 * Bis zum Besuchsmorgen vom 28.10.2026 kam sie allein aus dem Live-Listener. Auf einzelnen
 * iPhones lieferte der keine Daten (siehe src/firebase.ts), obwohl alle Buchungen
 * gespeichert waren: Karten ohne Haken, nach «Abschliessen» eine leere Auswahl — und nach
 * dem Neuladen holte der Zwischenspeicher denselben veralteten Stand wieder hervor.
 * Seither zählen drei Quellen, in dieser Rangfolge:
 *
 *  1. das Ergebnis der eigenen Buchung — die Transaktion meldet zurück, was gespeichert
 *     ist. Es gilt, bis der Listener diesen oder einen neueren Stand liefert; ältere
 *     Stände, die er verspätet nachliefert, überschreiben es nicht.
 *  2. der Live-Listener auf bookings/{uid}, solange er vom Server kommt. Nach einem
 *     Fehler verbindet er sich neu.
 *  3. die Kopie im Gerätespeicher, geschrieben bei jedem bekannten Stand. Sie ist nie
 *     älter als der Firestore-Zwischenspeicher, denn der erfährt nur, was der Listener
 *     liefert — und genau der kann hängen.
 *
 * `sicher` heisst: Der Stand ist bekannt. Unsicher ist nur das «gibt es nicht», wenn
 * Firestore offline ist oder die Frist ohne Antwort abläuft.
 */
export function useBuchung(uid: string | null) {
  const [server, setServer] = useState<Stand & { ausCache: boolean } | null>(null);
  const [eigene, setEigene] = useState<Stand | null>(null);
  const kopie = useMemo(() => (uid ? leseKopie(uid) : undefined), [uid]);

  useEffect(() => {
    if (!uid) return;
    let abmelden = () => {};
    let neuerVersuch: ReturnType<typeof setTimeout> | undefined;
    let fehler = 0;
    const abonnieren = () => {
      abmelden = onSnapshot(
        doc(db, 'bookings', uid),
        (s) => {
          fehler = 0;
          const b = s.exists() ? vollstaendig(s.data() as Buchung) : null;
          setServer({ uid, buchung: b, ausCache: s.metadata.fromCache });
          // Bestätigt der Listener die eigene Buchung — oder liefert er einen neueren Stand,
          // etwa aus einem zweiten Tab —, führt ab jetzt wieder er.
          setEigene((e) => (e?.uid === uid && (gleicheBuchung(e.buchung, b) || neuer(b, e.buchung)) ? null : e));
        },
        // Nach einem Fehler beendet Firestore den Listener endgültig — also neu verbinden.
        () => { neuerVersuch = setTimeout(abonnieren, Math.min(30_000, 1000 * 2 ** fehler++)); },
      );
    };
    abonnieren();

    // Sicherheitsnetz gegen einen Ladebildschirm ohne Ende: Firestore meldet sich für ein
    // Dokument, das es weder auf dem Server noch im Zwischenspeicher findet, schlicht nie —
    // weder mit Daten noch mit einem Fehler. Ohne Netz ist das der Normalfall für ein
    // Gerät, dessen Anmeldung noch nie geladen wurde; die App bliebe bei «Einen Moment …»
    // stehen. Nach der Frist gilt: Es ist nichts bekannt. Kommt die Anmeldung später doch
    // noch, ersetzt der Listener sie ohnehin.
    const frist = setTimeout(
      () => setServer((s) => (s?.uid === uid ? s : { uid, buchung: null, ausCache: true })),
      navigator.onLine ? 10000 : 1500,
    );

    return () => { clearTimeout(frist); clearTimeout(neuerVersuch); abmelden(); };
  }, [uid]);

  const e = eigene?.uid === uid ? eigene : null;
  const s = server?.uid === uid ? server : null;
  const quelle: { buchung: Buchung | null; sicher: boolean } | null =
    e ? { buchung: e.buchung, sicher: true }
    : s && !s.ausCache ? { buchung: s.buchung, sicher: true }
    : kopie !== undefined ? { buchung: kopie, sicher: true }
    : s ? { buchung: s.buchung, sicher: s.buchung !== null }
    : null;
  const buchung = quelle?.buchung ?? null;
  const sicher = quelle?.sicher ?? false;

  useEffect(() => {
    if (uid && sicher) schreibeKopie(uid, buchung);
  }, [uid, sicher, buchung]);

  /** Nach einer eigenen Buchung: das Ergebnis der Transaktion sofort übernehmen. */
  const merke = useCallback((fuerUid: string, b: Buchung | null) => {
    schreibeKopie(fuerUid, b);
    setEigene({ uid: fuerUid, buchung: b });
  }, []);

  return { buchung, geladen: quelle !== null, sicher, merke };
}

const vollstaendig = (b: Buchung): Buchung => ({ ...b, wahl: { ...leereWahl(), ...b.wahl } });

const millis = (t: unknown): number | null =>
  (t as { toMillis?: () => number } | null | undefined)?.toMillis?.() ?? null;

/**
 * Wurde `b` nach dem Stand geschrieben, auf dem die eigene Buchung aufbaute? Das Ergebnis
 * der Transaktion trägt noch den Zeitstempel des Stands, den sie gelesen hat; jeder
 * spätere Schreibvorgang — der eigene eingeschlossen — hat einen jüngeren. Gab es vorher
 * gar keine Anmeldung, ist jeder vorhandene Stand neuer.
 */
function neuer(b: Buchung | null, eigene: Buchung | null): boolean {
  const t = millis(b?.geaendertAm);
  if (t === null) return false;
  const gelesen = millis(eigene?.geaendertAm);
  return gelesen === null || t > gelesen;
}

/* ------------------------------------------------- Kopie im Gerätespeicher */

const KOPIE = 'fms.auswahl';

/** `undefined` = keine Kopie für diese Sitzung und diesen Anlass. */
function leseKopie(uid: string): Buchung | undefined {
  try {
    const roh = window.localStorage.getItem(KOPIE);
    if (!roh) return undefined;
    const k = JSON.parse(roh) as { uid: string; datum: string; buchung: Buchung };
    // Das Datum des Anlasses gehört dazu: Eine Auswahl vom letzten Jahr ist keine.
    return k.uid === uid && k.datum === datumIso() ? vollstaendig(k.buchung) : undefined;
  } catch {
    return undefined;
  }
}

function schreibeKopie(uid: string, b: Buchung | null): void {
  // Gesperrter Speicher (privates Fenster, «Alle Cookies blockieren») ist kein Fehler —
  // dann gibt es eben keine Kopie, alles andere funktioniert gleich.
  try {
    if (!b) { window.localStorage.removeItem(KOPIE); return; }
    const { plaetze, wahl, quelle, notiz } = b;
    window.localStorage.setItem(KOPIE, JSON.stringify({
      uid, datum: datumIso(), buchung: { plaetze, wahl, quelle, notiz },
    }));
  } catch { /* siehe oben */ }
}

/**
 * Alle Anmeldungen samt Dokument-ID — nur für die Betreuung (firestore.rules).
 *
 * Die ID ist bei Gästen die anonyme Geräte-ID: Sie ist der «Client» im Protokoll und
 * verbindet die Anmeldung mit ihren Vorgängen. Darum hier mitgeliefert, anders als beim
 * Gast, der immer nur seine eigene Anmeldung sieht.
 */
export function useBuchungen() {
  const [buchungen, setBuchungen] = useState<(Buchung & { id: string })[]>([]);

  useEffect(() => onSnapshot(
    collection(db, 'bookings'),
    (s) => setBuchungen(s.docs.map((d) => ({ id: d.id, ...(d.data() as Buchung) }))),
    () => setBuchungen([]),
  ), []);

  return buchungen;
}
