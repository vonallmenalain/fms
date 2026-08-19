#!/usr/bin/env node
// scripts/lasttest.mjs — beweist, dass die App 200 (und 400) gleichzeitige Geräte trägt.
//
//   node scripts/lasttest.mjs --clients 200 --projekt fms-besuchstag-test
//   node scripts/lasttest.mjs --clients 400 --projekt fms-besuchstag-test
//
// Bewusst mit dem WEB-SDK und anonymer Anmeldung, nicht mit dem Admin-SDK: nur so laufen
// dieselben Security Rules und dieselbe Transaktionslogik wie am Eventtag.
// Spezifikation und Abnahmekriterien L1–L7: docs/05-last-und-performance.md §6
//
// Vor dem Lauf:  config/app.anmeldungOffen = true  im TESTPROJEKT
// Nach dem Lauf: node scripts/reset.mjs --project fms-besuchstag-test

import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, collection, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : standard;
};

const ANZAHL      = Number(arg('clients', 200));
const BELIEBT     = ['l1-27fd', 'l2-27fd', 'a1-psychologie'];   // erzwungener Andrang
const ANTEIL_HEISS = 0.15;    // 15 % zielen gezielt auf die beliebten Angebote
const ANTEIL_UMBUCHT = 0.30;  // 30 % ändern nachträglich eine Wahl
const ZUHOERER    = 10;       // messen, wie schnell fremde Änderungen ankommen

const programm = JSON.parse(await readFile(new URL('../data/programm.json', import.meta.url)));
const proBlock = (b) => programm.offerings.filter((o) => o.blockId === b).map((o) => o.id);
const zufall   = (liste) => liste[Math.floor(Math.random() * liste.length)];
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

const messungen = { dauer: [], wiederholungen: 0, ausgebucht: 0, fehler: 0, sichtbar: [] };

async function client(nr) {
  const app  = initializeApp({ /* VITE_FIREBASE_* */ }, `client-${nr}`);
  const auth = getAuth(app);
  const db   = getFirestore(app);
  await signInAnonymously(auth);
  const uid  = auth.currentUser.uid;
  const plaetze = 1 + Math.floor(Math.random() * 4);          // Gruppengrösse 1–4 (D3)
  const heiss   = Math.random() < ANTEIL_HEISS;

  for (const block of ['a1', 'a2', 'l1', 'l2']) {
    await schlafen(2000 + Math.random() * 6000);              // Bedenkzeit
    const kandidaten = proBlock(block);
    const ziel = heiss
      ? (BELIEBT.find((id) => kandidaten.includes(id)) ?? zufall(kandidaten))
      : zufall(kandidaten);

    const start = performance.now();
    try {
      await buchen(db, uid, block, ziel, plaetze);
      messungen.dauer.push(performance.now() - start);
    } catch (f) {
      if (f.name === 'AusgebuchtFehler') messungen.ausgebucht++;
      else { messungen.fehler++; console.error(`client ${nr}/${block}:`, f.message); }
    }
  }

  if (Math.random() < ANTEIL_UMBUCHT) {                        // der teure Drei-Dokumente-Fall
    await schlafen(1000 + Math.random() * 4000);
    await buchen(db, uid, 'l1', zufall(proBlock('l1')), plaetze).catch(() => messungen.fehler++);
  }
}

// buchen() = exakt die Transaktion aus src/buchung.ts, inkl. mitWiederholung().
// Beim Bauen aus der App importieren statt hier zu duplizieren – sonst testet man den falschen Kode.
async function buchen(db, uid, block, angebotId, plaetze) { /* … siehe src/buchung.ts … */ }

// Zuhörer: messen die Zeit von fremder Buchung bis zur sichtbaren Änderung (Kriterium L6)
async function zuhoerer(nr) {
  const app = initializeApp({ /* VITE_FIREBASE_* */ }, `hoerer-${nr}`);
  const db  = getFirestore(app);
  await signInAnonymously(getAuth(app));
  const gesehen = new Map();
  onSnapshot(collection(db, 'slots'), (snap) => {
    const jetzt = performance.now();
    snap.docChanges().forEach((c) => {
      const zuletzt = gesehen.get(c.doc.id);
      if (zuletzt) messungen.sichtbar.push(jetzt - zuletzt);
      gesehen.set(c.doc.id, jetzt);
    });
  });
}

// ---- Lauf ------------------------------------------------------------------
console.log(`Starte ${ANZAHL} Clients + ${ZUHOERER} Zuhörer …`);
const t0 = performance.now();
await Promise.all([
  ...Array.from({ length: ZUHOERER }, (_, i) => zuhoerer(i)),
  // Anmeldung über 20 s verteilt – der Schwarm um 08:35
  ...Array.from({ length: ANZAHL }, (_, i) => schlafen((i / ANZAHL) * 20000).then(() => client(i))),
]);

// ---- Invarianten L1–L3 -----------------------------------------------------
const app = initializeApp({ /* VITE_FIREBASE_* */ }, 'pruefer');
const db  = getFirestore(app);
await signInAnonymously(getAuth(app));

const slots    = await getDocs(collection(db, 'slots'));
const buchungen = await getDocs(collection(db, 'bookings'));

const summeBelegt = slots.docs.reduce((s, d) => s + d.data().belegt, 0);
const summeGebucht = buchungen.docs.reduce((s, d) => {
  const b = d.data();
  return s + b.plaetze * Object.values(b.wahl).filter(Boolean).length;
}, 0);
const ueber = slots.docs.filter((d) => d.data().belegt > d.data().kapazitaet);
const unter = slots.docs.filter((d) => d.data().belegt < 0);

const p = (liste, q) => liste.length ? [...liste].sort((a, b) => a - b)[Math.floor(liste.length * q)] : NaN;
const ok = (b) => (b ? 'BESTANDEN' : '*** DURCHGEFALLEN ***');

console.log(`
Dauer des Laufs        ${((performance.now() - t0) / 1000).toFixed(1)} s
Buchungen              ${messungen.dauer.length}   ausgebucht ${messungen.ausgebucht}   Fehler ${messungen.fehler}

L1 Summe belegt/gebucht  ${summeBelegt} / ${summeGebucht}   ${ok(summeBelegt === summeGebucht)}
L2 belegt > kapazitaet   ${ueber.length} Fälle              ${ok(ueber.length === 0)}
L3 belegt < 0            ${unter.length} Fälle              ${ok(unter.length === 0)}
L4 harte Fehler          ${messungen.fehler}                ${ok(messungen.fehler === 0)}
L5 Buchungsdauer p50/p95 ${p(messungen.dauer, .5)?.toFixed(0)} / ${p(messungen.dauer, .95)?.toFixed(0)} ms   ${ok(p(messungen.dauer, .95) <= 1500)}
L6 sichtbar p95          ${p(messungen.sichtbar, .95)?.toFixed(0)} ms          ${ok(p(messungen.sichtbar, .95) <= 1000)}

L7 Verbrauch: Firebase-Konsole -> Nutzung ablesen und mit docs/05 §3 vergleichen.
`);
process.exit(messungen.fehler === 0 && ueber.length === 0 && summeBelegt === summeGebucht ? 0 : 1);
