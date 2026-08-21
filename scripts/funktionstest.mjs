/* =========================================================================
   Laden die Netlify-Funktionen auch auf einer aelteren Laufzeit?
   -------------------------------------------------------------------------
   Hintergrund: firebase-admin zieht jwks-rsa nach, und das laedt jose mit
   require(). Ist jose reines ESM (ab Version 6), geht das erst ab Node 22.12 —
   AWS' nodejs22.x liegt darunter. Die Funktion stirbt dann schon beim Import,
   Netlify antwortet mit 502, und die App faellt auf die Mail von Firebase
   zurueck, ohne dass irgendein Test das gemerkt haette.

   Darum laeuft diese Pruefung mit --no-experimental-require-module: Der Schalter
   nimmt dem neuen Node genau die Faehigkeit weg, die der alten fehlt. Sie muss
   also mit diesem Schalter laufen, sonst prueft sie nichts.

       node --no-experimental-require-module scripts/funktionstest.mjs

   Geprueft wird nur das Laden und die Wegweisung — kein Versand, keine
   Schluessel, keine Netzaufrufe. Den Rest deckt scripts/mailtest.mjs ab.
   ========================================================================= */

import { readdir } from 'node:fs/promises';

if (process.execArgv.includes('--experimental-require-module')
  || !process.execArgv.includes('--no-experimental-require-module')) {
  console.error('Bitte mit --no-experimental-require-module starten (siehe Kopf dieser Datei).');
  process.exit(1);
}

const ORDNER = new URL('../netlify/functions/', import.meta.url);
let fehler = 0;

for (const datei of (await readdir(ORDNER)).filter((d) => d.endsWith('.mjs')).sort()) {
  try {
    const { default: handler, config } = await import(new URL(datei, ORDNER));
    const antwort = await handler(new Request('http://pruefung/', { method: 'GET' }));
    if (antwort.status !== 405) throw new Error(`GET sollte 405 ergeben, war ${antwort.status}`);
    if (!config?.path) throw new Error('config.path fehlt');
    console.log(`  ok    ${datei} laedt, ${config.path} antwortet`);
  } catch (f) {
    fehler++;
    console.error(`  FEHLER ${datei}: ${f.message}`);
  }
}

if (fehler) {
  console.error(`\n${fehler} Funktion(en) laden nicht. Auf einer Laufzeit ohne require(ESM) `
    + 'antwortet Netlify damit 502 — meist hilft ein Eintrag unter "overrides" in package.json.');
  process.exit(1);
}
console.log('\nAlle Funktionen laden auch ohne require(ESM).');
