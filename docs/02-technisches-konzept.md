# 02 · Technisches Konzept

## 1. Architektur in einem Bild

```
   Handy des Gasts                    Netlify (CDN)              Firebase (Spark, gratis)
 ┌──────────────────┐            ┌────────────────────┐        ┌──────────────────────────┐
 │  Browser         │            │  statische Dateien │        │  Auth (anonym + Admin)   │
 │  React-SPA       │◄──HTTPS────┤  HTML/JS/CSS       │        │                          │
 │                  │            │  + programm.json   │        │  Firestore               │
 │  Programm-Daten  │            │    (im Bundle!)    │        │   slots/{id}   Zähler    │
 │  liegen lokal ───┼────────────┘  Deploy via GitHub │        │   bookings/{uid}         │
 │                  │                                 │        │   codes/{code}           │
 │  Zähler + Buchung├─────── Firestore SDK (WebSocket)─────────►│   config/app             │
 └──────────────────┘         Transaktion + Live-Updates        │   admins/{uid}           │
                                                                └──────────────────────────┘
                                              KEINE eigenen Server · KEINE Cloud Functions
```

**Die zentrale Entscheidung:** Das **Programm** (Fächer, Zimmer, Zeiten, Kapazitäten) liegt als
`data/programm.json` **im Frontend-Bundle**, nicht in der Datenbank. In Firestore liegen nur die
Dinge, die sich zur Laufzeit ändern: **Zähler** und **Buchungen**.

Vorteile — und alle drei sind hier wichtig:
1. **Programmänderungen = Git-Commit + Push.** Die Schule weiss bis Anfang Oktober noch nicht,
   ob aus Soziologie eine Pädagogik-Lektion wird. Ein Commit, 45 Sekunden Netlify-Build, fertig.
   Versioniert und nachvollziehbar, kein Admin-Formular nötig, das man einmal benutzt.
2. **Die Liste ist auch ohne Datenbank sichtbar.** Fällt Firestore aus, zeigt die App weiterhin
   das vollständige Programm — nur ohne Platzzahlen. Das ist die halbe Notfallvariante gratis.
3. **Spart Firestore-Reads** (siehe §6) — die einzige Ressource, die auf dem Gratis-Plan knapp
   werden könnte.

## 2. Technologie-Wahl

| Baustein | Wahl | Warum |
|---|---|---|
| Build | **Vite + React + TypeScript** | 4 Screens mit Live-Daten; TS verhindert genau die Tippfehler (`l1-27fc` vs. `l1-27Fc`), die am Eventtag weh tun |
| Styling | **Tailwind CSS** | keine separate CSS-Datei zu pflegen, konsistente Tap-Grössen |
| Routing | **react-router** | 6 Routen inkl. `/admin`, `/ticket` |
| Backend | **Firebase Firestore** (Spark/gratis) | Echtzeit-Zähler + atomare Transaktionen ohne eigenen Server |
| Auth | **Firebase Auth**: anonym (Gäste) + E-Mail/Passwort (Admin) | anonyme UID = stabile Geräte-ID **und** Basis für die Security Rules |
| Hosting | **Netlify** | Git-Deploy, Deploy-Previews pro Branch, Gratis-Tier reicht um Faktor 1000 |
| Tests | **Vitest** + **Firebase Emulator Suite** | Rules-Tests und der Lasttest laufen lokal, ohne Quota zu verbrauchen |

**Bewusst nicht gewählt**
- *Cloud Functions* — bräuchten den **Blaze-Plan** (Kreditkarte hinterlegt). Die Kapazitätsprüfung
  geht auch clientseitig sicher, siehe §4/§5. Also: nicht nötig, keine Kreditkarte.
- *Next.js / SSR* — für 6 statische Screens unnötiger Ballast.
- *Supabase / Netlify Blobs* — funktionierten ebenfalls, aber Firestore hat mit
  `onSnapshot` + `runTransaction` genau die zwei Bausteine, die dieses Projekt braucht,
  und du hast Firebase im Word-Dokument bereits vorgeschlagen.

## 3. Datenmodell (Firestore)

Vier Collections plus ein Konfigdokument. Alles bewusst flach.

