#!/usr/bin/env node
/**
 * Löscht alle Anmeldungen, leert das Protokoll und setzt sämtliche Zähler auf 0.
 * Nach der Generalprobe und nach dem Event.
 *
 *   node scripts/reset.mjs --ja [--project fmsbesuchstag]
 *
 * Ohne --ja passiert nichts — das Skript ist absichtlich schwer versehentlich auszuführen.
 */
import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const arg = (n, s) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : s;
};
if (!process.argv.includes('--ja')) {
  console.error('Sicherheitsabfrage: Aufruf mit --ja wiederholen, um wirklich alles zu löschen.');
  process.exit(1);
}

const projectId = arg('project', process.env.GCLOUD_PROJECT || 'fmsbesuchstag');
const programm = JSON.parse(await readFile(new URL('../data/programm.json', import.meta.url)));

// Gegen die Emulator Suite braucht es keine Anmeldedaten.
const imEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp(imEmulator ? { projectId } : { projectId, credential: applicationDefault() });
const db = getFirestore();

const loesche = async (name) => {
  const snap = await db.collection(name).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return snap.size;
};

const buchungen = await loesche('bookings');
// Protokollzeilen zu Anmeldungen, die es nicht mehr gibt, sind nur noch Verwirrung.
const protokoll = await loesche('log');

// Erst die Zähler aus der Programmdatei — sie bekommen dabei auch wieder ihre Kapazität.
const b = db.batch();
for (const a of programm.offerings) {
  b.set(db.collection('slots').doc(a.id), { belegt: 0, kapazitaet: a.kapazitaet, block: a.blockId });
}

/**
 * Und dann alle übrigen: Seit die Steuerung eigene Angebote anlegen darf, steht nicht
 * mehr jeder Zähler in der Programmdatei. Ohne diese Schleife bliebe ihr Stand nach dem
 * Zurücksetzen stehen, während die zugehörige Anmeldung gelöscht ist — genau die
 * Invariante L1 aus docs/05 («Summe der Zähler = Summe der gebuchten Plätze») wäre
 * gebrochen, und `npm run pruefe` fiele durch. Die Kapazität bleibt dabei unangetastet;
 * sie steht nirgends sonst.
 */
const alleZaehler = await db.collection('slots').get();
const ausDatei = new Set(programm.offerings.map((a) => a.id));
const weitere = alleZaehler.docs.filter((d) => !ausDatei.has(d.id));
weitere.forEach((d) => b.update(d.ref, { belegt: 0 }));

b.set(db.doc('config/app'), { anmeldungOffen: false, banner: '' }, { merge: true });
await b.commit();

console.log(`${buchungen} Anmeldungen gelöscht, ${protokoll} Protokollzeilen geleert, `
  + `${programm.offerings.length + weitere.length} Zähler auf 0`
  + `${weitere.length ? ` (davon ${weitere.length} in der Steuerung angelegt)` : ''}, `
  + 'Anmeldung geschlossen.');
