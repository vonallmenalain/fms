# 05 · Last, Performance und Live-Verhalten

> Antwort auf die drei Prioritäten: **sauber und flüssig**, **wirklich live**, **kein Limit bei
> 200 gleichzeitigen Geräten**. Dieses Dokument sagt, wie die Architektur das erreicht — und
> vor allem, wie wir es **vor** dem 28. Oktober beweisen statt hoffen.

---

## 1. Die Kurzantwort auf «Nur Frontend oder Backend?»

**Ein reines Frontend kann es nicht.** Damit Gerät B sieht, dass Gerät A gerade den letzten Platz
genommen hat, braucht es einen gemeinsamen Ort für diesen Zustand. Das ist die Datenbank.

Aber «Backend» heisst hier **nicht, dass wir Serverkode schreiben**. Die Aufteilung:

| Schicht | Was | Wer betreibt es |
|---|---|---|
| **Frontend** (Netlify) | die gesamte App und Bedienlogik | statische Dateien vom CDN |
| **Firestore** | Zähler + Anmeldungen, Live-Synchronisierung, atomare Buchung | Google, horizontal skaliert |
| **Firebase Auth** | anonym für Gäste, E-Mail/Passwort für die 3–4 Organisierenden | Google |
| **Security Rules** | erzwingen serverseitig, dass kein Zähler über die Kapazität geht | Google |
| ~~Cloud Functions~~ | **bewusst nicht** — siehe §2 | — |

**Firebase Authentication brauchen wir zweifach**, und beides ist nicht verhandelbar:
- **Anonyme Anmeldung für Gäste.** Sie liefert die stabile Geräte-Kennung, an der die Anmeldung
  hängt, *und* das `request.auth`, ohne das die Security Rules nicht zwischen «dieses Gerät» und
  «irgendjemand» unterscheiden könnten. Für den Gast unsichtbar: kein Formular, kein Klick.
- **E-Mail/Passwort für die Organisierenden.** Sonst wäre die Notbremse für jeden erreichbar,
  der die Adresse `/admin` errät.

## 2. Warum kein Cloud-Functions-Backend — obwohl Blaze verfügbar wäre

Das ist die Stelle, an der die Intuition in die falsche Richtung zeigt. Ein Server *zwischen*
App und Datenbank macht das System bei 200 Geräten **langsamer und fragiler**, nicht sicherer:

| | Direkt: App → Firestore | Über eine Cloud Function |
|---|---|---|
| Buchung, warmer Zustand | **1 Runde**, ~120–300 ms | 2 Runden, ~350–700 ms |
| Buchung, erste Anfrage nach Ruhe | gleich schnell | **+1 bis 3 s Kaltstart** |
| Verhalten bei 200 gleichzeitig | Google skaliert Firestore | begrenzter Instanzen-Pool → **echter Flaschenhals** |
| Ausfallpunkte | 1 | 2 |
| Autorität über die Kapazität | Security Rules | Funktionskode |

Der einzige Vorteil einer Function wäre serverseitige Autorität — und die haben wir über die
Security Rules bereits, ohne Runde und ohne Kaltstart. Um 08:35, wenn 200 Geräte gleichzeitig
loslegen, ist der Kaltstart genau das, was man nicht will.

**Entscheid: keine Cloud Functions.** Die Buchung läuft als Firestore-Transaktion direkt aus der App.

## 3. Blaze: ja — aber als Sicherheitsnetz, nicht als Feature

Auf dem Gratis-Tarif gibt es genau **eine** harte Ausfallart: Ist das Tageskontingent von
50 000 Lesevorgängen erschöpft, **hört die App mitten im Anlass auf zu funktionieren**. Nicht
langsamer — aus. Und die Rechnung für 200 Geräte landet genau auf dieser Kante:

| Posten | Rechnung | Realistisch | Ungünstigster Fall |
|---|---|---|---|
| Erste Momentaufnahme je Block (7/7/12/12 Dokumente) | 200 × 38 | 7 600 | 7 600 |
| Live-Änderungen, während ein Gerät auf einer Liste steht | 200 × 45 × 4 Blöcke | 36 000 | 160 000 |
| Eigene Anmeldung + `config/app` | 200 × 6 | 1 200 | 1 200 |
| Admin-Übersichten (5 Personen, ganzer Morgen) | 5 × 1 000 | 5 000 | 8 000 |
| **Lesevorgänge total** | | **≈ 50 000** | **≈ 177 000** |
| **Schreibvorgänge total** | 200 × 4 × 3 + Anmeldungen | ≈ 3 000 | ≈ 4 500 |

