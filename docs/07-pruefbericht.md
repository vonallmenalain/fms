# 07 · Prüfbericht vor der ersten Vorführung

**Stand 20.08.2026.** Vollständiger Durchgang durch die App vor der ersten Vorführung bei
einer Lehrperson: Stresstest mit 150 gleichzeitigen Geräten, automatisierter Browsertest
des ganzen Gast-Ablaufs, gezielte Suche nach Schwachstellen in den Security Rules — und
die Liste dessen, was vorher noch erledigt werden sollte.

---

## 1. Die Kurzfassung

**Ja, das kann man zeigen.** Der Kern — Anmelden ohne Überbuchung — hält, und zwar
nachweislich: In vier Lastläufen mit je 150 gleichzeitigen Geräten stimmte die Summe der
Zähler **jedes Mal exakt** mit den gebuchten Plätzen überein, kein Angebot wurde je
überbucht, kein einziger harter Fehler.

Gefunden und **behoben** wurden fünf Dinge (§2). Eines davon war deutlich sichtbar: Beim
allerersten Tipp auf eine Karte verschwand die ganze Angebotsliste für einen halben
Sekundenbruchteil hinter «Einen Moment …» — ausgerechnet in dem Moment, in dem alle
gleichzeitig loslegen.

Offen bleiben Dinge, die sich **nicht am Schreibtisch** klären lassen: die echte Latenz
gegen die Produktionsdatenbank, das Gast-WLAN der Schule, und die Frage, ob Firebase die
anonyme Anmeldung von der gemeinsamen Schul-IP drosselt. Für die Vorführung bei einer
einzelnen Lehrperson spielt nichts davon eine Rolle.

---

## 2. Was in diesem Durchgang geändert wurde

| # | Was | Warum |
|---|---|---|
| 1 | **Klick aufs Logo führt auf die Startseite** | Gewünscht. Auf der Übersicht ist das Logo jetzt ein Knopf (Tippfeld 150 × 47 px), auf der Startseite bleibt es ein Bild — kein toter Knopf. Der Handy-Zurück-Knopf führt danach korrekt zurück. |
| 2 | **Fusszeile: «Login Betreuungspersonen»** | Gewünscht. |
| 3 | **Kein ganzseitiger Ladebildschirm mehr beim ersten Tipp** | Beim ersten Buchen meldet sich das Gerät an; dadurch begann die eigene Anmeldung zu laden und die Sperre für den Erstaufbau schlug ein zweites Mal zu. Im Browsertest mit 150 ms Mobilfunk-Latenz war die Angebotsliste dadurch **524 ms lang komplett weg** und kam danach zurück. Jetzt gilt der Ladebildschirm nur noch für den allerersten Aufbau. |
| 4 | **«Alle Plätze freigeben» meldet die Wahrheit** | Ist die Anmeldung inzwischen geschlossen, weist der Server die Freigabe ab. Vorher meldete die App trotzdem «Alle Plätze wurden freigegeben» und warf die Person auf die Startseite — wo ihre Auswahl weiterhin stand. |
| 5 | **Kurzmeldungen verschwinden wieder** | Der 4.2-Sekunden-Zeitgeber startete bei jedem Neuzeichnen neu. Auf der Auswahlseite zeichnet jede fremde Buchung neu — im Andrang wäre eine Meldung nie mehr weggegangen. |
| 6 | **«Alles zurücksetzen» in Portionen** | Ein Firestore-Stapel fasst 500 Vorgänge. Nach ein paar Proberunden ohne Zurücksetzen wäre ausgerechnet der Aufräum-Knopf gescheitert — jetzt schickt er in Portionen zu 400 und meldet Fehler, statt still zu scheitern. |
| 7 | **Security Rules prüfen die Form der Anmeldung** | Der Server nahm bisher jede Wahl an: erfundene Angebots-IDs, fremde Blockschlüssel, eine Notiz mit 200 000 Zeichen (≈ 195 KB, die jede Betreuungsperson live mitlädt). Jetzt muss die Angebots-ID zum Block passen und die Notiz ≤ 300 Zeichen sein. **Sieben neue Prüfungen** in `npm run regeltest`. |
| 8 | **Lasttest kann nicht mehr versehentlich die Produktion treffen** | `npm run lasttest` lief bisher ohne Rückfrage gegen die echte Datenbank und hätte dort hunderte Anmeldungen hinterlassen. Jetzt braucht es ausdrücklich `--produktion`. |
| 9 | **`preconnect` und `noscript` in `index.html`** | DNS + TLS zu Firestore und Firebase Auth werden schon beim Laden aufgebaut statt erst beim ersten Zugriff. Auf einem kalten Mobilfunkanschluss spart das eine Rundreise. |

