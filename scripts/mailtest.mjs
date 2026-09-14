/* =========================================================================
   Prüft die Mail- und Zugangsfunktionen gegen die Firebase Emulator Suite.
   -------------------------------------------------------------------------
     npm run mailtest        (startet die Emulatoren selbst)

   Geprüft wird der echte Kode aus netlify/ — nur der Versand über Resend wird
   abgefangen, damit im Test keine Post rausgeht. Wichtigste Punkte: die
   Schranke bei Einladung und Passwort (nur eingetragene Adressen bekommen Post,
   ohne dass die Antwort verrät, wer eingetragen ist) und der Zugangscode —
   er darf nur mit der richtigen Adresse und nur für das Erlaubte gelten.
   ========================================================================= */

import { generateKeyPairSync } from 'node:crypto';

const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

// Das Admin-SDK verlangt ein vollständiges Dienstkonto, auch gegen die Emulatoren.
// Gegen sie wird nichts davon signiert oder geprüft — der Schlüssel entsteht hier
// frisch, damit im Repo keiner herumliegt.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: process.env.GCLOUD_PROJECT ?? 'fmsbesuchstag',
  private_key_id: 'nur-fuer-den-test',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'test@fmsbesuchstag.iam.gserviceaccount.com',
  client_id: '1',
  token_uri: 'https://oauth2.googleapis.com/token',
});
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.GCLOUD_PROJECT ??= 'fmsbesuchstag';
process.env.RESEND_API_KEY = 're_nur-fuer-den-test';
process.env.MAIL_ABSENDER = 'FMS Neufeld <besuchsmorgen@alae.app>';
process.env.SEITEN_URL = 'https://fms.alae.app';

// Resend abfangen; alles andere (die Emulatoren) läuft normal weiter.
const echtesFetch = globalThis.fetch;
let letzteMail = null;
globalThis.fetch = async (url, opt) => {
  if (!String(url).includes('api.resend.com')) return echtesFetch(url, opt);
  letzteMail = JSON.parse(opt.body);
  return new Response('{"id":"test"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const { default: bestaetigung } = await import('../netlify/functions/bestaetigung.mjs');
const { default: einladung } = await import('../netlify/functions/einladung.mjs');
const { default: zugangAnmelden } = await import('../netlify/functions/zugang-anmelden.mjs');
const { default: loginErstellen } = await import('../netlify/functions/login-erstellen.mjs');
const { default: passwort } = await import('../netlify/functions/passwort.mjs');
const { adminAuth, adminDb } = await import('../netlify/lib/dienst.mjs');

const post = (fn, rumpf) => fn(new Request('https://fms.alae.app/api/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rumpf),
}));

/** Konto im Auth-Emulator anlegen — der prüft den API-Schlüssel nicht. */
async function neuesKonto(email) {
  const r = await echtesFetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=egal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'geheim123', returnSecureToken: true }),
  });
  const d = await r.json();
  if (!d.idToken) throw new Error(`Emulator antwortete: ${JSON.stringify(d)}`);
  return d;
}

/**
 * Emulatoren leeren. Der Test legt Konten und Zugänge mit festen Adressen an; ohne das
 * scheitert der zweite Durchlauf an «EMAIL_EXISTS». Es trifft ausschliesslich die
 * Emulatoren — gegen die echte Datenbank läuft dieses Skript nie, es kennt nur die
 * Adressen aus FIREBASE_AUTH_EMULATOR_HOST und FIRESTORE_EMULATOR_HOST.
 */
