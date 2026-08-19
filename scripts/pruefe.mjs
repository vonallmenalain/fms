#!/usr/bin/env node
/**
 * Prüft die Invarianten L1–L3 aus docs/05-last-und-performance.md gegen die echte Datenbank.
 * Nach dem Lasttest, nach der Generalprobe und am Eventtag jederzeit ausführbar.
 *
 *   node scripts/pruefe.mjs [--project fmsbesuchstag]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const arg = (n, s) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : s;
};
const projektId = arg('project', process.env.GCLOUD_PROJECT || 'fmsbesuchstag');
initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: projektId } : { projectId: projektId, credential: applicationDefault() });
const db = getFirestore();

const [slots, buchungen] = await Promise.all([db.collection('slots').get(), db.collection('bookings').get()]);

const summeBelegt = slots.docs.reduce((n, d) => n + (d.data().belegt ?? 0), 0);
const summeGebucht = buchungen.docs.reduce((n, d) => {
  const b = d.data();
  return n + (b.plaetze ?? 0) * Object.values(b.wahl ?? {}).filter(Boolean).length;
}, 0);
const ueber = slots.docs.filter((d) => (d.data().belegt ?? 0) > (d.data().kapazitaet ?? 0));
const unter = slots.docs.filter((d) => (d.data().belegt ?? 0) < 0);

const ok = (b) => (b ? 'BESTANDEN' : '*** DURCHGEFALLEN ***');
console.log(`
Angebote ${slots.size} · Anmeldungen ${buchungen.size}

L1 Summe belegt = Summe gebuchter Plätze   ${summeBelegt} / ${summeGebucht}   ${ok(summeBelegt === summeGebucht)}
L2 kein belegt > kapazitaet                ${ueber.length} Fälle   ${ok(ueber.length === 0)}
L3 kein belegt < 0                         ${unter.length} Fälle   ${ok(unter.length === 0)}
`);
if (ueber.length) console.log('Überbucht:', ueber.map((d) => `${d.id} ${d.data().belegt}/${d.data().kapazitaet}`).join(', '));
process.exit(summeBelegt === summeGebucht && !ueber.length && !unter.length ? 0 : 1);
