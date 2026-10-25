# 09 · GoLive-Check vor dem 28. Oktober 2026

**Stand Sonntag, 25.10.2026, drei Tage vor dem Anlass.** Vollständiger Durchgang durch den
Stand auf `main` (= das, was auf fms.alae.app läuft): Kode, Security Rules, Lasttests mit
200 Clients, Browsertest der Live-Site, Zustand der Produktionsdatenbank. Dazu das Ergebnis
eines Versuchs, die letzte bekannte Schwachstelle in den Rules zu schliessen — und warum er
bewusst nicht ausgerollt wird.

---

## 1. Die Kurzfassung

**Ja, die App ist bereit — mit vier Dingen, die vor Mittwoch noch zu tun sind (§5).**

Der Kern hält, nachweislich und mit dem Stand, der live ist: Zwei Lastläufe mit je 200
gleichzeitigen Clients gegen die echten Security Rules, dazu 20 Geräte auf exakt dieselbe
Millisekunde — in jedem Lauf stimmte die Summe der Zähler exakt mit den gebuchten Plätzen
überein, kein Angebot wurde überbucht, kein einziger harter Fehler.

Zwei Dinge wurden geändert, beide ohne Berührung von Layout oder Bedienung (§3):
der Reserveschalter «Live-Zähler aus» lud die Platzzahlen aus dem Zwischenspeicher statt
vom Server, und die Meldung bei der Anmelde-Drosselung nennt jetzt den Ausweg (Mobilfunk).

Das grösste Restrisiko liegt **nicht in der App**, sondern im Gast-WLAN der Schule
(gemeinsame IP, Anmelde-Drosselung) — dazu §5 und §6.

---

## 2. Was geprüft wurde

### 2.1 Kode und Rules (Stand `main`, Commit 64d7440)

| Was | Ergebnis |
|---|---|
| `npm run typecheck`, `npm run build` | grün · Gast-Bündel 198 KB gzip (Firebase 136, React 45, App 12.5, CSS 4) |
| Security Rules auf `main` = Rules in Produktion | **ja** — letzter «Firebase»-Workflow am 14.09. erfolgreich, letzte Rules-Änderung vom 26.08. |
| `npm run regeltest` | **87 / 87** |
| `npm run andrangtest` (echter `src/`-Buchungskode, 20 Geräte gleichzeitig, manipulierter Client) | **21 / 21** |
| Lasttest 200 Clients, realistisch (Gruppen meist 1–2, 15 % auf dieselben Angebote) | 609 Buchungen · **0 Fehler** · L1 **962 / 962** · L2/L3 0 Fälle · L6 (fremde Änderung sichtbar) p95 **379 ms** |
| Lasttest 200 Clients, Andrang (60 % auf vier Angebote, 0.8 s Bedenkzeit) | 508 Buchungen · 277 sauber «ausgebucht» · **0 Fehler** · L1 **903 / 903** · L6 p95 **265 ms** |
| L5 Buchungsdauer p50 / p95 | 63–127 ms / ≈ 3 s — wie in [07 §3](07-pruefbericht.md) erklärt eine Grenze des Testrechners (200 Clients + Emulator auf einer Maschine), nicht von Firestore |

### 2.2 Live-Site fms.alae.app (Browser, iPhone-Format, über das Netz)

- Ausgeliefert ist exakt der Bau von `main` (gleiche Dateistempel, Service-Worker-Stand `ecc0657dff6f`).
- Seite lädt, Startseite nach 4 s inkl. Logo (durch einen Proxy gemessen, am Handy schneller),
  **keine Fehler oder Warnungen in der Konsole**.
- Service Worker aktiv, Zwischenspeicher `fms-ecc0657dff6f` angelegt, Firestore-Speicher in IndexedDB
  vorhanden — die Offline-Fassung funktioniert.
- `preconnect` zu Firestore und Firebase Auth greift; die Firestore-Verbindung steht vor dem ersten Tipp.
- HTTP-Kopfzeilen wie in `netlify.toml`: `sw.js` und `index.html` mit `max-age=0`, Bündel `immutable`.
- `/api/*` (Mailfunktionen) antwortet — betrifft nur die Betreuung, nicht den Gast-Ablauf.

### 2.3 Produktionsdatenbank (nur gelesen)

| | Stand 25.10., 20:00 Uhr |
|---|---|
| `config/app` | **anmeldungOffen: true** · liveZaehler: true · maxPlaetzeProGeraet: 4 · programmVersion 2026-08-20 (= Bündel) |
| `slots` | 38 Zähler, alle `belegt: 0`, Kapazitäten 35 / 20 wie im Programm |
| `config/programm` | Zimmer und Kürzel von Hand angepasst (z. B. Psychologie GN 2.53, Humanbiologie A2 GN 2.52) — wirkt bei Gästen, Betreuung und Übersicht |
| `bookings`, `log`, `admins`, `codes` ohne Anmeldung | **403** — wie vorgesehen |

> **Die Anmeldung steht zurzeit auf OFFEN.** Wer den Link heute schon hat, kann buchen. Das
> gehört vor dem Anlass auf «geschlossen» (siehe §5, Punkt 1).

