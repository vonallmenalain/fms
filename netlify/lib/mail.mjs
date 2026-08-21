/* =========================================================================
   E-Mail-Versand über Resend — Vorlagen und Auslieferung
   -------------------------------------------------------------------------
   Läuft ausschliesslich in einer Netlify-Funktion, also auf dem Server. Der
   Resend-Schlüssel darf niemals ins Browser-Bündel: Wer ihn hat, verschickt
   Post in deinem Namen von deiner Domain.

   Bewusst ohne das Paket «resend»: Der Dienst hat eine gewöhnliche
   JSON-Schnittstelle, ein einziger fetch-Aufruf genügt. Das spart eine
   Abhängigkeit und damit Bündelgrösse und Kaltstartzeit der Funktion.
   ========================================================================= */

const RESEND_URL = 'https://api.resend.com/emails';

/** Resend antwortet normalerweise in Millisekunden; hängt es, brechen wir ab. */
const ZEITLIMIT_MS = 8000;

export class MailFehler extends Error {
  constructor(nachricht, ursache) {
    super(nachricht);
    this.name = 'MailFehler';
    this.ursache = ursache ?? null;
  }
}

/**
 * Adresse dieser Website — für den Logo-Verweis im E-Mail und die Fusszeile.
 * `URL` setzt Netlify beim Bauen von selbst auf die Hauptadresse der Site.
 */
export function seitenUrl() {
  return (process.env.SEITEN_URL || process.env.URL || 'https://fms.alae.app').replace(/\/+$/, '');
}

export async function sendeMail({ an, betreff, html, text }) {
  const schluessel = process.env.RESEND_API_KEY;
  const von = process.env.MAIL_ABSENDER;
  if (!schluessel) throw new MailFehler('RESEND_API_KEY ist nicht gesetzt');
  if (!von) throw new MailFehler('MAIL_ABSENDER ist nicht gesetzt');

  let antwort;
  try {
    antwort = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schluessel}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: von,
        to: [an],
        subject: betreff,
        html,
        text,
        // Antworten sollen bei einem Menschen landen, nicht im Nirgendwo. Ohne
        // MAIL_ANTWORT bleibt es beim Absender.
        ...(process.env.MAIL_ANTWORT ? { reply_to: process.env.MAIL_ANTWORT } : {}),
      }),
      signal: AbortSignal.timeout(ZEITLIMIT_MS),
    });
  } catch (fehler) {
    throw new MailFehler('Resend war nicht erreichbar', fehler);
  }

  if (!antwort.ok) {
    const körper = await antwort.text().catch(() => '');
    throw new MailFehler(`Resend hat abgelehnt (HTTP ${antwort.status}): ${körper.slice(0, 400)}`);
  }
}

/* --------------------------------------------------------------- Vorlage */

/** Für Text, der in HTML landet — der Bestätigungslink enthält & und =. */
const sicher = (wert) =>
  String(wert).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Dieselben Farben wie in src/index.css. E-Mail-Programme kennen keine
// CSS-Variablen und kein <style> im Kopf (Gmail wirft es teilweise weg),
// darum stehen alle Angaben direkt am Element.
const GRUEN = '#B4BD00';
const SCHWARZ = '#1D1D1B';
const GRAU = '#83857A';
const PAPIER = '#F6F7F1';
const LINIE = '#DCDFD0';
// Achtung: Die Angabe landet in einem style="…"-Attribut. Schriftnamen mit Leerzeichen
// müssen darum in EINFACHEN Anführungszeichen stehen — doppelte beenden das Attribut,
// und das E-Mail-Programm zeigt alles in seiner Grundschrift (Times) an.
const SCHRIFT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Gerüst für alle Mails dieser App: Logo, Titel, ein Satz, ein Knopf, Kleingedrucktes.
 *
 * Aufgebaut mit Tabellen und Attributen statt mit Flexbox — nicht aus Nostalgie,
 * sondern weil Outlook auf Windows bis heute mit der Word-Maschine rendert und
 * moderne Anordnung dort schlicht zusammenfällt.
 */
