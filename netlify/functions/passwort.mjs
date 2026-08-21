/* =========================================================================
   POST /api/passwort  —  eigene Mail zum Zurücksetzen des Passworts
   -------------------------------------------------------------------------
   Wer sein Passwort vergessen hat, bekommt einen Einmal-Link auf die Firebase-
   Seite, auf der sich ein neues setzen lässt. Erzeugt wird er wie bei den
   anderen beiden Mails mit dem Admin-SDK; verschickt wird er von unserer Domain
   in unserer Gestaltung.

   Wie beim Anmeldelink ist hier niemand angemeldet — die Adresse kommt ungeprüft
   aus dem Formular. Es gilt darum dieselbe Schranke (`darfPostBekommen`) und
   dieselbe unauffällige Antwort für alle Fälle:

     · nicht eingeladen und nicht freigeschaltet → keine Mail
     · kein Konto, oder eines ohne Passwort (nur Google) → keine Mail
     · sonst → Mail

   Firebase erlaubt das Zurücksetzen auch für Konten, die sich bisher nur mit
   Google angemeldet haben — das legt dort stillschweigend ein Passwort an.
   Darum prüfen wir vorher, ob es überhaupt eine Passwort-Anmeldung gibt.
   ========================================================================= */

import {
  adminAuth, antwort, darfPostBekommen, EinrichtungsFehler, istMailAdresse, mailSchluessel,
  sperreLoesen, zuSchnell,
} from '../lib/dienst.mjs';
import { passwortMail, sendeMail, seitenUrl } from '../lib/mail.mjs';

/** Gibt es zu dieser Adresse ein Konto mit Passwort? */
async function hatPasswortKonto(adresse) {
  try {
    const benutzer = await adminAuth().getUserByEmail(adresse);
    return benutzer.providerData.some((p) => p.providerId === 'password');
  } catch {
    return false;
  }
}

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let mail;
  try {
    ({ mail } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (!istMailAdresse(mailSchluessel(mail ?? ''))) return antwort(400, { fehler: 'Keine gültige Adresse' });

  const adresse = mailSchluessel(mail);
  const schluessel = `passwort:${adresse}`;
  if (zuSchnell(schluessel)) return antwort(200, { stand: 'erledigt' });

  try {
    if (!(await darfPostBekommen(adresse)) || !(await hatPasswortKonto(adresse))) {
      console.info('[passwort] kein Konto mit Passwort oder nicht freigeschaltet, nichts verschickt');
      return antwort(200, { stand: 'erledigt' });
    }

    const link = await adminAuth().generatePasswordResetLink(adresse, { url: `${seitenUrl()}/admin` });
    const { betreff, html, text } = passwortMail(link);
    await sendeMail({ an: adresse, betreff, html, text });
    return antwort(200, { stand: 'erledigt' });
  } catch (fehler) {
    sperreLoesen(schluessel);
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[passwort] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet' });
    }
    console.error('[passwort] Versand fehlgeschlagen:', fehler);
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden' });
  }
}

export const config = { path: '/api/passwort' };