Alle Änderungen sind durch die bestehenden Testläufe abgedeckt: `npm run regeltest`
(36 Prüfungen), `npm run andrangtest` (21 Prüfungen), Lasttest, Browsertest.

---

## 3. Stresstest: 150 gleichzeitige Geräte

Vier Profile, je 150 echte Firebase-Clients mit anonymer Anmeldung gegen die Emulator
Suite — **mit den echten Security Rules und derselben Transaktionslogik** wie am
Eventtag. Fünf zusätzliche Clients hören nur zu und messen, wie schnell fremde
Buchungen ankommen.

| Profil | Buchungen | vorab gesperrt | «ausgebucht» | **harte Fehler** | **L1 Summe** | **L2 überbucht** | L5 p50/p95/p99 | L6 p95 |
|---|---|---|---|---|---|---|---|---|
| **1** Realistisch (Gruppen meist 1–2, 15 % gezielt auf dieselben Angebote) | 573 | 0 | 55 | **0** | **889 / 889** | **0** | 44 / 2820 / 3767 ms | 417 ms |
| **2** Andrang (60 % stürzen sich auf dieselben vier Angebote, kurze Bedenkzeit) | 506 | 0 | 107 | **0** | **749 / 749** | **0** | 93 / 2920 / 5514 ms | 1321 ms |
| **3** Überlast (Gruppen 1–4 gleichverteilt, ≈ 2.5-fache Nachfrage) | 412 | 121 | 116 | **0** | **970 / 970** | **0** | 44 / **441** / 1400 ms | 771 ms |
| **4** Abschlusslauf mit den verschärften Rules aus §2 | 573 | 0 | 60 | **0** | **899 / 899** | **0** | 74 / 2418 / 4679 ms | 559 ms |

Dazu: `npm run andrangtest` **21/21** (20 Geräte auf 8 Plätze → exakt 8 gebucht,
12 sauber «ausgebucht»; 10 Dreiergruppen auf 8 Plätze → 6 belegt, die 2 Restplätze
bleiben frei statt halb vergeben; zehn Angriffe eines manipulierten Clients abgewiesen).
`npm run regeltest` **36/36**.

### Was diese Zahlen sagen — und was nicht

**Belastbar ist die Korrektheit.** L1 bis L4 sind unabhängig vom Testrechner: Entweder
stimmt die Summe der Zähler mit den gebuchten Plätzen überein oder nicht. Sie stimmte in
jedem der vier Läufe exakt, auch bei zweieinhalbfacher Nachfrage und mit 60 % der Geräte
gezielt auf dieselben vier Angebote.

**Nicht belastbar sind die Latenzen (L5).** 150 Firebase-Clients in einem Node-Prozess
plus die Java-basierte Emulator Suite teilen sich hier vier Kerne, und die Emulator Suite
ist *ein* Prozess — die echte Datenbank verteilt Dokumente über viele Maschinen. Genau das
zeigt Profil 3: Sobald die Vorprüfung greift (121 Geräte tippen erst gar nicht, weil die
Anzeige zu wenig Plätze zeigt), fällt p95 von 2.8 s auf **441 ms**. Der lange Schwanz ist
also die gewollte Wiederholungsleiter (120/300/700/1500 ms mit Streuung) und die
Ressourcengrenze des Testrechners, nicht Firestore.

**Was die Zahlen für den Eventtag bedeuten.** Die vier Massnahmen gegen den Andrang
greifen messbar in dieser Reihenfolge:

1. Die **Vorprüfung aus der Live-Anzeige** ist mit Abstand die wirksamste — sie hat in
   Profil 3 121 Transaktionen verhindert, bevor sie entstanden sind.
2. Die **Wiederholung mit Streuung** fängt den Rest ab: 0 harte Fehler in allen vier
   Läufen, obwohl in Profil 2 107 Geräte auf ein volles Angebot gestossen sind.
3. Ein **Vorgang pro Gerät** verhindert, dass sich ein Gerät selbst behindert.
4. **Sauberes Scheitern**: Wer zu spät kommt, sieht «leider gerade eben ausgebucht» und
   wählt weiter — keine Fehlerseite, kein Neuladen, keine verlorene Auswahl.

> **Die eigentliche Zahl zur Beruhigung:** Pro Block gibt es 245 bzw. 240 Plätze für
> 120 erwartete Gäste. Der Lasttest fuhr 150 Geräte mit im Mittel 1.6 Personen —
> also ≈ 240 Personen auf 245 Plätze, **doppelt so viel Nachfrage wie real erwartet**.

### Was noch nicht gemessen ist

| | |
|---|---|
| **Echte Latenz** | L5/L6 gegen die Produktionsdatenbank, von einem gewöhnlichen Anschluss aus. Aus einem Rechenzentrum geht das nicht: Dort greift die Anmelde-Drosselung sofort (siehe [05 §5a](05-last-und-performance.md)). |
| **Anmelde-Drosselung im Schul-WLAN** | Firebase drosselt anonyme Neuanmeldungen **pro IP**. Im Gast-WLAN teilen sich alle Geräte eine IP. Nur vor Ort messbar — gehört in die Generalprobe. |
| **Verbrauch (L7)** | Firebase-Konsole → Nutzung, gegen die Rechnung in [05 §3](05-last-und-performance.md). Für 150 Geräte rund 37 000 Lesevorgänge, also innerhalb des Gratis-Kontingents von 50 000. |

---

## 4. Was der Browsertest gefunden hat

Automatisiert gegen die Emulator Suite, Chromium im iPhone-Format, teils mit
nachgebildeter Mobilfunk-Latenz von 150 ms.

**Bestanden (22 von 23 Prüfungen; die eine Abweichung ist ein Artefakt der Testumgebung,
die `apis.google.com` sperrt — das betrifft nur die Google-Anmeldung im Betreuungsbereich):**

- Startseite, Gruppengrösse, alle vier Blöcke, Übersicht mit fünf Zeilen
- Sperre «gleiches Fach» in der zweiten Runde (Entscheid D1)
- **Neu:** Logo → Startseite → «Meine Auswahl ansehen» → Übersicht, und der
  Handy-Zurück-Knopf führt sauber zurück
- Neu laden stellt die Auswahl wieder her
- **Notbremse:** Bei geschlossener Anmeldung fehlt der Startknopf; wird der Schalter
  umgelegt, erscheint er **ohne Neuladen** auf allen Geräten
- **Meldung an alle:** Banner erscheint und verschwindet live
- **Ausgebucht:** volles Angebot ist markiert und nicht antippbar
- **Reserveschalter «Live-Zähler aus»** (die Notbremse für den Eventtag, die bisher nie
  im Browser gelaufen ist): Liste erscheint, Platzzahlen werden einmalig geladen, fremde
  Buchungen aktualisieren bewusst nicht mehr, **Buchen funktioniert unverändert**, auch
  über einen Blockwechsel hinweg. Keine JavaScript-Fehler.

**Zwei Befunde, die kein Fehler sind, aber am Morgen stolpern lassen:**

