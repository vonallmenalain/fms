/* =========================================================================
   dist/sw.js erzeugen — letzter Schritt von `npm run build`
   -------------------------------------------------------------------------
   Der Service Worker muss wissen, welche Dateien zum Stand gehören: Ihre
   Namen tragen einen Inhaltsstempel und ändern sich mit jedem Bau. Von Hand
   wäre die Liste nach der ersten Änderung falsch — und eine falsche Liste
   heisst: Die App startet offline nicht.

   Darum hier, aus dem, was wirklich im Bau liegt:

   * **Liste**: alles unter dist/ ausser sw.js selbst. Das sind ~740 KB, davon
     das Meiste Firebase und React — dieselben Dateien, die der Gast beim
     ersten Aufruf ohnehin lädt. Die nachgeladenen Bündel für Steuerung und
     Übersicht kommen mit; sie kosten zusammen ~60 KB und ersparen der
     Betreuung das Nachladen im Saal.
   * **Versionsstempel**: über Namen UND Inhalte. Nur so merkt der Browser
     eine Änderung, die keinen Dateinamen berührt — etwa ein neues
     Sicherheitsattribut in index.html. Bliebe sw.js dabei Byte für Byte
     gleich, käme der neue Stand offline nie an.

   Läuft der Schritt nicht, fehlt dist/sw.js — dann verhält sich die App wie
   vorher: online tadellos, offline nur mit offenem Tab.
   ========================================================================= */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(wurzel, 'dist');
const vorlagePfad = join(wurzel, 'scripts', 'sw-vorlage.js');

/** Alle Dateien unter einem Ordner, rekursiv. */
async function alleDateien(ordner) {
  const eintraege = await readdir(ordner, { withFileTypes: true });
  const teile = await Promise.all(eintraege.map((e) => {
    const pfad = join(ordner, e.name);
    return e.isDirectory() ? alleDateien(pfad) : [pfad];
  }));
  return teile.flat();
}

let gefunden;
try {
  gefunden = await alleDateien(dist);
} catch {
  console.error('sw-bauen: dist/ fehlt — bitte zuerst `vite build` laufen lassen.');
  process.exit(1);
}

const pfade = gefunden
  .map((p) => '/' + relative(dist, p).split(sep).join('/'))
  .filter((p) => p !== '/sw.js')
  .sort();

const stempel = createHash('sha256');
let bytes = 0;
for (const p of pfade) {
  const inhalt = await readFile(join(dist, p.slice(1)));
  stempel.update(p);
  stempel.update(inhalt);
  bytes += inhalt.length;
}
const version = stempel.digest('hex').slice(0, 12);

const vorlage = await readFile(vorlagePfad, 'utf8');
for (const platzhalter of ['__VERSION__', '__DATEIEN__']) {
  if (!vorlage.includes(platzhalter)) {
    console.error(`sw-bauen: ${platzhalter} steht nicht mehr in sw-vorlage.js.`);
    process.exit(1);
  }
}

const sw = vorlage
  .replace('__VERSION__', version)
  .replace('__DATEIEN__', JSON.stringify(pfade, null, 2));

await writeFile(join(dist, 'sw.js'), sw);

console.log(`sw.js: ${pfade.length} Dateien (${(bytes / 1024).toFixed(0)} KB), Stand ${version}`);
