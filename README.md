# Besuchsmorgen FMS Neufeld — App-Konzept

Web-App zur Selbst-Anmeldung der Besuchenden am **Besuchsmorgen vom Mittwoch, 28. Oktober 2026**
an der FMS Neufeld, Bremgartenstrasse 133, 3012 Bern.

> **Status:** Die App ist gebaut und läuft — Gast-Ablauf, Admin-Bereich, Security Rules,
> automatischer Deploy. Live auf **[fms.alae.app](https://fms.alae.app)**.
> Was fertig ist, wie man es startet und was noch aussteht:
> **[docs/06-stand-der-umsetzung.md](docs/06-stand-der-umsetzung.md)**.

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
| **Domain** | `fms.alae.app` |
| **Kosten** | **< CHF 1 für den ganzen Anlass** ([Rechnung](docs/05-last-und-performance.md)) |
| **Aufwand** | **27–29 h**, verteilt auf 8 Phasen |
| **Klickbarer Prototyp** | nach ca. 8 h (Phase 2), noch ganz ohne Datenbank |
| **Belastbarkeit** | im Lasttest mit **200 und 400** gleichzeitigen Clients belegt (Phase 6) |

## Die Dokumente

| Datei | Inhalt |
|---|---|
| **[docs/01-fachkonzept.md](docs/01-fachkonzept.md)** | Ziel & Erfolgskriterien, Nicht-Ziele, Rollen, Bildschirm-für-Bildschirm-Ablauf, Gruppenanmeldung, Regeln, Admin-Bereich, Gestaltung & Farben, Datenschutz, **4 offene Entscheide** |
| **[docs/02-technisches-konzept.md](docs/02-technisches-konzept.md)** | Architektur, Technologiewahl mit Begründung, Firestore-Datenmodell, Transaktionslogik gegen Überbuchung, Security Rules, **Quota-Rechnung**, Deployment, Störungsverhalten |
| **[docs/03-umsetzungsplan.md](docs/03-umsetzungsplan.md)** | 8 Phasen mit konkreten Befehlen und Abnahmekriterien, **Terminplan bis zum 28.10.**, Aufwand pro Phase, Risikoliste |
| **[docs/04-eventtag-runbook.md](docs/04-eventtag-runbook.md)** | Ablauf des Morgens, Text der QR-Folie, die 5 häufigsten Supportfälle, Eskalationsstufen, **Papier-Fallback** |
| **[docs/05-last-und-performance.md](docs/05-last-und-performance.md)** | Warum kein Cloud-Functions-Backend, warum Blaze, wie «wirklich live» entsteht, der Engpass bei 200 Geräten, **Lasttest mit Abnahmekriterien**, Leistungsbudget |
| **[data/programm.json](data/programm.json)** | Das vollständige Programm: 14 Atelier- und 24 Lektionsangebote mit Fach, Klasse, Zimmer, Lehrperson, Kapazität — aus der Programm-PPT übernommen |
| **[docs/06-stand-der-umsetzung.md](docs/06-stand-der-umsetzung.md)** | **Was gebaut ist**, lokal starten, Skripte, GitHub-Actions, bewusste Abweichungen vom Konzept, Messwerte |
| **[docs/snippets/](docs/snippets/)** | Entwurfsfassungen aus der Konzeptphase — verbindlich ist der Kode im Repo |

## Schnellstart

```bash
npm install
npm run dev                                    # gegen die echte Datenbank
```

| Pfad | Was |
|---|---|
| `/` | Anmeldung für die Besuchenden |
| `/admin` | Bereich für die betreuenden Lehrpersonen |

Erster Admin-Zugang: **«Mit Google anmelden»** — die Adresse in `firestore.rules`
(`bootstrapMail`) trägt sich beim ersten Login selbst als Betreuung ein.

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
| Lehrpersonen sehen live, wer wohin kommt? | **Ja** — Live-Dashboard, Druckansicht und CSV-Export. Kostet fast nichts extra |
| Slots wieder freigeben und neu buchen? | **Ja** — beim Wechsel wird der alte Platz in derselben Transaktion frei |
| Auswahl wieder aufrufbar? | **Ja** — automatisch auf demselben Gerät |
| Analoge Variante vorbereiten? | **Ja, unbedingt** — 20 Zettel pro Lektion, [Runbook §5](docs/04-eventtag-runbook.md#5-papier-fallback-am-vorabend-vorbereiten-kostet-20-minuten). Kostet 20 Minuten und nimmt allen die Nervosität |
| Support am 28.10., 08:15–08:45? | Eingeplant: **08:00–09:15 online**, danach telefonisch. Das Runbook ist so geschrieben, dass die Lehrpersonen 90 % selbst lösen |

## Beruhigende Zahl zum Schluss

Pro Block stehen **245 Atelier-** bzw. **240 Lektionsplätze** für **120 Gäste** bereit —
gut doppelt so viele Plätze wie Personen. First Come, First Serve trifft also nur einzelne
Publikumslieblinge, nicht die Masse. Genau dafür zeigt die App die freien Plätze live an.
