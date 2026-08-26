# 03 · Umsetzungsplan — konkrete Vorgehensweise

**Heute:** 19.08.2026 · **Event:** 28.10.2026 · **Zeit:** 10 Wochen
**Aufwand:** ca. **27–29 Stunden** — verteilbar auf 6–8 Abende.

Die Reihenfolge ist bewusst so gewählt, dass nach **Phase 2 (ca. 8 h)** bereits eine klickbare,
online erreichbare App existiert, die man der Schulleitung zeigen und mit einer Klasse testen kann —
noch komplett ohne Firebase. Alles Riskante (Datenbank, Regeln, Last) kommt danach und lässt sich
gegen den bereits abgenommenen Prototypen prüfen.

---

## Phase 0 · Entscheide & Zugänge  (1 h, blockiert alles Weitere)

1. ~~Die vier Entscheide **D1–D4** klären~~ — **erledigt am 19.08.2026**, siehe
   [01-fachkonzept §11](01-fachkonzept.md). Damit ist die Fachseite vollständig geklärt.
2. Das **CI-Grün** aus dem Logo-Original besorgen (SVG/AI oder CI-Manual) — Platzhalter ist `#B4BD00`.
3. Logo als **SVG** und als PNG (512 px, für das Favicon/Startsymbol) ablegen unter `public/`.
4. Zugänge anlegen:
   - Firebase-Projekte **`fms-besuchstag-test`** und **`fms-besuchstag-prod`**,
     Firestore-Standort **`eur3` (Europa)** — *dieser Standort lässt sich später nicht mehr ändern.*
   - In beiden: **Authentication → Anonym** aktivieren, **E-Mail/Passwort** aktivieren
   - **Blaze-Tarif** auf beiden Projekten aktivieren ([Begründung: 05 §3](05-last-und-performance.md))
   - **Budget-Alarm** in der Google-Cloud-Konsole auf **CHF 5 und CHF 20** mit E-Mail —
     Blaze kennt keine harte Ausgabengrenze, der Alarm ist das Sicherheitsnetz
   - Netlify-Konto mit GitHub verbinden
   - DNS-Zugriff für `alae.app` bereitlegen

**Fertig, wenn:** beide Firebase-Projekte existieren, auf Blaze laufen und der Budget-Alarm
eine Testmail ausgelöst hat.

---

## Phase 1 · Gerüst & erster Deploy  (2 h)

```bash
git clone https://github.com/vonallmenalain/fms.git && cd fms
npm create vite@latest . -- --template react-ts
npm install
npm install firebase react-router
npm install -D tailwindcss @tailwindcss/vite vitest
```

- `netlify.toml` und `.env.example` aus [`docs/snippets/`](snippets/) übernehmen
- Farb-Tokens aus [01-fachkonzept.md §8](01-fachkonzept.md) in `src/index.css` als CSS-Variablen
- Netlify: «Add new site → Import from GitHub» → `vonallmenalain/fms`, Branch `main`
- Erste Seite: Logo + «Besuchsmorgen FMS Neufeld — 28. Oktober 2026»

**Fertig, wenn:** ein Push auf `main` automatisch deployt und die Netlify-URL auf dem Handy
das Logo korrekt anzeigt.

---

## Phase 2 · Vollständiger Klick-Prototyp, ohne Datenbank  (5–6 h) ⭐

Der wichtigste Meilenstein. Alles läuft aus `data/programm.json` und React-State im Browser.

- `src/programm.ts`: JSON importieren, TypeScript-Typen (`Block`, `Offering`) definieren,
  Hilfsfunktionen `angeboteFuerBlock(blockId)` und `istGesperrt(offering, wahl)` (Regel D1/D2)
- Screens bauen: **Start → A1 → A2 → L1 → L2 → Ticket**
- Platzzahlen kommen aus einer Attrappe (`useSlotsMock`) mit **derselben Signatur**, die später
  der echte Hook hat → der Austausch in Phase 3 ist ein Einzeiler
