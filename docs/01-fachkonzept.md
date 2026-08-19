# 01 · Fachkonzept — «Besuchsmorgen FMS Neufeld»

> Web-App zur Selbst-Anmeldung der Besuchenden am Besuchsmorgen
> **Mittwoch, 28. Oktober 2026**, FMS Neufeld, Bremgartenstrasse 133, 3012 Bern.

---

## 1. Ziel in einem Satz

Rund **120 Besuchende** melden sich am Morgen mit dem eigenen Handy in **unter 90 Sekunden**
selbstständig für je **2 Ateliers** und **2 Unterrichtsbesuche** an — ohne Namen, ohne Login,
ohne Personal am Anmeldetisch.

**Erfolgskriterien (messbar, am 28.10. um 09:00 überprüfbar)**

| # | Kriterium | Zielwert |
|---|---|---|
| E1 | Anteil Besuchende mit vollständigem Ticket vor 08:50 | ≥ 90 % |
| E2 | Überbuchte Angebote (mehr Tickets als Kapazität) | **0** |
| E3 | Supportfälle, die eine Lehrperson lösen muss | ≤ 10 |
| E4 | Zeit von QR-Scan bis fertiges Ticket (Median) | ≤ 90 s |
| E5 | Laufende Kosten | CHF 0.— |

## 2. Was die App **nicht** ist (Nicht-Ziele)

Bewusst weggelassen — jede dieser Funktionen kostet Zeit und bringt am Event nichts:

- ❌ Kein Personen-Login, keine Namen, keine E-Mail-Adressen, keine Klassenzuordnung der Gäste
- ❌ **Kein Check-in / keine Ticketkontrolle** vor Ort (Schule: bewusst nicht gewünscht)
- ❌ Keine Warteliste, keine Wunsch-/Prioritätenvergabe, kein Losverfahren → reines First-Come-First-Serve
- ❌ Keine Mehrsprachigkeit (nur Deutsch)
- ❌ Keine native App, kein App-Store, keine Push-Nachrichten
- ❌ Keine Anbindung an kantonale Systeme / kein Kanton-Login (heikel, Schule will das nicht)

## 3. Rollen

| Rolle | Wer | Anzahl | Zugang |
|---|---|---|---|
| **Gast** | Besuchende Schüler:innen (oft in 2er-/3er-Gruppen) | ~120 | QR-Code → offene URL, anonym |
| **Betreuung** | Lehrpersonen am Info-Stand (GN, 2. Etage) | 3–4 | E-Mail + Passwort |
| **Organisation** | Projektleitung Schule | 1–2 | wie Betreuung + Notbremse/Reset |
| **Technik** | Entwickler (du) | 1 | Firebase-Konsole, Netlify, GitHub |

## 4. Ablauf aus Sicht der Gäste

```
QR-Code (Folie in der Aula, 08:15–08:40)
        │
        ▼
 ┌─────────────────┐   fms.alae.app
 │ 0 · Start       │   3 Sätze Erklärung + «Für wie viele Personen?» (1–3)
 └────────┬────────┘
          ▼
 ┌─────────────────┐   7 Ateliers · freie Plätze live · ausgebucht = sichtbar, aber grau
 │ 1 · Atelier 1   │   08:50–09:10
 └────────┬────────┘
          ▼
 ┌─────────────────┐   dieselben 7 · bereits gewähltes Fach gesperrt («schon gewählt»)
 │ 2 · Atelier 2   │   09:20–09:40
 └────────┬────────┘
          ▼
 ┌─────────────────┐   12 Klassen · Fach, Klasse, Zimmer · freie Plätze live
 │ 3 · Lektion 1   │   09:55–10:40
 └────────┬────────┘
          ▼
 ┌─────────────────┐   12 Klassen · bereits gewähltes Fach gesperrt
 │ 4 · Lektion 2   │   10:50–11:35
 └────────┬────────┘
          ▼
 ┌─────────────────┐   4 Karten: Zeit · Fach · Zimmer  +  Rettungscode
 │ 5 · Ticket      │   «Screenshot machen!» · jederzeit wieder aufrufbar
 └─────────────────┘   Buttons: [Einzelne Wahl ändern] [Zimmerlegende]
```

