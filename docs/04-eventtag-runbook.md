# 04 · Runbook für den 28. Oktober 2026

Eine Seite, die man ausdruckt und den 3–4 Lehrpersonen am Info-Stand in die Hand gibt.

## 1. Zeitplan des Morgens

| Zeit | Was passiert | Wer macht was |
|---|---|---|
| 07:45 | Technik: Firebase-Konsole (Nutzung) öffnen, Verbrauch notieren, App auf 2 Geräten testen | Technik |
| 08:00 | Support online und erreichbar | Technik |
| 08:15 | Begrüssung in der Aula durch die Schulleitung | Schulleitung |
| **08:35** | **QR-Folie einblenden** + Admin schaltet `Anmeldung offen` ein (manueller Schalter, D4) | Organisation |
| 08:35–08:50 | Anmeldephase, 3–4 Lehrpersonen im Saal und am Info-Stand | Betreuung |
| 08:45 | Admin druckt/exportiert die Belegungsliste (Papier-Backup) | Betreuung |
| 08:50 | Atelier 1 startet | — |
| 09:15 | Support-Fenster endet, Technik bleibt per Telefon erreichbar | Technik |
| 11:35 | Ende, Admin exportiert CSV für die Auswertung | Betreuung |

## 2. Was auf der QR-Folie steht

```
        ANMELDUNG BESUCHSMORGEN

           [ QR-Code, min. 8 cm ]

              fms.alae.app

  1. QR scannen oder Adresse eintippen
  2. Ateliers und Lektionen wählen
  3. Screenshot vom Ticket machen!

  Ohne mobile Daten:  WLAN «Gast-…»  ·  Passwort: …
  Fragen? → Info-Stand, Gebäude Nord, 2. Etage
```

Zusätzlich mündlich ansagen — das entschärft 80 % der Hektik:
> «Es hat für alle Platz — mehr als doppelt so viele Plätze wie Personen. Nehmt euch Zeit.
> Wer zu zweit, zu dritt oder zu viert unterwegs ist, meldet sich auf **einem** Handy für alle an.»

Die Aufforderung «nehmt euch Zeit» ist nicht nur nett gemeint: Sie verteilt 200 gleichzeitige
Zugriffe auf zwei Minuten statt auf zwei Sekunden — wirksamer als jede technische Optimierung.

## 3. Die fünf häufigsten Supportfälle

| Symptom | Lösung (dauert < 30 Sekunden) |
|---|---|
| «Ich habe kein Handy» | Admin → **+ Anmeldung erfassen** → Auswahl → Gästen aufschreiben oder abfotografieren lassen |
| «Meine Auswahl ist weg» | Seite über `fms.alae.app` erneut öffnen — die Auswahl kommt auf demselben Gerät automatisch zurück. Sonst: Admin → **+ Anmeldung erfassen** neu erfassen |
| «Das Fach ist ausgebucht» | Nachbar-Angebot vorschlagen; im Notfall Admin → Kapazität +2 (Zimmergrösse beachten!) |
| «Ich will wechseln» | In der Auswahl **Ändern** tippen — der alte Platz wird sofort frei |
| «Wir sind zu viert» | Startseite → «Für wie viele Personen?» → **1 bis 4**, danach gemeinsam wählen |

## 4. Wenn etwas grösser schiefgeht

**Stufe 1 — Es ist langsam / Zähler stocken**
Admin → `Live-Zähler` ausschalten. Platzzahlen zeigen dann «Stand 08:47» statt live.
Buchen funktioniert unverändert. → halbiert die Last sofort.

**Stufe 2 — Buchen schlägt bei mehreren Personen fehl**
Firebase-Konsole → *Nutzung*. Dank Blaze-Tarif kann kein Kontingent mehr auslaufen — es wird
abgerechnet statt abgeschaltet. Bleibt also: ein Rules-Fehler (sichtbar in der Browserkonsole
eines betroffenen Geräts) oder Andrang auf ein einzelnes, fast volles Angebot. Im zweiten Fall
zeigt das Admin-Dashboard das betroffene Angebot sofort — Kapazität um 2 erhöhen oder die Leute
auf ein Nachbarangebot lenken.

**Stufe 3 — Nichts geht mehr**
Admin → `Anmeldung geschlossen` + Banner «Bitte beim Info-Stand melden», dann Papier (§5).

### 4.5 Jemand braucht kurzfristig Zugang

Administration → **Steuerung → Zugänge** → Adresse eintragen, Rolle **Betreuung**,
«Anmeldelink sofort per E-Mail schicken» angehakt lassen. Die Person öffnet den Link auf
ihrem Gerät und ist drin. Wer nur betreut, sieht die Steuerung gar nicht — es kann also
niemand versehentlich die Anmeldung schliessen oder alles zurücksetzen.

## 5. Papier-Fallback (am Vorabend vorbereiten, kostet 20 Minuten)

Ja — vorbereiten. Er kostet fast nichts und nimmt allen Beteiligten die Nervosität.

- **Pro Lektion 20 Zettel**, pro Atelier 35 Zettel, je mit Fach · Klasse · Zimmer · Zeit
  (ohne Lehrpersonen-Kürzel, gleich wie in der App)
- 38 Bündel mit Gummiband, beschriftet, in 4 Kisten (A1 · A2 · L1 · L2)
- Wer einen Zettel nimmt, hat den Platz. Ist ein Bündel leer, ist das Angebot ausgebucht.
  **Exakt dieselbe Logik wie die App** — das macht den Umstieg trivial.
- Zusätzlich: **die Belegungsliste von 08:45 ausgedruckt** — damit lässt sich der Papierbetrieb
  auch mitten im Morgen auf dem aktuellen Stand fortsetzen.

## 6. Nach dem Event

- [ ] CSV-Export sichern (Belegung pro Angebot) — Grundlage für die Planung 2027
- [ ] Kurzes Feedback der 4 Lehrpersonen einholen: Was wurde am Info-Stand gefragt?
- [ ] `anmeldungOffen: false`, Banner «Der Besuchsmorgen ist vorbei. Danke fürs Kommen!»
- [ ] Bis 04.11.: `node scripts/reset.mjs --project fms-besuchstag-prod` → alle Buchungen gelöscht
- [ ] Repo taggen: `git tag besuchsmorgen-2026 && git push --tags` → 2027 wiederverwendbar
      (dann nur `data/programm.json` und das Datum ersetzen)