- Zustände einer Angebots-Karte durchspielen: frei · knapp · ausgebucht · schon gewählt · gewählt
- Ticket-Screen inkl. Rettungscode-Attrappe und «Screenshot machen»-Hinweis
- Navigationszeile unter der Angebotsliste (Zurück · Weiter · Abschliessen), Fortschrittsanzeige

**Fertig, wenn:** du auf dem Handy von Start bis Ticket durchklickst, ohne einmal zu zoomen —
und drei Kolleg:innen dasselbe schaffen, ohne zu fragen.

> **Hier ist der richtige Moment für die Abnahme durch die Schule.** Deploy-Preview-Link
> verschicken, Rückmeldungen zu Wording und Reihenfolge einsammeln, bevor Technik dazukommt.

---

## Phase 3 · Firebase anbinden  (4 h)

1. `src/firebase.ts`: Init aus `import.meta.env.VITE_FIREBASE_*`, `signInAnonymously()` beim Start
2. `scripts/seed.mjs` ausführen → schreibt aus `data/programm.json` die 38 `slots/`-Dokumente
   plus `config/app` (siehe [`snippets/seed.mjs`](snippets/seed.mjs)):
   ```bash
   node scripts/seed.mjs --project fms-besuchstag-test
   ```
3. `src/hooks/useSlots.ts`: `onSnapshot` auf `query(collection(db,'slots'), where('block','==',blockId))`
   — **Listener beim Verlassen des Screens abmelden** (Read-Budget, siehe [02 §6](02-technisches-konzept.md))
4. `src/buchung.ts`: `runTransaction`-Logik aus [02 §4](02-technisches-konzept.md)
5. Rettungscode: 6 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (ohne 0/O/1/I/l),
   bei Kollision neu würfeln, `codes/{code}` mitschreiben
6. Ticket aus `bookings/{uid}` wiederherstellen — die anonyme UID überlebt das Schliessen des Browsers

**Fertig, wenn:** zwei Handys gleichzeitig buchen und beide sehen die Platzzahl des anderen
innerhalb von ~1 Sekunde sinken.

---

## Phase 4 · Security Rules + Tests  (3 h)

```bash
npm install -D firebase-tools @firebase/rules-unit-testing
npx firebase init firestore emulators
npx firebase emulators:start
```

`firestore.rules` aus [`snippets/firestore.rules`](snippets/firestore.rules) übernehmen und
gegen den Emulator testen — diese Fälle **müssen fehlschlagen**:

| # | Angriff | Erwartung |
|---|---|---|
| T1 | `belegt` auf `kapazitaet + 1` setzen | ❌ abgelehnt |
| T2 | `kapazitaet` von 20 auf 999 ändern | ❌ abgelehnt |
| T3 | fremdes `bookings/{andereUid}` schreiben | ❌ abgelehnt |
| T4 | `belegt` um 50 auf einmal senken | ❌ abgelehnt |
| T5 | `codes/*` als Gast lesen | ❌ abgelehnt |
| T6 | `config/app.anmeldungOffen` als Gast ändern | ❌ abgelehnt |
| T7 | normale Buchung als anonymer Gast | ✅ erlaubt |
| T8 | Admin ändert Kapazität eines Slots | ✅ erlaubt |

```bash
npx firebase deploy --only firestore:rules --project fms-besuchstag-test
```

**Fertig, wenn:** alle 8 Tests grün sind und in CI (GitHub Actions) bei jedem Push laufen.

---

## Phase 5 · Admin-Bereich  (4 h)

- `/admin` mit E-Mail/Passwort-Login; `admins/{uid}`-Dokumente von Hand in der Firebase-Konsole
  anlegen (3–4 Lehrpersonen + Organisation)
- **Dashboard:** 4 Spalten live, Balken `belegt/kapazitaet`, Sortierung «am vollsten zuerst»
- **«+ Anmeldung erfassen»:** Gast-Flow mit Notizfeld, für Personen ohne Handy
- **Rettungscode-Suche:** Code eingeben → Buchung anzeigen / ändern / löschen
- **Steuerung:** `anmeldungOffen`-Schalter, Banner-Text, Programm & Kapazitäten einzeln ändern
- **Öffentliche Übersicht** (`/uebersicht`) für die Lehrpersonen — ohne Login, nur zum Ansehen

