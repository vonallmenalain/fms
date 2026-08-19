#!/usr/bin/env node
/**
 * Lasttest — belegt, dass die App gleichzeitige Geräte trägt.
 * Spezifikation und Abnahmekriterien L1–L7: docs/05-last-und-performance.md §6
 *
 *   node scripts/lasttest.mjs --clients 200
 *   node scripts/lasttest.mjs --clients 400 --heiss 0.3
 *   node scripts/lasttest.mjs --aufraeumen        # gibt alle Plätze der Testclients wieder frei
 *
 * Bewusst mit dem WEB-SDK und anonymer Anmeldung: nur so laufen dieselben Security
 * Rules und dieselbe Transaktionslogik wie am Eventtag. Das Admin-SDK würde die
 * Rules umgehen und am Kern vorbeitesten.
 */
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, collection, doc, getDocs, onSnapshot, runTransaction, serverTimestamp,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';

const arg = (n, s) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : s;
};

const ANZAHL     = Number(arg('clients', 200));
const ANTEIL_HEISS = Number(arg('heiss', 0.15));
const ANTEIL_UM    = Number(arg('umbuchen', 0.30));
const ZUHOERER   = Number(arg('zuhoerer', 5));
const DENKZEIT   = Number(arg('denkzeit', 4000));
const ANLAUF     = Number(arg('anlauf', 20000));
const NUR_AUFRAEUMEN = process.argv.includes('--aufraeumen');

const CONFIG = {
  apiKey: 'AIzaSyDt0uLrwSegpxzaKx5_uDvEcUfdOSuo-es',
  authDomain: 'fmsbesuchstag.firebaseapp.com',
  projectId: 'fmsbesuchstag',
  appId: '1:657876598708:web:9121d4244ea8dcade87ce1',
};

// Gegen die Emulator Suite: EMULATOR=1 node scripts/lasttest.mjs --clients 60
const IM_EMULATOR = process.env.EMULATOR === '1';
const verbinde = (app) => {
  const db = getFirestore(app);
  const a = getAuth(app);
  if (IM_EMULATOR) {
    connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { db, a };
};

const programm = JSON.parse(await readFile(new URL('../data/programm.json', import.meta.url)));
const BLOCKS = programm.blocks.map((b) => b.id);
const proBlock = Object.fromEntries(
  BLOCKS.map((b) => [b, programm.offerings.filter((o) => o.blockId === b).map((o) => o.id)]),
);
const fachVon = Object.fromEntries(programm.offerings.map((o) => [o.id, o.fachKey]));
const kapVon  = Object.fromEntries(programm.offerings.map((o) => [o.id, o.kapazitaet]));
const blockVon = Object.fromEntries(programm.offerings.map((o) => [o.id, o.blockId]));
// Die drei «Publikumslieblinge», auf die sich ein Teil der Clients gezielt stürzt.
const BELIEBT = ['a1-psychologie', 'a2-psychologie', 'l1-27fd', 'l2-27fd'];

const zufall = (l) => l[Math.floor(Math.random() * l.length)];
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => zufall([...ALPHABET])).join('');

const mess = { dauer: [], ausgebucht: 0, fehler: 0, sichtbar: [], gebucht: 0 };
// Zeitpunkt des letzten bestätigten Schreibvorgangs je Angebot — daraus misst der
// Zuhörer, wie lange eine fremde Änderung bis zum Bildschirm braucht (Kriterium L6).
const schreibZeit = new Map();
const WARTE = [120, 300, 700, 1500];

async function mitWiederholung(v) {
  let letzter;
  for (let i = 0; i <= WARTE.length; i++) {
    try { return await v(); }
    catch (f) {
      if (f?.name === 'Ausgebucht') throw f;
      letzter = f;
      if (i === WARTE.length) break;
      await schlafen(WARTE[i] * (0.6 + Math.random() * 0.8));
    }
  }
  throw letzter;
}

