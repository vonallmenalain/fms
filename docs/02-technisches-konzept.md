# 02 · Technisches Konzept

## 1. Architektur in einem Bild

```
   Handy des Gasts                    Netlify (CDN)              Firebase (Blaze-Tarif)
 ┌──────────────────┐            ┌────────────────────┐        ┌──────────────────────────┐
 │  Browser         │            │  statische Dateien │        │  Auth (anonym + Admin)   │
 │  React-SPA       │◄──HTTPS────┤  HTML/JS/CSS       │        │                          │
 │                  │            │  + programm.json   │        │  Firestore               │
 │  Programm-Daten  │            │    (im Bundle!)    │        │   slots/{id}   Zähler    │
 │  liegen lokal ───┼────────────┘  Deploy via GitHub │        │   bookings/{uid}         │
 │  Zähler + Buchung├─────── Firestore SDK (WebSocket)─────────►│   config/app + /programm │
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

**Nachtrag August 2026 — die Ausnahme am Eventmorgen.** Punkt 1 gilt bis zum Vorabend; um
08:47 hilft er nicht mehr, wenn ein Zimmer kurzfristig wechselt. Darum kann die
Administration das Programm in der Steuerung ändern: das **Datum** des Anlasses, Titel
und **Zeiten der Bereiche**, Titel, Klasse, Zimmer, Lehrpersonen-Kürzel und Kapazität der
**Angebote** — und beides lässt sich auch anlegen und entfernen. Gespeichert wird das als
**Abweichung** in `config/programm` (§3). Die Programmdatei bleibt die Quelle der
Wahrheit — sie wird überlagert, nicht ersetzt, und die Punkte 2 und 3 bleiben unberührt:
ein zusätzliches Dokument, das meist leer ist.

Damit ist die App auch für den **nächsten** Besuchsmorgen zu haben, ohne dass jemand die
Datei anfassen muss: neues Datum setzen, Bereiche und Angebote nachführen, fertig.

## 2. Technologie-Wahl

| Baustein | Wahl | Warum |
|---|---|---|
| Build | **Vite + React + TypeScript** | 4 Screens mit Live-Daten; TS verhindert genau die Tippfehler (`l1-27fc` vs. `l1-27Fc`), die am Eventtag weh tun |
| Styling | **Tailwind CSS** | keine separate CSS-Datei zu pflegen, konsistente Tap-Grössen |
| Routing | **react-router** | 6 Routen inkl. `/admin`, `/ticket` |
| Backend | **Firebase Firestore** (Blaze, s. [05 §3](05-last-und-performance.md)) | Echtzeit-Zähler + atomare Transaktionen ohne eigenen Server |
| Auth | **Firebase Auth**: anonym (Gäste) + E-Mail/Passwort (Admin) | anonyme UID = stabile Geräte-ID **und** Basis für die Security Rules |
| Hosting | **Netlify** | Git-Deploy, Deploy-Previews pro Branch, Gratis-Tier reicht um Faktor 1000 |
| Tests | **Vitest** + **Firebase Emulator Suite** | Rules-Tests und der Lasttest laufen lokal, ohne Quota zu verbrauchen |

**Bewusst nicht gewählt**
- *Cloud Functions* — **auch mit aktiviertem Blaze-Tarif nicht.** Serverkode zwischen App und
  Datenbank macht die Buchung bei 200 Geräten langsamer (zusätzliche Runde, Kaltstart 1–3 s,
  begrenzter Instanzen-Pool) und fügt einen zweiten Ausfallpunkt hinzu. Die serverseitige
  Autorität, ihr einziger echter Vorteil, kommt bei uns aus den Security Rules — ohne Runde.
  Ausführliche Begründung mit Zahlen: [05 §2](05-last-und-performance.md).
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
  "plaetze": 2,                       // Gruppengrösse 1–4 (Entscheid D3)
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

### `config/app` — Laufzeitsteuerung (1 Dokument)
```jsonc
{
  "anmeldungOffen": false,          // manueller Schalter (D4) — Notbremse und Freigabe
  "maxPlaetzeProGeraet": 4,        // 1–4, zur Laufzeit einstellbar (D3)
  "liveZaehler": true,             // Reserveschalter: false = keine Live-Updates
  "banner": "",                     // Freitext an alle Gäste, "" = aus
  "programmVersion": "2026-08-19"   // Warnung, falls Gerät veraltetes Bundle hat
}
```

### `config/programm` — Anpassungen von Hand (1 Dokument, meist leer)
```jsonc
{
  // Fehlt das Feld, gilt das Datum aus data/programm.json. Der Wochentag wird gerechnet.
  "event": { "datum": "2027-11-03" },

  // Nur die Bereiche, die angefasst wurden. `neu` heisst: gibt es nur hier;
  // `entfernt` heisst: steht in der Datei, wird aber ausgeblendet.
  "bloecke": {
    "a1": { "label": "Werkstatt 1", "von": "08:45", "bis": "09:05" },
    "l1": { "entfernt": true },
    "z1": { "neu": true, "art": "lektion", "label": "Unterrichtsbesuch 3",
            "von": "09:00", "bis": "09:15", "kapazitaet": 20 }
  },

  // Nur die Angebote, die in der Steuerung angefasst wurden — alle anderen gelten
  // unverändert aus data/programm.json. Die Kapazität steht NICHT hier, sondern im
  // Zähler: Dort prüft die Buchungstransaktion gegen Überbuchung.
  "angebote": {
    "l1-28fb": { "fach": "Pädagogik", "klasse": "28Fb", "raum": "GN 2.53", "lehrperson": "KLN" },
    "a2-chemie": { "entfernt": true },
    "z1-bildnerisches-gestalten-ytyi": {
      "neu": true, "blockId": "z1", "fachKey": "bildnerisches-gestalten",
      "fach": "Bildnerisches Gestalten", "klasse": "29Fa", "raum": "GN 0.11", "lehrperson": "ABC"
    }
  }
}
```

Die Blockschlüssel `z1`–`z8` sind ein **fester Vorrat** für selbst angelegte Bereiche:
Die Security Rules prüfen für jeden Schlüssel einzeln, dass die gewählte Angebots-ID zu
ihm gehört (`gueltigerSlot`), und die Regelsprache kennt keine Schleifen. Zwölf Bereiche
sind für einen Vormittag reichlich; die Liste steht in `firestore.rules` und in
`src/programm.ts` (`NEUE_BLOCK_IDS`) und muss dort zusammenpassen.

Ein Dokument, ein Listener, auf jedem Gerät — auch beim Gast: Korrigiert die
Administration um 08:47 ein Zimmer, muss die Änderung dort ankommen, wo gewählt wird.
`src/programm.ts` legt die Abweichung über die Programmdatei und zeichnet alle
Bildschirme neu (`useSyncExternalStore`).

### `zugang/{mail}` — Einladungen (Dokument-ID = Mailadresse, klein geschrieben)
```jsonc
{
  "email": "lea.muster@example.ch",
  "name": "Lea Muster",
  "rolle": "betreuung",             // "betreuung" | "admin"
  "erstelltAm": "2026-10-01T09:12:00.000Z",
  "erstelltVon": "leitung@example.ch"
}
```
Die Einladung hängt an der Mailadresse, weil es die Person zu diesem Zeitpunkt noch nicht
gibt: Eine uid entsteht erst beim ersten Anmelden. Angelegt wird sie in der App unter
**Steuerung → Zugänge**.

### `admins/{uid}` — freigeschaltete Konten (beim ersten Anmelden selbst angelegt)
```jsonc
{
  "rolle": "betreuung",             // aus der Einladung übernommen, nicht frei wählbar
  "name": "Lea Muster",
  "email": "lea.muster@example.ch",
  "seit": "2026-10-02T07:41:00.000Z"
}
```

**Zwei Rollen.** `betreuung` sieht die Übersicht und erfasst Anmeldungen für Gäste ohne
Handy. `admin` darf zusätzlich steuern: Freigabeschalter, Meldung an alle, Kapazitäten,
Zurücksetzen und Zugänge vergeben. Erzwungen wird das in `firestore.rules` — der Reiter
«Steuerung» blendet sich zwar aus, aber das allein wäre kein Schutz.

**Erstzugang.** Damit überhaupt jemand die ersten Zugänge vergeben kann, steht in
`firestore.rules` eine kurze Liste von Adressen (`bootstrapMail()`), die sich selbst als
`admin` eintragen dürfen. Das ist die einzige Stelle, die einen Deploy braucht — alles
Weitere läuft danach über die App.

**Anmelden** geht auf drei Wegen: E-Mail + Passwort, Google oder Anmeldelink per E-Mail
(Firebase verschickt ihn selbst, kein Mailserver nötig). Der Anmeldebildschirm zeigt nur
die ersten beiden; wer noch kein Konto hat, wechselt über «Konto erstellen» in die zweite
Ansicht — dort stehen alle drei Wege, ein Konto anzulegen. Voraussetzung für den Link:
Firebase-Konsole → Authentication → Sign-in method → «E-Mail-Adresse/Passwort» mit
**E-Mail-Link (passwortloses Anmelden)** aktiviert, und die Domain unter Settings →
Authorized domains eingetragen.

**Konto selbst erstellen.** Ein Konto anzulegen öffnet keinen Zugang: Freigeschaltet wird
nur, wessen Adresse unter «Steuerung → Zugänge» eingetragen ist. Bei einem Passwort-Konto
kommt eine Bedingung dazu — `firestore.rules` verlangt `email_verified`, sonst könnte
jemand ein Konto auf eine fremde, eingeladene Adresse anlegen und deren Rolle übernehmen.
Darum geht die Bestätigungsmail sofort raus, und bis zur Bestätigung steht statt «Kein
Zugang» der Bildschirm «E-Mail bestätigen» (mit erneutem Versand und frischem Token per
`getIdToken(true)` — ohne das trägt der Client seine alte, unbestätigte Aussage weiter).
Google- und Link-Anmeldungen gelten bei Firebase von sich aus als bestätigt.

## 4. Der Buchungsvorgang (Kernlogik)

Eine Wahl ändern heisst: **alten Platz freigeben, neuen belegen, Buchung aktualisieren** —
und zwar **alles zusammen oder gar nicht**. Genau dafür ist `runTransaction` da.

```ts
async function waehle(blockId: BlockId, neuesAngebot: string | null) {
  await mitWiederholung(() =>                                     // 4 Versuche mit Streuung, s. 05 §5
    runTransaction(db, async (tx) => {
      const bookingRef = doc(db, 'bookings', uid);

      // ---- 1. ALLE Lesevorgänge zuerst -------------------------------------
      // Firestore verlangt das: sobald geschrieben wurde, ist kein tx.get() mehr erlaubt.
      const bookingSnap  = await tx.get(bookingRef);
      const booking      = bookingSnap.data() ?? neueBuchung();
      const plaetze      = booking.plaetze;                        // 1-4
      const altesAngebot = booking.wahl[blockId];

      if (altesAngebot === neuesAngebot) return;                   // nichts zu tun

      const neuRef  = neuesAngebot  ? doc(db, 'slots', neuesAngebot)  : null;
      const altRef  = altesAngebot  ? doc(db, 'slots', altesAngebot)  : null;
      const neuSnap = neuRef ? await tx.get(neuRef) : null;
      const altSnap = altRef ? await tx.get(altRef) : null;

      // ---- 2. Prüfen -------------------------------------------------------
      if (neuSnap) {
        const { belegt, kapazitaet } = neuSnap.data()!;
        if (belegt + plaetze > kapazitaet) {
          throw new AusgebuchtFehler(neuesAngebot!);               // -> freundliche Meldung
        }
      }

      // ---- 3. ALLE Schreibvorgänge danach ----------------------------------
      if (neuRef && neuSnap) tx.update(neuRef, { belegt: neuSnap.data()!.belegt + plaetze });
      if (altRef && altSnap) tx.update(altRef, { belegt: Math.max(0, altSnap.data()!.belegt - plaetze) });

      tx.set(bookingRef, {
        ...booking,
        wahl: { ...booking.wahl, [blockId]: neuesAngebot },
        geaendertAm: serverTimestamp(),
      }, { merge: true });
    })
  );
}
```

**Warum das gegen Überbuchung wasserdicht ist:** Firestore-Transaktionen sind optimistisch —
ändert ein anderes Gerät `slots/l1-28fb` zwischen `tx.get` und dem Commit, bricht Firestore die
Transaktion ab und führt sie automatisch neu aus (bis zu 5×). Die Prüfung `belegt + plaetze >
kapazitaet` läuft also immer gegen den aktuellen Stand. Zwei Personen können nicht denselben
letzten Platz bekommen.

**Zwei Fallstricke, die genau hier sitzen:**
1. **Lesen vor Schreiben.** Ein `tx.get()` nach dem ersten `tx.update()` lässt die Transaktion
   zur Laufzeit scheitern. Deshalb die strikte Dreiteilung oben.
2. **Andrang auf ein Dokument.** Tippen 60 Personen gleichzeitig auf dasselbe Angebot, reiht
   Firestore die Transaktionen auf und das SDK gibt nach 5 Versuchen auf. `mitWiederholung()`
   legt eine eigene Wiederholung mit Streuung darüber, und die Karte ist ohnehin gesperrt, sobald
   die Live-Anzeige keine freien Plätze mehr zeigt. Details und Messwerte:
   [05 §5](05-last-und-performance.md).

**Fehlerbehandlung im UI:** `AusgebuchtFehler` → Karte wird sofort gesperrt, kurze Meldung
«Leider gerade eben ausgebucht — bitte wähle ein anderes Fach». Kein Absturz, kein Neuladen.

## 5. Security Rules (der eigentliche Schutz)

Ohne Rules könnte jemand mit der Browserkonsole `belegt: 0` schreiben. Die Rules sind die
Sicherheitsschicht — nicht das UI. Vollständiger Entwurf: [`snippets/firestore.rules`](snippets/firestore.rules).

Die drei Regeln, auf die es ankommt:

| Regel | Bewirkt |
|---|---|
| Bei `slots` darf **nur** `belegt` geändert werden, nie `kapazitaet` | niemand kann sich Plätze «dazuerfinden» |
| `belegt` muss `>= 0` und `<= kapazitaet` bleiben | **Überbuchung ist serverseitig unmöglich**, selbst bei manipuliertem Client |
| Änderung von `belegt` max. ± 4 pro Schreibvorgang (Decke aus D3) | ein Skript kann nicht in einem Rutsch alles blockieren |
| `bookings/{uid}` nur schreibbar, wenn `uid == request.auth.uid` | fremde Tickets sind nicht manipulierbar |
| `config/*` für alle lesbar, nur für Admins schreibbar | Notbremse bleibt in Lehrer-Hand; zugleich die Grundlage der Nur-Lese-Übersicht unter `/uebersicht` |
| `bookings` ist nur für die Betreuung auflistbar | die öffentliche Übersicht zeigt Belegung und freie Plätze, nie einzelne Anmeldungen oder Notizen |

> **Härtung Stufe 2 (optional, Phase 6):** Mit `getAfter()` lässt sich in den Rules zusätzlich
> prüfen, dass im selben Commit auch das Buchungsdokument passend geändert wird. Damit kann ein
> manipulierter Client nicht mehr fremde Zähler senken, ohne selbst eine Buchung zu bewegen.
> Für einen Schulanlass mit 120 wohlgesinnten Gästen ist Stufe 1 ausreichend — Stufe 2 nur, wenn
> nach dem Lasttest noch Zeit bleibt.

**Kein Geheimnis im Frontend:** Die Firebase-Web-Konfiguration (`apiKey` etc.) ist öffentlich —
das ist so vorgesehen und kein Sicherheitsproblem. Der Schutz kommt zu 100 % aus den Rules.
Trotzdem via Netlify-Umgebungsvariablen `VITE_FIREBASE_*` einbinden, damit Test- und
Produktivprojekt getrennt bleiben.

## 6. Kapazität und Kosten

Ausführlich mit allen Zahlen in [05 · Last und Performance](05-last-und-performance.md).
Das Ergebnis in Kürze:

| | 120 Geräte | 200 Geräte, realistisch | 200 Geräte, ungünstigster Fall |
|---|---|---|---|
| Lesevorgänge | ≈ 25 000 | ≈ 50 000 | ≈ 177 000 |
| Schreibvorgänge | ≈ 2 200 | ≈ 3 000 | ≈ 4 500 |
| Gratis-Kontingent (auch im Blaze-Tarif enthalten) | 50 000 / 20 000 pro Tag | | |
| **Kosten über dem Kontingent** | 0.00 | 0.00 | **≈ 0.08 USD** |

**Deshalb Blaze-Tarif aktivieren.** Nicht wegen zusätzlicher Funktionen — die brauchen wir nicht —
sondern weil das Gratis-Kontingent bei 200 Geräten **genau auf der Kante** liegt und ein
erschöpftes Kontingent im Gratis-Tarif bedeutet: die App hört mitten im Anlass auf zu
funktionieren. Im Blaze-Tarif kostet dieselbe Situation ein paar Rappen. Dazu ein
**Budget-Alarm auf CHF 5 und CHF 20**, weil Blaze keine harte Ausgabengrenze kennt.

| Dienst | Verbrauch | Kosten |
|---|---|---|
| Firestore (Blaze) | s. oben | < CHF 1 für den ganzen Anlass |
| Netlify Bandbreite / Builds | ~60 MB / ~15 Min. | CHF 0 (100 GB bzw. 300 Min. pro Monat gratis) |
| Firebase Auth (anonym + 5 Konten) | ~210 Nutzer | CHF 0 (50 000 gratis) |
| Domain `fms.alae.app` | vorhanden | CHF 0 |

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
| Kein Netz beim Öffnen | Die App startet trotzdem — sie liegt seit dem ersten Besuch vollständig im Browser (Service Worker, siehe unten). Banner «Kein Internet …», die eigene Anmeldung ist lesbar, Buchen ist gesperrt |
| Netz bricht mitten in der Auswahl ab | Der laufende Versuch scheitert sauber — eine Transaktion braucht zwingend den Server. Die Karte fällt in ihren Zustand zurück, die Meldung sagt, woran es liegt. Es kann nie eine Wahl auf dem Schirm stehen, die niemand reserviert hat |
| Angebot währenddessen ausgebucht | Toast + Karte sofort gesperrt, keine Fehlerseite |
| Firestore-Kontingent erschöpft | Im Blaze-Tarif gibt es diesen Fall nicht mehr — es wird abgerechnet statt abgeschaltet. Trotzdem hinterlegt: Banner «Anmeldung vorübergehend nicht möglich — bitte beim Info-Stand melden» |
| Andrang auf ein einzelnes Angebot | Wiederholung mit Streuung; danach «gerade eben ausgebucht», Liste zeigt bereits den neuen Stand ([05 §5](05-last-und-performance.md)) |
| Gerät hat altes Bundle (Programm geändert) | Vergleich `config/app.programmVersion` → Hinweis «Bitte Seite neu laden» |
| Browserdaten gelöscht / anderes Handy | Am Info-Stand melden → Admin erfasst die Anmeldung neu (der Screenshot der Auswahl hilft) |
| **Totalausfall** | Papier-Fallback, siehe [04-eventtag-runbook.md](04-eventtag-runbook.md) §5 |

### 8a. Offline-Betrieb (seit 27.08.)

Der Fall aus dem Prüfbericht — Tab geschlossen, kein Netz, `fms.alae.app` neu aufgerufen —
zeigte bis dahin die Fehlerseite des Browsers. Er braucht **zwei** Hälften, eine ohne die
andere nützt nichts:

| Hälfte | Wo | Was sie tut |
|---|---|---|
| **App** | `scripts/sw-vorlage.js` → beim Bau `dist/sw.js` | Ein Service Worker legt den gebauten Stand (index.html, Bündel, CSS, Logo — ~835 KB) im Zwischenspeicher des Browsers ab. Ohne Netz kommt die App von dort. |
| **Daten** | `src/firebase.ts` | Firestore schreibt seinen Zwischenspeicher nach IndexedDB statt nur in den Arbeitsspeicher. Damit überlebt die eigene Anmeldung das Schliessen des Tabs und ist beim Start ohne Netz sofort da. |

**Was offline geht:** die App starten, die eigene Anmeldung mit allen Bereichen, Zimmern und
Zeiten ansehen, durch die Angebotslisten blättern. Oben steht dann ein Banner «Kein Internet
— du siehst deinen zuletzt geladenen Stand».

**Was offline nicht geht:** buchen, wechseln, freigeben. Jeder dieser Vorgänge ist eine
Firestore-Transaktion und braucht den Server (§4) — genau deshalb kann offline auch keine
Wahl entstehen, die in Wirklichkeit niemand reserviert hat. Die App sagt das beim Tippen
sofort, statt ein Rädchen drehen zu lassen. Auch die Platzzahlen sind offline der zuletzt
geladene Stand, nicht der aktuelle.

**Neue Fassungen** kommen trotzdem an: Seitenaufrufe holen index.html zuerst aus dem Netz
(Frist 3.5 s, danach die gespeicherte Fassung). Der Service Worker lädt einen neuen Stand
im Hintergrund vollständig herunter und übernimmt ihn, sobald kein Tab der App mehr offen
ist — nie halb, und nie mitten im Buchen.

## 9. Projektstruktur (Zielbild)

```
fms/
├── data/programm.json          # einzige Quelle der Wahrheit fürs Programm
├── docs/                       # dieses Konzept
├── scripts/
│   ├── seed.mjs                # programm.json → Firestore slots/ (idempotent)
│   ├── reset.mjs               # alle Buchungen löschen, Zähler auf 0
│   ├── lasttest.mjs            # 150 parallele Buchungen simulieren
│   ├── sw-vorlage.js           # Service Worker, Offline-Start (§8a)
│   └── sw-bauen.mjs            # trägt die gebauten Dateien ein → dist/sw.js
├── src/
│   ├── programm.ts             # importiert + typisiert programm.json
│   ├── firebase.ts             # Init, anonyme Anmeldung
│   ├── buchung.ts              # runTransaction-Logik aus §4
│   ├── wiederholung.ts         # Retry mit Streuung gegen Andrang (05 §5)
│   ├── hooks/useSlots.ts       # Live-Zähler für einen Block
│   ├── hooks/useVerbindung.ts  # hat das Gerät gerade Netz?
│   ├── screens/                # Start · Auswahl · Ticket · Admin
│   └── ui/                     # AngebotsKarte, Fortschritt, Banner …
├── firestore.rules
├── netlify.toml
└── .env.example
```
