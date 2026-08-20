#!/usr/bin/env node
/**
 * Prüft gegen die Firebase Emulator Suite, dass kein Angebot überbucht werden kann —
 * und zwar mit dem ECHTEN Buchungskode aus `src/`, nicht mit einem Nachbau.
 *
 * Jedes «Gerät» ist ein eigener Node-Prozess mit eigener anonymer Anmeldung; alle
 * drücken auf dieselbe Millisekunde. Nur so entsteht der Andrang, den es am Eventmorgen
 * auf die Publikumslieblinge gibt. Innerhalb eines Prozesses wäre er nicht nachstellbar,
 * weil `nacheinander()` in src/wiederholung.ts pro Gerät ohnehin serialisiert.
 *
 *   npx firebase emulators:start --only firestore,auth --project fmsbesuchstag
 *   npm run andrangtest
 *
 * Läuft nur gegen den Emulator: Das Skript weigert sich, ohne FIRESTORE_EMULATOR_HOST
 * zu starten, damit es nie die Produktionsdaten anfasst.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const PROJEKT = process.env.GCLOUD_PROJECT || 'fmsbesuchstag';
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
process.env.GCLOUD_PROJECT = PROJEKT;

const erreichbar = async (hostPort) => {
  try {
    const a = new AbortController();
    const t = setTimeout(() => a.abort(), 2000);
    await fetch(`http://${hostPort}/`, { signal: a.signal });
    clearTimeout(t);
    return true;
  } catch { return false; }
};

if (!(await erreichbar(FIRESTORE)) || !(await erreichbar(AUTH))) {
  console.error(`Emulator nicht erreichbar (${FIRESTORE} / ${AUTH}).\n`
    + `Bitte zuerst starten:\n\n`
    + `  npx firebase emulators:start --only firestore,auth --project ${PROJEKT}\n`);
  process.exit(2);
}

/* ---------------------------------------------------------------- Vorbereiten */

const programm = require('../data/programm.json');
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROJEKT });
const db = getFirestore();

// Den echten Buchungspfad aus src/ für Node bündeln. `import.meta.env` gibt es nur unter
// Vite — hier wird es durch den Emulator-Schalter ersetzt, den src/firebase.ts auswertet.
// Das Bündel muss INNERHALB des Projekts liegen: Es lässt `firebase/*` extern, und Node
// löst solche Angaben relativ zur Datei auf, nicht zum Arbeitsverzeichnis.
const arbeit = join(wurzel, 'node_modules/.cache/andrangtest');
await rm(arbeit, { recursive: true, force: true });
await mkdir(arbeit, { recursive: true });
const geraetQuelle = join(arbeit, 'geraet.mjs');
await writeFile(join(arbeit, 'geraet.ts'), `
import { benutzerBereit } from ${JSON.stringify(join(wurzel, 'src/firebase'))};
import { waehle } from ${JSON.stringify(join(wurzel, 'src/buchung'))};
import { AusgebuchtFehler, RechteFehler } from ${JSON.stringify(join(wurzel, 'src/wiederholung'))};

const [, , angebotId, blockId, plaetze, start] = process.argv;
const u = await benutzerBereit();
const warten = Number(start) - Date.now();
if (warten > 0) await new Promise((r) => setTimeout(r, warten));
try {
  await waehle(u.uid, blockId, angebotId, Number(plaetze));
  console.log(JSON.stringify({ ergebnis: 'gebucht' }));
} catch (f) {
  if (f instanceof AusgebuchtFehler) console.log(JSON.stringify({ ergebnis: 'ausgebucht' }));
  else if (f instanceof RechteFehler) console.log(JSON.stringify({ ergebnis: 'abgelehnt' }));
  else console.log(JSON.stringify({ ergebnis: 'fehler', text: String(f?.message ?? f) }));
}
process.exit(0);
`);
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [join(arbeit, 'geraet.ts')],
  outfile: geraetQuelle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  absWorkingDir: wurzel,
  define: { 'import.meta.env': JSON.stringify({ VITE_EMULATOR: '1' }) },
});

