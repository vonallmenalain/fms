import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { BlockId } from '../programm';

export interface SlotStand { belegt: number; kapazitaet: number }
export type Staende = Record<string, SlotStand>;

/**
 * Live-Zählerstände für genau einen Block (7 bzw. 12 Dokumente).
 * Bewusst nicht für alle 38 auf einmal: Wer auf der Ticket-Seite steht, soll keine
 * Zähleränderungen mehr empfangen. Siehe docs/05-last-und-performance.md §3.
 *
 * `live = false` (Reserveschalter config/app.liveZaehler) lädt einmalig statt dauerhaft.
 */
export function useSlots(blockId: BlockId | null, live = true) {
  const [staende, setStaende] = useState<Staende>({});
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    if (!blockId) { setStaende({}); setGeladen(true); return; }
    setGeladen(false);
    const q = query(collection(db, 'slots'), where('block', '==', blockId));
    const ab = onSnapshot(
      q,
      { includeMetadataChanges: false },
      (schnappschuss) => {
        const naechste: Staende = {};
        schnappschuss.forEach((d) => {
          const w = d.data() as SlotStand;
          naechste[d.id] = { belegt: w.belegt ?? 0, kapazitaet: w.kapazitaet ?? 0 };
        });
        setStaende(naechste);
        setGeladen(true);
        if (!live) ab();               // einmalig laden und Verbindung wieder abbauen
      },
      () => setGeladen(true),          // Rechte-/Netzfehler: Liste ohne Platzzahlen zeigen
    );
    return ab;                          // beim Verlassen des Schrittes sofort abmelden
  }, [blockId, live]);

  return { staende, geladen };
}

/** Alle 38 Zähler — nur für die Admin-Übersicht. */
export function useAlleSlots() {
  const [staende, setStaende] = useState<Staende>({});
  useEffect(() => onSnapshot(collection(db, 'slots'), (s) => {
    const n: Staende = {};
    s.forEach((d) => {
      const w = d.data() as SlotStand;
      n[d.id] = { belegt: w.belegt ?? 0, kapazitaet: w.kapazitaet ?? 0 };
    });
    setStaende(n);
  }), []);
  return staende;
}

/**
 * Alle 38 Zähler, EINMALIG gelesen — für die Auslastungszeile auf «Deine Auswahl».
 *
 * Bewusst ohne Live-Listener: Auf der Ticketseite stehen gegen Ende alle gleichzeitig,
 * und ein Dauer-Listener über alle 38 Dokumente wäre genau der ungünstigste Fall aus
 * docs/05-last-und-performance.md §3. Ein einmaliger Lesevorgang kostet 38 Lesevorgänge
 * je Aufruf und bleibt damit im gerechneten Rahmen. Wer den Stand von jetzt will,
 * tippt auf «aktualisieren».
 */
export function useAlleSlotsEinmalig(aktiv: boolean) {
  const [staende, setStaende] = useState<Staende | null>(null);
  const [zeitpunkt, setZeitpunkt] = useState<Date | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [runde, setRunde] = useState(0);

  useEffect(() => {
    if (!aktiv) return;
    let weg = false;
    setLaedt(true);
    getDocs(collection(db, 'slots'))
      .then((schnappschuss) => {
        if (weg) return;
        const naechste: Staende = {};
        schnappschuss.forEach((d) => {
          const w = d.data() as SlotStand;
          naechste[d.id] = { belegt: w.belegt ?? 0, kapazitaet: w.kapazitaet ?? 0 };
        });
        setStaende(naechste);
        setZeitpunkt(new Date());
      })
      .catch(() => { /* Netz- oder Rechtefehler: dann bleibt die Zeile einfach weg */ })
      .finally(() => { if (!weg) setLaedt(false); });
    return () => { weg = true; };
  }, [aktiv, runde]);

  const aktualisieren = useCallback(() => setRunde((r) => r + 1), []);

  return { staende, zeitpunkt, laedt, aktualisieren };
}