**Wichtige UX-Entscheide**

1. **Ein Schritt pro Bildschirm.** Kein Scrollen durch 38 Angebote, keine Mehrfachauswahl-Logik.
   Ein Tipp auf eine Karte = gebucht = nächster Schritt. Kein «Weiter»-Button.
2. **Sofort buchen, nicht am Schluss.** Jede Wahl wird einzeln in die Datenbank geschrieben.
   Wer bei Schritt 3 abbricht, hat trotzdem seine 2 Ateliers. Kein «Warenkorb», der verfällt.
3. **Überspringen ist erlaubt.** Jeder Schritt hat unten einen unauffälligen Link
   «Diesen Block überspringen» — die Schule schreibt niemandem vor, alle 4 Blöcke zu besuchen.
4. **Ausgebuchtes bleibt sichtbar**, aber ausgegraut mit «ausgebucht» statt Platzzahl.
   (So sieht man, dass es das Fach gibt, und fragt nicht am Info-Stand nach.)
5. **Freie Plätze live**, aber entschärft dargestellt: `12 freie Plätze` · `noch 3 Plätze` (orange)
   · `ausgebucht` (grau). Keine Prozentbalken, kein Countdown — das erzeugt nur Hektik.
6. **Kein Registrierungs-Formular.** Die Anmeldung beginnt mit dem ersten Tipp auf ein Atelier.

## 5. Gruppen-Anmeldung (2–3 Personen auf einem Gerät)

Auf der Startseite: **«Für wie viele Personen meldest du an?» [1] [2] [3] [4]** (Standard 1,
änderbar bis zur ersten Buchung, danach nur noch über «Alles zurücksetzen»).

- Die Gruppe bucht **gemeinsam dieselben Angebote** — sie will ja zusammen hingehen.
- Es werden `n` Plätze pro Angebot belegt. Reichen die freien Plätze nicht für die ganze Gruppe,
  ist die Karte gesperrt mit Hinweis «nur noch 2 Plätze frei — für 4 Personen zu wenig».
- Das Ticket zeigt «Gültig für 4 Personen».
- Obergrenze **4**, zur Laufzeit auf 1–4 einstellbar (`config/app.maxPlaetzeProGeraet`) — die
  Security Rules erzwingen 4 als absolute Decke, unabhängig von der Einstellung. Das schützt
  zugleich vor versehentlicher oder mutwilliger Massenbuchung.

## 6. Regeln (verbindlich)

| Regel | Festlegung | Herkunft |
|---|---|---|
| Kapazität Atelier | **35** Plätze | Word-Doc §5 |
| Kapazität Lektion | **20** Plätze | Word-Doc §5 |
| Zuteilung | First Come, First Serve — kein Losverfahren | Word-Doc §5 |
| Doppelwahl Ateliers | dasselbe **Fach** nicht zweimal (A1 ≠ A2) | Word-Doc §3 · Entscheid **D1** |
| Doppelwahl Lektionen | dasselbe **Fach** nicht zweimal (L1 ≠ L2) — nicht die Klasse | Entscheid **D1** |
| Atelier vs. Lektion | **erlaubt** — Atelier Physik + Lektion Physik geht | Entscheid **D2** |
| Gruppengrösse pro Gerät | 1–4, zur Laufzeit einstellbar | Entscheid **D3** |
| Freigabe der Anmeldung | manueller Schalter in der Admin-Ansicht | Entscheid **D4** |
| Pflicht zur Wahl | **keine** — jeder Block darf leer bleiben | Word-Doc §5 |
| Änderungen | jederzeit möglich, alter Platz wird sofort frei | Word-Doc §5 |
| Kontrolle vor Ort | keine; Ticket muss nicht gezeigt werden | Word-Doc §5 |
| Personendaten | keine — kein Name, keine Mail, kein Geburtsdatum | Word-Doc §4 |

**Rechnerische Reserve:** 7 × 35 = **245** Atelierplätze und 12 × 20 = **240** Lektionsplätze
pro Block, bei 120 Gästen. Es gibt also global **doppelt so viele Plätze wie Gäste** — Engpässe
entstehen nur bei einzelnen Publikumslieblingen (erfahrungsgemäss Psychologie, Sport, Musik,
Chemie). Genau dafür ist die Live-Anzeige da.

