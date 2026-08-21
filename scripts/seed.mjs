#!/usr/bin/env node
/**
 * Spiegelt data/programm.json nach Firestore.
 *
 *   node scripts/seed.mjs [--project fmsbesuchstag] [--oeffnen]
 *
 * Idempotent: bestehende Zählerstände (belegt) bleiben erhalten, es werden nur
 * Kapazität und Blockzuordnung abgeglichen und fehlende Dokumente angelegt.
 * Damit lässt sich das Programm auch noch am Vorabend anpassen, ohne Anmeldungen
 * zu verlieren.
 *
 * Anmeldung über GOOGLE_APPLICATION_CREDENTIALS (Dienstkonto-Schlüssel).
 * In der GitHub-Action wird der Schlüssel aus dem Secret FIREBASE_SERVICE_ACCOUNT gelegt.
 */
import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : standard;
};
const flag = (name) => process.argv.includes(`--${name}`);

const projectId = arg('project', process.env.GCLOUD_PROJECT || 'fmsbesuchstag');
const programm = JSON.parse(await readFile(new URL('../data/programm.json', import.meta.url)));

// Gegen die Emulator Suite braucht es keine Anmeldedaten.
const imEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp(imEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

let angelegt = 0, abgeglichen = 0;
const batch = db.batch();

for (const a of programm.offerings) {
  const ref = db.collection('slots').doc(a.id);
  const vorhanden = await ref.get();
  if (vorhanden.exists) {
    batch.update(ref, { kapazitaet: a.kapazitaet, block: a.blockId });
    abgeglichen++;
  } else {
    batch.set(ref, { kapazitaet: a.kapazitaet, block: a.blockId, belegt: 0 });
    angelegt++;
  }
}

const configRef = db.doc('config/app');
const config = await configRef.get();
batch.set(configRef, {
  maxPlaetzeProGeraet: programm.regeln.maxPlaetzeProGeraet,
  liveZaehler: true,
  programmVersion: programm.version,
  aktualisiertAm: FieldValue.serverTimestamp(),
  // anmeldungOffen wird NIE automatisch verändert (Entscheid D4: manueller Schalter),
  // ausser beim allerersten Anlegen oder mit --oeffnen.
  ...(config.exists && !flag('oeffnen') ? {} : { anmeldungOffen: flag('oeffnen') }),
  ...(config.exists ? {} : { banner: '', protokoll: true }),
}, { merge: true });

await batch.commit();

const proBlock = Object.fromEntries(programm.blocks.map((b) => [b.id, { angebote: 0, plaetze: 0 }]));
for (const a of programm.offerings) {
  proBlock[a.blockId].angebote++;
  proBlock[a.blockId].plaetze += a.kapazitaet;
}
console.log(`Projekt ${projectId}: ${angelegt} angelegt, ${abgeglichen} abgeglichen.`);
console.table(proBlock);
const jetzt = await configRef.get();
console.log(`Programmversion ${programm.version} · Anmeldung ist ${jetzt.data().anmeldungOffen ? 'OFFEN' : 'GESCHLOSSEN'}.`);
