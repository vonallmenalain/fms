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

## 5a. Der Fund aus dem ersten Lasttest: Anmelde-Drosselung pro IP

Beim ersten Lauf gegen die echte Datenbank brach der Test sofort ab:

```
FirebaseError: Firebase: Error (auth/too-many-requests)
```

**Firebase Auth drosselt anonyme Neuanmeldungen pro IP-Adresse.** 150 Anmeldungen
innerhalb von 20 Sekunden von einer einzigen IP wurden blockiert — und die Sperre hielt
danach über eine Stunde an.

**Warum das für den 28. Oktober zählt:** Im Gast-WLAN der Schule teilen sich **alle Geräte
eine einzige öffentliche IP** (NAT). Melden sich 150 Personen im Moment des QR-Scans
gleichzeitig an, sieht Firebase genau das Muster, das es eben blockiert hat. Über das
Mobilfunknetz besteht das Problem nicht — dort hat jedes Gerät eine eigene Adresse.

**Was daraufhin geändert wurde:**

1. **Anmeldung erst beim ersten Buchen, nicht beim Laden der Seite.** Das ist die
   wirksamste Massnahme. Programm und freie Plätze sind laut `firestore.rules` ohne
   Anmeldung lesbar; angemeldet wird erst, wenn jemand wirklich ein Angebot antippt.
   Damit verteilen sich die Anmeldungen von selbst über die Zeit, die die Leute zum Lesen,
   Gruppengrösse-Wählen und Aussuchen brauchen — aus einem Schwall von 15 Sekunden werden
   zwei bis drei Minuten.
2. **Wiederholung mit Streuung** (400 / 1200 / 2600 / 5000 ms ± 40 %) bei
   `auth/too-many-requests`.
3. **Verständliche Meldung**, falls es trotzdem klemmt: «Gerade melden sich sehr viele
   gleichzeitig an. Bitte in ein paar Sekunden nochmals tippen.» — kein Absturz, kein
   Datenverlust, die Auswahl bleibt stehen.

**Was noch offen ist:** Die Drosselschwelle ist von Google nicht dokumentiert und für
Rechenzentrums-IPs strenger als für gewöhnliche Anschlüsse. Ob das Gast-WLAN der Schule
betroffen ist, lässt sich nur vor Ort messen. **Deshalb gehört in die Generalprobe: 20
echte Handys, alle im Gast-WLAN, alle innerhalb einer Minute anmelden.** Das ist der
einzige belastbare Test. Auf der QR-Folie soll ausserdem stehen, dass Mobilfunk der
bevorzugte Weg ist und das WLAN nur die Ergänzung für Geräte ohne Datenverbindung.

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

> **Hinweis zum Ausführungsort:** Der Lasttest meldet echte anonyme Nutzer an und läuft
> deshalb gegen die Drosselung aus §5a, wenn alle Anmeldungen von einer IP kommen. Er
> nimmt sich dafür Zeit (`--anlauf`), aber aus einem Rechenzentrum heraus greift die
> Sperre trotzdem früh. **Gegen die echte Datenbank deshalb von einem gewöhnlichen
> Anschluss aus laufen lassen** — oder gegen die Emulator Suite, wo die Drosselung nicht
> greift und die Korrektheitsprüfungen L1–L4 vollständig gelten.

**Zusätzlich, weil Skripte nicht alles zeigen:** an der Generalprobe rund 20 echte Handys im
Gast-WLAN — mit besonderem Blick auf §5a: alle innerhalb einer Minute anmelden lassen. Das findet die Dinge, die kein Lasttest findet — winzige Tap-Ziele, ein iPhone mit
gesperrtem Zwischenspeicher, ein Android, das die Verbindung im Hintergrund kappt.

## 7. Leistungsbudget des Frontends

«Flüssig» entscheidet sich zu einem grossen Teil vor der ersten Buchung — beim Laden.

| Grösse | Ziel | Wie erreicht |
|---|---|---|
| JavaScript auf dem kritischen Pfad | **≤ 200 KB** gepackt | Gemessen am 27.08.: **198 KB** — Firebase 140, React 46, App 13. Firebase modular importiert; die 140 statt 116 KB sind der dauerhafte Zwischenspeicher, der die App offline startfähig macht ([02 §8a](02-technisches-konzept.md)). Damit ist das Budget aufgebraucht: Was hier noch dazukommt, muss anderswo weg |
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

