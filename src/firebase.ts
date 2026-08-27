import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, type User } from 'firebase/auth';
import {
  connectFirestoreEmulator, getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
import { merkeGeraet } from './geraet';

/**
 * Die Firebase-Web-Konfiguration ist öffentlich — das ist so vorgesehen und kein Geheimnis.
 * Der gesamte Schutz kommt aus firestore.rules. Sie steht hier fest im Kode, damit weder
 * Netlify-Umgebungsvariablen noch ein .env-File nötig sind; per VITE_FIREBASE_* lässt sie
 * sich für ein Testprojekt überschreiben.
 */
const env = import.meta.env;

export const app = initializeApp({
  apiKey:            env.VITE_FIREBASE_API_KEY            ?? 'AIzaSyDt0uLrwSegpxzaKx5_uDvEcUfdOSuo-es',
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN        ?? 'fmsbesuchstag.firebaseapp.com',
  projectId:         env.VITE_FIREBASE_PROJECT_ID         ?? 'fmsbesuchstag',
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET     ?? 'fmsbesuchstag.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '657876598708',
  appId:             env.VITE_FIREBASE_APP_ID             ?? '1:657876598708:web:9121d4244ea8dcade87ce1',
});

export const auth = getAuth(app);

/**
 * Firestore mit DAUERHAFTEM Zwischenspeicher (IndexedDB) statt nur im Arbeitsspeicher.
 *
 * Das ist die Datenhälfte des Offline-Betriebs: Der Service Worker sorgt dafür, dass die
 * App ohne Netz überhaupt startet (scripts/sw-vorlage.js) — aber ohne diese Zeilen stünde
 * sie danach vor einer leeren Anmeldung. Der voreingestellte Speicher lebt nur so lange
 * wie der Tab; wird er geschlossen, ist die eigene Buchung weg und `onSnapshot` meldet
 * sich ohne Verbindung nie wieder. Mit IndexedDB liegt sie auf dem Gerät und ist beim
 * nächsten Start sofort da, auch im Flugmodus.
 *
 * Gebucht wird deswegen nicht offline: Jede Buchung läuft über `runTransaction`
 * (src/buchung.ts), und eine Transaktion braucht zwingend den Server. Es kann also nie
 * eine Wahl auf dem Schirm stehen, die niemand reserviert hat.
 *
 * `persistentMultipleTabManager` erlaubt mehrere offene Tabs desselben Browsers — ohne
 * ihn bekäme nur der erste den dauerhaften Speicher. Steht IndexedDB nicht zur Verfügung
 * (privates Fenster in Safari, gesperrter Speicher), fällt das SDK von selbst auf den
 * Arbeitsspeicher zurück; die App läuft dann wie bisher, nur eben ohne Offline-Start.
 *
 * Im Lasttest läuft derselbe Kode unter Node (scripts/andrangtest.mjs). Dort gibt es
 * kein IndexedDB — darum die Weiche, statt das SDK eine Warnung schreiben zu lassen.
 */
const imBrowser = typeof window !== 'undefined' && typeof indexedDB !== 'undefined';

export const db = imBrowser
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  : getFirestore(app);

// Nur für lokale Tests gegen die Firebase Emulator Suite (npm run dev:emulator).
// Vite ersetzt die Variable beim Bauen durch eine Konstante, der Block fällt im
// Produktionsbündel vollständig weg.
if (env.VITE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * Liefert die bereits bestehende Anmeldung dieses Geräts — ohne Netzaufruf.
 * Firebase legt die anonyme Sitzung lokal ab; ein wiederkehrendes Gerät findet so sein
 * Ticket wieder, ohne sich neu anzumelden.
 */
export function bestehenderBenutzer(): Promise<User | null> {
  return new Promise((fertig) => {
    const ab = onAuthStateChanged(auth, (u) => { ab(); fertig(u); }, () => { ab(); fertig(null); });
  });
}

export class AnmeldeAndrangFehler extends Error {
  readonly name = 'AnmeldeAndrangFehler';
  constructor() { super('Zu viele gleichzeitige Anmeldungen von diesem Netz'); }
}

/**
 * Meldet das Gerät anonym an — bewusst ERST beim ersten Schreibvorgang, nicht beim Laden.
 *
 * Grund: Firebase Auth drosselt anonyme Neuanmeldungen pro IP-Adresse. Im Gast-WLAN der
 * Schule teilen sich alle Geräte eine einzige öffentliche IP; würden sich 150 Geräte im
 * selben Moment beim Scannen des QR-Codes anmelden, blockiert Firebase mit
 * auth/too-many-requests. Weil das Programm und die freien Plätze ohne Anmeldung lesbar
 * sind (siehe firestore.rules), verteilt sich die Anmeldung so von selbst über die Zeit,
 * die die Leute zum Lesen und Auswählen brauchen. Zusätzlich Wiederholung mit Streuung.
 */
const ANMELDE_WARTE_MS = [400, 1200, 2600, 5000];

export async function benutzerBereit(): Promise<User> {
  if (auth.currentUser) return merken(auth.currentUser);
  const vorhanden = await bestehenderBenutzer();
  if (vorhanden) return merken(vorhanden);

  let letzter: unknown;
  for (let versuch = 0; versuch <= ANMELDE_WARTE_MS.length; versuch++) {
    try {
      const ergebnis = await signInAnonymously(auth);
      return merken(ergebnis.user);
    } catch (fehler) {
      letzter = fehler;
      const code = (fehler as { code?: string })?.code;
      if (code !== 'auth/too-many-requests' && code !== 'auth/network-request-failed') break;
      if (versuch === ANMELDE_WARTE_MS.length) break;
      const ms = ANMELDE_WARTE_MS[versuch];
      await new Promise((r) => setTimeout(r, ms * (0.6 + Math.random() * 0.8)));
    }
  }
  if ((letzter as { code?: string })?.code === 'auth/too-many-requests') throw new AnmeldeAndrangFehler();
  throw letzter;
}

/**
 * Anonyme Sitzungen hinterlassen ihre uid auf dem Gerät — damit eine Betreuungsperson
 * ihre als Gast erstellte Anmeldung nach dem eigenen Anmelden wiederfindet. Siehe
 * src/geraet.ts für den ganzen Grund.
 */
function merken(u: User): User {
  if (u.isAnonymous) merkeGeraet(u.uid);
  return u;
}
