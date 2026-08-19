#!/usr/bin/env node
// scripts/seed.mjs — spiegelt data/programm.json nach Firestore.
//
//   node scripts/seed.mjs --project fms-besuchstag-test
//   node scripts/seed.mjs --project fms-besuchstag-prod
//
// Idempotent: bestehende Zählerstände (belegt) bleiben erhalten, es werden nur
// Kapazität/Block aktualisiert und fehlende Dokumente angelegt. Damit lässt sich das
// Programm auch noch am Vorabend anpassen, ohne bestehende Anmeldungen zu verlieren.
//
// Voraussetzung: GOOGLE_APPLICATION_CREDENTIALS zeigt auf den Service-Account-Schlüssel
// (Firebase-Konsole -> Projekteinstellungen -> Dienstkonten -> Neuen Schlüssel erzeugen).
// Der Schlüssel gehört NICHT ins Repo — .gitignore enthält *.serviceaccount.json

import { readFile } from 'node:fs/promises';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.argv[process.argv.indexOf('--project') + 1];
if (!projectId || projectId.startsWith('--')) {
  console.error('Aufruf: node scripts/seed.mjs --project <firebase-projekt-id>');
  process.exit(1);
}

const programm = JSON.parse(await readFile(new URL('../data/programm.json', import.meta.url)));
initializeApp({ projectId, credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) });
const db = getFirestore();

let angelegt = 0, aktualisiert = 0;
const batch = db.batch();

for (const angebot of programm.offerings) {
  const ref = db.collection('slots').doc(angebot.id);
  const vorhanden = await ref.get();
  if (vorhanden.exists) {
    batch.update(ref, { kapazitaet: angebot.kapazitaet, block: angebot.blockId });
    aktualisiert++;
  } else {
    batch.set(ref, { kapazitaet: angebot.kapazitaet, block: angebot.blockId, belegt: 0 });
    angelegt++;
  }
}

batch.set(db.doc('config/app'), {
  anmeldungOffen: false,                 // bewusst geschlossen — Freigabe am Eventtag (D4)
  maxPlaetzeProGeraet: 3,
  liveZaehler: true,
  banner: '',
  programmVersion: programm.version,
}, { merge: true });

await batch.commit();

// Kontrollausgabe: verhindert stille Tippfehler in programm.json
const proBlock = Object.fromEntries(programm.blocks.map((b) => [b.id, { angebote: 0, plaetze: 0 }]));
for (const a of programm.offerings) {
  proBlock[a.blockId].angebote++;
  proBlock[a.blockId].plaetze += a.kapazitaet;
}
console.log(`Projekt ${projectId}: ${angelegt} angelegt, ${aktualisiert} aktualisiert.`);
console.table(proBlock);
console.log(`Programmversion ${programm.version} — Anmeldung ist GESCHLOSSEN.`);