1. **Das Gast-WLAN.** Zwei getrennte Probleme, beide vor dem Event zu klären:
   *(a)* 200 gleichzeitige Geräte an einem Zugangspunkt sind für viele Schul-Installationen
   die Belastungsgrenze — nicht wegen der Datenmenge (die App ist winzig), sondern wegen der
   Anzahl Verbindungen. **Mit der Schul-IT klären**, wie viele gleichzeitige Geräte das
   Gast-WLAN in der Aula verkraftet.
   *(b)* Alle Geräte teilen sich dahinter **eine öffentliche IP**, was die Anmelde-Drosselung
   aus §5a auslösen kann. Das Mobilfunknetz ist in der Stadt Bern die verlässlichere Variante
   und löst beide Probleme — deshalb steht das WLAN auf der Folie als Ergänzung, nicht als
   Hauptweg.
2. **Der Andrang selbst.** Eine Ansage in der Aula («es hat gut doppelt so viele Plätze wie
   Personen, in Ruhe») verteilt die Last über zwei Minuten statt über zwei Sekunden — wirksamer
   als jede technische Optimierung.

## 10. Das Protokoll: Was kostet es, jeden Vorgang mitzuschreiben?

Die Steuerung zeigt seit dem 21.08. einen **Protokollbereich**: welcher Client, welche Art
von Gerät, welche Uhrzeit, wie viele Plätze, wie viele Slots. Die naheliegende Sorge ist,
dass ausgerechnet ein Log den Andrang um 08:35 ausbremst. Die Antwort ist **nein**, und
zwar aus vier Gründen, die alle in der Bauweise stecken.

### 10.1 Die halbe Ansicht kostet gar nichts

«Pro Client» — wer ist angemeldet, seit wann, mit wie vielen Personen, auf welchen vier
Angeboten — steht bereits in `bookings`. Jede Anmeldung trägt seit jeher `quelle`,
`plaetze`, `wahl`, `erstelltAm` und `geaendertAm`. Diese Sicht ist reine Darstellung:
**null zusätzliche Schreibvorgänge, null zusätzliche Lesevorgänge** gegenüber der
Übersicht, die es schon gab.

Was dort **nicht** steht, ist der Verlauf: Wer Sport gegen Physik tauscht, überschreibt in
der Anmeldung die vorherige Wahl. Genau dafür — und nur dafür — gibt es die Sammlung `log`.

### 10.2 Der Eintrag liegt nicht auf dem kritischen Pfad

Geschrieben wird **nach** der bestätigten Transaktion und **ohne `await`**:

```ts
await runTransaction(db, …);          // die Buchung — hier zählt jede Millisekunde
protokolliere(buchungId, quelle, …);  // kehrt sofort zurück, läuft nebenher
```

Für die Person am Handy ändert sich damit nichts: Ihre Buchung ist in dem Moment fertig,
in dem sie vorher fertig war. Das Leistungsbudget aus §7 («Tipp bis sichtbare Reaktion
≤ 100 ms») bleibt unangetastet, weil die Anzeige ohnehin schon aus dem lokalen
Zwischenspeicher kommt (§4a).

Der Preis dafür ist ehrlich zu nennen: Wer den Browser in derselben Zehntelsekunde
schliesst, verliert **diese eine Protokollzeile**. Die Buchung ist zu diesem Zeitpunkt
längst bestätigt. Ein Protokoll, das eine gültige Buchung scheitern lassen könnte, wäre
der schlechtere Tausch.

### 10.3 Es gibt kein heisses Dokument — das ist der entscheidende Punkt

Der Engpass aus §5 ist **nicht** die Zahl der Schreibvorgänge, sondern der Andrang auf ein
**einzelnes Dokument**: Firestore verträgt rund einen dauerhaften Schreibvorgang pro
Sekunde pro Dokument, und 60 Transaktionen auf denselben Zähler reihen sich auf.

Protokollzeilen haben dieses Problem prinzipiell nicht: Jeder Eintrag ist ein **eigenes
Dokument mit Zufalls-ID**. 200 gleichzeitige Einträge sind 200 unabhängige Schreibvorgänge
auf 200 verschiedene Dokumente — der Fall, für den Firestore gebaut ist. Sie treffen sich
nirgends. Es gibt auch keinen Zähler, der mitgeführt werden müsste; die Zahlen im
Protokollbereich rechnet der Browser der Administration aus den Zeilen aus.

### 10.4 Die Rechnung

| Posten | Rechnung | Realistisch | Ungünstigster Fall |
|---|---|---|---|
| Buchungen (120 Gäste × 4 Blöcke) | 480 | 480 | 800 |
| Wechsel und Freigaben (30 %) | 145 | 145 | 400 |
| Erfassungen am Info-Stand | | 15 | 40 |
| **Protokollzeilen total** | | **≈ 640** | **≈ 1 240** |
| Rules-Lesevorgang je Zeile (`anmeldungOffen`) | 1 × oben | ≈ 640 | ≈ 1 240 |