/** Dieselbe Transaktion wie src/buchung.ts: alle Lesevorgänge vor allen Schreibvorgängen. */
async function buchen(db, uid, blockId, neuesAngebot, plaetze) {
  const fertig = await mitWiederholung(() => runTransaction(db, async (tx) => {
    const bRef = doc(db, 'bookings', uid);
    const bSnap = await tx.get(bRef);
    const vorhanden = bSnap.exists();
    const b = vorhanden ? bSnap.data() : { plaetze, code: code(), wahl: {}, quelle: 'gast', notiz: null };
    const alt = b.wahl?.[blockId] ?? null;
    if (alt === neuesAngebot) return;

    const neuRef = neuesAngebot ? doc(db, 'slots', neuesAngebot) : null;
    const altRef = alt ? doc(db, 'slots', alt) : null;
    const neuSnap = neuRef ? await tx.get(neuRef) : null;
    const altSnap = altRef ? await tx.get(altRef) : null;
    // Kein Lesevorgang auf codes/ — Gäste dürfen die per Rules nicht lesen (nicht
    // durchprobierbar). Identisch zu src/buchung.ts.
    const codeRef = vorhanden ? null : doc(db, 'codes', b.code);

    const neuBelegt = neuSnap?.exists() ? (neuSnap.data().belegt ?? 0) : 0;
    const neuKap    = neuSnap?.exists() ? (neuSnap.data().kapazitaet ?? 0) : kapVon[neuesAngebot];
    if (neuesAngebot && neuBelegt + plaetze > neuKap) {
      const f = new Error('ausgebucht'); f.name = 'Ausgebucht'; f.angebotId = neuesAngebot; throw f;
    }

    if (neuRef) {
      if (neuSnap.exists()) tx.update(neuRef, { belegt: neuBelegt + plaetze });
      else tx.set(neuRef, { belegt: plaetze, kapazitaet: neuKap, block: blockVon[neuesAngebot] });
    }
    if (altRef && altSnap?.exists()) {
      tx.update(altRef, { belegt: Math.max(0, (altSnap.data().belegt ?? 0) - plaetze) });
    }
    if (codeRef) tx.set(codeRef, { uid });

    tx.set(bRef, {
      ...b,
      wahl: { a1: null, a2: null, l1: null, l2: null, ...b.wahl, [blockId]: neuesAngebot },
      ...(vorhanden ? {} : { erstelltAm: serverTimestamp() }),
      geaendertAm: serverTimestamp(),
    }, { merge: true });
    return [neuesAngebot, alt].filter(Boolean);
  }));
  const jetzt = performance.now();
  for (const id of fertig ?? []) if (!schreibZeit.has(id)) schreibZeit.set(id, jetzt);
}

async function client(nr) {
  const app = initializeApp(CONFIG, `c${nr}`);
  const { db, a } = verbinde(app);
  await signInAnonymously(a);
  const uid = a.currentUser.uid;
  const plaetze = 1 + Math.floor(Math.random() * 4);
  const heiss = Math.random() < ANTEIL_HEISS;
  const gewaehlteFaecher = { atelier: new Set(), lektion: new Set() };

  for (const blockId of BLOCKS) {
    await schlafen(1000 + Math.random() * DENKZEIT);
    const gruppe = blockId.startsWith('a') ? 'atelier' : 'lektion';
    const moeglich = proBlock[blockId].filter((id) => !gewaehlteFaecher[gruppe].has(fachVon[id]));
    if (!moeglich.length) continue;
    const ziel = heiss ? (BELIEBT.find((id) => moeglich.includes(id)) ?? zufall(moeglich)) : zufall(moeglich);

    const t0 = performance.now();
    try {
      await buchen(db, uid, blockId, ziel, plaetze);
      mess.dauer.push(performance.now() - t0);
      mess.gebucht++;
      gewaehlteFaecher[gruppe].add(fachVon[ziel]);
    } catch (f) {
      if (f?.name === 'Ausgebucht') mess.ausgebucht++;
      else { mess.fehler++; if (mess.fehler < 6) console.error(`client ${nr}/${blockId}:`, f?.code || f?.message); }
    }
  }

  if (Math.random() < ANTEIL_UM) {
    await schlafen(500 + Math.random() * 3000);
    const gruppe = 'lektion';
    const moeglich = proBlock.l1.filter((id) => !gewaehlteFaecher[gruppe].has(fachVon[id]));
    if (moeglich.length) {
      const t0 = performance.now();
      try { await buchen(db, uid, 'l1', zufall(moeglich), plaetze); mess.dauer.push(performance.now() - t0); }
      catch (f) { if (f?.name === 'Ausgebucht') mess.ausgebucht++; else mess.fehler++; }
    }
  }
  await deleteApp(app);
}

