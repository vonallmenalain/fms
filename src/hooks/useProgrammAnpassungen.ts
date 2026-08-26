import { useEffect, useSyncExternalStore } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { abonniereProgramm, programmStand, setzeAnpassungen, type Anpassungen } from '../programm';

/**
 * Die von Hand gepflegten Programmanpassungen (Titel, Klasse, Zimmer, Lehrperson),
 * live aus `config/programm`.
 *
 * Ein Dokument, ein Listener — und zwar auf JEDEM Gerät, auch beim Gast: Korrigiert die
 * Administration am Morgen ein Zimmer, muss die Änderung dort ankommen, wo gewählt wird.
 * Das Dokument ist so lange leer, wie niemand etwas angepasst hat.
 *
 * Ohne Anmeldung lesbar (firestore.rules: `config` ist für alle lesbar) — die öffentliche
 * Übersicht für die Lehrpersonen braucht dieselben Angaben.
 */
export function useProgrammAnpassungen(): number {
  useEffect(() => onSnapshot(
    doc(db, 'config', 'programm'),
    (s) => setzeAnpassungen((s.data()?.angebote ?? {}) as Anpassungen),
    // Rechte- oder Netzfehler: Es gilt weiterhin die Programmdatei aus dem Bündel.
    () => setzeAnpassungen({}),
  ), []);

  // Der Zählerstand ist bloss der Auslöser: Ändert er sich, zeichnet React neu — und
  // `angebot()` liefert überall im Baum die angepassten Werte.
  return useSyncExternalStore(abonniereProgramm, programmStand, programmStand);
}