Gegen die Grundlast aus §3 (≈ 3 000 Schreib- und ≈ 50 000 Lesevorgänge) sind das **rund
20 % mehr Schreibvorgänge und gut 1 % mehr Lesevorgänge**. In Franken: Schreibvorgänge
kosten rund 0.18 USD je 100 000 — die 640 Zeilen sind **etwa ein Rappen**. Damit bleibt
die Aussage aus §3 unverändert: der ganze Anlass unter einem Franken.

Der einzige Posten, der Aufmerksamkeit verdient, ist das **Lesen** des Protokolls: Ein
Listener auf eine wachsende Sammlung liest beim Aufbau jedes Dokument einmal. Deshalb
zwei Vorkehrungen: Der Bereich ist **zugeklappt** und baut erst beim Öffnen eine
Verbindung auf, und die Abfrage ist auf die **500 neusten Zeilen** gedeckelt. Wer in der
heissen Phase die Steuerung offen hat, aber das Protokoll nicht aufklappt, zahlt nichts.

### 10.5 Der Schalter, falls doch

`config/app.protokoll` schaltet das Mitschreiben zur Laufzeit ab — genau wie
`liveZaehler` in §8, sofort auf allen Geräten. Ausgeschaltet fehlt danach der Verlauf;
«Pro Client» bleibt vollständig, weil es aus den Anmeldungen kommt.

**Fazit für den Eventmorgen:** Das Protokoll ist keine Gefahr für die Leistung. Wenn am
28. Oktober etwas klemmt, liegt es an einer der Ursachen aus §5, §5a oder §9 — nicht hier.
Der Schalter ist trotzdem da, weil eine Reserve nichts kostet, solange man sie nicht braucht.

### 10.6 Warum «Gerät 12» und nicht die Firebase-Kennung

`iJovaGD9…` ist eindeutig, aber unlesbar, unsprechbar und im Gespräch am Info-Stand
wertlos. Die Zeilen werden darum nach **erstem Auftreten** durchnummeriert — «Gerät 12»
lässt sich vorlesen und wiederfinden; die echte Kennung steht in der aufgeklappten Zeile.

Nach *erstem* Auftreten, weil eine Nummer, die sich bei jeder fremden Buchung verschiebt,
schlechter wäre als gar keine. Aus demselben Grund zählt die erste **Protokollzeile** und
nicht die Anmeldung, sobald es beides gibt: Sonst verschöbe eine gelöschte Anmeldung die
Nummern aller Geräte, die kurz danach dazugekommen sind.

Restrisiko, bewusst in Kauf genommen: Taucht nachträglich ein Gerät mit einer früheren
Zeit auf, rücken die jüngeren um eins weiter. Dagegen hülfe nur ein Zähler in der
Datenbank — also genau das heisse Dokument aus §5.

### 10.7 Warum keine IP-Adresse

Die IP ist die naheliegende Kennung, und sie ist trotzdem die falsche. Drei Gründe, jeder
für sich ausreichend:

1. **Sie ist nicht da.** Die App spricht ohne Serverkode direkt mit Firestore (§2). Die
   Security Rules kennen `request.auth` und `request.time` — die IP des Aufrufers steht
   ihnen nicht zur Verfügung, und der Browser kann seine eigene öffentliche Adresse nicht
   ermitteln. Zu holen wäre sie nur über eine zusätzliche Netlify-Funktion, die dem Client
   sagt, wie sie ihn sieht: eine weitere Runde je Gerät und ein weiterer Ausfallpunkt, für
   eine Angabe, die niemand braucht.
2. **Sie würde nichts unterscheiden.** Im Gast-WLAN der Schule teilen sich **alle Geräte
   eine einzige öffentliche IP** (§5a — genau deshalb greift dort die Anmelde-Drosselung).
   In der Spalte stünde bei fast allen Zeilen dieselbe Zahl. Sie sähe nach Information aus
   und wäre keine — schlimmer als ein leeres Feld.
3. **Sie ist ein Personendatum.** Das Fachkonzept trägt «keine Personendaten, kein
   Cookie-Banner nötig» ([01 §10](01-fachkonzept.md)). Eine gespeicherte IP kippt das,
   für nichts.

**Was stattdessen trägt:** die fortlaufende Gerätenummer aus §10.6, dazu die Geräteart
(`iPhone · Safari`) und die Zahl der Vorgänge. Am Info-Stand ist «das iPhone, das um 08:41
angefangen hat und sechs Vorgänge gemacht hat» eine Beschreibung, mit der man arbeiten
kann. `84.75.19.203` ist es nicht.

### 10.8 Was das Protokoll nicht ist