Der realistische Fall trifft das Gratis-Limit auf den Punkt. Der ungünstigste — alle 200 stehen
gleichzeitig auf derselben Liste, während gebucht wird — überschreitet es um das Dreieinhalbfache.

**Was Blaze daraus macht:** Die 50 000 Lesevorgänge pro Tag sind auch im Blaze-Tarif enthalten,
darüber kostet es rund **0.06 USD je 100 000 Lesevorgänge**.

| Szenario | Lesevorgänge | Kosten über dem Freikontingent |
|---|---|---|
| Realistisch | 50 000 | **0.00** |
| Ungünstigster Fall | 177 000 | **≈ 0.08 USD** |
| Absurder Fall (500 000) | 500 000 | ≈ 0.27 USD |

Der ganze Anlass kostet also **weniger als einen Franken** — und dafür fällt die einzige harte
Ausfallart weg. Das ist ein aussergewöhnlich gutes Geschäft.

> **Zwei Dinge dazu einrichten** (Phase 0, zusammen 10 Minuten):
> 1. **Budget-Alarm** in der Google-Cloud-Konsole auf CHF 5 und CHF 20 mit E-Mail-Benachrichtigung.
>    Blaze kennt keine harte Ausgabengrenze — der Alarm ist das Sicherheitsnetz gegen einen
>    Fehler im Kode, der in einer Schleife liest.
> 2. Trotzdem die **Sparmassnahmen aus §5 umsetzen**. Blaze ist die Versicherung, nicht die
>    Ausrede, verschwenderisch zu bauen. Preise vor dem Event einmal in der Firebase-Preisübersicht
>    gegenprüfen — Grössenordnungen ändern sich nicht, Zahlen manchmal schon.

## 4. Wie «wirklich live» zustande kommt

«Live» sind zwei verschiedene Dinge, und sie brauchen verschiedene Lösungen:

**a) Meine eigene Aktion muss sich sofort anfühlen.**
Firestore schreibt jede Änderung zuerst in den lokalen Zwischenspeicher und löst den Listener aus,
**bevor** der Server bestätigt. Der eigene Tipp ist dadurch mit 0 ms sichtbar. Das dürfen wir nicht
kaputt machen: **kein Ladekringel über der Karte**, sondern sofortige Darstellung des neuen
Zustands und ein leiser Haken, wenn der Server bestätigt. Ein Spinner an dieser Stelle würde die
App künstlich langsam machen.

**b) Die Buchung der anderen muss schnell ankommen.**
Firestore-Listener laufen über eine offene Verbindung, nicht über Abfragen im Sekundentakt.
Typisch sind **100–400 ms** vom fremden Schreibvorgang bis zum aktualisierten Bildschirm.
Voraussetzung dafür, dass es auch so bleibt:

- **Listener nur auf den aktuellen Block** (7 bzw. 12 Dokumente), aufgebaut bevor die Liste
  erscheint, beim Verlassen sofort abgemeldet.
- **Listener nicht bei jedem Neuzeichnen neu aufbauen.** Der klassische React-Fehler — instabile
  Abhängigkeiten im `useEffect` — führt zu ständigem Ab- und Neuanmelden: die Liste flackert, die
  Aktualisierung wirkt zäh, und jede Neuanmeldung kostet nochmals 12 Lesevorgänge.
- **Kein Springen der Liste.** Die Platzzahl bekommt eine feste Breite mit `tabular-nums`, und die
  Reihenfolge der Angebote ändert sich während einer Sitzung nie. Sonst rutscht die Liste unter dem
  Finger weg, sobald jemand anderes bucht — das ist der Unterschied zwischen «live» und «unruhig».

**Abnahmekriterium:** p95 der Zeit von fremder Buchung bis sichtbarer Änderung **< 1 s**,
gemessen im Lasttest (§6).

## 5. Der wirkliche Engpass bei 200 Geräten: das heisse Dokument

Nicht das Kontingent ist die Gefahr, sondern **Andrang auf ein einzelnes Angebot**. Wenn 60 Leute
innerhalb von zwei Sekunden auf «Sport · 27Fd» tippen, zielen 60 Transaktionen auf dasselbe
Dokument. Firestore reiht sie auf; jeder Wiederholungsversuch kostet eine Runde. Nach fünf
Versuchen gibt das SDK auf — die Person sähe einen Fehler, obwohl Plätze frei waren.

Die vier Massnahmen, in der Reihenfolge ihrer Wirkung:

1. **Vorprüfung aus der Live-Anzeige.** Zeigt die Momentaufnahme `belegt + gruppe > kapazitaet`,
   ist die Karte gesperrt und es wird gar keine Transaktion gestartet. Das senkt die Zahl der
   konkurrierenden Versuche von «alle 200» auf «freie Plätze plus die gerade laufenden».
2. **Eigene Wiederholung mit Streuung.** `runTransaction` in vier Versuche mit
   120 / 300 / 700 / 1500 ms ± 40 % Zufall verpacken. Ohne Streuung kommen alle Wiederholungen
   im selben Moment zurück und der Andrang wiederholt sich exakt.
3. **Ein Vorgang pro Gerät.** Eine Sperre im Frontend, damit ein doppelter Tipp nicht zwei
   Transaktionen gleichzeitig startet — sonst behindert sich ein Gerät selbst.
4. **Sauberes Scheitern.** Schlägt es endgültig fehl: «Leider gerade eben ausgebucht», die Liste
   zeigt den neuen Stand bereits an, die Person wählt weiter. Keine Fehlerseite, kein Neuladen.

**Wichtige Regel beim Bauen:** Eine Firestore-Transaktion muss **alle Lesevorgänge vor allen
Schreibvorgängen** ausführen. Beim Umbuchen werden drei Dokumente angefasst (alter Zähler, neuer
Zähler, Anmeldung) — erst alle drei lesen, dann alle drei schreiben. Andernfalls scheitert die
Transaktion zur Laufzeit. Der Kode in [02 §4](02-technisches-konzept.md) ist entsprechend aufgebaut.

**Zum Vergleich, damit die Grössenordnung klar ist:** Die relevanten Firestore-Grenzen liegen bei
rund einem *dauerhaften* Schreibvorgang pro Sekunde **pro Dokument** (Spitzen darüber sind
unproblematisch) und bei einer Million gleichzeitiger Verbindungen **pro Datenbank**. Unser
meistgefragtes Dokument bekommt über den ganzen Morgen höchstens 35 Schreibvorgänge, und 200
Verbindungen sind vier Zehntausendstel der Verbindungsgrenze. Wir sind nirgends in der Nähe
einer Grenze — ausser beim Andrang auf ein einzelnes Dokument, und genau dafür sind die vier
Massnahmen oben da.

## 6. Der Beweis: Lasttest mit 200 und 400 Geräten

Argumente ersetzen keine Messung. `scripts/lasttest.mjs` startet echte Firebase-Clients gegen das
**Testprojekt** — mit anonymer Anmeldung und denselben Security Rules wie in der Produktion.
(Bewusst **nicht** mit dem Admin-SDK: das umgeht die Rules und würde am Kern vorbeitesten.)

**Testprofil**
- 200 Clients melden sich innerhalb von 20 Sekunden an — der Schwarm um 08:35
- jeder wählt 4 Angebote mit 2–8 Sekunden Bedenkzeit dazwischen
- 30 % ändern danach eine Wahl (das ist der teure Drei-Dokumente-Fall)
- 15 % stürzen sich gezielt auf dieselben drei Angebote — **erzwungener Andrang**
- 10 Clients wählen nichts, hören nur zu, und messen die Zeit bis fremde Änderungen ankommen

**Gemessen wird**
p50 / p95 / p99 der Buchungsdauer · Anzahl Wiederholungen · endgültige Fehlschläge ·
Zeit bis fremde Änderung sichtbar · verbrauchte Lese- und Schreibvorgänge laut Konsole

**Danach geprüft (die Invarianten)**

| # | Prüfung | Erwartung |
|---|---|---|
| L1 | Summe aller `belegt` = Summe aller gebuchten Plätze aus `bookings` | **exakt gleich** |
| L2 | Kein Angebot mit `belegt > kapazitaet` | 0 Fälle |
| L3 | Kein Angebot mit `belegt < 0` | 0 Fälle |
| L4 | Endgültig fehlgeschlagene Buchungen bei freien Plätzen | 0 |
| L5 | p95 der Buchungsdauer | **≤ 1.5 s** |
| L6 | p95 bis fremde Änderung sichtbar | **≤ 1.0 s** |
| L7 | Verbrauch je Lauf gegen die Schätzung aus §3 | Abweichung < 30 % |

**Drei Läufe:**
1. **200 Clients** — das erwartete Maximum
2. **400 Clients** — doppelter Sicherheitsfaktor; hier darf es langsamer werden, aber L1–L4 müssen halten
3. **200 Clients mit gedrosseltem Netz** (3G-Profil, 10 % Paketverlust) — der Turnhallenfall

