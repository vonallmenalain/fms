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

**Noch offen:** Lasttest gegen die echte Datenbank mit 200/400 Clients (Phase 6),
Generalprobe, CI-Grün aus dem Original-Logo, Blaze-Tarif.

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

Lasttest gegen die Emulator Suite, **mit den echten Security Rules**,
120 Clients, Gruppengrössen 1–4, 25 % gezielt auf dieselben drei Angebote:

```
359 Buchungen · 137 korrekt als ausgebucht abgewiesen · 0 harte Fehler

L1 Summe der Zähler = Summe gebuchter Plätze   866 / 866   BESTANDEN
L2 kein Angebot über Kapazität                 0 Fälle     BESTANDEN
L3 kein Zähler unter null                      0 Fälle     BESTANDEN
L4 Fehlgeschlagene Buchungen bei freien Plätzen 0          BESTANDEN
L5 Buchungsdauer p50/p95/p99      44 / 129 / 204 ms        BESTANDEN (Ziel p95 ≤ 1500)
L6 fremde Änderung sichtbar p95   594 ms                   BESTANDEN (Ziel p95 ≤ 1000)
```

> Die Emulator Suite läuft lokal; die Latenzwerte sind deshalb **optimistisch**.
> Belastbar ist der Korrektheitsnachweis (L1–L4): Unter starkem Andrang auf einzelne
> Angebote stimmt die Summe der Zähler exakt mit den gebuchten Plätzen überein, und
> nichts wurde überbucht. Die Latenzmessung gegen die echte Datenbank mit 200 und 400
> Clients steht in Phase 6 an.

**Bündelgrössen (gzip), kritischer Pfad für Gäste:**

| Datei | gzip |
|---|---|
| index.html + CSS | 3.2 KB |
| App-Kode | 9.4 KB |
| React | 45.7 KB |
| Firebase (App + Auth + Firestore) | 115.0 KB |
| **Total** | **≈ 173 KB** (Ziel ≤ 200 KB) |

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

Zusätzlich verifiziert: Bei geschlossener Anmeldung weisen die Security Rules **jede**
Buchung ab — die Notbremse wirkt serverseitig, nicht nur im Bildschirm.