> Druckansicht und CSV-Export standen hier ursprünglich mit auf der Liste. Sie sind
> gebaut und im August 2026 wieder **entfernt** worden: Am Info-Stand wurde nie gedruckt,
> und für den Blick von aussen genügt der Nur-Lese-Link.

**Fertig, wenn:** eine Lehrperson ohne Erklärung eine Anmeldung für 3 Personen erfasst.

---

## Phase 6 · Lasttest & Härten  (4 h) ⭐

Die Phase, die die Zusage «läuft flüssig bei 200 Geräten» **belegt** statt behauptet.
Vollständige Spezifikation: [05 §6](05-last-und-performance.md).

```bash
node scripts/lasttest.mjs --clients 200 --projekt fms-besuchstag-test
node scripts/lasttest.mjs --clients 400 --projekt fms-besuchstag-test   # doppelter Sicherheitsfaktor
node scripts/lasttest.mjs --clients 200 --netz 3g --projekt fms-besuchstag-test
```

Echte Firebase-Clients mit anonymer Anmeldung — **nicht** das Admin-SDK, das würde die Security
Rules umgehen und am Kern vorbeitesten. 15 % der Clients stürzen sich absichtlich auf dieselben
drei Angebote, um Andrang zu erzwingen.

**Abnahmekriterien — alle sieben müssen halten:**

| # | Prüfung | Erwartung |
|---|---|---|
| L1 | Summe `belegt` = Summe gebuchter Plätze | **exakt gleich** |
| L2 | Kein `belegt > kapazitaet` | 0 Fälle |
| L3 | Kein `belegt < 0` | 0 Fälle |
| L4 | Fehlgeschlagene Buchungen trotz freier Plätze | 0 |
| L5 | p95 Buchungsdauer | ≤ 1.5 s |
| L6 | p95 bis fremde Änderung sichtbar | ≤ 1.0 s |
| L7 | Verbrauch gegen die Schätzung aus 05 §3 | Abweichung < 30 % |

**Ausserdem in dieser Phase:**
- Leistungsbudget prüfen: JS auf dem kritischen Pfad ≤ 200 KB gepackt, Admin-Bereich per
  `lazy()` ausserhalb des Gast-Bundles (`npx vite-bundle-visualizer`)
- Lighthouse Mobil: Leistung ≥ 90, Bedienhilfen ≥ 95
- Flugmodus-Test: mitten in der Auswahl offline gehen, wieder online → keine Buchung verloren
- Echte Geräte: **iPhone Safari, Android Chrome, ein altes langsames Gerät**
- Reserveschalter `config/app.liveZaehler = false` testen
- Kein Layoutsprung, wenn ein Zähler sich ändert (feste Breite, keine Umsortierung)

## Phase 7 · Produktion, Domain, Generalprobe  (2 h)

1. Produktives Firebase-Projekt seeden, Rules deployen, Admin-Konten anlegen
2. Netlify-Umgebungsvariablen auf `prod` umstellen, Custom Domain **`fms.alae.app`** einrichten
   (CNAME + TLS abwarten) — **spätestens Di 20.10.**
3. **QR-Code** auf `https://fms.alae.app` erzeugen (Fehlerkorrektur-Stufe H, mind. 8 cm auf der Folie),
   PPT-Folie mit QR + Gast-WLAN-Zugang + Hinweis «Screenshot vom Ticket machen»
4. **Generalprobe** mit einer echten Klasse (~20 SuS) auf dem **Test**-Projekt
5. `node scripts/reset.mjs --project fms-besuchstag-prod` → Produktion sauber, `anmeldungOffen: false`
6. Code einfrieren: ab **Di 27.10. 18:00 keine Deploys mehr**

---

## Terminplan