Es enthält **keine Personendaten**: Ein «Client» ist die anonyme Firebase-Geräte-ID, die
Spalte «Gerät» nennt nur Familie und Browser (`iPhone · Safari`), ohne Versionen, ohne die
vollständige User-Agent-Zeile, ohne IP-Adresse. Es ist damit dieselbe Datenlage wie in
[01 §10](01-fachkonzept.md#10-datenschutz-dsgdsgvo-tauglich-weil-es-nichts-zu-schützen-gibt) —
und es wird zusammen mit den Anmeldungen gelöscht (`npm run reset`, «Alles zurücksetzen»).

Angeschrieben wird eine Zeile genau einmal: `update` ist in den Security Rules für alle
gesperrt, auch für die Administration. Aufräumen heisst deshalb löschen, nicht ändern.

## 10a. Die Schattenbuchung der Betreuungspersonen

Der Fall, der ohne Gegenmassnahme garantiert eintritt: Eine Lehrperson meldet sich morgens
wie jeder Gast an — anonym, ohne Formular. Später meldet sie sich unter `/admin` mit ihrer
Adresse an. **Firebase ersetzt dabei die anonyme Sitzung.** Ihre Anmeldung liegt danach
unter einer uid, die niemand mehr besitzt: Sie belegt Plätze, ist in der Übersicht
sichtbar, und die Person selbst kommt nicht mehr an sie heran. Nur die Administration
könnte sie noch wegräumen.

**Die Lösung ist eine Verschiebung, keine Reparatur.** Das Gerät merkt sich seine anonyme
uid in `localStorage` (`src/geraet.ts`). Kommt die angemeldete Person über den Knopf
**«Hauptseite ↗»** auf die Anmeldung zurück, holt `uebernimmGeraeteAnmeldung` die Buchung
in ihr Konto: altes Dokument lesen, neues schreiben, altes löschen — in **einer**
Transaktion. Die Zähler bleiben unberührt, weil sich an der Zahl der belegten Plätze
nichts ändert; ein Zwischenzustand, in dem die Anmeldung weg und die Plätze noch belegt
sind, kann gar nicht entstehen.

Drei Feinheiten, die den Unterschied zwischen «funktioniert» und «funktioniert am
Eventmorgen» ausmachen:

- **Nur wenn nichts kollidiert.** Hat das Konto bereits eine eigene Anmeldung, wird nicht
  übernommen — sonst verwaisten deren Plätze. Die alte bleibt dann für die Administration
  stehen.
- **Gleichzeitige Aufrufe teilen sich einen Lauf.** React ruft Effekte im
  Entwicklungsmodus doppelt auf, und ein schneller Wechsel zwischen den Bereichen tut das
  Gleiche. Beide Aufrufe lasen sonst denselben Merker, bevor der erste ihn löschte — und
  das Protokoll bekäme zwei Übernahmen für einen Vorgang.
- **Der Merker wird danach gelöscht.** Sonst erbte die nächste Person am selben Gerät
  (Info-Stand-Tablet!) eine fremde Anmeldung.

Damit die Administration die Anmeldung, die plötzlich ohne Vorgeschichte dasteht,
einordnen kann, schreibt die Übernahme eine eigene Protokollzeile: **«ins Konto
übernommen»**. Die Zeilen der alten Kennung bleiben, wo sie sind — sie sind angeschrieben
und unveränderlich, das ist der Sinn eines Protokolls.

**Security Rules:** Dafür darf `istBetreuung()` neu eine Anmeldung löschen; beim Verschieben
ist die anonyme Sitzung, der das alte Dokument gehörte, bereits verschwunden. Dasselbe
Recht schliesst nebenbei eine echte Lücke: Bisher konnte die Betreuung einen eigenen
Vertipper am Info-Stand nicht selbst korrigieren. Die Massenvorgänge bleiben der
Administration vorbehalten — «Alles zurücksetzen» fasst `config` und `slots` an, und
beides darf nur `istAdmin()`.

## 11. Geprüfte Alternative: Firebase Realtime Database

Der Vollständigkeit halber, weil sie für Live-Zähler naheliegt: Die Realtime Database rechnet
nach Datenmenge statt nach Zugriffen — das Kontingentproblem aus §3 gäbe es dort gar nicht, und
die Latenz ist tendenziell nochmals etwas tiefer.

**Trotzdem Firestore**, aus einem konkreten Grund: Das Umbuchen — alten Platz freigeben, neuen
belegen, Anmeldung aktualisieren — ist in Firestore **eine** Transaktion über drei Dokumente. In
der Realtime Database bräuchte es dafür einen mehrpfadigen Schreibvorgang mit Zählerinkrementen
plus Validierungsregeln, die die Kapazität prüfen. Das geht, ist aber deutlich fehleranfälliger
zu bauen und zu testen — und die Ersparnis liegt bei unter einem Franken. Dazu kommt: Firestore
ist für die Admin-Auswertung, den Export und die Wiederverwendung 2027 die angenehmere Basis.