## 7. Betreuungs-/Admin-Ansicht

Erreichbar unter `fms.alae.app/admin`, nicht verlinkt, Login mit E-Mail + Passwort.

**7.1 Dashboard (Live)**
Vier Spalten (A1 · A2 · L1 · L2), pro Angebot eine Zeile:
`Fach · Klasse · Zimmer · ████████░░ 16/20`. Sortierbar nach «am vollsten».
Aktualisiert sich in Echtzeit, ohne Neuladen. Genau das, was im Word-Doc als «Luxus» steht.

**7.2 Person ohne Handy eintragen** (der wichtigste Admin-Fall)
Gleicher 4-Schritt-Flow wie für Gäste, aber:
- Startet über den Button **«+ Anmeldung erfassen»**
- Freies Notizfeld statt Name (z. B. `Gruppe Frau Meier`, `3 SuS ohne Handy`) — kein Klarname nötig
- Am Schluss: Ticket als **grosse Druckansicht** → abfotografieren lassen oder vorlesen

**7.3 Ticket eines Gasts wiederfinden / reparieren**
Eingabe des **6-stelligen Rettungscodes** vom Ticket (z. B. `K7F2QP`) → Buchung anzeigen,
ändern oder löschen. Löst den Fall «Handy leer / Browserdaten gelöscht / anderes Gerät».

**7.4 Notbremse & Steuerung**
- `Anmeldung offen / geschlossen` (Schalter) — z. B. erst ab 08:40 öffnen
- Freitext-Banner für alle Gäste (z. B. «Sport findet in TH 2 statt»)
- Kapazität eines einzelnen Angebots ad hoc erhöhen (z. B. 20 → 24)
- **Druckansicht** aller Angebote mit Belegung → für den Info-Stand auf Papier

**7.5 Export**
Ein Klick → CSV mit `Block, Fach, Klasse, Zimmer, Lehrperson, Belegt, Kapazität`.
Für die Nachbesprechung und als Papier-Backup um 08:45.

## 8. Gestaltung

**Marke.** Logo «fms | NEUFELD» + Claim «der ort für alltagsheld:innen».
Aus dem Original-Logo gemessen: Schwarz = `#1D1D1B`. Das Grün des Claims ist im gelieferten
Logo (S/W) nicht enthalten und **muss aus dem CI-Manual übernommen werden** — im Konzept mit
`#B4BD00` als Platzhalter geführt.

| Token | Wert | Verwendung |
|---|---|---|
| `--fms-schwarz` | `#1D1D1B` | Text, Logo, Schrift auf grünen Flächen |
| `--fms-gruen` | `#B4BD00` * | Grosse Flächen, Buttons, aktive Karte |
| `--fms-gruen-dunkel` | `#6E7500` | Text/Links auf Weiss (Kontrast 5.0 : 1 ✔) |
| `--fms-grau` | `#F1F1F1` | Kartenhintergrund, ausgebuchte Angebote |
| `--fms-orange` | `#B35C00` | «nur noch wenige Plätze» |

\* Platzhalter — vor Phase 2 durch den CI-Wert ersetzen.

**Kontrast-Regel (wichtig, sonst ist die App im Sonnenlicht unlesbar):**
`#B4BD00` auf Weiss ergibt nur 2.05 : 1 — **ungenügend für Text**. Deshalb:
grüne Flächen immer mit **schwarzer** Schrift (8.3 : 1 ✔), grüner Text nur in `--fms-gruen-dunkel`.

**Layout.** Mobile first, eine Spalte, Tap-Ziele ≥ 56 px hoch, Schriftgrösse ≥ 17 px,
keine Hover-Effekte, kein Dark-Mode-Sonderfall (App erzwingt Hell). Fortschritt oben als
«Schritt 2 von 4». Auf Desktop einfach zentriert bei max. 560 px Breite — die Admin-Ansicht
ist die einzige echte Desktop-Ansicht.

**Sprache.** Nur Deutsch, «du»-Form, kurze Sätze. Schweizer Rechtschreibung (ss statt ß).

**Was auf einer Angebots-Karte steht.** Bewusst knapp — drei Zeilen, mehr nicht:

```
  Musik                     ← Fach, gross
  29Fc · GN -1.57           ← Klasse und Zimmer, kleiner und grau
  14 freie Plätze           ← Live-Zahl, feste Breite
```

**Ohne Lehrpersonen-Kürzel** (Entscheid der Schule). Sie bleiben in `data/programm.json`
erhalten, weil sie für die internen Listen und den Info-Stand nützlich sind, werden den Gästen
aber nirgends angezeigt — gesteuert über `anzeige.lehrpersonKuerzel: false`.
Bei den Ateliers entfällt die Klasse, dort steht nur Fach und Zimmer.
«TH 1» wird als **«Turnhalle 1»** ausgeschrieben.

## 9. Barrierefreiheit (Minimum, aber echt)

- Bedienbar mit Tastatur; jede Karte ist ein `<button>`, kein `div` mit Click-Handler
- `aria-live` auf der Platzzahl, damit Screenreader die Änderung mitbekommen
- Ausgebucht wird **nicht nur** durch Graustufe signalisiert, sondern durch das Wort «ausgebucht»
- Keine reinen Farbcodes (rot/grün) als einzige Information

## 10. Datenschutz (DSG/DSGVO-tauglich, weil es nichts zu schützen gibt)

- **Keine Personendaten.** Gespeichert werden nur: anonyme Geräte-ID, Gruppengrösse,
  4 Angebots-IDs, Zeitstempel.
- Die anonyme ID ist eine Firebase-Zufalls-ID, keinem Menschen zuordenbar.
- Keine Analytics, kein Google Analytics, keine Cookies ausser dem technisch nötigen
  Auth-Token im Local Storage → **kein Cookie-Banner nötig**.
- Kurzer Datenschutz-Absatz (5 Zeilen) verlinkt auf der Startseite.
- **Löschung:** Alle Buchungen werden 7 Tage nach dem Event gelöscht (Skript `npm run reset`).
- Serverstandort Firestore: **`eur3` (europe-west)** wählen — Daten bleiben in der EU.

## 11. Getroffene Entscheide

Alle am 19.08.2026 durch die Schule entschieden — damit ist die Fachseite vollständig geklärt.

| # | Frage | **Entscheid** | Auswirkung |
|---|---|---|---|
| **D1** | Was gilt bei Lektionen als «schon gewählt»? | **nur dasselbe Fach** — nicht die Klasse | Wer 28Fb Pädagogik in Block 1 wählt, sieht 28Fa Pädagogik in Block 2 gesperrt. Verschiedene Klassen mit verschiedenen Fächern bleiben frei wählbar. |
| **D2** | Atelier Physik **und** Lektion Physik? | **erlaubt** (vorerst) | Die Sperre wirkt nur *innerhalb* der Ateliers und *innerhalb* der Lektionen, nie quer darüber. Umstellbar über `dedupeGruppen` in `data/programm.json`, ohne Kodeänderung. |
| **D3** | Max. Personen pro Gerät | **4**, einstellbar 1–4 | `config/app.maxPlaetzeProGeraet` ist zur Laufzeit änderbar (Admin-Ansicht), die Security Rules erzwingen 4 als harte Decke. |
| **D4** | Freigabe der Anmeldung | **manueller Schalter** | Kein Zeitplan, keine Automatik: Die Organisation schaltet frei, wenn die QR-Folie erscheint — und kann jederzeit wieder schliessen. |

**Ebenfalls geklärt (Programmdaten):**

| Frage | Antwort | umgesetzt in `data/programm.json` |
|---|---|---|
| `Franz (WIN)` | **Französisch** | `l1-27fa` → `"fach": "Französisch"` |
| `TH 1` | **Turnhalle 1**, kein Weghinweis nötig | `l2-27fd` → `"raum": "Turnhalle 1"`, `"raumKurz": "TH 1"` |
| Lehrpersonen-Kürzel | **nicht anzeigen** | `anzeige.lehrpersonKuerzel: false`; Daten bleiben für interne Listen erhalten |

> Wird die Sperre bei D2 später doch gewünscht, ist es ein Eintrag in `dedupeGruppen`:
> beide Blockpaare in **eine** Gruppe legen. Keine Kodeänderung, ein Commit.