### `slots/{offeringId}` — der Zähler (38 Dokumente)
```jsonc
// slots/l1-28fb
{
  "kapazitaet": 20,   // gespiegelt aus programm.json, von den Rules gelesen
  "belegt": 7,        // einziges Feld, das sich ändert
  "block": "l1"       // für Admin-Queries
}
```
> **Warum ein Dokument pro Angebot** und nicht ein Sammel-Dokument mit allen Zählern?
> Firestore erlaubt pro Dokument ca. 1 Schreibvorgang/Sekunde nachhaltig. Ein Sammel-Dokument
> müsste alle ~480 Buchungen des Morgens verkraften — und jede Änderung würde an alle 120 Geräte
> ausgeliefert (= 120 × 480 Reads). Bei 38 Einzeldokumenten bekommt das meistfrequentierte
> maximal 35 Schreibvorgänge über den ganzen Morgen.

### `bookings/{uid}` — die Anmeldung (max. ~130 Dokumente)
```jsonc
// bookings/AbC123...  (uid = anonyme Firebase-ID = Gerät)
{
  "plaetze": 2,                       // Gruppengrösse 1–3
  "code": "K7F2QP",                   // Rettungscode fürs Ticket
  "wahl": {
    "a1": "a1-psychologie",
    "a2": "a2-chemie",
    "l1": "l1-29fc",
    "l2": null                        // übersprungen
  },
  "erstelltAm": <Timestamp>,
  "geaendertAm": <Timestamp>,
  "quelle": "gast",                   // "gast" | "admin"
  "notiz": null                       // nur bei quelle=admin, z. B. "3 SuS ohne Handy"
}
```

### `codes/{code}` — Rettungscode-Index (nur für Admins lesbar)
```jsonc
// codes/K7F2QP
{ "uid": "AbC123..." }
```

### `config/app` — Laufzeitsteuerung (1 Dokument)
```jsonc
{
  "anmeldungOffen": false,          // Notbremse / Freigabe um 08:35
  "maxPlaetzeProGeraet": 3,
  "banner": "",                     // Freitext an alle Gäste, "" = aus
  "programmVersion": "2026-08-19"   // Warnung, falls Gerät veraltetes Bundle hat
}
```

### `admins/{uid}` — Berechtigung (3–5 Dokumente, von Hand angelegt)
```jsonc
{ "name": "Info-Stand 1", "darfReset": false }
```

## 4. Der Buchungsvorgang (Kernlogik)

Eine Wahl ändern heisst: **alten Platz freigeben, neuen belegen, Buchung aktualisieren** —
und zwar **alles zusammen oder gar nicht**. Genau dafür ist `runTransaction` da.

```ts
async function waehle(blockId: BlockId, neuesAngebot: string | null) {
  await runTransaction(db, async (tx) => {
    const bookingRef = doc(db, 'bookings', uid);
    const booking    = (await tx.get(bookingRef)).data() ?? neueBuchung();
    const plaetze    = booking.plaetze;
    const altesAngebot = booking.wahl[blockId];

    if (altesAngebot === neuesAngebot) return;                    // nichts zu tun

    // 1) Kapazität des neuen Angebots prüfen — im selben Lesevorgang
    if (neuesAngebot) {
      const slotRef  = doc(db, 'slots', neuesAngebot);
      const slot     = (await tx.get(slotRef)).data();
      if (slot.belegt + plaetze > slot.kapazitaet) {
        throw new AusgebuchtFehler(neuesAngebot);                 // → freundliche Meldung
      }
      tx.update(slotRef, { belegt: slot.belegt + plaetze });
    }

    // 2) Alten Platz freigeben
    if (altesAngebot) {
      const altRef = doc(db, 'slots', altesAngebot);
      const alt    = (await tx.get(altRef)).data();
      tx.update(altRef, { belegt: Math.max(0, alt.belegt - plaetze) });
    }

    // 3) Buchung schreiben
    tx.set(bookingRef, { ...booking, wahl: { ...booking.wahl, [blockId]: neuesAngebot },
                         geaendertAm: serverTimestamp() }, { merge: true });
  });
}
```

**Warum das gegen Überbuchung wasserdicht ist:** Firestore-Transaktionen sind optimistisch —
ändert ein anderes Gerät `slots/l1-28fb` zwischen `tx.get` und dem Commit, bricht Firestore die
Transaktion ab und führt sie automatisch neu aus (bis zu 5×). Die Prüfung `belegt + plaetze >
kapazitaet` läuft also immer gegen den aktuellen Stand. Zwei Personen können nicht denselben
letzten Platz bekommen.