function geruest({ titel, satz, knopfText, link, klein, vorschau }) {
  const url = sicher(link);
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${sicher(titel)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPIER};">
  <!-- Vorschauzeile: steht in der Übersicht des Postfachs neben dem Betreff, im Mail selbst unsichtbar. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${sicher(vorschau)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPIER};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:480px;background:#FFFFFF;border:1px solid ${LINIE};border-radius:4px;">
          <tr>
            <td style="padding:28px 28px 0;">
              <img src="${seitenUrl()}/fms-neufeld.png" width="150" height="31" alt="fms Neufeld"
                   style="display:block;border:0;width:150px;height:auto;">
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 0;font-family:${SCHRIFT};font-size:21px;line-height:1.3;font-weight:700;color:${SCHWARZ};">
              ${sicher(titel)}
            </td>
          </tr>
          <tr>
            <td style="padding:10px 28px 0;font-family:${SCHRIFT};font-size:16px;line-height:1.5;color:${SCHWARZ};">
              ${sicher(satz)}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 0;">
              <a href="${url}"
                 style="display:block;background:${GRUEN};color:${SCHWARZ};font-family:${SCHRIFT};font-size:17px;font-weight:600;text-align:center;text-decoration:none;padding:17px 22px;border-radius:4px;">
                ${sicher(knopfText)}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 28px;font-family:${SCHRIFT};font-size:13px;line-height:1.5;color:${GRAU};">
              ${klein}
            </td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
          <tr>
            <td align="center" style="padding:16px 8px 0;font-family:${SCHRIFT};font-size:12px;line-height:1.5;color:${GRAU};">
              Besuchsmorgen FMS Neufeld
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Die Bestätigungsmail für ein neues Konto im Betreuungsbereich.
 *
 * `link` ist der von Firebase erzeugte Einmal-Link (siehe die Funktion
 * bestaetigung.mjs). Wir gestalten nur die Verpackung — die Prüfung der
 * Adresse bleibt vollständig bei Firebase.
 */
export function bestaetigungsMail(link) {
  const betreff = 'E-Mail bestätigen — Besuchsmorgen FMS Neufeld';
  const html = geruest({
    titel: 'E-Mail bestätigen',
    satz: 'Ein Klick, dann ist dein Zugang zum Betreuungsbereich bereit.',
    knopfText: 'E-Mail bestätigen',
    link,
    vorschau: 'Ein Klick, dann ist dein Zugang zum Betreuungsbereich bereit.',
    // Bewusst ohne den ausgeschriebenen Link: Er ist über 200 Zeichen lang und würde das
    // kurze Mail optisch beherrschen. Wer HTML abgeschaltet hat, sieht die Textfassung
    // unten — dort steht er.
    klein: 'Der Link gilt einmalig. Nicht angefordert? Dann diese Nachricht einfach löschen.',
  });
  const text = [
    'E-Mail bestätigen',
    '',
    'Ein Klick, dann ist dein Zugang zum Betreuungsbereich bereit:',
    link,
    '',
    'Der Link gilt einmalig. Nicht angefordert? Dann diese Nachricht einfach löschen.',
    '',
    'Besuchsmorgen FMS Neufeld',
  ].join('\n');
  return { betreff, html, text };
}

/**
 * Der Anmeldelink — der Weg in den Betreuungsbereich ohne Passwort.
 *
 * Wieder ist `link` der von Firebase erzeugte Einmal-Link (siehe
 * anmeldelink.mjs). Er wird in der App eingelöst, nicht auf einer Firebase-Seite.
 */
export function anmeldelinkMail(link) {
  const betreff = 'Anmelden — Besuchsmorgen FMS Neufeld';
  const html = geruest({
    titel: 'Anmelden',
    satz: 'Ein Klick, und du bist im Betreuungsbereich angemeldet.',
    knopfText: 'Jetzt anmelden',
    link,
    vorschau: 'Ein Klick, und du bist im Betreuungsbereich angemeldet.',
    klein: 'Der Link gilt einmalig. Nicht angefordert? Dann diese Nachricht einfach löschen.',
  });
  const text = [
    'Anmelden',
    '',
    'Ein Klick, und du bist im Betreuungsbereich angemeldet:',
    link,
    '',
    'Der Link gilt einmalig. Nicht angefordert? Dann diese Nachricht einfach löschen.',
    '',
    'Besuchsmorgen FMS Neufeld',
  ].join('\n');
  return { betreff, html, text };
}
