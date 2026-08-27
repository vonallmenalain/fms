/* =========================================================================
   Service Worker — damit die App auch ohne Netz startet
   -------------------------------------------------------------------------
   Ohne ihn ist die Anmeldung nur so lange offline lesbar, wie der Tab offen
   bleibt. Ein Neuladen oder ein neuer Aufruf ohne Verbindung zeigt die
   Fehlerseite des Browsers — die App ist dann gar nicht da (docs/07 §4).
   Mit ihm liegt der gebaute Stand im Zwischenspeicher des Browsers: Wer
   einmal online da war, startet die App danach auch im Flugmodus.

   ACHTUNG: Diese Datei wird nicht ausgeliefert. Bei jedem Bau erzeugt
   `scripts/sw-bauen.mjs` daraus `dist/sw.js` und trägt dabei die Liste der
   gebauten Dateien und einen Versionsstempel ein — darum die zwei
   Platzhalter weiter unten.

   ZWEI REGELN, mehr ist es nicht:

   1. **Seitenaufrufe** holen index.html zuerst aus dem Netz. So bringt jeder
      Neustart mit Verbindung den neuesten Stand — auch eine Korrektur vom
      Eventmorgen. Antwortet das Netz nicht oder zu langsam, kommt die
      zwischengespeicherte Fassung. Sie wird dabei NIE überschrieben: Sie
      gehört genau zu den Bündeln, die neben ihr im selben Zwischenspeicher
      liegen. Ein neuer Stand kommt nur über eine neue Auslieferung dieser
      Datei — ganz oder gar nicht, nie halb.
   2. **Gebaute Dateien** (Bündel, CSS, Logo) tragen einen Inhaltsstempel im
      Namen und ändern sich nie. Sie kommen darum ohne Netzaufruf direkt aus
      dem Zwischenspeicher.

   Alles andere fasst der Service Worker NICHT an: Firestore, Firebase Auth
   und die Mailfunktionen unter /api/ laufen unverändert ins Netz. Er
   speichert keine ihrer Antworten und liefert keine aus — was die App an
   Daten offline zeigt, kommt aus dem Zwischenspeicher von Firestore selbst
   (siehe src/firebase.ts).

   AUSTAUSCH EINES STANDES: Der Browser lädt diese Datei bei jedem
   Seitenaufruf neu (netlify.toml setzt dafür `max-age=0`). Ist sie anders,
   wird der neue Stand im Hintergrund vollständig heruntergeladen und wartet.
   Übernommen wird er erst, wenn kein Tab der App mehr offen ist — bewusst
   ohne `skipWaiting()`, damit einer laufenden Seite nicht mitten im Buchen
   die Dateien unter den Füssen weggezogen werden.

   WIEDER LOSWERDEN: eine Auslieferung, in der `dist/sw.js` nur noch
   `self.registration.unregister()` aufruft und `caches.keys()` leert. Der
   Bauschritt in package.json muss dafür weichen, sonst wird die Datei beim
   nächsten Bau wieder überschrieben.
   ========================================================================= */

/** Stempel über Namen UND Inhalte des Baus — trägt `sw-bauen.mjs` ein. */
const VERSION = '__VERSION__';

/** Ein Zwischenspeicher je Stand. Der vorherige wird beim Übernehmen gelöscht. */
const CACHE = 'fms-' + VERSION;

/** Die Einzelseiten-App: ein einziges HTML für alle Pfade (siehe netlify.toml). */
const SEITE = '/index.html';

/**
 * So lange darf das Netz für index.html brauchen, bevor die gespeicherte
 * Fassung übernimmt. Ohne Verbindung scheitert der Aufruf sofort — die Frist
 * greift nur im schlimmeren Fall: Netz da, aber verstopft. Genau das ist am
 * Eventmorgen wahrscheinlich, wenn 150 Geräte gleichzeitig laden.
 */
const NETZFRIST_MS = 3500;

/** Alles, was der Bau erzeugt hat — trägt `sw-bauen.mjs` ein. */
const DATEIEN = __DATEIEN__;

const GEBAUT = new Set(DATEIEN);

self.addEventListener('install', (e) => {
  // Alles auf einmal: Scheitert eine einzige Datei (Netz weg mitten im
  // Herunterladen), gilt der ganze Stand als nicht installiert und der
  // bisherige bleibt in Betrieb. Ein halber Stand wäre schlimmer als keiner.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Hier angekommen ist der neue Stand vollständig — sonst hätte `install`
    // abgebrochen. Die älteren dürfen weg.
    for (const name of await caches.keys()) {
      if (name !== CACHE && name.startsWith('fms-')) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const anfrage = e.request;
  if (anfrage.method !== 'GET') return;

  const url = new URL(anfrage.url);
  // Fremde Server (Firestore, Auth) gehen den Service Worker nichts an.
  if (url.origin !== self.location.origin) return;

  if (anfrage.mode === 'navigate') { e.respondWith(seite(anfrage)); return; }
  // Nur die gebauten Dateien; /api/* und alles Übrige läuft unberührt weiter.
  if (GEBAUT.has(url.pathname)) e.respondWith(gebauteDatei(anfrage, url.pathname));
});

/** Seitenaufruf: zuerst das Netz, sonst der gespeicherte Stand. */
async function seite(anfrage) {
  try {
    return await mitFrist(fetch(anfrage));
  } catch {
    const c = await caches.open(CACHE);
    return (await c.match(SEITE)) ?? Response.error();
  }
}

/** Gebaute Datei: aus dem Zwischenspeicher; fehlt sie dort, einmalig aus dem Netz. */
async function gebauteDatei(anfrage, pfad) {
  const c = await caches.open(CACHE);
  const gespeichert = await c.match(pfad);
  if (gespeichert) return gespeichert;

  // Kann vorkommen, wenn der Browser Speicher zurückfordert: dann ist der
  // Eintrag weg, die Datei liegt aber unverändert auf dem Server.
  const antwort = await fetch(anfrage);
  if (antwort.ok) await c.put(pfad, antwort.clone());
  return antwort;
}

/** Wie `await`, aber mit Geduldsgrenze — und ein Fehlerstatus zählt als Fehlschlag. */
function mitFrist(versprechen) {
  return new Promise((fertig, ab) => {
    const uhr = setTimeout(() => ab(new Error('Netz zu langsam')), NETZFRIST_MS);
    versprechen.then(
      (antwort) => {
        clearTimeout(uhr);
        if (antwort.ok) fertig(antwort);
        else ab(new Error('Netz antwortet mit ' + antwort.status));
      },
      (fehler) => { clearTimeout(uhr); ab(fehler); },
    );
  });
}