**Fehlerbehandlung im UI:** `AusgebuchtFehler` → Karte wird sofort rot markiert, Toast
«Leider gerade eben ausgebucht — bitte wähle ein anderes Fach». Kein Absturz, kein Neuladen.

## 5. Security Rules (der eigentliche Schutz)

Ohne Rules könnte jemand mit der Browserkonsole `belegt: 0` schreiben. Die Rules sind die
Sicherheitsschicht — nicht das UI. Vollständiger Entwurf: [`snippets/firestore.rules`](snippets/firestore.rules).

Die drei Regeln, auf die es ankommt:

| Regel | Bewirkt |
|---|---|
| Bei `slots` darf **nur** `belegt` geändert werden, nie `kapazitaet` | niemand kann sich Plätze «dazuerfinden» |
| `belegt` muss `>= 0` und `<= kapazitaet` bleiben | **Überbuchung ist serverseitig unmöglich**, selbst bei manipuliertem Client |
| Änderung von `belegt` max. ± `maxPlaetzeProGeraet` pro Schreibvorgang | ein Skript kann nicht in einem Rutsch alles blockieren |
| `bookings/{uid}` nur schreibbar, wenn `uid == request.auth.uid` | fremde Tickets sind nicht manipulierbar |
| `codes/*` nur für Admins lesbar | Rettungscodes lassen sich nicht durchprobieren |
| `config/app` für alle lesbar, nur für Admins schreibbar | Notbremse bleibt in Lehrer-Hand |

> **Härtung Stufe 2 (optional, Phase 6):** Mit `getAfter()` lässt sich in den Rules zusätzlich
> prüfen, dass im selben Commit auch das Buchungsdokument passend geändert wird. Damit kann ein
> manipulierter Client nicht mehr fremde Zähler senken, ohne selbst eine Buchung zu bewegen.
> Für einen Schulanlass mit 120 wohlgesinnten Gästen ist Stufe 1 ausreichend — Stufe 2 nur, wenn
> nach dem Lasttest noch Zeit bleibt.

**Kein Geheimnis im Frontend:** Die Firebase-Web-Konfiguration (`apiKey` etc.) ist öffentlich —
das ist so vorgesehen und kein Sicherheitsproblem. Der Schutz kommt zu 100 % aus den Rules.
Trotzdem via Netlify-Umgebungsvariablen `VITE_FIREBASE_*` einbinden, damit Test- und
Produktivprojekt getrennt bleiben.

## 6. Kapazitäts- und Kostenrechnung (Gratis-Plan)

Firestore Spark: **50 000 Reads / 20 000 Writes pro Tag**, gratis. Rechnung für den 28.10.:

| Posten | Rechnung | Reads | Writes |
|---|---|---|---|
| Gäste: Zähler-Listener pro Schritt (7 / 7 / 12 / 12 Docs) | 120 × 38 | 4 560 | — |
| Gäste: Live-Änderungen sichtbar während der Auswahl | 120 × ~200 | 24 000 | — |
| Gäste: eigenes Buchungsdokument + `config/app` | 120 × 4 | 480 | — |
| Buchungen (2 Zähler + 1 Buchung pro Wahl) | 120 × 4 × 3 | — | 1 440 |
| Änderungen (Annahme: 30 % ändern einmal) | 36 × 3 | — | 108 |
| Admin-Dashboards (4 Personen, ganzer Morgen) | 4 × ~520 | 2 080 | — |
| Puffer (Neuladen, Doppelscans, Tests) | ×1.4 | ~12 600 | ~620 |
| **Total** | | **≈ 43 700** | **≈ 2 170** |
| **Gratis-Limit / Tag** | | 50 000 | 20 000 |

Reads liegen bei ~87 % des Limits — knapper als angenehm. Drei Gegenmassnahmen, alle in Phase 6:

1. **Listener nur für den aktuellen Block** (7 bzw. 12 Dokumente statt 38) — bereits eingeplant.
2. **Listener beim Verlassen eines Schritts sofort abmelden** (`unsubscribe`), damit ein Gerät auf
   der Ticket-Seite keine Zähleränderungen mehr empfängt. Das ist der grösste Hebel.
