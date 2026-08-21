import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { Buchung } from '../buchung';
import { leereWahl } from '../buchung';

/** Die eigene Anmeldung, live. Ein Dokument, ein Listener, überlebt Neuladen. */
export function useBuchung(uid: string | null) {
  const [buchung, setBuchung] = useState<Buchung | null>(null);
  const [geladen, setGeladen] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setGeladen(false);
    return onSnapshot(
      doc(db, 'bookings', uid),
      (s) => {
        setBuchung(s.exists() ? { ...(s.data() as Buchung), wahl: { ...leereWahl(), ...(s.data() as Buchung).wahl } } : null);
        setGeladen(true);
      },
      () => setGeladen(true),
    );
  }, [uid]);

  return { buchung, geladen };
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
