/* =========================================================================
   POST /api/anmeldelink  —  eigener Anmeldelink statt der Mail von Firebase
   -------------------------------------------------------------------------
   Der zweite Weg in den Betreuungsbereich: ein Einmal-Link statt eines
   Passworts. Bisher verschickte ihn Firebase selbst; neu erzeugen wir denselben
   Link mit dem Admin-SDK und verschicken ihn in der Gestaltung der App.

   ANDERS ALS BEI DER BESTÄTIGUNGSMAIL gibt es hier niemanden, der schon
   angemeldet wäre — die Adresse kommt ungeprüft aus dem Formular. Ohne Schranke
   wäre das ein offenes Tor: Jede und jeder könnte von unserer Domain aus
   beliebige Adressen anschreiben lassen. Darum verschicken wir nur an Adressen,
   die überhaupt etwas mit dem Betreuungsbereich zu tun haben:

     · eingeladen unter «Steuerung → Zugänge» (Dokument in `zugang`), oder
     · bereits freigeschaltet (Konto in `admins`).

   Alle anderen bekommen nichts — und dieselbe Antwort wie alle. Sonst liesse
   sich über diese Schnittstelle durchprobieren, wer an der Schule Zugang hat.
   Für die Person am Bildschirm ändert das nichts: Ein Link an eine nicht
   eingeladene Adresse führte ohnehin nur auf «Kein Zugang».
   ========================================================================= */

import {
  adminAuth, adminDb, antwort, EinrichtungsFehler, istMailAdresse, mailSchluessel,
  sperreLoesen, zuSchnell,
} from '../lib/dienst.mjs';
import { anmeldelinkMail, sendeMail, seitenUrl } from '../lib/mail.mjs';

/** Ist diese Adresse eingeladen oder bereits freigeschaltet? */
async function darfEinenLinkBekommen(adresse) {
  const db = adminDb();

  const einladung = await db.collection('zugang').doc(adresse).get();
  if (einladung.exists) return true;

  // Kein Eintrag unter «Zugänge» — es kann trotzdem ein Konto geben, etwa der
  // Erstzugang aus den Rules oder eine zurückgezogene Einladung mit Konto.
  try {
    const benutzer = await adminAuth().getUserByEmail(adresse);
    const konto = await db.collection('admins').doc(benutzer.uid).get();
    return konto.exists;
  } catch {
    return false;                       // auth/user-not-found und alles andere
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
  const schluessel = `anmeldelink:${adresse}`;
  // Auch das Nachfassen bekommt die neutrale Antwort — ein eigener Fehlercode
  // verriete, dass es diese Adresse gibt.
  if (zuSchnell(schluessel)) return antwort(200, { stand: 'erledigt' });

  try {
    if (!(await darfEinenLinkBekommen(adresse))) {
      console.info('[anmeldelink] nicht eingeladen, nichts verschickt');
      return antwort(200, { stand: 'erledigt' });
    }

    // handleCodeInApp: true — der Link muss in der App eingelöst werden
    // (signInWithEmailLink in src/zugang.ts), nicht auf einer Firebase-Seite.
    const link = await adminAuth().generateSignInWithEmailLink(adresse, {
      url: `${seitenUrl()}/admin`,
      handleCodeInApp: true,
    });
    const { betreff, html, text } = anmeldelinkMail(link);
    await sendeMail({ an: adresse, betreff, html, text });
    return antwort(200, { stand: 'erledigt' });
  } catch (fehler) {
    sperreLoesen(schluessel);
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[anmeldelink] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet' });
    }
    console.error('[anmeldelink] Versand fehlgeschlagen:', fehler);
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden' });
  }
}

export const config = { path: '/api/anmeldelink' };