---

## 3. Was geändert wurde

| # | Was | Warum |
|---|---|---|
| 1 | **Reserveschalter «Live-Zähler aus» liest vom Server** (`src/hooks/useSlots.ts`) | Seit der Firestore-Zwischenspeicher auf der Platte liegt (Offline-Fassung vom 27.08.), liefert ein Listener seinen ersten Schnappschuss aus dem Zwischenspeicher. Der Reserveschalter meldete den Listener nach genau diesem ersten Schnappschuss ab — die Gäste sahen die Platzzahlen vom letzten Besuch, nie den aktuellen Stand. Jetzt `getDocs()`: zuerst der Server, nur ohne Netz der Zwischenspeicher. Im Browsertest gegen den Emulator nachgestellt (fremde Buchung, Reserveschalter um, neu laden → Serverstand sichtbar). |
| 2 | **Meldung bei Anmelde-Drosselung nennt den Ausweg** (`src/App.tsx`) | Die Drosselung von Firebase Auth gilt je IP-Adresse; im Gast-WLAN teilen sich alle eine. «WLAN kurz ausschalten und über Mobilfunk anmelden» ist dann der schnellste Weg — vorher stand nur «in ein paar Sekunden nochmals tippen». |

Beides ohne Auswirkung auf Gestaltung, Layout oder Eingaben.

---

## 4. Versucht und bewusst nicht ausgerollt: Zähler an die eigene Anmeldung binden

Die eine bekannte Schwachstelle der Rules ([07 §5.1](07-pruefbericht.md)): Ein manipulierter
Client darf einen Zähler innerhalb der Grenzen (0 … Kapazität, ± 4) bewegen, ohne dort zu
buchen. Die Lösung aus 07 wurde heute gebaut:

```
// zaehlerGedeckt(slotId, blk, vorher, neu) — belegen: vorher nicht gewählt, nachher gewählt,
// Schritt = Gruppengrösse; freigeben: umgekehrt. get() = Anmeldung vor der Transaktion,
// getAfter() = Anmeldung danach. Nur bei offener Anmeldung; Betreuung ausgenommen.
allow update: if belegtImRahmen()
  && ((angemeldet() && anmeldungOffen()
       && zaehlerGedeckt(slotId, resource.data.block, resource.data.belegt, request.resource.data.belegt))
      || istBetreuung());
```

**Regeltest: 100 / 100** (13 neue Prüfungen, darunter alle drei Angriffe aus 07 §5.1 und die
Fälle buchen, wechseln, freigeben, Info-Stand). Danach der Andrangtest mit dem echten Kode:

| Test | mit der Bindung |
|---|---|
| 20 Geräte gleichzeitig auf 8 Plätze | **0 gebucht, 20 × «abgelehnt»** (permission-denied) |
| 10 Dreiergruppen auf 8 Plätze | bestanden |
| ehrliches Gerät allein | bestanden |
| Lasttest 200 Clients realistisch | 610 Buchungen, **2 × permission-denied**, L1 967 / 967 |
| Lasttest 200 Clients Andrang | 393 Buchungen, 0 Fehler, L1 931 / 931 |

**Der Befund:** Firestore wertet die Rules gegen den Serverstand *zum Zeitpunkt des Commits*
aus. Haben zwischen dem Lesen und dem Commit andere Geräte denselben Zähler bewegt — der
Normalfall bei einem Publikumsliebling um 08:36 —, stimmt der exakte Schritt gegen
`resource.data.belegt` nicht mehr, die Regel sagt «nein», und der Server antwortet mit
`permission-denied`. Die bisherige Regel prüft nur Grenzen, die auch auf dem veränderten
Stand noch gelten; darum fällt sie durch auf den Transaktionsabbruch (`aborted`), den das
SDK von selbst bis zu fünfmal wiederholt — unsichtbar für die Person am Handy. Bei
`permission-denied` wiederholt der Client bewusst nicht (das ist der Code für «Anmeldung
geschlossen»), die Person sähe «Das hat der Server abgelehnt».

**Entscheid:** Nicht drei Tage vor dem Anlass, nicht an der Regel, an der jede Buchung hängt.
Die Schwachstelle braucht Absicht, Entwicklerwerkzeuge und Kenntnis des Datenmodells; sie
führt nie zu einem Absturz, und sie ist erkennbar (`pruefe`, L1) und reparierbar
(Kapazität korrigieren oder «Alles zurücksetzen»).

**Weg nach dem Event**, in dieser Reihenfolge: (a) `permission-denied` im Buchungspfad wie
`aborted` behandeln — wiederholen, erst nach der Leiter als «geschlossen» melden — und die
Bindung erneut gegen `andrangtest` fahren; oder (b) die Zähler auf `FieldValue.increment()`
umstellen, dann sieht die Regel den tatsächlichen Stand nach dem Schreiben, ganz ohne
Lesen-Ändern-Schreiben und damit ohne Andrang auf das Dokument. Beides ist Arbeit für eine
ruhige Woche, nicht für einen Sonntagabend. Die geprüfte Fassung der Regel und des Regeltests
liegen in der Sitzung bereit und sind in [07 §5.1](07-pruefbericht.md) skizziert.

