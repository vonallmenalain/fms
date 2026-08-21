/* =========================================================================
   POST /api/bestaetigung  —  eigene Bestätigungsmail statt der von Firebase
   -------------------------------------------------------------------------
   Wer im Betreuungsbereich ein Konto anlegt, muss seine Adresse bestätigen:
   firestore.rules verlangt `email_verified`, sonst könnte jemand ein Konto auf
   eine fremde, eingeladene Adresse anlegen und deren Rolle übernehmen.

   Firebase kann diese Mail selbst verschicken — sie sieht aber aus wie von
   Firebase und kommt von firebaseapp.com. Darum hier der Zwischenschritt:

     1. Der Browser schickt sein ID-Token.
     2. Wir prüfen es mit dem Admin-SDK (nur so wissen wir, wem die Adresse
        gehört — die Adresse einfach mitschicken zu lassen, hiesse: jede und
        jeder könnte über diese Schnittstelle fremde Adressen anschreiben).
     3. Das Admin-SDK erzeugt denselben Einmal-Link, den Firebase sonst selbst
        verschickt hätte.
     4. Resend verschickt ihn in unserer Gestaltung von unserer Domain.

   Die Prüfung der Adresse bleibt damit vollständig bei Firebase; wir tauschen
   nur die Verpackung und den Briefträger aus.
   ========================================================================= */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { bestaetigungsMail, MailFehler, sendeMail, seitenUrl } from '../lib/mail.mjs';

/** Zwischen zwei Mails an dasselbe Konto. Der Knopf im Bildschirm sperrt schon,
 *  das hier fängt den Fall ab, dass jemand die Schnittstelle direkt bedient.
 *  Bewusst nur im Arbeitsspeicher: Netlify hält eine Instanz einige Minuten
 *  warm, das genügt für den Zweck; ein kalter Start setzt zurück. Eine echte
 *  Sperre liegt ohnehin bei Firebase (Kontingent für Bestätigungslinks). */
const SPERRE_MS = 30_000;
const zuletzt = new Map();

let bereit = false;

/**
 * Admin-SDK einrichten. Die Zugangsdaten stehen in der Netlify-Umgebung als
 * FIREBASE_SERVICE_ACCOUNT (der JSON-Inhalt der Schlüsseldatei, einzeilig).
 * Ohne sie kann die Funktion nichts tun — dann bleibt der Rückfall im Browser.
 */
function firebaseBereit() {
  if (bereit || getApps().length) { bereit = true; return; }
  const roh = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!roh) throw new Error('FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt');
  const konto = JSON.parse(roh);
  // In den meisten Oberflächen für Umgebungsvariablen überleben echte
  // Zeilenumbrüche im Schlüssel nicht — dann stehen dort \n als zwei Zeichen.
  if (typeof konto.private_key === 'string') konto.private_key = konto.private_key.replace(/\\n/g, '\n');
  initializeApp({ credential: cert(konto) });
  bereit = true;
}

const antwort = (status, daten) =>
  new Response(JSON.stringify(daten), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let idToken;
  try {
    ({ idToken } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (typeof idToken !== 'string' || !idToken) return antwort(400, { fehler: 'idToken fehlt' });

  let konto;
  try {
    firebaseBereit();
    konto = await getAuth().verifyIdToken(idToken);
  } catch (fehler) {
    // Zwischen «Server falsch eingerichtet» und «Token ungültig» unterscheiden:
    // Ersteres soll in den Netlify-Protokollen auffallen, Letzteres nicht.
    if (!bereit) {
      console.error('[bestaetigung] Einrichtung unvollständig:', fehler);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet' });
    }
    return antwort(401, { fehler: 'Anmeldung nicht gültig' });
  }

  if (!konto.email) return antwort(400, { fehler: 'Dieses Konto hat keine E-Mail-Adresse' });
  // Schon bestätigt: kein Grund für eine weitere Mail — und kein Fehler.
  if (konto.email_verified) return antwort(200, { stand: 'schon-bestaetigt' });

  const jetzt = Date.now();
  const letzte = zuletzt.get(konto.uid) ?? 0;
  if (jetzt - letzte < SPERRE_MS) {
    return antwort(429, { fehler: 'Bitte einen Moment warten', stand: 'zu-schnell' });
  }
  zuletzt.set(konto.uid, jetzt);

  try {
    // Derselbe Link, den Firebase sonst selbst verschickt hätte. `url` ist die
    // Seite, auf der die Person nach dem Bestätigen landet — sie muss in der
    // Firebase-Konsole unter Authentication → Settings → Authorized domains stehen.
    const link = await getAuth().generateEmailVerificationLink(konto.email, {
      url: `${seitenUrl()}/admin`,
    });
    const { betreff, html, text } = bestaetigungsMail(link);
    await sendeMail({ an: konto.email, betreff, html, text });
    return antwort(200, { stand: 'gesendet' });
  } catch (fehler) {
    zuletzt.delete(konto.uid);           // nicht zugestellt, also auch nicht sperren
    console.error('[bestaetigung] Versand fehlgeschlagen:', fehler);
    const grund = fehler instanceof MailFehler ? 'mail' : 'link';
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden', stand: grund });
  }
}

/** Netlify hängt die Funktion zusätzlich unter diesen Pfad — ohne Umleitungsregel. */
export const config = { path: '/api/bestaetigung' };
