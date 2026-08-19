import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
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