const zuruecksetzen = async (kapazitaeten = {}) => {
  for (const name of ['bookings', 'slots', 'config']) {
    const s = await db.collection(name).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  const b = db.batch();
  for (const o of programm.offerings) {
    b.set(db.collection('slots').doc(o.id),
      { belegt: 0, kapazitaet: kapazitaeten[o.id] ?? o.kapazitaet, block: o.blockId });
  }
  b.set(db.doc('config/app'),
    { anmeldungOffen: true, maxPlaetzeProGeraet: 4, liveZaehler: true, banner: '' });
  await b.commit();
};

const geraet = (angebotId, blockId, plaetze, start) => new Promise((fertig) => {
  const p = spawn(process.execPath, [geraetQuelle, angebotId, blockId, String(plaetze), String(start)],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: wurzel });
  let aus = '', fehler = '';
  p.stdout.on('data', (d) => (aus += d));
  p.stderr.on('data', (d) => (fehler += d));
  p.on('close', () => {
    const zeile = aus.trim().split('\n').filter((z) => z.startsWith('{')).pop();
    fertig(zeile ? JSON.parse(zeile) : { ergebnis: 'absturz', text: fehler.slice(-300) });
  });
});

const stand = async (id) => (await db.doc(`slots/${id}`).get()).data();

/* -------------------------------------------------------------------- Prüfungen */

const pruefungen = [];
const pruefe = (text, erfuellt) => {
  pruefungen.push(erfuellt);
  console.log(`  ${erfuellt ? '✅' : '❌'} ${text}`);
};

// --- 1. Andrang auf ein einzelnes Angebot ------------------------------------
{
  const ZIEL = 'a1-psychologie', KAP = 8, GERAETE = 20;
  await zuruecksetzen({ [ZIEL]: KAP });
  console.log(`\n1. ${GERAETE} Geräte tippen gleichzeitig auf ein Angebot mit ${KAP} Plätzen`);

  const start = Date.now() + 5000;
  const e = await Promise.all(Array.from({ length: GERAETE }, () => geraet(ZIEL, 'a1', 1, start)));
  const z = (w) => e.filter((x) => x.ergebnis === w).length;
  const s = await stand(ZIEL);
  const sonstige = e.filter((x) => !['gebucht', 'ausgebucht'].includes(x.ergebnis));
  console.log(`   gebucht ${z('gebucht')} · ausgebucht ${z('ausgebucht')} · belegt=${s.belegt}/${s.kapazitaet}`);
  if (sonstige.length) console.log('  ', sonstige);

  pruefe('belegt überschreitet die Kapazität nie', s.belegt <= s.kapazitaet);
  pruefe('alle Plätze wurden vergeben, keiner verfällt', s.belegt === KAP);
  pruefe('genau so viele Geräte erfolgreich wie Plätze', z('gebucht') === KAP);
  pruefe('alle übrigen bekommen sauber «ausgebucht»', z('ausgebucht') === GERAETE - KAP);
  pruefe('keine unerwarteten Fehler', sonstige.length === 0);
}

// --- 2. Gruppen dürfen keinen Restplatz halb belegen -------------------------
{
  const ZIEL = 'a1-chemie', KAP = 8, GERAETE = 10, PRO = 3;
  await zuruecksetzen({ [ZIEL]: KAP });
  console.log(`\n2. ${GERAETE} Gruppen à ${PRO} Personen auf ${KAP} Plätze`);

  const start = Date.now() + 5000;
  const e = await Promise.all(Array.from({ length: GERAETE }, () => geraet(ZIEL, 'a1', PRO, start)));
  const s = await stand(ZIEL);
  console.log(`   gebucht ${e.filter((x) => x.ergebnis === 'gebucht').length} · belegt=${s.belegt}/${s.kapazitaet}`);

  pruefe('belegt bleibt innerhalb der Kapazität', s.belegt <= s.kapazitaet);
  pruefe('nur vollständige Gruppen gebucht', s.belegt % PRO === 0);
  pruefe('die zwei Restplätze bleiben frei statt halb vergeben', s.kapazitaet - s.belegt === 2);
}

