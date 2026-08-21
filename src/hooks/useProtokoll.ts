import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import type { LogEintrag } from '../protokoll';

/**
 * Das Protokoll, neueste Zeile zuerst.
 *
 * `grenze` deckelt bewusst: Ein Listener auf eine wachsende Sammlung liest beim Aufbau
 * jedes Dokument einmal, und das Protokoll ist die einzige Sammlung der App, die über
 * den Morgen laufend wächst. 500 Zeilen sind mehr, als ein Anlass mit 120 Gästen
 * erzeugt, und bleiben trotzdem ein überschaubarer Posten in der Rechnung aus
 * docs/05 §3. Wer mehr braucht, lädt die CSV.
 *
 * Sortiert nach `zeitpunkt` — ein einzelnes Feld, dafür legt Firestore den Index von
 * selbst an. Es braucht also keinen zusätzlichen Deploy von Indexdefinitionen.
 */
export function useProtokoll(grenze = 500) {
  const [eintraege, setEintraege] = useState<(LogEintrag & { id: string })[]>([]);
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    setGeladen(false);
    return onSnapshot(
      query(collection(db, 'log'), orderBy('zeitpunkt', 'desc'), limit(grenze)),
      (s) => {
        setEintraege(s.docs.map((d) => ({ id: d.id, ...(d.data() as LogEintrag) })));
        setFehler(false);
        setGeladen(true);
      },
      () => { setFehler(true); setGeladen(true); },
    );
  }, [grenze]);

  return { eintraege, geladen, fehler };
}