| Woche | Datum | Was | Wer |
|---|---|---|---|
| KW 34 | bis 23.08. | Phase 0 — Entscheide D1–D4, Logo/CI-Grün, Firebase-Projekte | Schule + Technik |
| KW 35–36 | bis 06.09. | Phase 1–2 — Klick-Prototyp online | Technik |
| KW 37 | 07.–13.09. | **Abnahme Prototyp** durch Schulleitung, Wording-Feedback | Schule |
| KW 38–39 | bis 27.09. | Phase 3–4 — Firebase + Rules + Tests | Technik |
| KW 40 | bis 04.10. | **Programm definitiv** → `data/programm.json` final | Schule |
| KW 41 | 05.–11.10. | Phase 5 — Admin-Bereich | Technik |
| KW 42 | 12.–18.10. | Phase 6 — Lasttest, Geräte-Tests | Technik |
| KW 43 | 19.–25.10. | Phase 7 — Domain live (bis Di 20.10.), **Generalprobe**, QR-Folie | beide |
| KW 44 | Mo 26.10. | Schulung der 3–4 Lehrpersonen (30 Min.), Papier-Backup drucken | beide |
| | Di 27.10. | Reset Produktion, Code-Freeze 18:00, Checkliste durchgehen | Technik |
| | **Mi 28.10.** | **Event** — Support online 08:00–09:15 | beide |
| | bis 04.11. | Auswertung, Buchungen löschen | Technik |

**Kritischer Pfad:** Phase 0 (Entscheide) → Phase 2 (Abnahme) → Programm final (04.10.) →
Domain (20.10.) → Generalprobe. Verzögert sich das definitive Programm, ist das unkritisch:
dank `data/programm.json` im Bundle ist eine Programmänderung noch am Vorabend ein 5-Minuten-Job.

## Aufwandsübersicht

| Phase | Stunden |
|---|---|
| 0 Entscheide & Zugänge | 1 |
| 1 Gerüst & Deploy | 2 |
| 2 Klick-Prototyp | 5–6 |
| 3 Firebase | 4 |
| 4 Rules & Tests | 3 |
| 5 Admin | 4 |
| 6 Lasttest & Härten | 4 |
| 7 Produktion & Generalprobe | 2 |
| Reserve / Feedback-Einarbeitung | 2–3 |
| **Total** | **27–29 h** |

## Risiken

| Risiko | Wahrsch. | Wirkung | Gegenmassnahme |
|---|---|---|---|
| Programm ändert spät | hoch | klein | Programm im Bundle → Commit + Deploy in 5 Min. |
| Firestore-Kontingent erschöpft | **entfällt** | — | Blaze-Tarif: wird abgerechnet statt abgeschaltet. Budget-Alarm CHF 5/20 |
| Andrang auf ein einzelnes Angebot | mittel | mittel | Vorprüfung aus der Live-Anzeige + Wiederholung mit Streuung; im Lasttest mit 400 Clients belegt ([05 §5](05-last-und-performance.md)) |
| 200 Geräte gleichzeitig um 08:35 | mittel | mittel | Lasttest Phase 6 mit 200 **und** 400 Clients; Aula-Ansage «in Ruhe, es hat gut doppelt so viele Plätze wie Leute» |
| Gast-WLAN verkraftet 200 Verbindungen nicht | mittel | mittel | **Vorab mit der Schul-IT klären** ([05 §9](05-last-und-performance.md)); Mobilfunknetz ist der Hauptweg, WLAN die Ergänzung |
| WLAN im Gebäude überlastet | mittel | mittel | App lädt < 200 KB, funktioniert über Mobilnetz; Gast-WLAN auf der QR-Folie |
| Gäste ohne Handy | sicher | klein | Admin-Erfassung durch Lehrpersonen (Phase 5) |
| Ticket verloren (Browserdaten weg) | klein | klein | Rettungscode + Admin-Suche |
| Totalausfall Firebase/Netlify | sehr klein | gross | Papier-Fallback, [04-eventtag-runbook.md](04-eventtag-runbook.md) §5 |
| Entwickler am 28.10. nicht erreichbar | klein | gross | Runbook, damit die Lehrpersonen 90 % selbst lösen |
