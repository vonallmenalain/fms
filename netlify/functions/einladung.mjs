/* =========================================================================
   POST /api/einladung  —  Einladungsmail mit Zugangscode
   -------------------------------------------------------------------------
   Verschickt die Einladung zu einem Eintrag unter «Steuerung → Zugänge»: ein
   oder zwei Knöpfe («Jetzt anmelden», «Login erstellen»), je nach Rolle und
   dem, was die Administration erlaubt hat (siehe einladungsLinks in
   lib/mail.mjs). Den Zugangscode dazu erzeugt oder holt `zugangscode`.

   Zwei Aufrufer:

   · Die Administration, mit ihrem ID-Token — beim Eintragen, bei «E-Mail
     schicken» und bei «Links kopieren». Sie bekommt eine ehrliche Antwort und
     die Links selbst, um sie auch von Hand weiterzugeben (`senden: false`
     verschickt nichts). Mit `erneuern: true` gibt es einen neuen Code; die
     alten Links sind damit tot.
   · Die eingeladene Person selbst, ohne Token, über «Einladung nochmals
     schicken» im Login. Sie bekommt die neutrale Antwort — ob es zu dieser
     Adresse eine Einladung gibt, verrät die Funktion nicht.
   ========================================================================= */

import {
  adminDb, antwort, EinrichtungsFehler, istAdministration, istMailAdresse, mailSchluessel,
  sperreLoesen, zugangscode, zuSchnell,
} from '../lib/dienst.mjs';
import { einladungsLinks, einladungsMail, sendeMail } from '../lib/mail.mjs';

export default async function handler(anfrage) {
  if (anfrage.method !== 'POST') return antwort(405, { fehler: 'Nur POST' });

  let mail;
  let idToken;
  let senden;
  let erneuern;
  try {
    ({ mail, idToken, senden = true, erneuern = false } = await anfrage.json());
  } catch {
    return antwort(400, { fehler: 'Kein gültiger Rumpf' });
  }
  if (!istMailAdresse(mailSchluessel(mail ?? ''))) return antwort(400, { fehler: 'Keine gültige Adresse' });

  const adresse = mailSchluessel(mail);
  const schluessel = `einladung:${adresse}`;

  try {
    const offen = Boolean(await istAdministration(idToken));
    // Ohne Ausweis gibt es nur den einen Weg: Mail an die Adresse, neutrale Antwort.
    if (!offen) { senden = true; erneuern = false; }
    const neutral = (stand, mehr = {}) => antwort(200, offen ? { stand, ...mehr } : { stand: 'erledigt' });

    if (senden && zuSchnell(schluessel)) return neutral('gesperrt');

    const einladung = await adminDb().collection('zugang').doc(adresse).get();
    if (!einladung.exists) {
      console.info('[einladung] nicht eingeladen, nichts verschickt');
      return neutral('nicht-eingeladen');
    }
    const daten = einladung.data();
    const links = einladungsLinks(daten, await zugangscode(adresse, { erneuern }));
    if (!links.anmelden && !links.login) {
      // Beides abgeschaltet: Es gibt nichts, was die Person mit dem Mail anfangen könnte.
      if (senden) sperreLoesen(schluessel);
      return neutral('nichts-erlaubt', { links });
    }
    if (!senden) return neutral('links', { links });

    const { betreff, html, text } = einladungsMail({ name: daten.name, rolle: daten.rolle, links });
    await sendeMail({ an: adresse, betreff, html, text });
    console.info('[einladung] verschickt an', adresse);
    return neutral('gesendet', { links });
  } catch (fehler) {
    sperreLoesen(schluessel);
    if (fehler instanceof EinrichtungsFehler) {
      console.error('[einladung] Einrichtung unvollständig:', fehler.message);
      return antwort(503, { fehler: 'Mailversand ist nicht eingerichtet', grund: fehler.message });
    }
    console.error('[einladung] Versand fehlgeschlagen:', fehler);
    // Der Wortlaut (etwa die Ablehnung von Resend) nur für die Administration.
    const grund = (await istAdministration(idToken).catch(() => null)) ? String(fehler?.message ?? fehler) : undefined;
    return antwort(502, { fehler: 'Die E-Mail konnte nicht verschickt werden', ...(grund ? { grund } : {}) });
  }
}

export const config = { path: '/api/einladung' };
