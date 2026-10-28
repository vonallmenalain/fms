# 06 · Stand der Umsetzung

**Stand 20.08.2026** — die App ist gebaut und läuft. Dieses Dokument sagt, was existiert,
wie man es startet und wo bewusst vom Konzept abgewichen wurde.

> Der vollständige Durchgang vor der ersten Vorführung — Stresstest mit 150 Geräten,
> Browsertest, gefundene Schwachstellen und die ToDo-Listen — steht in
> **[07-pruefbericht.md](07-pruefbericht.md)**.
>
> **Nachtrag 28.10.2026:** Funde vom Besuchsmorgen und was daraufhin geändert wurde → §0.

---

## 0. Nach dem Besuchsmorgen vom 28.10.2026

### Fund 1: Auf einzelnen iPhones war die Auswahl nach «Abschliessen» leer

**Symptom.** Einige Personen wählten vier Kurse, nach «Abschliessen» standen sie aber nicht
in der Auswahl — teils auch nach dem Neuladen nicht. Gemeldet vor allem von iPhones.

**Ursache.** Ein Fehler in WebKit ab Safari/iOS 26.4
([firebase/firebase-js-sdk#9789](https://github.com/firebase/firebase-js-sdk/issues/9789),
betrifft Firebase 11.10 — genau die eingesetzte Version — und 12.x): Safari hält die
Live-Daten, die Firestore über einen offenen Datenstrom schickt, zurück, bis nach bis zu
30 Sekunden ein Lebenszeichen des Servers sie freigibt; manche Änderungen kommen gar nie an.
Auf dem iPhone ist jeder Browser technisch ein Safari, auch Chrome. Die **Buchungen selbst**
laufen dagegen über gewöhnliche Einzelanfragen (`runTransaction`) und **wurden gespeichert**.
Haken auf den Karten, Merkzettel und Auswahl kamen aber **ausschliesslich aus dem
Live-Listener** — und der schwieg. Nach dem Neuladen holte der Firestore-Zwischenspeicher
(IndexedDB) denselben veralteten Stand hervor, denn auch er erfährt nur, was der Listener
liefert.

**Nachgestellt** gegen die Emulator Suite mit dem produktiven Stand, indem nach «Los geht's»
der Listen-Kanal abgeschnitten wird (Buchen funktioniert weiter):

| | Stand am Besuchsmorgen | neuer Stand |
|---|---|---|
| Datenbank | alle 4 Kurse gespeichert | alle 4 Kurse gespeichert |
| Karten nach dem Antippen | kein Haken | ✓ gewählt |
| Nach «Abschliessen» | «Es ist noch keine Anmeldung vorhanden» | alle 4 Kurse |
| Nach dem Neuladen | Startseite ohne Auswahl | alle 4 Kurse |

**Behoben in zwei Schichten:**

1. **Ursache:** Auf WebKit (iPhone, iPad, Safari auf dem Mac) nutzt Firestore Long Polling
   statt des Datenstroms (`src/firebase.ts`) — die vom Firebase-Team empfohlene Abhilfe.
   Jede Antwort ist eine abgeschlossene Anfrage, die Safari nicht zurückhalten kann. Das
   behebt auf iPhones auch verzögerte Platzzahlen und eine verspätet sichtbare Freigabe.
   Andere Browser bleiben beim Datenstrom.
2. **Unabhängig vom Transport** (`src/hooks/useBuchung.ts`): Jede Buchung meldet zurück, was
   gespeichert wurde, und genau das steht sofort auf dem Schirm — ohne auf den Listener zu
   warten. Ältere Stände, die er verspätet nachliefert, überschreiben es nicht. Ein
   abgebrochener Listener verbindet sich neu. Eine Kopie der Auswahl im Gerätespeicher sorgt
   dafür, dass sie nach dem Neuladen sofort dasteht, auch bevor der Server antwortet und
   auch ohne Netz.

**Grenze:** Sperrt ein iPhone jeglichen Website-Speicher («Alle Cookies blockieren»,
geschlossenes privates Fenster), geht die Sitzung beim Neuladen verloren. Darum bleibt der
Hinweis «Mach jetzt einen Screenshot» auf der Auswahl.

**Nachweis für den Besuchsmorgen selbst:** In der Steuerung → Protokoll → «Pro Gerät» steht
je Gerät die Geräteart. Bei den betroffenen iPhones sollten dort alle vier Slots belegt sein —
die Plätze waren reserviert, sie wurden nur nicht angezeigt.

### Fund 2: Betreuung — erfasste Anmeldungen waren nach dem Speichern weg

- Nach **«+ Anmeldung erfassen»** stehen die **gewählten Kurse als Liste** da (Zeit,
  Bereich, Fach, Zimmer), dazu Name und Personenzahl — mit «Bearbeiten» und «Nächste
  Anmeldung erfassen».
- Neuer Reiter **«Erfasste Anmeldungen»** für beide Rollen: alle am Info-Stand erfassten
  Anmeldungen, live, durchsuchbar nach Name. Antippen → prüfen, **ändern** (Gruppengrösse,
  Kurse, Name) oder **löschen** (mit Rückfrage). Ändern und Löschen laufen je in einer
  Transaktion; die Zähler werden exakt verrechnet (im Emulator nach jedem Schritt geprüft).
  Änderungen kommen ins Protokoll wie die Umbuchung eines Gasts.
- `firestore.rules`: Die Betreuung darf am Info-Stand erfasste Anmeldungen (`quelle ==
  'admin'`) jetzt auch ändern — anlegen und löschen durfte sie schon. Gast-Anmeldungen
  bleiben ausgenommen. Sieben neue Fälle in `scripts/regeltest.mjs`.
- Das Feld «Notiz (freiwillig)» heisst jetzt **«Name»**, weiterhin freiwillig. In der
  Datenbank bleibt der Feldname `notiz`.
- **Fehler behoben:** Wurde im Erfassen-Formular ein Bereich gewählt und danach wieder auf
  «— nichts —» gestellt, scheiterte das Speichern mit «Das hat nicht geklappt» (Firestore
  lehnt `undefined` ab). Im produktiven Stand nachgestellt; jetzt wird der Bereich sauber
  als «nichts gewählt» gespeichert.

---

## 1. Was fertig ist

| Bereich | Zustand |
|---|---|
| Gast-Ablauf: Start → 4 Blöcke → Ticket | ✅ vollständig, mit Live-Platzzahlen |
| Gruppen-Anmeldung 1–4 Personen | ✅ (Entscheid D3) |
| Sperre «gleiches Fach» innerhalb der Blockgruppe | ✅ (Entscheide D1/D2) |
| Blöcke überspringen, Wahl ändern, Plätze freigeben | ✅ |
| Auswahl auf dem Gerät wiederherstellbar | ✅ |
| Freigabeschalter, wirkt serverseitig | ✅ (Entscheid D4) |
| Admin: Live-Dashboard, Anmeldung erfassen, Steuerung | ✅ |
| Steuerung: Titel, Klasse, Zimmer, Lehrperson und Kapazität je Angebot ändern | ✅ seit 26.08. |
| Steuerung: Datum des Anlasses, Bereiche und Angebote anlegen, umbenennen, umlegen, entfernen | ✅ seit 26.08. |
| Öffentliche Nur-Lese-Übersicht `/uebersicht` für die Lehrpersonen | ✅ seit 26.08. |
| Drucken und CSV-Export | ⛔ am 26.08. entfernt — wurde nicht gebraucht |
| Security Rules | ✅ gegen den Emulator geprüft |
| Überbuchungssicherung, automatisiert nachprüfbar | ✅ `npm run andrangtest` (21 Prüfungen) |
| Automatischer Rules-Deploy per GitHub-Action | ✅ |
| Lasttest mit Invariantenprüfung | ✅ |
| Netlify-Deploy aus `main` | ✅ |
| Security Rules prüfen auch die **Form** der Anmeldung (Wahl, Notiz) | ✅ seit 20.08. — [07 §5.2](07-pruefbericht.md) |
| Reserveschalter «Live-Zähler aus» im Browser durchgespielt | ✅ seit 20.08. |
| Ganzer Gast-Ablauf als automatisierter Browsertest | ✅ [07 §4](07-pruefbericht.md) |
| «Deine Auswahl» farblich abgesetzt, letzter Schritt nur noch mit «Abschliessen» | ✅ seit 20.08. |
| Betreuung kann sich selbst ein Konto erstellen (Passwort, Link oder Google) | ✅ seit 20.08. — nur für eingetragene Adressen |
| Protokoll in der Steuerung: pro Gerät und chronologischer Verlauf | ✅ seit 21.08. — abschaltbar, [05 §10](05-last-und-performance.md) |
| Protokoll als aufklappbare Liste, ohne Querlauf auf dem Handy | ✅ seit 22.08. |
| Einzelne Anmeldung löschen — die Plätze werden dabei frei | ✅ seit 22.08. |
| Keine Schattenbuchungen mehr: eigene Gast-Anmeldung wandert ins Konto | ✅ seit 22.08. — [05 §10a](05-last-und-performance.md) |
| App startet ohne Netz — Tab geschlossen, Flugmodus, Aufruf: Anmeldung ist da | ✅ seit 27.08. — Service Worker + Firestore auf der Platte, [02 §8a](02-technisches-konzept.md) |

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
| `node scripts/reset.mjs --ja` | alle Anmeldungen löschen, Protokoll leeren, Zähler auf 0, Anmeldung schliessen |
| `EMULATOR=1 node scripts/lasttest.mjs --clients 150` | Lasttest gegen die Emulator Suite — der Normalfall |
| `node scripts/lasttest.mjs --clients 200 --produktion` | Lasttest gegen die **echte** Datenbank. `--produktion` ist Pflicht, sonst bricht das Skript ab; danach zwingend `reset` |
| `npm run andrangtest` | 21 Prüfungen: Überbuchung und Angriffe eines manipulierten Clients |
| `npm run regeltest` | 57 Prüfungen der Security Rules, startet den Emulator selbst |
| `npm run mailtest` | 45 Prüfungen der Mail- und Zugangsfunktionen (Einladung, Zugangscode, Login erstellen, Bestätigung, Passwort) gegen die Emulator Suite, startet sie selbst ([docs/08](08-bestaetigungsmail.md)) |
| `npm run mailvorschau` | Alle Mails als `mailvorschau.html` ansehen; mit `-- adresse@example.ch` zusätzlich echter Testversand |

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
| react-router | **30-Zeilen-Router** (`src/hooks/useRoute.ts`) | Es gibt drei Pfade (`/`, `/admin`, `/uebersicht`). Eine Bibliothek dafür wären ~15 KB — bei 200 gleichzeitig ladenden Geräten unnötig. |
| Webschrift | **Systemschrift** | Nichts blockiert das erste Zeichnen, kein zusätzlicher Netzaufruf. Die Marke trägt das Logo. |
| Rettungscode am Info-Stand | **entfernt** | Niemand merkt sich einen sechsstelligen Code für den Fall, dass das Handy streikt. Die Auswahl kommt auf demselben Gerät automatisch zurück, ein Screenshot deckt den Rest ab — das spart einen Bildschirmabschnitt, eine Firestore-Sammlung und einen Schreibvorgang je Anmeldung. |
| Selbstheilung fehlender Zähler mit fester Kapazitätsliste | **Kapazität an den Block gebunden** | Die Rules liessen für ein fehlendes Zählerdokument jede Kapazität aus `[20, 35]` zu — ein manipulierter Client hätte einem 20er-Zimmer 35 Plätze verpassen können. Jetzt muss der Blockschlüssel zur Angebots-ID passen und die Kapazität zum Block. `npm run andrangtest` prüft beide Richtungen: der Angriff prallt ab, die ehrliche Selbstheilung funktioniert weiter. |
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
| *20.08.* Realistisch | 150 | ≈ 1.0 × | 573 | **0** | **889 / 889** | **0** |
| *20.08.* Andrang (60 % auf vier Angebote) | 150 | ≈ 1.0 × | 506 | **0** | **749 / 749** | **0** |
| *20.08.* Überlast (Gruppen gleichverteilt 1–4) | 150 | ≈ 2.5 × | 412 | **0** | **970 / 970** | **0** |
| *20.08.* mit verschärften Rules | 150 | ≈ 1.0 × | 573 | **0** | **899 / 899** | **0** |

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
5. Auswahl mit fünf Zeilen (Begrüssung + vier Blöcke) ✓
6. Seite neu laden → Auswahl kommt automatisch zurück ✓
7. `/admin` zeigt die Anmeldung für Lehrpersonen ✓
8. Keine Fehler in der Browserkonsole ✓

Zusätzlich verifiziert:
- Bei **geschlossener Anmeldung** weisen die Security Rules **jede** Buchung ab — die
  Notbremse wirkt serverseitig, nicht nur im Bildschirm. (Aufgefallen, weil ein Testlauf
  nach einem `reset` komplett abgewiesen wurde — genau richtig.)
- Gegen die **Produktionsdatenbank** nach dem Rules-Deploy: `bookings/` unangemeldet lesen →
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
| 8 | Zählerbewegung an die eigene Anmeldung binden — am 25.10. geprüft und wegen des Andrang-Befunds auf **nach dem Event** verschoben, siehe [07 §5.1](07-pruefbericht.md) und [09 §4](09-golive-check.md) | Technik |

Vollständige, nach Dringlichkeit sortierte Listen: **[07 §7 und §8](07-pruefbericht.md)**.
