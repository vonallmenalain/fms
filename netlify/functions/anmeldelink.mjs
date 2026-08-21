/* =========================================================================
   POST /api/anmeldelink  —  eigener Anmeldelink statt der Mail von Firebase
   -------------------------------------------------------------------------
   Der zweite Weg in den Betreuungsbereich: ein Einmal-Link statt eines
   Passworts. Bisher verschickte ihn Firebase selbst; neu erzeugen wir denselben
   Link mit dem Admin-SDK und verschicken ihn in der Gestaltung der App.

   ANDERS ALS BEI DER BESTÄTIGUNGSMAIL gibt es hier in der Regel niemanden, der
   angemeldet wäre — die Adresse kommt ungeprüft aus dem Formular. Darum
   entscheidet `darfPostBekommen` (siehe lib/dienst.mjs), ob überhaupt etwas
   rausgeht: nur an eingeladene oder bereits freigeschaltete Adressen. Alle
   anderen bekommen nichts — und dieselbe Antwort wie alle, damit sich nicht
   durchprobieren lässt, wer an der Schule Zugang hat. Für die Person am
   Bildschirm ändert das nichts: Ein Link an eine nicht eingeladene Adresse
   führte ohnehin nur auf «Kein Zugang».

   EINE AUSNAHME: Schickt die Administration ihr ID-Token mit (beim Einladen
   unter «Steuerung → Zugänge»), antwortet die Funktion ehrlich — was verschickt
   wurde, was nicht, und warum nicht. Vor ihr ist nichts zu verbergen, und ohne
   diese Auskunft ist ein ausbleibendes Mail nicht von einem stillen «nicht
   eingeladen» zu unterscheiden.
   ========================================================================= */

import {
  adminAuth, antwort, darfPostBekommen, EinrichtungsFehler, istAdministration, istMailAdresse,
  mailSchluessel, sperreLoesen, zuSchnell,
} from '../lib/dienst.mjs';
import { anmeldelinkMail, sendeMail, seitenUrl } from '../lib/mail.mjs';

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let mail;
  let idToken;
  try {
    ({ mail, idToken } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (!istMailAdresse(mailSchluessel(mail ?? ''))) return antwort(400, { fehler: 'Keine gültige Adresse' });

  const adresse = mailSchluessel(mail);
  const schluessel = `anmeldelink:${adresse}`;

  try {
    // Ehrlich nur gegenüber der Administration; sonst für jeden Ausgang dasselbe.
    const offen = Boolean(await istAdministration(idToken));
    const neutral = (stand) => antwort(200, { stand: offen ? stand : 'erledigt' });

    // Zu schnell hintereinander. Auch das Nachfassen bekommt die neutrale Antwort —
    // ein eigener Fehlercode verriete, dass es diese Adresse gibt.
    if (zuSchnell(schluessel)) return neutral('gesperrt');

    if (!(await darfPostBekommen(adresse))) {
      console.info('[anmeldelink] nicht eingeladen, nichts verschickt');
      return neutral('nicht-eingeladen');
    }

    // handleCodeInApp: true — der Link muss in der App eingelöst werden
    // (signInWithEmailLink in src/zugang.ts), nicht auf einer Firebase-Seite.
    const link = await adminAuth().generateSignInWithEmailLink(adresse, {
      url: `${seitenUrl()}/admin`,
      handleCodeInApp: true,
    });
    const { betreff, html, text } = anmeldelinkMail(link);
    await sendeMail({ an: adresse, betreff, html, text });
    console.info('[anmeldelink] verschickt an', adresse);
    return neutral('gesendet');
  } catch (fehler) {
    sperreLoesen(schluessel);
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[anmeldelink] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet', grund: fehler.message });
    }
    console.error('[anmeldelink] Versand fehlgeschlagen:', fehler);
    // Der Wortlaut (etwa die Ablehnung von Resend) nur für die Administration:
    // Er nennt Absender und Domain und gehört nicht an Unbekannte.
    const grund = (await istAdministration(idToken).catch(() => null)) ? String(fehler?.message ?? fehler) : undefined;
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden', ...(grund ? { grund } : {}) });
  }
}

export const config = { path: '/api/anmeldelink' };
