import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, type User } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

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
export const db = getFirestore(app);

// Nur für lokale Tests gegen die Firebase Emulator Suite (npm run dev:emulator).
// Vite ersetzt die Variable beim Bauen durch eine Konstante, der Block fällt im
// Produktionsbündel vollständig weg.
if (env.VITE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/**
 * Meldet das Gerät anonym an, falls noch niemand angemeldet ist, und liefert den Benutzer.
 * Die anonyme UID ist die Geräte-Kennung: Sie überlebt das Schliessen des Browsers und ist
 * gleichzeitig das request.auth, an dem die Security Rules die Buchung festmachen.
 */
export function benutzerBereit(): Promise<User> {
  return new Promise((fertig, fehler) => {
    const ab = onAuthStateChanged(
      auth,
      (u) => {
        if (u) { ab(); fertig(u); return; }
        signInAnonymously(auth).catch((f) => { ab(); fehler(f); });
      },
      (f) => { ab(); fehler(f); },
    );
  });
}