| Befund | Wirkung | Umgang |
|---|---|---|
| **Betreuungs-Login auf einem Gerät, das schon eine Gast-Anmeldung hat** | Firebase kann pro Browser nur eine Sitzung führen. Die Google-/E-Mail-Anmeldung ersetzt die anonyme — die Gast-Anmeldung hängt danach an einer uid, die dieses Gerät nicht mehr hat. **Das Ticket ist weg, die Plätze bleiben belegt** und lassen sich vom Gerät aus nicht mehr freigeben. | Für die Vorführung: zwei Geräte oder zwei Browser (eines normal, eines im privaten Fenster). Am Eventtag betrifft es nur Betreuungspersonen, die sich vorher selbst angemeldet haben — gehört ins Runbook. Aufräumen: «Steuerung → Alles zurücksetzen». |
| **Neu laden ohne Netz** | Solange der Tab offen bleibt, ist die Übersicht offline lesbar (Firestore-Zwischenspeicher). Ein **Neuladen** ohne Verbindung zeigt die Fehlerseite des Browsers — die App ist dann gar nicht da. | Deshalb steht «Mach jetzt einen Screenshot» auf der Übersicht. Eine echte Offline-Fassung bräuchte einen Service Worker (§6, Kür). |

---

## 5. Schwachstellen

Gefunden mit einer gezielten Sonde, die als angemeldeter Gast am App-Kode vorbei
schreibt. Sortiert nach Schwere.

### 5.1 Zähler lassen sich verschieben, ohne dort gebucht zu haben — **offen**

Die Regel für `slots` prüft nur die Grenzen (0 … Kapazität) und die Schrittweite (± 4).
Sie prüft **nicht**, ob die schreibende Person dort wirklich einen Platz hat. Gemessen:

- Ein Angebot mit 30 belegten Plätzen liess sich **in 8 Schreibvorgängen auf 0 drücken** —
  die Plätze, die 30 Leute schon haben, sehen danach wieder frei aus. Buchen dann weitere
  Personen, sitzen am Ende mehr Leute im Zimmer als Stühle da sind.
- Umgekehrt liess sich ein leeres Angebot **in 9 Schreibvorgängen auf «ausgebucht»
  füllen** — es steht für alle als voll da, obwohl niemand dort ist.
- Beides funktioniert auch bei **geschlossener** Anmeldung: Der Freigabeschalter wird nur
  beim Schreiben der Anmeldung geprüft, nicht beim Zähler.

**Einordnung.** Das braucht Absicht, Entwicklerwerkzeuge und Kenntnis des Datenmodells —
kein Versehen, kein Gast mit einem normalen Handy. Die Überbuchungssicherung gegen den
*normalen* Betrieb ist davon unberührt: Alle Läufe in §3 belegen das.

**Erkennen:** `npm run pruefe` meldet es sofort — L1 (Summe der Zähler = Summe der
gebuchten Plätze) stimmt dann nicht mehr. Am Eventtag einmal vor der Freigabe und einmal
gegen 10:00 laufen lassen.
**Reparieren:** «Steuerung → Alles zurücksetzen», oder die betroffene Kapazität von Hand
korrigieren.

**Richtige Lösung** (ToDo §7): Die Zählerbewegung an die eigene Anmeldung binden. In den
Rules gibt es dafür `getAfter()`, das den Zustand *nach* der Transaktion liefert:

```
// Skizze — nicht ungeprüft einspielen
function meineWahlNachher(blk) {
  return getAfter(/databases/$(database)/documents/bookings/$(request.auth.uid))
           .data.wahl[blk];
}
allow update: if angemeldet()
  && nurGeaendert(['belegt'])
  && ... bisherige Grenzen ...
  && (istBetreuung()                              // erfasst mit eigener Dokument-ID
      || (request.resource.data.belegt > resource.data.belegt
            ? meineWahlNachher(resource.data.block) == slotId       // belegen
            : meineWahlNachher(resource.data.block) != slotId));    // freigeben
```

Kostet zwei zusätzliche Lesevorgänge je Buchung (vernachlässigbar) und muss gegen
`npm run andrangtest` **und** einen Lastlauf geprüft werden — es ist die Regel, an der
das ganze Buchen hängt. **Nicht direkt vor der Vorführung anfassen.**

### 5.2 Behoben: Form der Anmeldung war ungeprüft

War möglich, ist jetzt abgewiesen (siehe §2, Punkt 7, und die neuen Prüfungen in
`npm run regeltest`):

