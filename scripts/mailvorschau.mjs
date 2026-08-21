/* =========================================================================
   Vorschau der Bestätigungsmail — und auf Wunsch ein echter Testversand.
   -------------------------------------------------------------------------
     npm run mailvorschau                  → schreibt mailvorschau.html
     npm run mailvorschau -- du@example.ch → schickt die Mail zusätzlich hin

   Für den Versand braucht es RESEND_API_KEY und MAIL_ABSENDER in der Umgebung:
     RESEND_API_KEY=re_… MAIL_ABSENDER='FMS Neufeld <besuchsmorgen@alae.app>' \
       npm run mailvorschau -- du@example.ch
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { bestaetigungsMail, sendeMail } from '../netlify/lib/mail.mjs';

const empfaenger = process.argv[2] ?? null;

// Ein Link, der wie ein echter aussieht — verschickt wird hier nichts Gültiges.
const BEISPIEL_LINK =
  'https://fmsbesuchstag.firebaseapp.com/__/auth/action?mode=verifyEmail'
  + '&oobCode=BEISPIEL-nur-zur-Ansicht&apiKey=BEISPIEL&lang=de';

const { betreff, html, text } = bestaetigungsMail(BEISPIEL_LINK);

// Im echten Mail wird das Logo von der Website geladen. Für die Ansicht auf der eigenen
// Platte gibt es diese Website nicht — darum hier das Bild direkt einbetten, sonst steht
// an seiner Stelle ein kaputtes Symbol und die Vorschau täuscht einen Fehler vor.
const logo = readFileSync(new URL('../public/fms-neufeld.png', import.meta.url)).toString('base64');
const htmlFuerDatei = html.replace(/src="[^"]*fms-neufeld\.png"/, `src="data:image/png;base64,${logo}"`);

writeFileSync('mailvorschau.html', htmlFuerDatei);
console.log(`Betreff: ${betreff}`);
console.log('Geschrieben: mailvorschau.html — im Browser öffnen.\n');
console.log(text);

if (empfaenger) {
  await sendeMail({ an: empfaenger, betreff, html, text });
  console.log(`\nTestmail an ${empfaenger} verschickt.`);
}
