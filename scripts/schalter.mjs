#!/usr/bin/env node
/**
 * Freigabeschalter (Entscheid D4) von aussen umlegen — unabhängig vom Admin-Bereich.
 * Gedacht als zweiter Weg, falls am Eventtag niemand im Admin-Bereich angemeldet ist.
 *
 *   node scripts/schalter.mjs --offen
 *   node scripts/schalter.mjs --zu
 *   node scripts/schalter.mjs --banner "Sport findet in Turnhalle 2 statt"
 *   node scripts/schalter.mjs --live-aus          # Reserveschalter: keine Live-Zähler
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const arg = (n, s) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : s;
};
const flag = (n) => process.argv.includes(`--${n}`);

const projectId = arg('project', process.env.GCLOUD_PROJECT || 'fmsbesuchstag');
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

const werte = {};
if (flag('offen')) werte.anmeldungOffen = true;
if (flag('zu')) werte.anmeldungOffen = false;
if (flag('live-aus')) werte.liveZaehler = false;
if (flag('live-an')) werte.liveZaehler = true;
if (process.argv.includes('--banner')) werte.banner = arg('banner', '');

if (!Object.keys(werte).length) {
  console.error('Nichts zu tun. Optionen: --offen --zu --live-an --live-aus --banner "Text"');
  process.exit(1);
}

await db.doc('config/app').set(werte, { merge: true });
const jetzt = (await db.doc('config/app').get()).data();
console.log('config/app ist jetzt:', {
  anmeldungOffen: jetzt.anmeldungOffen,
  liveZaehler: jetzt.liveZaehler,
  banner: jetzt.banner,
  maxPlaetzeProGeraet: jetzt.maxPlaetzeProGeraet,
});