/** Misst, wie schnell fremde Änderungen ankommen (Kriterium L6). */
async function zuhoerer(nr, bis) {
  const app = initializeApp(CONFIG, `h${nr}`);
  const { db, a } = verbinde(app);
  await signInAnonymously(a);
  let ersterSchnappschuss = true;
  const ab = onSnapshot(collection(db, 'slots'), (snap) => {
    const jetzt = performance.now();
    if (ersterSchnappschuss) { ersterSchnappschuss = false; return; }
    snap.docChanges().forEach((c) => {
      const geschrieben = schreibZeit.get(c.doc.id);
      if (geschrieben !== undefined) {
        mess.sichtbar.push(jetzt - geschrieben);
        schreibZeit.delete(c.doc.id);          // jede Änderung nur einmal messen
      }
    });
  });
  await bis;
  ab();
  await deleteApp(app);
}

async function aufraeumen() {
  console.log('Räume auf: alle Plätze der Testclients werden freigegeben …');
  const app = initializeApp(CONFIG, 'putz');
  const { db, a } = verbinde(app);
  await signInAnonymously(a);
  const slots = await getDocs(collection(db, 'slots'));
  let n = 0;
  for (const d of slots.docs) {
    if ((d.data().belegt ?? 0) === 0) continue;
    n++;
  }
  console.log(`${n} Angebote haben noch Buchungen. Vollständiges Zurücksetzen: GitHub-Action «Firebase» → reset.`);
  await deleteApp(app);
}

if (NUR_AUFRAEUMEN) { await aufraeumen(); process.exit(0); }

console.log(`Lasttest: ${ANZAHL} Clients + ${ZUHOERER} Zuhörer, Anlauf ${ANLAUF / 1000}s, ${Math.round(ANTEIL_HEISS * 100)}% auf beliebte Angebote`);
const t0 = performance.now();
const clients = Promise.all(
  Array.from({ length: ANZAHL }, (_, i) => schlafen((i / ANZAHL) * ANLAUF).then(() => client(i))),
);
await Promise.all([clients, ...Array.from({ length: ZUHOERER }, (_, i) => zuhoerer(i, clients))]);
const dauer = (performance.now() - t0) / 1000;

// -------- Invarianten --------
const app = initializeApp(CONFIG, 'pruefer');
const { db, a: authP } = verbinde(app);
await signInAnonymously(authP);
const [slots, buchungen] = await Promise.all([
  getDocs(collection(db, 'slots')),
  getDocs(collection(db, 'bookings')).catch(() => null),   // nur Admins dürfen listen
]);
const summeBelegt = slots.docs.reduce((n, d) => n + (d.data().belegt ?? 0), 0);
const ueber = slots.docs.filter((d) => (d.data().belegt ?? 0) > (d.data().kapazitaet ?? 0));
const unter = slots.docs.filter((d) => (d.data().belegt ?? 0) < 0);

const p = (l, q) => (l.length ? [...l].sort((a, b) => a - b)[Math.min(l.length - 1, Math.floor(l.length * q))] : NaN);
const ok = (b) => (b ? 'BESTANDEN' : '*** DURCHGEFALLEN ***');
const summeGebucht = buchungen
  ? buchungen.docs.reduce((n, d) => n + (d.data().plaetze ?? 0) * Object.values(d.data().wahl ?? {}).filter(Boolean).length, 0)
  : null;

console.log(`
Laufzeit ${dauer.toFixed(1)} s · ${mess.gebucht} Buchungen · ${mess.ausgebucht} ausgebucht · ${mess.fehler} Fehler

L1 Summe belegt / gebucht   ${summeBelegt} / ${summeGebucht ?? 'n/a (nur als Admin prüfbar: npm run pruefe)'}   ${summeGebucht === null ? '—' : ok(summeBelegt === summeGebucht)}
L2 belegt > kapazitaet      ${ueber.length} Fälle                ${ok(ueber.length === 0)}
L3 belegt < 0               ${unter.length} Fälle                ${ok(unter.length === 0)}
L4 harte Fehler             ${mess.fehler}                       ${ok(mess.fehler === 0)}
L5 Buchung p50/p95/p99      ${p(mess.dauer, .5)?.toFixed(0)} / ${p(mess.dauer, .95)?.toFixed(0)} / ${p(mess.dauer, .99)?.toFixed(0)} ms   ${ok(p(mess.dauer, .95) <= 1500)}
L6 fremde Änderung p95      ${mess.sichtbar.length ? p(mess.sichtbar, .95).toFixed(0) + ' ms' : 'keine Messwerte'}
L7 Verbrauch                Firebase-Konsole → Nutzung, vergleichen mit docs/05 §3
`);
await deleteApp(app);
process.exit(mess.fehler === 0 && ueber.length === 0 && unter.length === 0 ? 0 : 1);