| War möglich | Wirkung | Jetzt |
|---|---|---|
| Notiz mit 200 000 Zeichen (≈ 195 KB je Dokument) | Jede Betreuungsperson lädt das live mit; bei mehreren solchen Anmeldungen wird die Übersicht zäh und der Verbrauch steigt | ≤ 300 Zeichen |
| Erfundene Angebots-ID in der eigenen Wahl | Betreuungsliste zeigt eine leere Zeile | ID muss zum Block passen |
| Fremde Blockschlüssel (`a3`, `xyz`) | Datenmüll | nur `a1`, `a2`, `l1`, `l2` |

### 5.3 Die Sperre «gleiches Fach» wirkt nur im Bildschirm — **bewusst offen**

Ein manipulierter Client kann Psychologie in beiden Ateliers belegen. Das ist eine
Fairness-Regel (Entscheid D1), keine Sicherheitsregel: Es entsteht keine Überbuchung, die
Person nimmt nur sich selbst die Abwechslung. Serverseitig durchsetzbar wäre es, kostet
aber Regelkomplexität an derselben heiklen Stelle wie 5.1. Empfehlung: zusammen mit 5.1
angehen oder bewusst so lassen.

### 5.4 Kleinigkeiten

| Was | Wirkung |
|---|---|
| Beim Anlegen des eigenen Betreuungs-Kontos wird nicht geprüft, dass `email` zur eigenen Anmeldung passt | Eine eingeladene Betreuungsperson könnte eine fremde Adresse eintragen und so beim Entfernen eines fremden Zugangs mitgenommen werden. Braucht einen bereits eingeladenen Innentäter — sehr geringes Gewicht. |
| `blockKapazitaet()` in den Rules hat 35/20 fest eingebaut | Stimmt heute mit `data/programm.json` exakt überein (geprüft). Bekäme ein einzelnes Angebot eine andere Kapazität, würde nur die Selbstheilung eines *fehlenden* Zählers falsch — und die greift nur, wenn `seed` nicht gelaufen ist. Beim Ändern von Kapazitäten also beides anfassen. |
| Kein CSP-Header | Netlify setzt bereits `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Ein CSP wäre die Kür — muss aber gegen eine Deploy-Vorschau geprüft werden, weil Firebase eigene Hosts braucht. |

---

## 6. Was noch optimiert werden könnte

**Geprüft und verworfen:** Das Bündel lässt sich nicht sinnvoll verkleinern. Getestet
wurden das Aufteilen ohne feste Firebase-Gruppe (169.9 statt 170.1 KB) und ein leichteres
`initializeAuth` statt `getAuth` (−0.3 KB). Die 112 KB des Firebase-SDK sind schlicht der
Preis für Firestore-Listener und Transaktionen. Die jetzige Aufteilung ist die bessere,
weil `firebase` und `react` über Deploys hinweg denselben Namen behalten und im Zwischen-
speicher liegen bleiben.

| Kritischer Pfad für Gäste (gzip) | |
|---|---|
| Firebase (App + Auth + Firestore) | 112.3 KB |
| React | 44.6 KB |
| App-Kode | 9.9 KB |
| CSS + HTML | 4.2 KB |
| **Total** | **≈ 171 KB** (Ziel ≤ 200 KB) |
| Admin-Bereich, nur für Betreuung nachgeladen | 6.5 KB |

**Was echte Wirkung hätte, in dieser Reihenfolge:**

1. **Anmeldung vorwärmen** (halbe Sekunde beim ersten Tipp). Heute meldet sich das Gerät
   erst beim ersten Tipp auf eine Karte an — das kostet dort eine zusätzliche Rundreise
   (im Test 1.3 s statt 0.8 s bis die Wahl steht). Man könnte die Anmeldung schon beim
   Tipp auf «Los geht’s» im Hintergrund starten; sie läuft dann während der Lesezeit der
   ersten Liste. **Aber:** Genau diese Verzögerung ist die wirksamste Massnahme gegen die
   Anmelde-Drosselung pro IP ([05 §5a](05-last-und-performance.md)) — sie verteilt die
   Anmeldungen über die Auswahlzeit. Der Abstand zwischen «Los geht’s» und dem ersten
   Kartentipp ist nur die Lesezeit einer Liste, also 5–20 Sekunden. **Entscheid gehört
   dir; erst nach der Generalprobe sinnvoll, wenn die Drosselschwelle im Schul-WLAN
   bekannt ist.**
2. **Logo auch auf der Auswahlseite.** Dort gibt es heute gar keinen Kopf — mitten im
   Ablauf kommt man nur über den Handy-Zurück-Knopf zurück auf die Startseite. Wäre eine
   kleine Ergänzung, verschiebt aber die feststehende Navigationszeile.
3. **Rückmeldung beim zweiten Tipp.** Tippt jemand eine zweite Karte an, während die
   erste noch bucht, passiert sichtbar nichts (die Sperre «ein Vorgang pro Gerät»
   schluckt den Tipp). Richtig wäre: alle Karten kurz sperren, nicht nur die angetippte.
4. **Bildschirmwechsel für Screenreader ansagen.** Nach «Weiter» springt die Seite nach
   oben, aber der Fokus bleibt stehen — wer vorliest, merkt den Wechsel nicht. Dazu:
   `Schritt N von 4` steht als `h3` über dem `h1` des Blocks, die Überschriftenordnung
   stimmt also nicht.
5. **Sortierung in der Betreuungs-Übersicht einfrieren.** Sie sortiert nach Belegung und
   springt deshalb im Andrang live um — genau das, was auf der Gastseite bewusst
   vermieden wurde.
6. **«Anmeldung erfassen»:** Ändert man die Personenzahl nach der Auswahl, bleibt eine zu
   knappe Wahl stehen und das Speichern scheitert erst am Server. Und die Sperre
   «gleiches Fach» gilt dort nicht.
7. **Service Worker.** Damit ein Neuladen ohne Netz noch die Übersicht zeigt statt der
   Fehlerseite des Browsers. Echte Zusatzarbeit — der Screenshot-Hinweis deckt den Fall
   heute pragmatisch ab.

---

## 7. ToDo vor der Vorführung bei der Lehrperson

| # | Was | Wer | Aufwand |
|---|---|---|---|
| **1** | **Diesen Stand ausrollen.** Branch `claude/app-teacher-demo-prep-g0v6s0` nach `main` — Netlify baut, die GitHub-Action «Firebase» rollt die verschärften Rules aus. | Technik | 5 min |
| **2** | **Anmeldung öffnen.** Actions → «Firebase» → `reset-und-oeffnen`. Setzt gleichzeitig alle Zähler auf 0, damit die Lehrperson eine leere App sieht. | Technik | 2 min |
| **3** | **Zwei Geräte oder zwei Browser bereitlegen**, falls auch der Betreuungsbereich gezeigt wird — sonst schluckt der Login die eigene Gast-Anmeldung (§4). | — | — |
| **4** | **Zugang für die Lehrperson**, falls sie selbst hineinschauen soll: Steuerung → Zugänge → Adresse, Rolle «Betreuung». Der Anmeldelink geht direkt raus. | Alain | 2 min |
| **5** | **Das CI-Grün ansprechen.** `#B4BD00` in `src/index.css` ist noch ein gemessener Platzhalter. Am besten selbst erwähnen, bevor es jemand bemerkt — und gleich nach dem Original fragen. | Alain | — |
| **6** | **Danach: Actions → «Firebase» → `reset`.** Löscht die Vorführ-Anmeldungen und schliesst die Anmeldung wieder. | Technik | 2 min |

