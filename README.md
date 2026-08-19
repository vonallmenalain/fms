# Besuchsmorgen FMS Neufeld — App-Konzept

Web-App zur Selbst-Anmeldung der Besuchenden am **Besuchsmorgen vom Mittwoch, 28. Oktober 2026**
an der FMS Neufeld, Bremgartenstrasse 133, 3012 Bern.

> **Status:** Konzept — noch kein Code. Nächster Schritt: die vier Entscheide **D1–D4**
> ([01-fachkonzept §11](docs/01-fachkonzept.md#11-offene-entscheide)) klären, danach Phase 1.

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
| **Backend** | **Firebase Firestore** + Firebase Auth (anonym) — Spark-Plan, keine Kreditkarte |
| **Domain** | `fms.alae.app` |
| **Laufende Kosten** | **CHF 0.—** ([Rechnung](docs/02-technisches-konzept.md#6-kapazitäts--und-kostenrechnung-gratis-plan)) |
| **Aufwand** | **26–28 h**, verteilt auf 8 Phasen |
| **Klickbarer Prototyp** | nach ca. 8 h (Phase 2), noch ganz ohne Datenbank |

## Die Dokumente

| Datei | Inhalt |
|---|---|
| **[docs/01-fachkonzept.md](docs/01-fachkonzept.md)** | Ziel & Erfolgskriterien, Nicht-Ziele, Rollen, Bildschirm-für-Bildschirm-Ablauf, Gruppenanmeldung, Regeln, Admin-Bereich, Gestaltung & Farben, Datenschutz, **4 offene Entscheide** |
| **[docs/02-technisches-konzept.md](docs/02-technisches-konzept.md)** | Architektur, Technologiewahl mit Begründung, Firestore-Datenmodell, Transaktionslogik gegen Überbuchung, Security Rules, **Quota-Rechnung**, Deployment, Störungsverhalten |
| **[docs/03-umsetzungsplan.md](docs/03-umsetzungsplan.md)** | 8 Phasen mit konkreten Befehlen und Abnahmekriterien, **Terminplan bis zum 28.10.**, Aufwand pro Phase, Risikoliste |
| **[docs/04-eventtag-runbook.md](docs/04-eventtag-runbook.md)** | Ablauf des Morgens, Text der QR-Folie, die 5 häufigsten Supportfälle, Eskalationsstufen, **Papier-Fallback** |
| **[data/programm.json](data/programm.json)** | Das vollständige Programm: 14 Atelier- und 24 Lektionsangebote mit Fach, Klasse, Zimmer, Lehrperson, Kapazität — aus der Programm-PPT übernommen |
| **[docs/snippets/](docs/snippets/)** | Startfertige `firestore.rules`, `netlify.toml`, `seed.mjs`, `.env`-Vorlage |

## Die vier Entscheide, die jetzt anstehen

| # | Frage | Vorschlag |
|---|---|---|
| **D1** | Was gilt bei den Lektionen als «schon gewählt» — dieselbe Klasse oder dasselbe Fach? | dasselbe **Fach** |
| **D2** | Darf jemand Atelier Physik **und** Lektion Physik wählen? | **ja** — verschiedene Formate |
| **D3** | Wie viele Personen darf ein Gerät anmelden? | **3** |
| **D4** | Wann wird die Anmeldung freigeschaltet? | **08:35**, per Schalter, wenn die QR-Folie erscheint |

Dazu drei kleine Rückfragen zu den Programmdaten (siehe [01-fachkonzept §11](docs/01-fachkonzept.md#11-offene-entscheide)):
`Franz (WIN)` → «Französisch»? · `TH 1` → Turnhalle 1, Weg dorthin? · Lehrpersonen-Kürzel anzeigen
oder ausgeschriebene Namen?

## Antworten auf die Fragen aus dem Word-Dokument

| Frage | Antwort |
|---|---|
| Anmeldung für 2–3 Personen auf einem Gerät? | **Ja** — Gruppengrösse auf der Startseite, die Gruppe belegt entsprechend viele Plätze |
| 3–4 Lehrpersonen als Admin, die Gäste eintragen? | **Ja** — eigener Admin-Bereich mit Login, «+ Anmeldung erfassen» |
| Lehrpersonen sehen live, wer wohin kommt? | **Ja** — Live-Dashboard, Druckansicht und CSV-Export. Kostet fast nichts extra |
| Slots wieder freigeben und neu buchen? | **Ja** — beim Wechsel wird der alte Platz in derselben Transaktion frei |
| Ticket wieder aufrufbar? | **Ja** — automatisch auf demselben Gerät, plus 6-stelliger Rettungscode für den Notfall |
| Analoge Variante vorbereiten? | **Ja, unbedingt** — 20 Zettel pro Lektion, [Runbook §5](docs/04-eventtag-runbook.md#5-papier-fallback-am-vorabend-vorbereiten-kostet-20-minuten). Kostet 20 Minuten und nimmt allen die Nervosität |
| Support am 28.10., 08:15–08:45? | Eingeplant: **08:00–09:15 online**, danach telefonisch. Das Runbook ist so geschrieben, dass die Lehrpersonen 90 % selbst lösen |

## Beruhigende Zahl zum Schluss

Pro Block stehen **245 Atelier-** bzw. **240 Lektionsplätze** für **120 Gäste** bereit —
gut doppelt so viele Plätze wie Personen. First Come, First Serve trifft also nur einzelne
Publikumslieblinge, nicht die Masse. Genau dafür zeigt die App die freien Plätze live an.
