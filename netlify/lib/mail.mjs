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

/** Der Name vor der Adresse, falls MAIL_ABSENDER nur die Adresse enthält. */
const ABSENDER_NAME = 'Besuchsmorgen FMS Neufeld';

/**
 * «besuchsmorgen@alae.app» → «Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>».
 *
 * Ein Absender ohne Anzeigenamen wirkt automatisiert: Gmail zeigt dann die nackte
 * Adresse an, und Spam-Filter werten es als kleines Warnzeichen. Steht in MAIL_ABSENDER
 * schon ein Name (`Name <adresse>`), bleibt er unangetastet.
 */
export const mitAbsenderName = (von) =>
  (von.includes('<') ? von : `${ABSENDER_NAME} <${von.trim()}>`);

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
        from: mitAbsenderName(von),
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
 * Dasselbe Kleingedruckte in Bestätigungs- und Rücksetzmail. Wer die Nachricht nicht
 * angefordert hat, soll überall dieselbe Antwort finden.
 */
const KLEINGEDRUCKTES = 'Der Link gilt einmalig. Nicht angefordert? Dann diese Nachricht einfach löschen.';

/** Ein Knopf im Gerüst. `hinweis` steht klein darunter, `zweitrangig` zeichnet nur einen Rand. */
function knopf({ text, link, hinweis, zweitrangig }) {
  const flaeche = zweitrangig
    ? `background:#FFFFFF;border:2px solid ${GRUEN};padding:15px 22px;`
    : `background:${GRUEN};padding:17px 22px;`;
  return `
          <tr>
            <td style="padding:24px 28px 0;">
              <a href="${sicher(link)}"
                 style="display:block;${flaeche}color:${SCHWARZ};font-family:${SCHRIFT};font-size:17px;font-weight:600;text-align:center;text-decoration:none;border-radius:4px;">
                ${sicher(text)}
              </a>
            </td>
          </tr>${hinweis ? `
          <tr>
            <td style="padding:8px 28px 0;font-family:${SCHRIFT};font-size:13px;line-height:1.5;color:${GRAU};">
              ${sicher(hinweis)}
            </td>
          </tr>` : ''}`;
}

/**
 * Gerüst für alle Mails dieser App: Logo, Titel, ein oder zwei Knöpfe, Kleingedrucktes.
 *
 * Bewusst ohne erklärenden Satz zwischen Titel und Knopf: Der Titel sagt bereits, worum
 * es geht, der Knopf sagt, was zu tun ist. Braucht ein Knopf doch eine Erklärung (die
 * Einladung hat zwei), steht sie klein unter ihm. `vorschau` ist die Zeile, die im
 * Postfach neben dem Betreff steht — sie ist im Mail selbst unsichtbar.
 *
 * Aufgebaut mit Tabellen und Attributen statt mit Flexbox — nicht aus Nostalgie,
 * sondern weil Outlook auf Windows bis heute mit der Word-Maschine rendert und
 * moderne Anordnung dort schlicht zusammenfällt.
 */
function geruest({ titel, knoepfe, klein, vorschau }) {
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
${knoepfe.map(knopf).join('')}
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
    knoepfe: [{ text: 'E-Mail bestätigen', link }],
    vorschau: KLEINGEDRUCKTES,
    // Bewusst ohne den ausgeschriebenen Link: Er ist über 200 Zeichen lang und würde das
    // kurze Mail optisch beherrschen. Wer HTML abgeschaltet hat, sieht die Textfassung
    // unten — dort steht er.
    klein: KLEINGEDRUCKTES,
  });
  const text = [
    'E-Mail bestätigen',
    '',
    link,
    '',
    KLEINGEDRUCKTES,
    '',
    'Besuchsmorgen FMS Neufeld',
  ].join('\n');
  return { betreff, html, text };
}

/* -------------------------------------------------------------- Einladung */