### Kleines Drehbuch für die Vorführung

1. QR-Code oder Link auf dem eigenen Handy öffnen → Startseite, Gruppengrösse 2.
2. Durch die vier Blöcke tippen. Dabei zeigen: die **freien Plätze stehen live** auf jeder
   Karte, dasselbe Fach ist in der zweiten Runde **gesperrt**, ein volles Angebot ist
   **nicht antippbar**.
3. Übersicht: fünf Zeilen inklusive Begrüssung, jede Zeile ist **antippbar zum Ändern**.
4. **Logo antippen** → zurück auf die Startseite, dort steht jetzt «Meine Auswahl ansehen».
5. Auf dem zweiten Gerät `/admin` öffnen: Live-Dashboard — die eben gebuchten Plätze sind
   **sofort** da. Kurz «+ Anmeldung erfassen» für Gäste ohne Handy zeigen.
6. Der stärkste Moment: **Steuerung → Anmeldung schliessen.** Auf dem Gast-Handy
   verschwindet der Startknopf **ohne Neuladen**. Wieder öffnen — er kommt zurück.
   Dann «Meldung an alle Gäste» senden, der Banner erscheint auf dem anderen Gerät.
7. Zum Schluss: Drucken und CSV-Export in der Übersicht.

---

## 8. ToDo vor dem 28. Oktober