3. **Reserve-Schalter:** `config/app.liveZaehler = false` schaltet alle Geräte auf einmaliges Laden
   statt Live-Updates um (Platzzahl dann «Stand 09:02»). Halbiert die Reads sofort und ist die
   Notbremse, falls der Verbrauch in der Firebase-Konsole am Morgen davonläuft.

Mit Massnahme 2 landet die realistische Schätzung bei **≈ 25 000 Reads = 50 % des Limits**.

| Dienst | Verbrauch | Limit gratis | Kosten |
|---|---|---|---|
| Netlify Bandbreite | ~40 MB | 100 GB/Monat | CHF 0 |
| Netlify Build-Minuten | ~15 | 300/Monat | CHF 0 |
| Firestore Speicher | < 1 MB | 1 GB | CHF 0 |
| Firebase Auth (anonym) | ~130 Nutzer | 50 000 MAU | CHF 0 |
| Domain `fms.alae.app` | vorhanden | — | CHF 0 |
| **Total laufend** | | | **CHF 0.—** |

## 7. Hosting, Domain, Deployment

- **Repo:** `github.com/vonallmenalain/fms`
  - `main` → automatischer Deploy auf `fms.alae.app` (Produktion)
  - jeder andere Branch → automatische **Deploy-Preview-URL** (zum Zeigen/Testen, ohne Risiko)
- **Netlify:** Build `npm run build`, Publish-Verzeichnis `dist`, SPA-Redirect
  (`/* → /index.html 200`), Security-Header. Siehe [`snippets/netlify.toml`](snippets/netlify.toml).
- **Domain:** `fms.alae.app` als Custom Domain in Netlify eintragen → CNAME auf den
  Netlify-Host setzen. TLS-Zertifikat kommt automatisch (Let's Encrypt).
  **Mindestens 7 Tage vor dem Event einrichten**, damit DNS-Propagation und Zertifikat sicher stehen.
- **Zwei Firebase-Projekte:** `fms-besuchstag-test` und `fms-besuchstag-prod`. Die Generalprobe
  läuft gegen Test, sonst muss man am Vorabend Testdaten aus der Produktion putzen.

## 8. Verhalten bei Störungen

| Störung | Verhalten der App |
|---|---|
| Kein Netz beim Öffnen | Programm wird trotzdem angezeigt (liegt im Bundle), Hinweis «Keine Verbindung — Auswahl noch nicht möglich» |
| Netz bricht mitten in der Auswahl ab | Firestore-SDK puffert und sendet automatisch nach; UI zeigt «wird gespeichert …» |
| Angebot währenddessen ausgebucht | Toast + Karte sofort gesperrt, keine Fehlerseite |
| Firestore-Quota erschöpft | Banner «Anmeldung vorübergehend nicht möglich — bitte beim Info-Stand melden» |
| Gerät hat altes Bundle (Programm geändert) | Vergleich `config/app.programmVersion` → Hinweis «Bitte Seite neu laden» |
| Browserdaten gelöscht / anderes Handy | Rettungscode am Info-Stand nennen → Admin stellt Buchung wieder her |
| **Totalausfall** | Papier-Fallback, siehe [04-eventtag-runbook.md](04-eventtag-runbook.md) §5 |

## 9. Projektstruktur (Zielbild)

```
fms/
├── data/programm.json          # einzige Quelle der Wahrheit fürs Programm
├── docs/                       # dieses Konzept
├── scripts/
│   ├── seed.mjs                # programm.json → Firestore slots/ (idempotent)
│   ├── reset.mjs               # alle Buchungen löschen, Zähler auf 0
│   └── lasttest.mjs            # 150 parallele Buchungen simulieren
├── src/
│   ├── programm.ts             # importiert + typisiert programm.json
│   ├── firebase.ts             # Init, anonyme Anmeldung
│   ├── buchung.ts              # runTransaction-Logik aus §4
│   ├── hooks/useSlots.ts       # Live-Zähler für einen Block
│   ├── screens/                # Start · Auswahl · Ticket · Admin
│   └── ui/                     # AngebotsKarte, Fortschritt, Banner …
├── firestore.rules
├── netlify.toml
└── .env.example
```