---

## 5. Vor Mittwoch — die Checkliste

| # | Was | Wer | Wann |
|---|---|---|---|
| **1** | **Anmeldung schliessen und Datenbank zurücksetzen:** GitHub → Actions → «Firebase» → `reset`. Löscht Probe-Anmeldungen und Protokoll, setzt alle Zähler auf 0 **und schliesst die Anmeldung**. Sie wird erst um 08:35 in der Aula geöffnet (Steuerung oder Action `anmeldung-oeffnen`). Heute steht sie auf OFFEN. | Technik | Dienstagabend |
| **2** | **Diesen Stand ausrollen und auf Netlify veröffentlichen.** Merge nach `main` baut nur; wegen «Stop auto publishing» muss der Deploy in Netlify von Hand veröffentlicht werden. Danach **keine weiteren Deploys am Mittwochmorgen** — ein offener Tab würde beim Nachladen des Betreuungs-Bündels auf alte Dateistempel laufen. | Technik | Montag/Dienstag |
| **3** | **Blaze-Tarif bestätigen + Budget-Alarm** (CHF 5 / 20). Ohne Blaze hört die App bei erschöpftem Gratis-Kontingent (50 000 Lesevorgänge/Tag) mitten im Anlass auf. Die Rechnung aus [05 §3](05-last-und-performance.md) landet realistisch genau auf dieser Kante. Von aussen nicht prüfbar — bitte in der Firebase-Konsole nachsehen. | Schule / Alain | vor Dienstag |
| **4** | **QR-Folie: Mobilfunk bevorzugen, WLAN nur als Ergänzung.** Firebase drosselt anonyme Neuanmeldungen je IP-Adresse; im Gast-WLAN teilen sich alle Geräte eine. Die App verteilt die Anmeldungen über die Auswahlzeit und nennt jetzt den Ausweg — aber die Folie und die Ansage («es hat für alle Platz, nehmt euch Zeit») sind die wirksamere Massnahme. | Organisation | Folie |
| 5 | Am Vorabend: `pruefe` (Action) — muss L1–L3 bestanden zeigen. Am Eventtag gegen 09:00 nochmals. | Technik | 27./28.10. |
| 6 | Papier-Fallback nach [Runbook §5](04-eventtag-runbook.md). | Schule | Vorabend |
| 7 | Betreuungspersonen melden sich **nicht** auf dem Handy an, mit dem sie selbst gebucht haben — oder gehen danach einmal auf die Hauptseite, dann wandert die Anmeldung ins Konto. | Betreuung | Runbook |

---

## 6. Was nicht prüfbar war — und was es bedeutet

| | |
|---|---|
| **Anmelde-Drosselung im Schul-WLAN** | Nur vor Ort messbar. Vom Rechenzentrum aus greift sie sofort, darum lief der Lasttest gegen den Emulator. Am Eventtag: 120–200 Anmeldungen verteilt über 10–20 Minuten sind ≈ 10–20 je Minute von einer IP — deutlich unter dem, was im August gesperrt wurde (150 in 20 Sekunden). Über Mobilfunk besteht das Problem gar nicht. |
| **Echte Latenz von 200 Handys** | Nicht messbar ohne 200 Anschlüsse. Was zählt, ist belegt: die Korrektheit unter Andrang (L1–L4), und dass fremde Buchungen in unter 0.5 s sichtbar sind (L6). Die Buchung selbst ist eine Runde zu Firestore; der lange Schwanz im Test ist die gewollte Wiederholungsleiter (120 / 300 / 700 / 1500 ms), nicht die Datenbank. |
| **Verbrauch (L7)** | Firebase-Konsole → Nutzung, am Eventtag beobachten. Erwartung: ≈ 50 000 Lesevorgänge für 200 Geräte. |

### Kleinigkeiten, bewusst nicht angefasst (Gestaltung bleibt)

- Beim allerersten Laden steht für den Bruchteil einer Sekunde «Die Anmeldung ist noch nicht
  offen», bis `config/app` vom Server da ist (Voreinstellung «geschlossen» ist die sichere
  Seite). Am Handy ≈ 300 ms, wiederkehrende Geräte haben den Stand im Zwischenspeicher.
- Die Betreuungs-Übersicht sortiert live nach Belegung und springt deshalb im Andrang um
  (07 §6, Punkt 5).
- Ein Gerät aus der Vorführung im September findet nach dem `reset` keine Anmeldung mehr und
  beginnt einfach auf der Startseite — so soll es sein.

---

## 7. Wie man alles selbst nachprüft

```bash
npm ci
npm run typecheck && npm run build
npm run regeltest                                   # 87 Prüfungen, startet den Emulator selbst

npx firebase-tools@^14 emulators:start --only firestore,auth --project fmsbesuchstag
npm run andrangtest                                 # 21 Prüfungen mit dem echten Buchungskode
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed.mjs --oeffnen
EMULATOR=1 node scripts/lasttest.mjs --clients 200
EMULATOR=1 node scripts/lasttest.mjs --clients 200 --heiss 0.6 --denkzeit 800
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/pruefe.mjs
```
