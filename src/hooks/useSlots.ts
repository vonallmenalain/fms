import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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