// --- 3. Manipulierter Client gegen die Security Rules ------------------------
{
  const ZIEL = 'a1-physik', KAP = 8;
  await zuruecksetzen({ [ZIEL]: KAP });
  console.log('\n3. Manipulierter Client schreibt am App-Kode vorbei');

  const { initializeApp: clientApp } = await import('firebase/app');
  const { getAuth, signInAnonymously, connectAuthEmulator } = await import('firebase/auth');
  const { getFirestore: clientDb, connectFirestoreEmulator, doc, updateDoc, setDoc, getDoc, deleteDoc } =
    await import('firebase/firestore');

  const app = clientApp({ apiKey: 'emulator', projectId: PROJEKT }, 'angreifer');
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH}`, { disableWarnings: true });
  const [host, port] = FIRESTORE.split(':');
  const cdb = clientDb(app);
  connectFirestoreEmulator(cdb, host, Number(port));
  const { user } = await signInAnonymously(auth);

  const abgewiesen = async (text, fn) => {
    let ergebnis = 'DURCHGEKOMMEN';
    try { await fn(); } catch (f) { ergebnis = f?.code === 'permission-denied' ? 'abgewiesen' : `Fehler ${f?.code}`; }
    pruefe(`${text} → ${ergebnis}`, ergebnis === 'abgewiesen');
  };

  await abgewiesen('belegt weit über die Kapazität setzen',
    () => updateDoc(doc(cdb, 'slots', ZIEL), { belegt: 99 }));
  await abgewiesen('belegt um genau einen Platz überziehen',
    () => updateDoc(doc(cdb, 'slots', ZIEL), { belegt: KAP + 1 }));
  await abgewiesen('sich selbst mehr Kapazität geben',
    () => updateDoc(doc(cdb, 'slots', ZIEL), { kapazitaet: 999 }));
  await abgewiesen('belegt in einem Sprung um 20 erhöhen',
    () => updateDoc(doc(cdb, 'slots', ZIEL), { belegt: 20 }));
  await abgewiesen('belegt negativ setzen (Plätze erfinden)',
    () => updateDoc(doc(cdb, 'slots', ZIEL), { belegt: -5 }));
  await abgewiesen('fremde Anmeldung lesen',
    () => getDoc(doc(cdb, 'bookings', 'jemand-anders')));
  await abgewiesen('fremde Anmeldung überschreiben',
    () => setDoc(doc(cdb, 'bookings', 'jemand-anders'), { plaetze: 1, wahl: {}, quelle: 'gast', notiz: null }));
  await abgewiesen('sich selbst zur Betreuung befördern',
    () => setDoc(doc(cdb, 'admins', user.uid), { name: 'ich' }));
  await abgewiesen('die Anmeldung selbst schliessen',
    () => setDoc(doc(cdb, 'config', 'app'), { anmeldungOffen: false }, { merge: true }));
  await abgewiesen('einen Zähler löschen',
    () => deleteDoc(doc(cdb, 'slots', ZIEL)));

  const s = await stand(ZIEL);
  pruefe('der Zähler ist unangetastet geblieben', s.belegt === 0 && s.kapazitaet === KAP);

  // Fehlender Zähler: Die App legt ihn selbst an (Selbstheilung ohne Seed). Ein
  // manipulierter Client darf dabei aber keine grössere Kapazität erfinden.
  const LEKTION = 'l1-27fd';                                  // echte Kapazität: 20
  await db.doc(`slots/${LEKTION}`).delete();
  await abgewiesen('einem 20er-Zimmer per Selbstheilung 35 Plätze verpassen',
    () => setDoc(doc(cdb, 'slots', LEKTION), { belegt: 1, kapazitaet: 35, block: 'l1' }));

  // ... und der ehrliche Weg muss weiterhin funktionieren.
  const e = await geraet(LEKTION, 'l1', 1, Date.now());
  const heil = await stand(LEKTION);
  pruefe('ehrliches Gerät heilt den fehlenden Zähler mit der echten Kapazität',
    e.ergebnis === 'gebucht' && heil?.kapazitaet === 20 && heil?.belegt === 1);
}

/* ---------------------------------------------------------------------- Fazit */

await rm(arbeit, { recursive: true, force: true });
const durchgefallen = pruefungen.filter((p) => !p).length;
console.log(`\n${pruefungen.length - durchgefallen}/${pruefungen.length} Prüfungen bestanden.`);
process.exit(durchgefallen === 0 ? 0 : 1);
