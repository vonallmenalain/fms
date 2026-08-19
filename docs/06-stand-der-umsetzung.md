# 06 · Stand der Umsetzung

**Stand 20.08.2026** — die App ist gebaut und läuft. Dieses Dokument sagt, was existiert,
wie man es startet und wo bewusst vom Konzept abgewichen wurde.

---

## 1. Was fertig ist

| Bereich | Zustand |
|---|---|
| Gast-Ablauf: Start → 4 Blöcke → Ticket | ✅ vollständig, mit Live-Platzzahlen |
| Gruppen-Anmeldung 1–4 Personen | ✅ (Entscheid D3) |
| Sperre «gleiches Fach» innerhalb der Blockgruppe | ✅ (Entscheide D1/D2) |
| Blöcke überspringen, Wahl ändern, Plätze freigeben | ✅ |
| Ticket mit Rettungscode, auf dem Gerät wiederherstellbar | ✅ |
| Freigabeschalter, wirkt serverseitig | ✅ (Entscheid D4) |
| Admin: Live-Dashboard, Anmeldung erfassen, Code-Suche, Steuerung, Druck, CSV | ✅ |
| Security Rules | ✅ gegen den Emulator geprüft |
| Automatischer Rules-Deploy per GitHub-Action | ✅ |
| Lasttest mit Invariantenprüfung | ✅ |
| Netlify-Deploy aus `main` | ✅ |

**Noch offen:** Latenzmessung gegen die echte Datenbank mit 200/400 Clients (muss von einem
gewöhnlichen Anschluss aus laufen, siehe unten), Generalprobe, CI-Grün aus dem
Original-Logo, Blaze-Tarif.

> ### Fund aus dem Lasttest: Anmelde-Drosselung pro IP
> Firebase Auth blockiert anonyme Neuanmeldungen, wenn zu viele von **derselben IP-Adresse**
> kommen (`auth/too-many-requests`). Im Gast-WLAN teilen sich alle Geräte eine IP — beim
> gleichzeitigen QR-Scan wäre das am Eventtag aufgetreten.
> **Behoben:** Die App meldet sich jetzt **erst beim ersten Buchen** an, nicht beim Laden
> der Seite. Da Programm und freie Plätze ohne Anmeldung lesbar sind, verteilen sich die
> Anmeldungen über die Auswahlzeit. Dazu Wiederholung mit Streuung und eine verständliche
> Meldung. Vollständige Analyse: [05 §5a](05-last-und-performance.md).
> **Bleibt zu prüfen:** ob das Gast-WLAN der Schule betroffen ist — nur vor Ort messbar,
> gehört in die Generalprobe.

## 2. Lokal starten

```bash
npm install
npm run dev                 # gegen die echte Firebase-Datenbank
```

Gegen die **Emulator Suite** (empfohlen zum Entwickeln — verbraucht kein Kontingent und
testet die echten Security Rules):

```bash
npx firebase-tools emulators:start --only firestore,auth      # Terminal 1
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed.mjs --oeffnen
VITE_EMULATOR=1 npm run dev                                    # Terminal 2
```

## 3. Skripte

| Befehl | Wirkung |
|---|---|
| `node scripts/seed.mjs` | Programm aus `data/programm.json` nach Firestore spiegeln (idempotent, Zählerstände bleiben) |
| `node scripts/seed.mjs --oeffnen` | dasselbe, öffnet zusätzlich die Anmeldung |
| `node scripts/pruefe.mjs` | Invarianten L1–L3 gegen die Datenbank prüfen |
| `node scripts/reset.mjs --ja` | alle Anmeldungen löschen, Zähler auf 0, Anmeldung schliessen |
| `node scripts/lasttest.mjs --clients 200` | Lasttest mit echten Clients und echten Rules |
| `EMULATOR=1 node scripts/lasttest.mjs --clients 120` | Lasttest gegen die Emulator Suite |