/**
 * Die beiden Links der Einladung, je nachdem, was die Administration erlaubt hat.
 *
 *   anmelden  «Jetzt anmelden»  — /admin?zugang=CODE           nur Rolle «betreuung»
 *   login     «Login erstellen» — /admin?zugang=CODE&login=1   beide Rollen
 *
 * Beide zeigen auf fms.alae.app, nicht auf eine Firebase-Seite: Der Code wird in der App
 * eingelöst (src/zugang.ts → /api/zugang-anmelden bzw. /api/login-erstellen). Für
 * Spam-Filter zählt das mit — Absender (alae.app) und Ziel passen zusammen.
 */
export function einladungsLinks({ rolle, link, passwort }, code) {
  const basis = `${seitenUrl()}/admin?zugang=${encodeURIComponent(code)}`;
  return {
    ...(rolle !== 'admin' && link !== false ? { anmelden: basis } : {}),
    ...(passwort !== false ? { login: `${basis}&login=1` } : {}),
  };
}

const EINLADUNG_KLEIN = 'Der Link ist persönlich und gehört zu deiner Adresse. Nicht angefordert? '
  + 'Dann diese Nachricht einfach löschen.';

const HINWEIS_ANMELDEN = 'Gilt auf allen deinen Geräten: Link öffnen, E-Mail-Adresse eintippen, fertig.';
const HINWEIS_LOGIN = 'Einmal ein Passwort festlegen — danach meldest du dich überall mit E-Mail und Passwort an.';
const HINWEIS_ADMIN = 'Als Administration meldest du dich mit Passwort an — oder mit Google, mit derselben Adresse.';

/**
 * Die Einladungsmail — ein oder zwei Knöpfe, je nach Rolle und Einstellung.
 *
 * Betreuung: «Jetzt anmelden» (ein Link für alle Geräte) und «Login erstellen» (einmal ein
 * Passwort setzen). Administration: nur «Login erstellen» — ihr Zugang soll nicht als
 * Dauerschlüssel in einem Postfach liegen. Welche Knöpfe erscheinen, entscheidet
 * `einladungsLinks`; hier wird nur gezeichnet, was da ist.
 */
export function einladungsMail({ name, rolle, links }) {
  const admin = rolle === 'admin';
  const titel = admin ? 'Dein Zugang zur Administration' : 'Dein Zugang zur Betreuung';
  const betreff = 'Dein Zugang — Besuchsmorgen FMS Neufeld';

  const knoepfe = [];
  if (links.anmelden) knoepfe.push({ text: 'Jetzt anmelden', link: links.anmelden, hinweis: HINWEIS_ANMELDEN });
  if (links.login) {
    knoepfe.push({
      text: 'Login erstellen', link: links.login,
      hinweis: admin ? HINWEIS_ADMIN : HINWEIS_LOGIN,
      zweitrangig: Boolean(links.anmelden),
    });
  }

  const html = geruest({
    titel,
    knoepfe,
    vorschau: `${name ? `${name}, du` : 'Du'} bist für den Besuchsmorgen eingetragen.`,
    klein: EINLADUNG_KLEIN,
  });

  const text = [
    titel,
    '',
    ...(links.anmelden ? [`Jetzt anmelden — ${HINWEIS_ANMELDEN}`, links.anmelden, ''] : []),
    ...(links.login ? [`Login erstellen — ${admin ? HINWEIS_ADMIN : HINWEIS_LOGIN}`, links.login, ''] : []),
    EINLADUNG_KLEIN,
    '',
    'Besuchsmorgen FMS Neufeld',
  ].join('\n');
  return { betreff, html, text };
}

/**
 * Passwort zurücksetzen — der Link führt auf die Firebase-Seite, auf der sich ein
 * neues Passwort setzen lässt (siehe passwort.mjs).
 */
export function passwortMail(link) {
  const betreff = 'Passwort zurücksetzen — Besuchsmorgen FMS Neufeld';
  const html = geruest({
    titel: 'Passwort zurücksetzen',
    knoepfe: [{ text: 'Neues Passwort setzen', link }],
    vorschau: KLEINGEDRUCKTES,
    klein: KLEINGEDRUCKTES,
  });
  const text = [
    'Passwort zurücksetzen',
    '',
    link,
    '',
    KLEINGEDRUCKTES,
    '',
    'Besuchsmorgen FMS Neufeld',
  ].join('\n');
  return { betreff, html, text };
}
