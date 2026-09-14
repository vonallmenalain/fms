/* =========================================================================
   POST /api/zugang-anmelden  —  «Jetzt anmelden» aus der Einladungsmail
   -------------------------------------------------------------------------
   Der Weg für die Betreuung ohne Passwort. Der Link in der Mail trägt den
   Zugangscode; die Person tippt in der App ihre E-Mail-Adresse ein, und beides
   kommt hierher. Passt es zusammen, bekommt sie ein Anmelde-Token für Firebase
   (signInWithCustomToken in src/zugang.ts) — und ist angemeldet.

   Anders als der frühere Einmal-Link von Firebase gilt der Code, solange die
   Einladung besteht: derselbe Link auf dem Laptop und auf dem Handy, jedes Mal
   mit Adresse. Genau das war der Wunsch — ein Link, der nach dem ersten Gerät
   nicht tot ist. Der Preis: Wer das Mail hat, hat den Zugang. Für die Rolle
   «betreuung» (Übersicht ansehen, Gäste erfassen — keine Steuerung) ist das
   vertretbar; die Administration meldet sich darum mit Passwort oder Google an
   und bekommt hier eine Absage.
   ========================================================================= */

import {
  adminAuth, antwort, EinrichtungsFehler, einladungZuCode, freischalten, istMailAdresse,
  kontoSicherstellen, mailSchluessel, ZugangFehler,
} from '../lib/dienst.mjs';

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let mail;
  let code;
  try {
    ({ mail, code } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (!istMailAdresse(mailSchluessel(mail ?? ''))) return antwort(400, { fehler: 'Keine gültige Adresse', grund: 'adresse' });
  if (typeof code !== 'string' || !code) return antwort(400, { fehler: 'Kein Zugangscode', grund: 'passt-nicht' });

  const adresse = mailSchluessel(mail);
  try {
    const einladung = await einladungZuCode(adresse, code);
    if (einladung.rolle === 'admin') {
      throw new ZugangFehler('nur-betreuung', 'Die Administration meldet sich mit Passwort oder Google an');
    }
    if (einladung.link === false) {
      throw new ZugangFehler('link-aus', 'Für diesen Zugang ist die Anmeldung per Link nicht freigegeben');
    }
    const benutzer = await kontoSicherstellen(adresse, { name: einladung.name });
    await freischalten(benutzer, einladung, adresse);
    const token = await adminAuth().createCustomToken(benutzer.uid);
    console.info('[zugang-anmelden] angemeldet:', adresse);
    return antwort(200, { token });
  } catch (fehler) {
    if (fehler instanceof ZugangFehler) {
      console.info('[zugang-anmelden] abgelehnt:', fehler.grund);
      return antwort(fehler.grund === 'gesperrt' ? 429 : 403, { fehler: fehler.message, grund: fehler.grund });
    }
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[zugang-anmelden] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Die Anmeldung ist auf dem Server nicht eingerichtet', grund: 'server' });
    }
    console.error('[zugang-anmelden] fehlgeschlagen:', fehler);
    return antwort(502, { fehler: 'Die Anmeldung hat nicht geklappt', grund: 'server' });
  }
}

export const config = { path: '/api/zugang-anmelden' };