Für die Skripte gegen die Produktion braucht es `GOOGLE_APPLICATION_CREDENTIALS`.
Ohne Schlüssel lokal: dieselben Aktionen laufen über die **GitHub-Action «Firebase»**
(Reiter Actions → Run workflow → `nur-seed`, `pruefen` oder `reset`).

## 4. GitHub-Actions

| Action | Auslöser | Wirkung |
|---|---|---|
| **CI** | jeder Push und Pull Request | Typprüfung, Build, Bündelgrössen im Protokoll |
| **Firebase** | Push nach `main`, der `firestore.rules`, `data/programm.json` oder `scripts/**` berührt | Rules deployen + Programm einspielen |
| **Firebase** | manuell (`workflow_dispatch`) | `nur-rules`, `nur-seed`, `pruefen` oder `reset` |

Anmeldung über das Dienstkonto im Repository-Secret `FIREBASE_SERVICE_ACCOUNT`.

## 5. Bewusste Abweichungen vom Konzept

| Konzept sagte | Umgesetzt | Grund |
|---|---|---|
| Tailwind CSS | **eine handgeschriebene CSS-Datei** mit Farb-Tokens | Für sechs Bildschirme ist ein Framework Ballast. Spart einen Build-Schritt und ~10 KB; das CI-Grün ist eine einzige Variable in `src/index.css`. |
| react-router | **30-Zeilen-Router** (`src/hooks/useRoute.ts`) | Es gibt zwei Pfade (`/` und `/admin`). Eine Bibliothek dafür wären ~15 KB — bei 200 gleichzeitig ladenden Geräten unnötig. |
| Webschrift | **Systemschrift** | Nichts blockiert das erste Zeichnen, kein zusätzlicher Netzaufruf. Die Marke trägt das Logo. |
| Rettungscode auf Kollision prüfen | **keine Prüfung** | Gäste dürfen `codes/` per Rules nicht lesen, sonst wären Codes durchprobierbar. Bei 31⁶ ≈ 887 Mio. Möglichkeiten und ~200 Anmeldungen liegt das Kollisionsrisiko bei rund 1:45'000 — und spart einen Lesevorgang je Anmeldung. |
| Zwei Firebase-Projekte (Test + Produktion) | **ein Projekt + Emulator Suite** | Die Emulator Suite ist das bessere Testprojekt: gratis, sofort zurückgesetzt, und sie prüft die Rules mit. Ein zweites Cloud-Projekt lohnt sich erst, wenn vor Ort mit echten Geräten geprobt wird. |

## 6. Messwerte

Lasttests gegen die Emulator Suite, **mit den echten Security Rules**, mehrere Profile.
Die Anmeldung läuft in einer eigenen Phase, danach buchen alle gleichzeitig los.

| Profil | Clients | Nachfrage/Kapazität | Buchungen | harte Fehler | L1 Summe | L2 überbucht |
|---|---|---|---|---|---|---|
| Realistisch (Gruppen meist 1–2) | 150 | ≈ 0.9 × | 566 | **0** | **877 / 877** | **0** |
| Realistisch, ohne Vorprüfung | 150 | ≈ 0.9 × | 491 | **0** | **756 / 756** | **0** |
| Überlast (Gruppen gleichverteilt 1–4) | 200 | ≈ 2.5 × | 426 | **0** | **955 / 955** | **0** |
| Erster Lauf | 120 | ≈ 0.8 × | 359 | **0** | **866 / 866** | **0** |

**Das ist das belastbare Ergebnis:** In jedem Lauf stimmt die Summe aller Zähler **exakt**
mit den gebuchten Plätzen überein, kein Angebot wurde je überbucht, kein einziger harter
Fehler — auch unter zweieinhalbfacher Überbuchung und mit einem Fünftel der Clients gezielt
auf dieselben vier Angebote.

### Was diese Läufe zur Latenz **nicht** sagen

| | gemessen |
|---|---|
| L5 Buchungsdauer p50 / p95 | 71–285 ms / 3.3–8.0 s |
| L6 fremde Änderung sichtbar p95 | 0.6–1.4 s |

Diese Zahlen sind **nicht übertragbar**, und zwar aus drei Gründen:

1. **Alles läuft auf einer Maschine.** 150 bis 200 Firebase-Clients in einem Node-Prozess
   plus die Java-basierte Emulator Suite teilen sich vier Kerne. Schon das Hinzufügen der
   Vorprüfung — ein zusätzlicher Lesevorgang je Wahl — hob p50 von 71 auf 227 ms. Das ist
   eine Ressourcengrenze des Testrechners, keine Eigenschaft von Firestore.
2. **Die Emulator Suite verteilt nicht.** Die echte Datenbank verteilt Dokumente über viele
   Maschinen; die Emulator Suite ist ein Prozess. Andrang auf ein Dokument wirkt sich dort
   deutlich stärker aus.
3. **Der lange Schwanz ist die Wiederholungsleiter, nicht die Datenbank.** Wer auf ein fast
   volles Angebot zielt, durchläuft 120/300/700/1500 ms mit Streuung. Das ist gewollt und
   endet in einer klaren Meldung — nicht in einem Fehler.

**Offener Punkt für Phase 6:** L5 und L6 gegen die **echte Datenbank** messen, mit 200 und
400 Clients — und von einem **gewöhnlichen Anschluss** aus, nicht aus einem Rechenzentrum
(siehe [05 §5a](05-last-und-performance.md): die Anmelde-Drosselung greift dort sofort).

### Bündelgrössen (gzip), kritischer Pfad für Gäste

| Datei | gzip |
|---|---|
| index.html + CSS | 3.2 KB |
| App-Kode | 9.8 KB |
| React | 45.7 KB |
| Firebase (App + Auth + Firestore) | 115.0 KB |
| **Total** | **≈ 174 KB** (Ziel ≤ 200 KB) |

Der Admin-Bereich liegt in einem eigenen Bündel (4.9 KB) und wird bei Gästen nie geladen.

## 7. Geprüfter Ablauf

Automatisierter Browsertest gegen die Emulator Suite (Chromium, iPhone-Format):

1. Startseite lädt, Gruppengrösse 2 wählbar ✓
2. Atelier 1 zeigt sieben Angebote mit Live-Platzzahlen ✓
3. Nach der Wahl: Atelier 2, dasselbe Fach ist gesperrt ✓ (Entscheid D1)
4. Unterrichtsbesuch 1 und 2 ✓
5. Ticket mit fünf Zeilen (Begrüssung + vier Blöcke) und Rettungscode ✓
6. Seite neu laden → Ticket kommt automatisch zurück ✓
7. `/admin` zeigt die Anmeldung für Lehrpersonen ✓
8. Keine Fehler in der Browserkonsole ✓

Zusätzlich verifiziert:
- Bei **geschlossener Anmeldung** weisen die Security Rules **jede** Buchung ab — die
  Notbremse wirkt serverseitig, nicht nur im Bildschirm. (Aufgefallen, weil ein Testlauf
  nach einem `reset` komplett abgewiesen wurde — genau richtig.)
- Gegen die **Produktionsdatenbank** nach dem Rules-Deploy: `codes/` unangemeldet lesen →
  **403**, `slots/` lesen → erlaubt, `config/app` → erlaubt. Genau wie vorgesehen.

## 8. Was als Nächstes ansteht

| # | Was | Wer |
|---|---|---|
| 1 | Erster Admin-Login über **«Mit Google anmelden»** — trägt sich selbst als Betreuung ein | Schule |
| 2 | CI-Grün aus dem Original-Logo liefern (Platzhalter `#B4BD00` in `src/index.css`) | Schule |
| 3 | Latenztest gegen die echte Datenbank von einem normalen Anschluss aus | Technik |
| 4 | Gast-WLAN mit der Schul-IT klären (Verbindungszahl **und** gemeinsame IP) | beide |
| 5 | Blaze-Tarif + Budget-Alarm CHF 5/20 | Schule |
| 6 | Generalprobe mit ~20 echten Handys im Gast-WLAN | beide |
| 7 | Vor dem Event: `reset`, danach Anmeldung geschlossen lassen bis 08:35 | Technik |