Aus [06 §8](06-stand-der-umsetzung.md) übernommen und um die Funde dieses Durchgangs
ergänzt.

| # | Was | Wer | Wann |
|---|---|---|---|
| **1** | **Zähler an die eigene Anmeldung binden** (§5.1) — mit `getAfter()`, danach `andrangtest` + Lastlauf. Wenn es Zeitdruck gibt: weglassen und stattdessen `pruefe` am Eventtag zweimal laufen lassen. | Technik | vor der Generalprobe |
| **2** | **Latenztest gegen die echte Datenbank** von einem gewöhnlichen Anschluss aus: `node scripts/lasttest.mjs --clients 200 --produktion`, danach zwingend `reset`. Erst dann sind L5 und L6 belastbar. | Technik | September |
| **3** | **Generalprobe mit ~20 echten Handys im Gast-WLAN.** Der einzige belastbare Test für die Anmelde-Drosselung pro IP. | beide | Oktober |
| **4** | **Gast-WLAN mit der Schul-IT klären**: Verbindungszahl *und* gemeinsame öffentliche IP. Auf die QR-Folie: **Mobilfunk bevorzugen**, WLAN nur als Ergänzung. | beide | September |
| **5** | **Blaze-Tarif + Budget-Alarm** auf CHF 5 / CHF 20. Ohne Blaze hört die App bei erschöpftem Gratis-Kontingent mitten im Anlass auf zu funktionieren. | Schule | vor der Generalprobe |
| **6** | **CI-Grün aus dem Original-Logo.** Eine Zeile in `src/index.css`. | Schule | jederzeit |
| **7** | **Runbook ergänzen:** «Betreuungspersonen melden sich nicht auf dem Handy an, mit dem sie selbst gebucht haben» (§4). | Alain | Oktober |
| **8** | **Papier-Fallback vorbereiten** — 20 Zettel je Lektion, [Runbook §5](04-eventtag-runbook.md). Kostet 20 Minuten und nimmt allen die Nervosität. | Schule | Vorabend |
| **9** | **Am Vorabend:** `reset`, danach Anmeldung geschlossen lassen bis 08:35. | Technik | 27.10. |
| **10** | Die Kür aus §6 (Logo auf der Auswahlseite, Screenreader-Ansage, Sortierung einfrieren, Service Worker) — nur, wenn Zeit übrig ist. | — | — |

---

## 9. Wie man alles selbst nachprüft

```bash
npm install
npm run typecheck && npm run build          # Typen und Bündelgrössen

npm run regeltest                           # 36 Prüfungen der Security Rules,
                                            # startet den Emulator selbst

npx firebase-tools emulators:start --only firestore,auth --project fmsbesuchstag
npm run andrangtest                         # 21 Prüfungen: Überbuchung + Angriffe

FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed.mjs --oeffnen
EMULATOR=1 node scripts/lasttest.mjs --clients 150
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/pruefe.mjs   # L1–L3

# Härtere Profile
EMULATOR=1 node scripts/lasttest.mjs --clients 150 --heiss 0.6 --denkzeit 800
EMULATOR=1 node scripts/lasttest.mjs --clients 150 --maxgruppe 4
```

Gegen die echte Datenbank verlangt der Lasttest jetzt ausdrücklich `--produktion`.
