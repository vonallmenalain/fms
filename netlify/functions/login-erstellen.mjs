/* =========================================================================
   POST /api/login-erstellen  —  «Login erstellen» aus der Einladungsmail
   -------------------------------------------------------------------------
   Die Person öffnet den Link, tippt in der App ihre E-Mail-Adresse und zweimal
   ein neues Passwort ein. Passen Code und Adresse zusammen, bekommt das Konto
   dieses Passwort — und die Adresse gilt als bestätigt, denn der Code kam per
   Mail genau dorthin. Eine Bestätigungsmail braucht es darum nicht mehr; die
   App meldet die Person direkt mit E-Mail und Passwort an.

   Für beide Rollen. Bei der Administration ist der Code danach verbraucht
   (siehe unten): Ihr Passwort soll sich nicht beliebig oft aus einem alten Mail
   heraus neu setzen lassen. Wer es vergisst, hat «Passwort vergessen?».
   ========================================================================= */

import {
  antwort, EinrichtungsFehler, einladungZuCode, freischalten, istMailAdresse,
  kontoSicherstellen, mailSchluessel, ZugangFehler, zugangscodeLoeschen,
} from '../lib/dienst.mjs';

/** Firebase verlangt sechs Zeichen; nach oben eine Grenze, damit niemand Romane schickt. */
const gueltigesPasswort = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 200;

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let mail;
  let code;
  let passwort;
  try {
    ({ mail, code, passwort } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (!istMailAdresse(mailSchluessel(mail ?? ''))) return antwort(400, { fehler: 'Keine gültige Adresse', grund: 'adresse' });
  if (typeof code !== 'string' || !code) return antwort(400, { fehler: 'Kein Zugangscode', grund: 'passt-nicht' });
  if (!gueltigesPasswort(passwort)) return antwort(400, { fehler: 'Das Passwort braucht mindestens 6 Zeichen', grund: 'passwort' });

  const adresse = mailSchluessel(mail);
  try {
    const einladung = await einladungZuCode(adresse, code);
    if (einladung.passwort === false) {
      throw new ZugangFehler('passwort-aus', 'Für diesen Zugang ist kein Login mit Passwort vorgesehen');
    }
    const benutzer = await kontoSicherstellen(adresse, { name: einladung.name, passwort });
    await freischalten(benutzer, einladung, adresse);
    // Für die Administration ist der Code hiermit verbraucht. Die Betreuung behält ihn:
    // Ihr «Jetzt anmelden» aus demselben Mail soll auf dem nächsten Gerät weiterhin gehen.
    if (einladung.rolle === 'admin') await zugangscodeLoeschen(adresse);
    console.info('[login-erstellen] Passwort gesetzt für', adresse);
    return antwort(200, { stand: 'erstellt' });
  } catch (fehler) {
    if (fehler instanceof ZugangFehler) {
      console.info('[login-erstellen] abgelehnt:', fehler.grund);
      return antwort(fehler.grund === 'gesperrt' ? 429 : 403, { fehler: fehler.message, grund: fehler.grund });
    }
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[login-erstellen] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Das Login ist auf dem Server nicht eingerichtet', grund: 'server' });
    }
    console.error('[login-erstellen] fehlgeschlagen:', fehler);
    return antwort(502, { fehler: 'Das Login liess sich nicht erstellen', grund: 'server' });
  }
}

export const config = { path: '/api/login-erstellen' };
