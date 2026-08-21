/**
 * Prüft firestore.rules gegen den echten Firestore-Emulator.
 *
 *   npm run regeltest
 *
 * Die Rules sind der einzige wirksame Schutz — der Bildschirm blendet den Reiter
 * «Steuerung» zwar aus, aber die App läuft im Browser und lässt sich dort verändern.
 * Darum wird hier geprüft, was der Server erlaubt, nicht was die Oberfläche zeigt.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, serverTimestamp,
} from 'firebase/firestore';
import fs from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'fms-regeltest',
  firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});

let ok = 0, schlecht = 0;
const pruefe = async (name, fn) => {
  try { await fn(); console.log('  ✓', name); ok++; }
  catch (f) { console.log('  ✗', name, '→', String(f).split('\n')[0].slice(0, 160)); schlecht++; }
};

const mail = (adresse) => ({ email: adresse, email_verified: true });

async function saat() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    await setDoc(doc(d, 'config/app'), { anmeldungOffen: true, banner: '', liveZaehler: true, maxPlaetzeProGeraet: 4 });
    await setDoc(doc(d, 'slots/a1-x'), { belegt: 0, kapazitaet: 35, block: 'a1' });
    await setDoc(doc(d, 'admins/uid-admin'), { rolle: 'admin', name: 'Chefin', email: 'chefin@example.ch', seit: 'x' });
    await setDoc(doc(d, 'admins/uid-betreuung'), { rolle: 'betreuung', name: 'Lea', email: 'lea@example.ch', seit: 'x' });
    await setDoc(doc(d, 'admins/uid-altlast'), { name: 'Altlast', email: 'alain.sc2@gmail.com', seit: 'x' });
    await setDoc(doc(d, 'zugang/lea@example.ch'), { email: 'lea@example.ch', name: 'Lea', rolle: 'betreuung' });
    await setDoc(doc(d, 'zugang/neu@example.ch'), { email: 'neu@example.ch', name: 'Neu', rolle: 'betreuung' });
    await setDoc(doc(d, 'zugang/neuadmin@example.ch'), { email: 'neuadmin@example.ch', name: 'NeuAdmin', rolle: 'admin' });
    await setDoc(doc(d, 'bookings/gast1'), { plaetze: 1, wahl: { a1: null, a2: null, l1: null, l2: null }, quelle: 'gast', notiz: null });
  });
}

await saat();
const admin = env.authenticatedContext('uid-admin', mail('chefin@example.ch')).firestore();
const betreuung = env.authenticatedContext('uid-betreuung', mail('lea@example.ch')).firestore();
const gast = env.authenticatedContext('gast1').firestore();
const fremd = env.authenticatedContext('uid-fremd', mail('fremd@example.ch')).firestore();
const neu = env.authenticatedContext('uid-neu', mail('neu@example.ch')).firestore();
const neuAdmin = env.authenticatedContext('uid-neuadmin', mail('neuadmin@example.ch')).firestore();
const erstzugang = env.authenticatedContext('uid-altlast', mail('alain.sc2@gmail.com')).firestore();

console.log('\nSteuerung (config) — nur Administration');
await pruefe('Admin darf den Freigabeschalter setzen', () => assertSucceeds(setDoc(doc(admin, 'config/app'), { anmeldungOffen: false }, { merge: true })));
await pruefe('Betreuung darf NICHT', () => assertFails(setDoc(doc(betreuung, 'config/app'), { anmeldungOffen: false }, { merge: true })));
await pruefe('Gast darf NICHT', () => assertFails(setDoc(doc(gast, 'config/app'), { banner: 'hallo' }, { merge: true })));
await pruefe('alle dürfen config lesen', () => assertSucceeds(getDoc(doc(gast, 'config/app'))));

console.log('\nKapazitäten (slots) — nur Administration');
await pruefe('Admin darf Kapazität ändern', () => assertSucceeds(updateDoc(doc(admin, 'slots/a1-x'), { kapazitaet: 30 })));
await pruefe('Betreuung darf NICHT', () => assertFails(updateDoc(doc(betreuung, 'slots/a1-x'), { kapazitaet: 12 })));
await pruefe('Betreuung darf belegt buchen', () => assertSucceeds(updateDoc(doc(betreuung, 'slots/a1-x'), { belegt: 2 })));
await pruefe('Gast darf belegt buchen', () => assertSucceeds(updateDoc(doc(gast, 'slots/a1-x'), { belegt: 3 })));

console.log('\nÜbersicht (bookings)');
await pruefe('Betreuung sieht alle Anmeldungen', () => assertSucceeds(getDocs(collection(betreuung, 'bookings'))));
await pruefe('Admin sieht alle Anmeldungen', () => assertSucceeds(getDocs(collection(admin, 'bookings'))));
await pruefe('Fremde sehen sie NICHT', () => assertFails(getDocs(collection(fremd, 'bookings'))));
await pruefe('Betreuung erfasst Anmeldung (quelle admin)', () => assertSucceeds(setDoc(doc(betreuung, 'bookings/vomstand1'),
  { plaetze: 2, wahl: { a1: null, a2: null, l1: null, l2: null }, quelle: 'admin', notiz: null, erstelltAm: new Date(), geaendertAm: new Date() })));
await pruefe('Betreuung darf fremde Anmeldung NICHT löschen', () => assertFails(deleteDoc(doc(betreuung, 'bookings/gast1'))));
await pruefe('Admin darf fremde Anmeldung löschen', () => assertSucceeds(deleteDoc(doc(admin, 'bookings/gast1'))));

console.log('\nZugänge (zugang)');
await pruefe('Admin darf einladen', () => assertSucceeds(setDoc(doc(admin, 'zugang/x@example.ch'), { email: 'x@example.ch', name: 'X', rolle: 'betreuung' })));
await pruefe('Betreuung darf NICHT einladen', () => assertFails(setDoc(doc(betreuung, 'zugang/y@example.ch'), { email: 'y@example.ch', name: 'Y', rolle: 'admin' })));
await pruefe('Betreuung darf die Liste NICHT lesen', () => assertFails(getDocs(collection(betreuung, 'zugang'))));
await pruefe('eigene Einladung darf man lesen', () => assertSucceeds(getDoc(doc(betreuung, 'zugang/lea@example.ch'))));
await pruefe('fremde Einladung NICHT', () => assertFails(getDoc(doc(betreuung, 'zugang/neu@example.ch'))));

console.log('\nSelbstfreischaltung (admins)');
await pruefe('Eingeladene schaltet sich als Betreuung frei', () => assertSucceeds(setDoc(doc(neu, 'admins/uid-neu'),
  { rolle: 'betreuung', name: 'Neu', email: 'neu@example.ch', seit: 'jetzt' })));
await pruefe('Eingeladene kann sich NICHT zur Administration machen', () => assertFails(setDoc(doc(neu, 'admins/uid-neu2'),
  { rolle: 'admin', name: 'Neu', email: 'neu@example.ch', seit: 'jetzt' })));
await pruefe('als Admin Eingeladene wird Administration', () => assertSucceeds(setDoc(doc(neuAdmin, 'admins/uid-neuadmin'),
  { rolle: 'admin', name: 'NeuAdmin', email: 'neuadmin@example.ch', seit: 'jetzt' })));
await pruefe('ohne Einladung geht gar nichts', () => assertFails(setDoc(doc(fremd, 'admins/uid-fremd'),
  { rolle: 'betreuung', name: 'Fremd', email: 'fremd@example.ch', seit: 'jetzt' })));
await pruefe('Betreuung darf sich NICHT selbst befördern', () => assertFails(updateDoc(doc(betreuung, 'admins/uid-betreuung'), { rolle: 'admin' })));
await pruefe('Admin darf Rollen setzen', () => assertSucceeds(updateDoc(doc(admin, 'admins/uid-betreuung'), { rolle: 'admin' })));
await pruefe('Admin darf Konto entfernen', () => assertSucceeds(deleteDoc(doc(admin, 'admins/uid-neu'))));
await pruefe('Erstzugang repariert sein Dokument ohne Rolle', () => assertSucceeds(updateDoc(doc(erstzugang, 'admins/uid-altlast'), { rolle: 'admin' })));

console.log('\nForm der Anmeldung (Struktur statt blindes Vertrauen)');
// Der erste Abschnitt hat den Freigabeschalter zugemacht, ein späterer die Anmeldung
// `gast1` gelöscht. Beides hier zurückstellen — sonst prüft dieser Abschnitt bloss noch
// die Notbremse und nicht die Form.
await setDoc(doc(admin, 'config/app'), { anmeldungOffen: true }, { merge: true });
const wahlLeer = { a1: null, a2: null, l1: null, l2: null };
const buchung = (extra) => ({ plaetze: 1, wahl: wahlLeer, quelle: 'gast', notiz: null, ...extra });
await pruefe('saubere Anmeldung geht durch', () => assertSucceeds(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ wahl: { ...wahlLeer, a1: 'a1-psychologie' } }))));
await pruefe('erfundene Angebots-ID wird abgewiesen', () => assertFails(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ wahl: { ...wahlLeer, a1: 'gibt-es-nicht' } }))));
await pruefe('Angebot aus dem falschen Block wird abgewiesen', () => assertFails(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ wahl: { ...wahlLeer, a1: 'l1-27fd' } }))));
await pruefe('fremder Blockschlüssel wird abgewiesen', () => assertFails(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ wahl: { ...wahlLeer, a3: 'a3-irgendwas' } }))));
await pruefe('übergrosse Notiz wird abgewiesen', () => assertFails(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ notiz: 'x'.repeat(5000) }))));
await pruefe('normale Notiz der Betreuung geht durch', () => assertSucceeds(setDoc(doc(betreuung, 'bookings/vomstand2'),
  { plaetze: 2, wahl: { ...wahlLeer, l1: 'l1-27fd' }, quelle: 'admin', notiz: '3 SuS ohne Handy',
    erstelltAm: new Date(), geaendertAm: new Date() })));
await pruefe('Gruppengrösse 5 wird abgewiesen', () => assertFails(setDoc(doc(gast, 'bookings/gast1'),
  buchung({ plaetze: 5 }))));

console.log('\nProtokoll (log) — anschreiben, nie ändern');
// Der Abschnitt oben hat `uid-betreuung` zur Administration befördert. Hier zählt wieder
// die kleine Rolle — sonst prüfte «Betreuung darf nicht löschen» das Gegenteil von dem,
// was es behauptet.
await setDoc(doc(admin, 'admins/uid-betreuung'), { rolle: 'betreuung' }, { merge: true });
// Die Anmeldung ist im Abschnitt davor wieder geöffnet worden; Gäste dürfen protokollieren.
const logZeile = (extra = {}) => ({
  zeitpunkt: serverTimestamp(), client: 'gast1', art: 'gast', geraet: 'iPhone · Safari',
  vorgang: 'gebucht', block: 'a1', angebot: 'a1-psychologie', vorher: null,
  plaetze: 1, slots: 1, ...extra,
});
await pruefe('Gast protokolliert seinen eigenen Vorgang',
  () => assertSucceeds(addDoc(collection(gast, 'log'), logZeile())));
await pruefe('Gast darf KEINE fremde Client-Kennung eintragen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ client: 'jemand-anderes' }))));
await pruefe('Gast darf sich NICHT als Info-Stand ausgeben',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ art: 'admin' }))));
await pruefe('selbst gesetzte Uhrzeit wird abgewiesen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ zeitpunkt: new Date(0) }))));
await pruefe('erfundener Vorgang wird abgewiesen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ vorgang: 'gehackt' }))));
await pruefe('zusätzliches Feld wird abgewiesen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ extra: 'x' }))));
await pruefe('übergrosse Geräteangabe wird abgewiesen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ geraet: 'x'.repeat(500) }))));
await pruefe('mehr Slots als Blöcke wird abgewiesen',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile({ slots: 9 }))));
await pruefe('Betreuung protokolliert eine Erfassung',
  () => assertSucceeds(addDoc(collection(betreuung, 'log'), logZeile({
    client: 'vomstand2', art: 'admin', vorgang: 'erfasst', block: null, angebot: null,
  }))));
await pruefe('Betreuung liest das Protokoll',
  () => assertSucceeds(getDocs(collection(betreuung, 'log'))));
await pruefe('Fremde lesen es NICHT', () => assertFails(getDocs(collection(fremd, 'log'))));
await pruefe('Gast liest es NICHT', () => assertFails(getDocs(collection(gast, 'log'))));

// Eine Zeile zum Ändern und Löschen — mit abgeschalteten Rules gesetzt, damit dieser
// Abschnitt nicht davon abhängt, dass der Schreibtest oben durchgekommen ist.
await env.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), 'log/zeile1'), { ...logZeile(), zeitpunkt: new Date() });
});
await pruefe('niemand ändert eine Zeile nachträglich — auch die Administration nicht',
  () => assertFails(updateDoc(doc(admin, 'log/zeile1'), { slots: 4 })));
await pruefe('Betreuung darf NICHT löschen', () => assertFails(deleteDoc(doc(betreuung, 'log/zeile1'))));
await pruefe('Admin darf aufräumen', () => assertSucceeds(deleteDoc(doc(admin, 'log/zeile1'))));

console.log('\nProtokoll bei geschlossener Anmeldung');
await setDoc(doc(admin, 'config/app'), { anmeldungOffen: false }, { merge: true });
await pruefe('Gast protokolliert dann NICHT mehr',
  () => assertFails(addDoc(collection(gast, 'log'), logZeile())));
await pruefe('der Info-Stand weiterhin schon',
  () => assertSucceeds(addDoc(collection(betreuung, 'log'), logZeile({
    client: 'vomstand2', art: 'admin', vorgang: 'erfasst', block: null, angebot: null,
  }))));

console.log('\nGast bleibt Gast');
await pruefe('Gast darf keine Zugänge lesen', () => assertFails(getDoc(doc(gast, 'zugang/lea@example.ch'))));
await pruefe('Gast darf kein Konto anlegen', () => assertFails(setDoc(doc(gast, 'admins/gast1'), { rolle: 'admin', name: 'g', email: null, seit: 'x' })));

console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
await env.cleanup();
process.exit(schlecht ? 1 : 0);