**Zusätzlich, weil Skripte nicht alles zeigen:** an der Generalprobe rund 20 echte Handys im
Gast-WLAN. Das findet die Dinge, die kein Lasttest findet — winzige Tap-Ziele, ein iPhone mit
gesperrtem Zwischenspeicher, ein Android, das die Verbindung im Hintergrund kappt.

## 7. Leistungsbudget des Frontends

«Flüssig» entscheidet sich zu einem grossen Teil vor der ersten Buchung — beim Laden.

| Grösse | Ziel | Wie erreicht |
|---|---|---|
| JavaScript auf dem kritischen Pfad | **≤ 200 KB** gepackt | Firebase modular importieren (App + Auth + Firestore ≈ 130 KB), React ≈ 45 KB |
| Admin-Bereich im Gast-Bundle | **0 KB** | eigene Route, per `lazy()` nachgeladen |
| Erster sichtbarer Inhalt (4G, Mittelklasse-Android) | **≤ 1.5 s** | statisches CDN, keine Schriftart blockiert das Zeichnen |
| Tipp bis sichtbare Reaktion | **≤ 100 ms** | optimistisches Zeichnen, keine Netzrunde davor |
| Layoutsprünge beim Live-Update | **0** | feste Breite für die Platzzahl, keine Umsortierung |
| Lighthouse Mobil | Leistung ≥ 90, Bedienhilfen ≥ 95 | in Phase 6 gemessen |

Nachweis: `npx vite-bundle-visualizer` nach jedem Bau, Lighthouse gegen die Netlify-Vorschau —
beides in Phase 6, beides wiederholbar.

## 8. Was am Eventtag beobachtet wird

- **Firebase-Konsole → Nutzung** offen: Lese-/Schreibvorgänge in Echtzeit
- **Budget-Alarm** aktiv (CHF 5 / CHF 20)
- Das **Admin-Dashboard ist der beste Frühwarnmelder**: Bewegen sich die Zahlen zwischen 08:35 und
  08:50 nicht mehr, stimmt etwas nicht — lange bevor es jemand meldet
- Reserveschalter `config/app.liveZaehler = false` in Reichweite: schaltet alle Geräte von
  Live-Aktualisierung auf einmaliges Laden um. Halbiert die Last sofort, Buchen läuft unverändert

## 9. Was ausserhalb unserer Architektur liegt

Zwei Dinge kann die beste App nicht lösen — beide gehören vor dem Event geklärt:

1. **Das Gast-WLAN.** 200 gleichzeitige Geräte an einem Zugangspunkt sind für viele
   Schul-Installationen die Belastungsgrenze — nicht wegen der Datenmenge (die App ist winzig),
   sondern wegen der Anzahl Verbindungen. **Vor dem Event mit der Schul-IT klären**, wie viele
   gleichzeitige Geräte das Gast-WLAN in der Aula verkraftet. Das Mobilfunknetz ist in der Stadt
   Bern die verlässlichere Variante — deshalb steht das WLAN auf der Folie als Ergänzung, nicht
   als Hauptweg.
2. **Der Andrang selbst.** Eine Ansage in der Aula («es hat gut doppelt so viele Plätze wie
   Personen, in Ruhe») verteilt die Last über zwei Minuten statt über zwei Sekunden — wirksamer
   als jede technische Optimierung.

## 10. Geprüfte Alternative: Firebase Realtime Database

Der Vollständigkeit halber, weil sie für Live-Zähler naheliegt: Die Realtime Database rechnet
nach Datenmenge statt nach Zugriffen — das Kontingentproblem aus §3 gäbe es dort gar nicht, und
die Latenz ist tendenziell nochmals etwas tiefer.

**Trotzdem Firestore**, aus einem konkreten Grund: Das Umbuchen — alten Platz freigeben, neuen
belegen, Anmeldung aktualisieren — ist in Firestore **eine** Transaktion über drei Dokumente. In
der Realtime Database bräuchte es dafür einen mehrpfadigen Schreibvorgang mit Zählerinkrementen
plus Validierungsregeln, die die Kapazität prüfen. Das geht, ist aber deutlich fehleranfälliger
zu bauen und zu testen — und die Ersparnis liegt bei unter einem Franken. Dazu kommt: Firestore
ist für die Admin-Auswertung, den Export und die Wiederverwendung 2027 die angenehmere Basis.
