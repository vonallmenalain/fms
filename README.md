# Besuchsmorgen FMS Neufeld — App-Konzept

Web-App zur Selbst-Anmeldung der Besuchenden am **Besuchsmorgen vom Mittwoch, 28. Oktober 2026**
an der FMS Neufeld, Bremgartenstrasse 133, 3012 Bern.

> **Status:** Die App ist gebaut und läuft — Gast-Ablauf, Admin-Bereich, Security Rules,
> automatischer Deploy. Live auf **[fms.alae.app](https://fms.alae.app)**.
> Was fertig ist, wie man es startet und was noch aussteht:
> **[docs/06-stand-der-umsetzung.md](docs/06-stand-der-umsetzung.md)**.
> Vor der ersten Vorführung geprüft, gemessen und abgehakt:
> **[docs/07-pruefbericht.md](docs/07-pruefbericht.md)**.

## Das Vorhaben in fünf Zeilen

Rund **120 Besuchende** melden sich mit dem eigenen Handy per QR-Code selbstständig für je
**2 Ateliers** (08:50 / 09:20, max. 35 Plätze) und **2 Unterrichtsbesuche** (09:55 / 10:50,
max. 20 Plätze) an. Zuteilung nach **First Come, First Serve**, ohne Namen, ohne Login, ohne
Kontrolle vor Ort. Ergebnis ist ein «Ticket» mit Fach, Zimmer und Zeit, das jederzeit wieder
aufrufbar und änderbar ist. Betreuende Lehrpersonen sehen die Belegung live und können Gäste
ohne Handy selbst eintragen.

| | |
|---|---|
| **Frontend + Hosting** | Vite + React + TypeScript auf **Netlify** — Gratis-Tier |
| **Backend** | **Firebase Firestore** + Firebase Auth (anonym für Gäste, E-Mail für Organisierende) — **Blaze-Tarif**, keine Cloud Functions |
| **Serverkode** | drei Netlify-Funktionen, ausserhalb des Gast-Ablaufs: der Versand der Mails an die Betreuung ([docs/08](docs/08-bestaetigungsmail.md)) |
| **Domain** | `fms.alae.app` |
| **Kosten** | **< CHF 1 für den ganzen Anlass** ([Rechnung](docs/05-last-und-performance.md)) |
| **Aufwand** | **27–29 h**, verteilt auf 8 Phasen |
| **Klickbarer Prototyp** | nach ca. 8 h (Phase 2), noch ganz ohne Datenbank |
| **Belastbarkeit** | im Lasttest mit **150, 200 und 400** gleichzeitigen Clients belegt — Summe der Zähler stimmt jedes Mal exakt, nie überbucht ([Prüfbericht](docs/07-pruefbericht.md)) |

## Die Dokumente

| Datei | Inhalt |
|---|---|
| **[docs/01-fachkonzept.md](docs/01-fachkonzept.md)** | Ziel & Erfolgskriterien, Nicht-Ziele, Rollen, Bildschirm-für-Bildschirm-Ablauf, Gruppenanmeldung, Regeln, Admin-Bereich, Gestaltung & Farben, Datenschutz, **4 offene Entscheide** |
| **[docs/02-technisches-konzept.md](docs/02-technisches-konzept.md)** | Architektur, Technologiewahl mit Begründung, Firestore-Datenmodell, Transaktionslogik gegen Überbuchung, Security Rules, **Quota-Rechnung**, Deployment, Störungsverhalten |
| **[docs/03-umsetzungsplan.md](docs/03-umsetzungsplan.md)** | 8 Phasen mit konkreten Befehlen und Abnahmekriterien, **Terminplan bis zum 28.10.**, Aufwand pro Phase, Risikoliste |
| **[docs/04-eventtag-runbook.md](docs/04-eventtag-runbook.md)** | Ablauf des Morgens, Text der QR-Folie, die 5 häufigsten Supportfälle, Eskalationsstufen, **Papier-Fallback** |
| **[docs/05-last-und-performance.md](docs/05-last-und-performance.md)** | Warum kein Cloud-Functions-Backend, warum Blaze, wie «wirklich live» entsteht, der Engpass bei 200 Geräten, **Lasttest mit Abnahmekriterien**, Leistungsbudget |
| **[data/programm.json](data/programm.json)** | Der Startwert fürs Programm: 14 Atelier- und 24 Lektionsangebote mit Fach, Klasse, Zimmer, Lehrperson, Kapazität — aus der Programm-PPT übernommen. Datum, Bereiche und Angebote sind zur Laufzeit in der Steuerung änderbar |
| **[docs/06-stand-der-umsetzung.md](docs/06-stand-der-umsetzung.md)** | **Was gebaut ist**, lokal starten, Skripte, GitHub-Actions, bewusste Abweichungen vom Konzept, Messwerte |
| **[docs/07-pruefbericht.md](docs/07-pruefbericht.md)** | **Prüfbericht vor der ersten Vorführung:** Stresstest mit 150 Geräten, Browsertest, gefundene Schwachstellen, **ToDo-Listen** und ein Drehbuch für die Vorführung |
| **[docs/08-bestaetigungsmail.md](docs/08-bestaetigungsmail.md)** | **Eigene Mails statt derer von Firebase:** Bestätigungsmail, Anmeldelink und Passwort-Zurücksetzen, wer eine Mail auslösen darf, Einrichtung in Resend/Netlify Schritt für Schritt, Vorschau, Testversand und Fehlersuche |
| **[docs/snippets/](docs/snippets/)** | Entwurfsfassungen aus der Konzeptphase — verbindlich ist der Kode im Repo |

## Schnellstart

```bash
npm install
npm run dev                                    # gegen die echte Datenbank
```

Die Überbuchungssicherung lässt sich jederzeit nachprüfen — sie läuft mit dem echten
Buchungskode aus `src/`, ein Node-Prozess je «Gerät», alle drücken zur selben Millisekunde:

```bash
npx firebase emulators:start --only firestore,auth --project fmsbesuchstag
npm run andrangtest                            # in einem zweiten Terminal
```

Dasselbe gilt für die Zugriffsrechte: `firestore.rules` ist der einzige wirksame Schutz,
also wird geprüft, was der Server erlaubt — nicht, was die Oberfläche anzeigt.

```bash
npm run regeltest                              # startet den Emulator selbst
```

Und die drei Mailfunktionen: Sie laufen bei Netlify in einer eigenen, älteren
Node-Laufzeit als der Bau. Der Test lädt sie mit abgeschaltetem `require(ESM)` — genau
das, was der alten Laufzeit fehlt — und würde sonst erst in der Produktion auffallen:

```bash
npm run funktionstest                          # kein Versand, keine Schlüssel
npm run mailtest                               # der ganze Ablauf gegen die Emulatoren
```

| Pfad | Was |
|---|---|
| `/` | Anmeldung für die Besuchenden |
| `/admin` | Bereich für die Betreuungspersonen |
| `/uebersicht` | Live-Übersicht für die Lehrpersonen — ohne Login, **nur zum Ansehen**, nirgends verlinkt |

### Zugänge

Zwei Rollen: **Betreuung** sieht die Übersicht und erfasst Anmeldungen für Gäste ohne
Handy; **Administration** darf zusätzlich steuern — Freigabeschalter, Meldung an alle,
Programm und Kapazitäten, Protokoll, Zurücksetzen und Zugänge vergeben.

### Übersicht für die Lehrpersonen

`/uebersicht` zeigt dieselbe Live-Übersicht wie der Betreuungsbereich, aber **ohne
Anmeldung und ohne einen einzigen Knopf, der etwas verändert**: keine Erfassung, keine
Kapazitäten, keine Zugänge. Sie liest ausschliesslich die Zähler und das
Steuerungsdokument, und beides ist laut `firestore.rules` ohnehin für alle lesbar.

Die Adresse steht in **Steuerung → Link für die Lehrpersonen** zum Kopieren bereit. Auf
der Anmeldeseite der Gäste ist sie bewusst nirgends verlinkt; die Seite trägt wie die
ganze App ein `noindex`.

### Programm von Hand anpassen

**Steuerung → Programm & Kapazitäten** ändert das ganze Programm im laufenden Betrieb —
jede Änderung ist auf allen Geräten sofort sichtbar, auch bei Gästen, die gerade
auswählen:

- **Datum des Anlasses.** Der Wochentag wird daraus gerechnet. Für den nächsten
  Besuchsmorgen genügt es also, hier den neuen Tag zu setzen; dieselbe App lässt sich
  ohne Deploy wiederverwenden.
- **Bereiche** (Atelier 1, Unterrichtsbesuch 1 …): Titel und Zeiten ändern, neue anlegen,
  bestehende entfernen. Die Bereiche werden nach Anfangszeit sortiert — die früheste
  zuerst —, und diese Reihenfolge ist zugleich der Weg durch die App und die Reihenfolge
  auf dem Ticket.
- **Angebote** je Bereich: Titel, Klasse, Zimmer, Lehrpersonen-Kürzel und Kapazität
  ändern, neue Ateliers bzw. Lektionen anlegen, bestehende entfernen.

Grundlage bleibt `data/programm.json`. In Firestore (`config/programm`) steht nur, was
davon abweicht; darum wirkt eine spätere Korrektur in der Datei weiterhin überall dort,
wo niemand von Hand eingegriffen hat. «Auf Programmdatei zurücksetzen» räumt eine
einzelne Abweichung wieder weg.

Zwei Grenzen sind bewusst gesetzt:

- **Belegtes lässt sich nicht entfernen.** Erst müssen die Plätze frei sein — sonst
  hielte jemand ein Ticket auf ein Angebot, das es nicht mehr gibt.
- **Entfernen heisst ausblenden**, solange es aus der Programmdatei stammt: Unter
  «Ausgeblendet» steht alles Weggenommene und ist mit einem Tipp wieder da.
- Zusätzlich zu den vier Bereichen der Programmdatei sind **acht weitere** möglich. Die
  Security Rules prüfen jeden Blockschlüssel einzeln, und die Regelsprache kennt keine
  Schleifen — darum ein fester Vorrat statt eines freien Feldes.

Erster Zugang: **«Mit Google anmelden»** — die Adresse in `firestore.rules`
(`bootstrapMail`) trägt sich beim ersten Anmelden selbst als Administration ein. Das ist
die einzige Stelle, die dafür einen Deploy braucht.

Alle weiteren: **Steuerung → Zugänge** → Adresse und Rolle eintragen. Auf Wunsch geht
gleich ein Anmeldelink raus; die Person kann sich auch mit Google oder E-Mail und
Passwort anmelden. Freigeschaltet wird sie beim ersten Anmelden automatisch, mit genau
der Rolle aus der Einladung.

Wer noch kein Konto hat, erstellt sich im Login über **«Konto erstellen»** selbst eines —
mit Passwort, per Anmeldelink oder mit Google. Zugang gibt das für sich allein nicht: Es
funktionieren nur Adressen, die hier schon eine Rolle erhalten haben; alle anderen landen
auf «Kein Zugang». Ein Konto mit Passwort muss zusätzlich seine Adresse bestätigen (die
Mail kommt sofort) — die Datenbank verlangt das, damit niemand ein Konto auf eine fremde,
eingeladene Adresse anlegen kann.

Wer sein Passwort vergessen hat, tippt im Login auf **«Passwort vergessen?»**.

**Bestätigungsmail, Anmeldelink und Passwort-Zurücksetzen verschickt die App selbst**:
eigene Gestaltung mit FMS-Logo, Absender auf `alae.app`, Zustellung über Resend. Erzeugt
und geprüft werden die Links weiterhin von Firebase — umgestellt sind nur Aussehen und
Absender. Anmeldelink und Rücksetzlink bekommen dabei nur eingeladene oder bereits
freigeschaltete Adressen, ohne dass die Antwort verrät, welcher Fall vorlag. Einrichtung,
Vorschau und Fehlersuche: **[docs/08-bestaetigungsmail.md](docs/08-bestaetigungsmail.md)**.

> Damit der Anmeldelink eingelöst werden kann, muss in der Firebase-Konsole unter
> Authentication → Sign-in method bei «E-Mail-Adresse/Passwort» auch **E-Mail-Link
> (passwortloses Anmelden)** aktiviert sein, und die Domain unter Settings → Authorized
> domains stehen. Ohne das melden Google und Passwort weiterhin normal an.

## Getroffene Entscheide (19.08.2026)

| # | Frage | Entscheid |
|---|---|---|
| **D1** | Sperre bei den Lektionen | **nur dasselbe Fach** — nicht die Klasse |
| **D2** | Atelier Physik *und* Lektion Physik | **erlaubt** (vorerst; umstellbar ohne Kodeänderung) |
| **D3** | Personen pro Gerät | **max. 4**, zur Laufzeit einstellbar 1–4 |
| **D4** | Freigabe der Anmeldung | **manueller Schalter** in der Admin-Ansicht |
| — | `Franz (WIN)` | **Französisch** |
| — | `TH 1` | **Turnhalle 1**, kein Weghinweis nötig |
| — | Lehrpersonen-Kürzel | **nicht anzeigen** (bleiben in den Daten für interne Listen) |

Alles davon steckt bereits in [`data/programm.json`](data/programm.json) unter `regeln` und `anzeige`.

## Wie die App 200 gleichzeitige Geräte trägt

Die drei Prioritäten — sauber und flüssig, wirklich live, kein Limit — sind in
[docs/05](docs/05-last-und-performance.md) im Detail beantwortet. Die Kurzfassung:

1. **Kein Serverkode zwischen App und Datenbank.** Cloud Functions würden bei 200 Geräten
   bremsen (zusätzliche Runde, Kaltstart 1–3 s, begrenzter Instanzen-Pool), nicht schützen.
   Die Buchung läuft als Firestore-Transaktion direkt aus der App; die Kapazitätsgrenze
   erzwingen die Security Rules.
2. **Blaze-Tarif, aber als Versicherung.** Bei 200 Geräten landet der Verbrauch mit ~50 000
   Lesevorgängen genau auf der Gratis-Kante — und ein erschöpftes Kontingent hiesse: die App hört
   mitten im Anlass auf zu funktionieren. Im Blaze-Tarif kostet der ungünstigste Fall rund
   **0.08 USD**. Dazu ein Budget-Alarm auf CHF 5 / CHF 20.
3. **Der echte Engpass ist nicht das Kontingent, sondern der Andrang auf ein einzelnes
   Angebot.** Dagegen: Vorprüfung aus der Live-Anzeige, Wiederholung mit Streuung, ein Vorgang
   pro Gerät, sauberes Scheitern.
4. **Bewiesen statt behauptet:** Lasttest mit 200 **und** 400 echten Clients gegen dieselben
   Security Rules, mit sieben Abnahmekriterien (L1–L7) — unter anderem «Summe der Zähler
   entspricht exakt den gebuchten Plätzen» und «p95 der Buchungsdauer ≤ 1.5 s».

## Antworten auf die Fragen aus dem Word-Dokument

| Frage | Antwort |
|---|---|
| Anmeldung für mehrere Personen auf einem Gerät? | **Ja** — Gruppengrösse 1–4 auf der Startseite, die Gruppe belegt entsprechend viele Plätze |
| 3–4 Lehrpersonen als Admin, die Gäste eintragen? | **Ja** — eigener Admin-Bereich mit Login, «+ Anmeldung erfassen» |
| Lehrpersonen sehen live, wer wohin kommt? | **Ja** — Live-Dashboard im Betreuungsbereich und ein öffentlicher Nur-Lese-Link (`/uebersicht`) für alle Lehrpersonen. Kostet fast nichts extra |
| Nachvollziehen, welches Gerät wann wie viel gebucht hat? | **Ja** — Protokoll in der Steuerung, pro Gerät und als Verlauf, mit Zahl der Vorgänge. Bremst den Andrang nicht ([Rechnung](docs/05-last-und-performance.md#10-das-protokoll-was-kostet-es-jeden-vorgang-mitzuschreiben)) |
| Was, wenn eine Lehrperson selbst bucht und sich dann anmeldet? | Ihre Anmeldung **wandert ins eigene Konto**, statt als Schattenbuchung liegen zu bleiben ([05 §10a](docs/05-last-und-performance.md)) |
| Slots wieder freigeben und neu buchen? | **Ja** — beim Wechsel wird der alte Platz in derselben Transaktion frei |
| Auswahl wieder aufrufbar? | **Ja** — automatisch auf demselben Gerät |
| Analoge Variante vorbereiten? | **Ja, unbedingt** — 20 Zettel pro Lektion, [Runbook §5](docs/04-eventtag-runbook.md#5-papier-fallback-am-vorabend-vorbereiten-kostet-20-minuten). Kostet 20 Minuten und nimmt allen die Nervosität |
| Support am 28.10., 08:15–08:45? | Eingeplant: **08:00–09:15 online**, danach telefonisch. Das Runbook ist so geschrieben, dass die Lehrpersonen 90 % selbst lösen |

## Beruhigende Zahl zum Schluss

Pro Block stehen **245 Atelier-** bzw. **240 Lektionsplätze** für **120 Gäste** bereit —
gut doppelt so viele Plätze wie Personen. First Come, First Serve trifft also nur einzelne
Publikumslieblinge, nicht die Masse. Genau dafür zeigt die App die freien Plätze live an.