const projekt = process.env.GCLOUD_PROJECT;
await echtesFetch(`http://${AUTH}/emulator/v1/projects/${projekt}/accounts`, { method: 'DELETE' });
await echtesFetch(
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projekt}/databases/(default)/documents`,
  { method: 'DELETE' },
);

let fehler = 0;
const pruefe = (name, bedingung, zusatz = '') => {
  console.log(`${bedingung ? '  ok  ' : 'FEHLER'}  ${name}${zusatz ? ` — ${zusatz}` : ''}`);
  if (!bedingung) fehler++;
};
const html = () => letzteMail?.html ?? '';

/* ------------------------------------------------------ Bestätigungsmail */
console.log('\nBestätigungsmail');

const neu = await neuesKonto('neu@example.ch');
letzteMail = null;
let r = await post(bestaetigung, { idToken: neu.idToken });
let d = await r.json();
pruefe('verschickt an die Adresse aus dem Token', r.status === 200 && d.stand === 'gesendet'
  && letzteMail?.to?.[0] === 'neu@example.ch', JSON.stringify(d));
pruefe('enthält den Bestätigungslink von Firebase', /mode=verifyEmail/.test(html()) && /oobCode=/.test(html()));
pruefe('führt zurück auf /admin', /continueUrl=[^"']*%2Fadmin/.test(html()));
pruefe('kommt von der eigenen Domain', Boolean(letzteMail?.from?.includes('@alae.app')));

letzteMail = null;
r = await post(bestaetigung, { idToken: neu.idToken });
pruefe('zweiter Versuch sofort danach ist gesperrt', r.status === 429 && letzteMail === null);

r = await post(bestaetigung, { idToken: 'unsinn' });
pruefe('ungültiges Token bekommt keine Mail', r.status === 401);

/* ------------------------------------------------------------- Einladung */
console.log('\nEinladung');

const linksAus = (t) => (t ?? '').split('\n').filter((z) => z.startsWith('http'));

letzteMail = null;
r = await post(einladung, { mail: 'fremde@example.ch' });
d = await r.json();
pruefe('fremde Adresse: keine Mail, aber unauffällige Antwort',
  r.status === 200 && d.stand === 'erledigt' && letzteMail === null);

await adminDb().collection('zugang').doc('eingeladen@example.ch')
  .set({ email: 'eingeladen@example.ch', name: 'Test', rolle: 'betreuung', link: true, passwort: true });
// MAIL_ABSENDER einmal ohne Namen — die Funktion muss ihn selbst davorsetzen, sonst zeigt
// Gmail die nackte Adresse (siehe mitAbsenderName in lib/mail.mjs).
process.env.MAIL_ABSENDER = 'besuchsmorgen@alae.app';
letzteMail = null;
r = await post(einladung, { mail: '  Eingeladen@Example.CH ' });        // Schreibweise egal, ohne Ausweis
d = await r.json();
process.env.MAIL_ABSENDER = 'FMS Neufeld <besuchsmorgen@alae.app>';
pruefe('eingetragene Adresse ohne Ausweis: Mail geht raus, Antwort bleibt neutral',
  r.status === 200 && d.stand === 'erledigt' && d.links === undefined
  && letzteMail?.to?.[0] === 'eingeladen@example.ch', JSON.stringify(d));
const [anmeldenLink, loginLink] = linksAus(letzteMail?.text);
pruefe('Betreuung bekommt zwei Links: «Jetzt anmelden» und «Login erstellen»',
  anmeldenLink?.startsWith('https://fms.alae.app/admin?zugang=') && loginLink === `${anmeldenLink}&login=1`,
  `${anmeldenLink} / ${loginLink}`);
pruefe('beide Links stehen auch im HTML und zeigen auf die eigene Domain, nicht auf Firebase',
  html().includes(`href="${anmeldenLink}"`) && html().includes(`href="${loginLink.replace('&', '&amp;')}"`)
  && !/firebaseapp\.com|127\.0\.0\.1|localhost/.test(html() + letzteMail?.text));
pruefe('Absender ohne Namen in MAIL_ABSENDER bekommt einen',
  letzteMail?.from === 'Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>', letzteMail?.from);
const code = anmeldenLink ? new URL(anmeldenLink).searchParams.get('zugang') : null;
pruefe('der Zugangscode ist lang genug, um nicht erraten zu werden', typeof code === 'string' && code.length >= 32);

letzteMail = null;
r = await post(einladung, { mail: 'eingeladen@example.ch' });
pruefe('zweiter Versuch sofort danach ist gesperrt — mit derselben Antwort',
  r.status === 200 && (await r.json()).stand === 'erledigt' && letzteMail === null);

// Die Administration weist sich mit ihrem ID-Token aus und bekommt ehrliche Antworten.
const admin = await neuesKonto('konto@example.ch');
const wer = await adminAuth().getUserByEmail('konto@example.ch');
await adminDb().collection('admins').doc(wer.uid)
  .set({ rolle: 'admin', name: 'Erstzugang', email: 'konto@example.ch', seit: '2026-01-01' });
const ohneRolle = await neuesKonto('nurkonto@example.ch');

letzteMail = null;
r = await post(einladung, { mail: 'eingeladen@example.ch', idToken: admin.idToken, senden: false });
d = await r.json();
pruefe('Administration holt nur die Links: nichts verschickt, derselbe Code wie im Mail',
  r.status === 200 && d.stand === 'links' && letzteMail === null
  && d.links?.anmelden === anmeldenLink && d.links?.login === loginLink, JSON.stringify(d));

letzteMail = null;
r = await post(einladung, { mail: 'niemand@example.ch', idToken: admin.idToken });
d = await r.json();
pruefe('Administration erfährt, dass nichts verschickt wurde',
  r.status === 200 && d.stand === 'nicht-eingeladen' && letzteMail === null, JSON.stringify(d));

await adminDb().collection('zugang').doc('chef@example.ch')
  .set({ email: 'chef@example.ch', name: 'Chef', rolle: 'admin', link: false, passwort: true });
letzteMail = null;
r = await post(einladung, { mail: 'chef@example.ch', idToken: admin.idToken });
d = await r.json();
pruefe('Administration erfährt, dass verschickt wurde',
  r.status === 200 && d.stand === 'gesendet' && letzteMail?.to?.[0] === 'chef@example.ch', JSON.stringify(d));
pruefe('Einladung für die Administration hat nur «Login erstellen»',
  linksAus(letzteMail?.text).length === 1 && d.links?.anmelden === undefined && d.links?.login?.endsWith('&login=1'));
const chefCode = d.links?.login ? new URL(d.links.login).searchParams.get('zugang') : null;

letzteMail = null;
r = await post(einladung, { mail: 'chef@example.ch', idToken: admin.idToken });
pruefe('Administration erfährt, dass die Sperre griff', (await r.json()).stand === 'gesperrt' && letzteMail === null);

await adminDb().collection('zugang').doc('leer@example.ch')
  .set({ email: 'leer@example.ch', name: '', rolle: 'betreuung', link: false, passwort: false });
letzteMail = null;
r = await post(einladung, { mail: 'leer@example.ch', idToken: admin.idToken });
pruefe('beide Wege abgeschaltet: keine Mail, und die Administration erfährt es',
  (await r.json()).stand === 'nichts-erlaubt' && letzteMail === null);

r = await post(einladung, { mail: 'niemand2@example.ch', idToken: ohneRolle.idToken });
pruefe('Konto ohne Rolle «admin» bekommt weiterhin die neutrale Antwort', (await r.json()).stand === 'erledigt');
r = await post(einladung, { mail: 'niemand3@example.ch', idToken: 'unsinn' });
pruefe('ungültiges Token bekommt weiterhin die neutrale Antwort', (await r.json()).stand === 'erledigt');

/* ------------------------------------------------- Jetzt anmelden (Zugangscode) */
console.log('\nJetzt anmelden');

r = await post(zugangAnmelden, { mail: 'eingeladen@example.ch', code: 'falsch' });
d = await r.json();
pruefe('falscher Code wird abgewiesen', r.status === 403 && d.grund === 'passt-nicht', JSON.stringify(d));
r = await post(zugangAnmelden, { mail: 'andere@example.ch', code });
pruefe('richtiger Code mit anderer Adresse wird abgewiesen', r.status === 403 && (await r.json()).grund === 'passt-nicht');

r = await post(zugangAnmelden, { mail: 'Eingeladen@example.ch', code });
d = await r.json();
const tokenTeile = String(d.token ?? '').split('.');
pruefe('Code und Adresse passen: Anmelde-Token kommt', r.status === 200 && tokenTeile.length === 3, JSON.stringify(d).slice(0, 80));
const nutzlast = tokenTeile.length === 3 ? JSON.parse(Buffer.from(tokenTeile[1], 'base64url').toString()) : {};
const eingeladenKonto = await adminAuth().getUserByEmail('eingeladen@example.ch').catch(() => null);
pruefe('Konto ist angelegt, Adresse gilt als bestätigt, Token lautet auf dieses Konto',
  eingeladenKonto?.emailVerified === true && nutzlast.uid === eingeladenKonto?.uid);
const frei = await adminDb().collection('admins').doc(eingeladenKonto?.uid ?? 'x').get();
pruefe('freigeschaltet mit der Rolle aus der Einladung',
  frei.exists && frei.data()?.rolle === 'betreuung' && frei.data()?.email === 'eingeladen@example.ch');

r = await post(zugangAnmelden, { mail: 'eingeladen@example.ch', code });
pruefe('derselbe Code geht nochmals — das zweite Gerät',
  r.status === 200 && String((await r.json()).token).split('.').length === 3);

r = await post(zugangAnmelden, { mail: 'chef@example.ch', code: chefCode });
pruefe('Administration kann sich nicht per Link anmelden', r.status === 403 && (await r.json()).grund === 'nur-betreuung');

await adminDb().collection('zugang').doc('eingeladen@example.ch').update({ link: false });
r = await post(zugangAnmelden, { mail: 'eingeladen@example.ch', code });
pruefe('Link abgeschaltet: keine Anmeldung per Code', r.status === 403 && (await r.json()).grund === 'link-aus');
await adminDb().collection('zugang').doc('eingeladen@example.ch').update({ link: true });

// Die Bremse: fünf Fehlversuche, dann Pause — auch mit dem richtigen Code.
for (let i = 0; i < 5; i++) await post(zugangAnmelden, { mail: 'bremse@example.ch', code: `falsch${i}` });
r = await post(zugangAnmelden, { mail: 'bremse@example.ch', code });
pruefe('nach fünf Fehlversuchen ist die Adresse zehn Minuten gesperrt', r.status === 429 && (await r.json()).grund === 'gesperrt');

/* ------------------------------------------------------- Login erstellen */
console.log('\nLogin erstellen');

r = await post(loginErstellen, { mail: 'eingeladen@example.ch', code, passwort: '123' });
pruefe('zu kurzes Passwort wird abgewiesen', r.status === 400 && (await r.json()).grund === 'passwort');
r = await post(loginErstellen, { mail: 'eingeladen@example.ch', code: 'falsch', passwort: 'geheim123' });
pruefe('falscher Code wird abgewiesen', r.status === 403 && (await r.json()).grund === 'passt-nicht');

r = await post(loginErstellen, { mail: 'eingeladen@example.ch', code, passwort: 'geheim123' });
d = await r.json();
pruefe('Betreuung legt ein Passwort fest', r.status === 200 && d.stand === 'erstellt', JSON.stringify(d));
const mitPasswort = await adminAuth().getUserByEmail('eingeladen@example.ch');
pruefe('das Konto hat jetzt einen Passwort-Anbieter und bleibt bestätigt',
  mitPasswort.providerData.some((p) => p.providerId === 'password') && mitPasswort.emailVerified === true);
r = await post(zugangAnmelden, { mail: 'eingeladen@example.ch', code });
pruefe('«Jetzt anmelden» geht für die Betreuung danach weiterhin', r.status === 200);

r = await post(loginErstellen, { mail: 'chef@example.ch', code: chefCode, passwort: 'chefgeheim' });
d = await r.json();
pruefe('Administration erstellt ihr Login', r.status === 200 && d.stand === 'erstellt', JSON.stringify(d));
const chef = await adminAuth().getUserByEmail('chef@example.ch');
const chefFrei = await adminDb().collection('admins').doc(chef.uid).get();
pruefe('… und ist als Administration freigeschaltet', chefFrei.exists && chefFrei.data()?.rolle === 'admin');
r = await post(loginErstellen, { mail: 'chef@example.ch', code: chefCode, passwort: 'nochmals123' });
pruefe('der Code der Administration ist danach verbraucht', r.status === 403 && (await r.json()).grund === 'passt-nicht');

await adminDb().collection('zugang').doc('eingeladen@example.ch').update({ passwort: false });
r = await post(loginErstellen, { mail: 'eingeladen@example.ch', code, passwort: 'geheim123' });
pruefe('Passwort abgeschaltet: kein Login erstellen', r.status === 403 && (await r.json()).grund === 'passwort-aus');
await adminDb().collection('zugang').doc('eingeladen@example.ch').update({ passwort: true });

/* --------------------------------------------------- Passwort zurücksetzen */
console.log('\nPasswort zurücksetzen');

letzteMail = null;
r = await post(passwort, { mail: 'fremde@example.ch' });
d = await r.json();
pruefe('fremde Adresse: keine Mail, aber unauffällige Antwort',
  r.status === 200 && d.stand === 'erledigt' && letzteMail === null);

// Eingeladen, aber es gibt noch gar kein Konto — es gibt nichts zurückzusetzen.
await adminDb().collection('zugang').doc('nur-eingeladen@example.ch')
  .set({ email: 'nur-eingeladen@example.ch', name: 'Test', rolle: 'betreuung' });
letzteMail = null;
r = await post(passwort, { mail: 'nur-eingeladen@example.ch' });
pruefe('eingeladen ohne Konto: keine Mail', r.status === 200 && letzteMail === null);

// Freigeschaltetes Konto mit Passwort — der eigentliche Fall.
letzteMail = null;
r = await post(passwort, { mail: 'konto@example.ch' });
pruefe('freigeschaltetes Konto mit Passwort: Mail geht raus', letzteMail?.to?.[0] === 'konto@example.ch');
pruefe('enthält den Rücksetzlink von Firebase', /mode=resetPassword/.test(html()) && /oobCode=/.test(html()));

letzteMail = null;
r = await post(passwort, { mail: 'konto@example.ch' });
pruefe('zweiter Versuch sofort danach ist gesperrt — mit derselben Antwort',
  r.status === 200 && (await r.json()).stand === 'erledigt' && letzteMail === null);

// Konto ohne Freischaltung: Passwort ja, Zugang nein.
letzteMail = null;
r = await post(passwort, { mail: 'nurkonto@example.ch' });
pruefe('Konto ohne Freischaltung: keine Mail', letzteMail === null);

console.log(fehler === 0 ? '\nAlle Prüfungen bestanden.\n' : `\n${fehler} Prüfung(en) fehlgeschlagen.\n`);
process.exit(fehler === 0 ? 0 : 1);
