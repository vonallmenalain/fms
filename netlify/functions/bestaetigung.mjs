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

import { adminAuth, antwort, EinrichtungsFehler, sperreLoesen, zuSchnell } from '../lib/dienst.mjs';
import { bestaetigungsMail, sendeMail, seitenUrl } from '../lib/mail.mjs';

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let idToken;
  try {
    ({ idToken } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (typeof idToken !== 'string' || !idToken) return antwort(400, { fehler: 'idToken fehlt' });

  let auth;
  let konto;
  try {
    auth = adminAuth();
    konto = await auth.verifyIdToken(idToken);
  } catch (fehler) {
    // Zwischen «Server falsch eingerichtet» und «Token ungültig» unterscheiden:
    // Ersteres soll in den Netlify-Protokollen auffallen, Letzteres nicht.
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[bestaetigung] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet' });
    }
    return antwort(401, { fehler: 'Anmeldung nicht gültig' });
  }

  if (!konto.email) return antwort(400, { fehler: 'Dieses Konto hat keine E-Mail-Adresse' });
  // Schon bestätigt: kein Grund für eine weitere Mail — und kein Fehler.
  if (konto.email_verified) return antwort(200, { stand: 'schon-bestaetigt' });

  const schluessel = `bestaetigung:${konto.uid}`;
  if (zuSchnell(schluessel)) return antwort(429, { fehler: 'Bitte einen Moment warten', stand: 'zu-schnell' });

  try {
    // Derselbe Link, den Firebase sonst selbst verschickt hätte. `url` ist die
    // Seite, auf der die Person nach dem Bestätigen landet — sie muss in der
    // Firebase-Konsole unter Authentication → Settings → Authorized domains stehen.
    const link = await auth.generateEmailVerificationLink(konto.email, { url: `${seitenUrl()}/admin` });
    const { betreff, html, text } = bestaetigungsMail(link);
    await sendeMail({ an: konto.email, betreff, html, text });
    return antwort(200, { stand: 'gesendet' });
  } catch (fehler) {
    sperreLoesen(schluessel);
    console.error('[bestaetigung] Versand fehlgeschlagen:', fehler);
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden' });
  }
}

/** Netlify hängt die Funktion zusätzlich unter diesen Pfad — ohne Umleitungsregel. */
export const config = { path: '/api/bestaetigung' };
