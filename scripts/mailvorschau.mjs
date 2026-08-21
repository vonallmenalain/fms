/* =========================================================================
   Vorschau der verschickten Mails — und auf Wunsch ein echter Testversand.
   -------------------------------------------------------------------------
     npm run mailvorschau                  → schreibt mailvorschau.html
     npm run mailvorschau -- du@example.ch → schickt alle drei Mails zusätzlich hin

   Für den Versand braucht es RESEND_API_KEY und MAIL_ABSENDER in der Umgebung:
     RESEND_API_KEY=re_… MAIL_ABSENDER='FMS Neufeld <besuchsmorgen@alae.app>' \
       npm run mailvorschau -- du@example.ch
   ========================================================================= */

import { readFileSync, writeFileSync } from 'node:fs';
import { anmeldelinkMail, bestaetigungsMail, passwortMail, sendeMail } from '../netlify/lib/mail.mjs';

const empfaenger = process.argv[2] ?? null;

// Links, die wie echte aussehen — gültig ist hier nichts.
const beispielLink = (modus) =>
  `https://fmsbesuchstag.firebaseapp.com/__/auth/action?mode=${modus}`
  + '&oobCode=BEISPIEL-nur-zur-Ansicht&apiKey=BEISPIEL&lang=de';

const mails = [
  { name: 'Bestätigungsmail', ...bestaetigungsMail(beispielLink('verifyEmail')) },
  { name: 'Anmeldelink', ...anmeldelinkMail(beispielLink('signIn')) },
  { name: 'Passwort zurücksetzen', ...passwortMail(beispielLink('resetPassword')) },
];

// Im echten Mail wird das Logo von der Website geladen. Für die Ansicht auf der eigenen
// Platte gibt es diese Website nicht — darum hier das Bild direkt einbetten, sonst steht
// an seiner Stelle ein kaputtes Symbol und die Vorschau täuscht einen Fehler vor.
const logo = readFileSync(new URL('../public/fms-neufeld.png', import.meta.url)).toString('base64');
const mitLogo = (html) => html.replace(/src="[^"]*fms-neufeld\.png"/, `src="data:image/png;base64,${logo}"`);

// Alle Mails untereinander in EINER Datei: So sieht man auf einen Blick, ob sie
// zusammenpassen. Die <body>-Hüllen der einzelnen Mails stören dabei nicht.
writeFileSync(
  'mailvorschau.html',
  mails.map((m) => mitLogo(m.html)).join('\n<hr style="border:0;border-top:1px dashed #BFC3AE;margin:0">\n'),
);

for (const m of mails) {
  console.log(`\n── ${m.name} ──`);
  console.log(`Betreff: ${m.betreff}\n`);
  console.log(m.text);
}
console.log('\nGeschrieben: mailvorschau.html — im Browser öffnen.');

if (empfaenger) {
  for (const m of mails) {
    await sendeMail({ an: empfaenger, betreff: m.betreff, html: m.html, text: m.text });
    console.log(`${m.name} an ${empfaenger} verschickt.`);
  }
}
