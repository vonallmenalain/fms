/* =========================================================================
   Prüft die beiden Mail-Funktionen gegen die Firebase Emulator Suite.
   -------------------------------------------------------------------------
     npm run mailtest        (startet die Emulatoren selbst)

   Geprüft wird der echte Kode aus netlify/ — nur der Versand über Resend wird
   abgefangen, damit im Test keine Post rausgeht. Wichtigster Punkt ist die
   Schranke bei Anmeldelink und Passwort: Sie ist die einzige Stelle, die
   verhindert, dass sich über die Schnittstellen beliebige Adressen von unserer
   Domain aus anschreiben lassen — und sie soll nicht verraten, wer Zugang hat.
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
const { default: anmeldelink } = await import('../netlify/functions/anmeldelink.mjs');
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

/* ----------------------------------------------------------- Anmeldelink */
console.log('\nAnmeldelink');

letzteMail = null;
r = await post(anmeldelink, { mail: 'fremde@example.ch' });
d = await r.json();
pruefe('fremde Adresse: keine Mail, aber unauffällige Antwort',
  r.status === 200 && d.stand === 'erledigt' && letzteMail === null);

await adminDb().collection('zugang').doc('eingeladen@example.ch')
  .set({ email: 'eingeladen@example.ch', name: 'Test', rolle: 'betreuung' });
letzteMail = null;
r = await post(anmeldelink, { mail: '  Eingeladen@Example.CH ' });        // Schreibweise egal
d = await r.json();
pruefe('eingeladene Adresse: Mail geht raus',
  r.status === 200 && d.stand === 'erledigt' && letzteMail?.to?.[0] === 'eingeladen@example.ch');
pruefe('enthält den Anmeldelink von Firebase', /mode=signIn/.test(html()) && /oobCode=/.test(html()));

letzteMail = null;
r = await post(anmeldelink, { mail: 'eingeladen@example.ch' });
pruefe('zweiter Versuch sofort danach ist gesperrt — mit derselben Antwort',
  r.status === 200 && (await r.json()).stand === 'erledigt' && letzteMail === null);

// Freigeschaltetes Konto ohne Einladung — etwa der Erstzugang aus den Rules.
await neuesKonto('konto@example.ch');
const wer = await adminAuth().getUserByEmail('konto@example.ch');
await adminDb().collection('admins').doc(wer.uid)
  .set({ rolle: 'admin', name: 'Erstzugang', email: 'konto@example.ch', seit: '2026-01-01' });
letzteMail = null;
r = await post(anmeldelink, { mail: 'konto@example.ch' });
pruefe('freigeschaltetes Konto ohne Einladung: Mail geht raus', letzteMail?.to?.[0] === 'konto@example.ch');

await neuesKonto('nurkonto@example.ch');
letzteMail = null;
r = await post(anmeldelink, { mail: 'nurkonto@example.ch' });
pruefe('Konto ohne Freischaltung: keine Mail', letzteMail === null);

r = await post(anmeldelink, { mail: 'keine-adresse' });
pruefe('unsinnige Adresse wird abgewiesen', r.status === 400);

/* --------------------------------------------------- Passwort zurücksetzen */
console.log('\nPasswort zurücksetzen');

letzteMail = null;
r = await post(passwort, { mail: 'fremde@example.ch' });
d = await r.json();
pruefe('fremde Adresse: keine Mail, aber unauffällige Antwort',
  r.status === 200 && d.stand === 'erledigt' && letzteMail === null);

// Eingeladen, aber es gibt noch gar kein Konto — es gibt nichts zurückzusetzen.
letzteMail = null;
r = await post(passwort, { mail: 'eingeladen@example.ch' });
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
