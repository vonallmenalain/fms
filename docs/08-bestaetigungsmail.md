# 08 · Eigene Mails an die Betreuung (Resend)

Der Betreuungsbereich verschickt drei Mails:

| Mail | Wann |
|---|---|
| **Einladung** | beim Eintragen unter «Steuerung → Zugänge», bei «E-Mail schicken» in der Liste — und wenn jemand im Login «Einladung nochmals per E-Mail schicken» drückt |
| **Bestätigungsmail** | nach «Konto erstellen» im Login — `firestore.rules` verlangt `email_verified` |
| **Passwort zurücksetzen** | über «Passwort vergessen?» im Login |

Alle drei verschickt die App **selbst**: eigene Gestaltung mit FMS-Logo, Absender auf
`alae.app`, Zustellung über **Resend**. Firebase verschickt nur noch im Rückfall
(Bestätigungsmail und Passwort): englisch angehauchtes Standardlayout, Absender
`noreply@fmsbesuchstag.firebaseapp.com`.

---

## 1 · Wie es funktioniert

### 1.1 Die Einladung — ein Zugangscode, bis zu zwei Knöpfe

```
Administration                    Netlify-Funktion                Firestore          Resend
  │ Zugang eintragen ─────────────────────────────────────────────► zugang/{mail}
  │ POST /api/einladung { mail, idToken } ──►│
  │                                          │ Einladung lesen ────► zugang/{mail}
  │                                          │ Code holen/erzeugen ► zugangscodes/{mail}
  │                                          │ Mail mit Knöpfen ────────────────────────► Zustellung
  │◄──── { stand: "gesendet", links } ───────│
```

Die Einladungsmail trägt einen **Zugangscode** in ihren Links:

| Knopf | Link | Für wen | Was in der App passiert |
|---|---|---|---|
| **Jetzt anmelden** | `/admin?zugang=CODE` | nur Betreuung | Adresse eintippen → `POST /api/zugang-anmelden` prüft Code und Adresse, legt bei Bedarf das Konto an, schaltet es frei und gibt ein Anmelde-Token zurück (`signInWithCustomToken`) |
| **Login erstellen** | `/admin?zugang=CODE&login=1` | beide Rollen | Adresse und zweimal ein neues Passwort → `POST /api/login-erstellen` setzt das Passwort, die Adresse gilt als bestätigt, die App meldet mit E-Mail und Passwort an |

Welche Knöpfe im Mail stehen, entscheidet die Administration beim Eintragen (die Haken
**«Anmeldung per Link»** und **«Login mit Passwort»**) — und die Rolle: **Die
Administration meldet sich mit Passwort oder Google an**, «Jetzt anmelden» gibt es für
sie nicht. Ihr Code ist nach dem ersten «Login erstellen» verbraucht; wer das Passwort
vergisst, hat «Passwort vergessen?».

**Warum kein Einmal-Link von Firebase mehr?** Der galt genau einmal und nur in dem
Browser, in dem er geöffnet wurde. Wer ihn im Mailprogramm antippte, war in dessen
eingebautem Browser angemeldet — und im eigentlichen Browser nicht; beim zweiten Versuch
war der Link verbraucht (mehr dazu in §4.4). Der Zugangscode gilt, solange die Einladung
besteht, auf **jedem Gerät**: Link öffnen, Adresse eintippen, fertig. Der Preis: Wer das
Mail hat, hat den Zugang. Für die Betreuung (Übersicht ansehen, Gäste erfassen — keine
Steuerung) ist das vertretbar; darum bleibt die Administration beim Passwort.

Der Code liegt in `zugangscodes/{mail}` — einer Sammlung, für die `firestore.rules`
keine Regel kennt und die darum aus dem Browser für niemanden lesbar ist, auch nicht für
die Administration. Nur die Funktionen kommen dran. Stünde er in `zugang/{mail}`, könnte
jede Administration mit dem Code einer anderen deren Passwort setzen. **«Code
erneuern»** in der Liste erzeugt einen neuen und verschickt die Einladung nochmals; die
alten Links sind damit tot. **«Zugang entfernen»** macht den Code ebenfalls wertlos —
ohne Einladung nimmt ihn keine Funktion an.

Gegen das Durchprobieren: 24 Bytes Zufall (32 Zeichen), und nach fünf Fehlversuchen je
Adresse zehn Minuten Pause.

### 1.2 Bestätigungsmail und Passwort — Firebase-Links in eigener Verpackung

```
Browser                      Netlify-Funktion                 Firebase        Resend
  │  POST /api/bestaetigung        │                              │              │
  │  { idToken } ─────────────────►│                              │              │
  │                                │ ID-Token prüfen ────────────►│              │
  │                                │ Einmal-Link erzeugen ───────►│              │
  │                                │ Mail mit Logo + Link ───────────────────────►│
  │◄──── { stand: "gesendet" } ────│                              │       Zustellung
```

Wichtig: **Die Prüfung der Adresse bleibt bei Firebase.** Wir erzeugen mit dem Admin-SDK
genau denselben Einmal-Link, den Firebase sonst selbst verschickt hätte, und tauschen nur
Verpackung und Briefträger aus. Am Anmeldeablauf, an den Security Rules und am
`email_verified`-Merkmal ändert sich nichts.

### 1.3 Wer darf eine Mail auslösen?

- **Einladung:** Mit ID-Token der Administration antwortet die Funktion ehrlich (was
  verschickt wurde, was nicht, und die Links selbst). Ohne Token — «Einladung nochmals
  schicken» im Login — verschickt sie nur an eingetragene Adressen und antwortet **für
  alle gleich**, damit sich nicht durchprobieren lässt, wer Zugang hat.
- **Bestätigungsmail:** Es zählt das mitgeschickte **ID-Token**, nicht die Adresse im
  Formular. Verschickt wird nur an die Adresse, die im Token steht — sonst könnte jede und
  jeder über diese Schnittstelle fremde Adressen anschreiben lassen.
- **Passwort:** Hier ist niemand angemeldet, die Adresse kommt ungeprüft aus dem
  Formular. Verschickt wird nur an Adressen, die **eingeladen** (Dokument in `zugang`)
  oder **bereits freigeschaltet** (Konto in `admins`) sind — die Schranke
  `darfPostBekommen` in `netlify/lib/dienst.mjs` — und nur, wenn es dazu ein **Konto mit
  Passwort** gibt. Firebase liesse ein Zurücksetzen auch für reine Google-Konten zu — und
  legte dort stillschweigend ein Passwort an.

Alle Wege lassen an dieselbe Adresse höchstens alle 30 Sekunden eine Mail zu.

Warum ein Server nötig ist: Der Resend-Schlüssel und der Firebase-Dienstschlüssel dürfen
niemals ins Browser-Bündel — wer sie hat, verschickt Post von deiner Domain. Und der
Zugangscode darf den Browser nur im Link erreichen.

**Fällt irgendetwas davon aus** (Schlüssel fehlt, Resend gestört, lokaler
Entwicklungsserver ohne Funktionen), verschickt Firebase die Bestätigungsmail und die
Rücksetzmail wie früher selbst — nüchtern, aber niemand bleibt vor der Tür stehen. Für die
Einladung gibt es diesen Rückfall nicht: Die Administration sieht den Grund in der
Meldung, und die Links stehen in der Liste unter «Links kopieren» — zum Weitergeben per
Chat.

| Datei | Rolle |
|---|---|
| `netlify/functions/einladung.mjs` | `POST /api/einladung` — Einladung lesen, Code holen, Mail auslösen oder nur die Links liefern |
| `netlify/functions/zugang-anmelden.mjs` | `POST /api/zugang-anmelden` — «Jetzt anmelden»: Code prüfen, Konto anlegen, freischalten, Anmelde-Token |
| `netlify/functions/login-erstellen.mjs` | `POST /api/login-erstellen` — «Login erstellen»: Code prüfen, Passwort setzen, freischalten |
| `netlify/functions/bestaetigung.mjs` | `POST /api/bestaetigung` — Token prüfen, Link erzeugen, Mail auslösen |
| `netlify/functions/passwort.mjs` | `POST /api/passwort` — dasselbe für das Zurücksetzen |
| `netlify/lib/mail.mjs` | Vorlagen (Logo, Farben, Text, ein oder zwei Knöpfe), die Links der Einladung und der Versand über die Resend-API |
| `netlify/lib/dienst.mjs` | Admin-SDK, Zugangscode (erzeugen, prüfen, Bremse), Konto anlegen und freischalten, die Schranke, einheitliche Antworten, die 30-Sekunden-Sperre |
| `src/zugang.ts` | Ruft die Schnittstellen auf; löst den Zugangscode ein |
| `scripts/mailvorschau.mjs` | Vorschau im Browser und Testversand |
| `scripts/mailtest.mjs` | 45 Prüfungen gegen die Emulator Suite (`npm run mailtest`) |

---

## 2 · Einrichten — Schritt für Schritt

### 2.1 Resend: Domain (ist bereits erledigt)

`alae.app` ist in Resend bereits verifiziert — die DNS-Einträge stehen in Cloudflare:

| Name | Typ | Zweck |
|---|---|---|
| `send.alae.app` | MX → `feedback-smtp.eu-west-1.amazonses.com` | Rückläufer (Bounces) |
| `send.alae.app` | TXT → `v=spf1 include:amazonses.com ~all` | SPF |
| `resend._domainkey.alae.app` | TXT → `p=MIGfMA0…` | DKIM-Signatur |
| `_dmarc.alae.app` | TXT → `v=DMARC1; p=none;` | DMARC |

**Nichts zu tun** — nur kurz in Resend → *Domains* nachsehen, dass `alae.app` auf
**Verified** steht. Falls nicht: dort auf *Verify DNS Records* tippen.

> **Firebase-Konsole:** Unter Authentication → Sign-in method muss «E-Mail-Adresse/Passwort»
> aktiviert sein (für «Login erstellen» und den Passwort-Login). Der Unterpunkt «E-Mail-Link
> (passwortloses Anmelden)» wird seit der Umstellung auf den Zugangscode **nicht mehr**
> gebraucht und darf ausgeschaltet bleiben. `fms.alae.app` muss unter Settings → Authorized
> domains stehen — für Google-Anmeldung und die Firebase-Links.

### 2.2 Resend: API-Schlüssel erstellen

1. [resend.com](https://resend.com) → **API Keys** → **Create API Key**
2. Name: `fms-besuchsmorgen`, Permission: **Sending access**, Domain: `alae.app`
3. Den Schlüssel (`re_…`) **sofort kopieren** — er wird nur einmal angezeigt.

> Ein eigener Schlüssel je App, nicht der von Photographic: So lässt sich einer der beiden
> jederzeit zurückziehen, ohne die andere App lahmzulegen.

### 2.3 Firebase: Dienstkonto-Schlüssel

Damit die Funktion Bestätigungslinks erzeugen darf. Es ist **derselbe Schlüssel**, der
schon als GitHub-Secret `FIREBASE_SERVICE_ACCOUNT` für den Rules-Deploy hinterlegt ist —
hast du die JSON-Datei von damals noch, überspring diesen Abschnitt und nimm sie. (Aus
GitHub lässt sich ein Secret nicht mehr auslesen; im Zweifel einfach einen neuen Schlüssel
erzeugen, alte bleiben gültig.)

1. [Firebase-Konsole](https://console.firebase.google.com/project/fmsbesuchstag/settings/serviceaccounts/adminsdk)
   → Projekt `fmsbesuchstag` → ⚙️ **Projekteinstellungen** → **Dienstkonten**
2. **Neuen privaten Schlüssel generieren** → es lädt eine `.json`-Datei herunter
3. Diese Datei **niemals ins Repo legen** (`.gitignore` fängt die üblichen Namen ab).
   Sie wird gleich als Umgebungsvariable eingefügt und kann danach gelöscht werden.

### 2.4 Netlify: Umgebungsvariablen setzen

Netlify → Site `fms` → **Site configuration** → **Environment variables** → **Add a variable**.
Scope: *All scopes*, Deploy contexts: *All deploy contexts*.

| Variable | Wert | Pflicht |
|---|---|---|
| `RESEND_API_KEY` | der Schlüssel `re_…` aus 2.2 | ja |
| `MAIL_ABSENDER` | `Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>` — **mit Namen**, nicht nur die Adresse | ja |
| `FIREBASE_SERVICE_ACCOUNT` | **der ganze Inhalt** der JSON-Datei aus 2.3 | ja |
| `MAIL_ANTWORT` | Adresse für Antworten, z. B. deine eigene | nein |
| `SEITEN_URL` | nur falls die Hauptadresse nicht `https://fms.alae.app` ist | nein |

Zum Einfügen von `FIREBASE_SERVICE_ACCOUNT`: JSON-Datei im Editor öffnen, **alles**
markieren (inklusive der geschweiften Klammern) und ins Wertfeld einfügen. Zeilenumbrüche
im Schlüssel sind kein Problem — die Funktion behandelt beide Schreibweisen.

> **Name vor der Adresse:** Steht in `MAIL_ABSENDER` nur die Adresse, setzt die Funktion
> selbst «Besuchsmorgen FMS Neufeld» davor (`mitAbsenderName` in `netlify/lib/mail.mjs`).
> Ein Absender ohne Namen wirkt automatisiert — Gmail zeigt dann die nackte Adresse an.
>
> **Absenderadresse:** Auf `alae.app` läuft Cloudflare Email Routing (die drei MX-Einträge).
> Antworten auf `besuchsmorgen@alae.app` landen nur dann irgendwo, wenn du in Cloudflare →
> **Email** → *Routing Addresses* eine Weiterleitung dafür anlegst. Sonst besser eine
> unmissverständliche Adresse wie `no-reply@alae.app` nehmen und `MAIL_ANTWORT` setzen.

### 2.5 Veröffentlichen

Ein Push auf `main` genügt — Netlify baut und stellt die Funktion mit bereit.
Umgebungsvariablen wirken **erst nach einem neuen Deploy**: Nach dem Setzen also
**Deploys → Trigger deploy → Clear cache and deploy site**.

---

## 3 · Prüfen

**Vorschau ohne Versand** (rein lokal, keine Schlüssel nötig):

```bash
npm run mailvorschau            # schreibt mailvorschau.html, im Browser öffnen
```

**Echter Testversand** (alle Mails an eine beliebige Adresse):

```bash
RESEND_API_KEY=re_… MAIL_ABSENDER='Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>' \
  npm run mailvorschau -- deine@adresse.ch
```

**Automatisch prüfen** — der echte Funktionskode gegen die Firebase-Emulatoren,
Resend wird dabei abgefangen, es geht keine Post raus:

```bash
npm run mailtest                # 45 Prüfungen, startet die Emulatoren selbst
```

Darin stecken die Schranke aus §1.3 (eingetragen → Mail, nicht eingetragen → keine Mail,
beide Male dieselbe Antwort), der Zugangscode (falscher Code, falsche Adresse, zweites
Gerät, Administration ohne Link, abgeschaltete Wege, die Bremse) und «Login erstellen»
(Passwort gesetzt, Adresse bestätigt, Code der Administration danach verbraucht).

**Der ganze Weg durch die App:**

1. `https://fms.alae.app/admin` → als Administration anmelden → **Steuerung → Zugänge** →
   eine Adresse eintragen, Rolle «Betreuung», alle drei Haken gesetzt lassen
2. Die Einladung muss innert Sekunden ankommen — mit Logo, Absender `alae.app`, zwei Knöpfen
3. **Jetzt anmelden** tippen, in der App die Adresse eintippen → drin. Denselben Link auf
   einem zweiten Gerät (oder in einem anderen Browser) öffnen → wieder drin
4. **Login erstellen** tippen → Adresse, zweimal ein Passwort → drin; danach abmelden und
   im Login mit E-Mail und Passwort anmelden
5. Für die Administration: eine Adresse mit Rolle «Administration» eintragen — das Mail
   hat nur «Login erstellen»
6. Für das Zurücksetzen: im Login die Adresse eintippen und **«Passwort vergessen?»**
7. Für die Bestätigungsmail: im Login **Konto erstellen** mit einer Adresse, die noch kein
   Konto hat → Mail → **E-Mail bestätigen** → in der App **Ich habe bestätigt**

---

## 4 · Wenn etwas klemmt

### 4.1 Die Einladung kommt nicht — in drei Schritten eingrenzen

**Schritt 0 — die Meldung beim Eintragen lesen.** Die Administration schickt ihr ID-Token
mit, und die Schnittstelle antwortet **ehrlich** statt neutral. Der Bildschirm sagt also
direkt, was passiert ist:

| Meldung | Bedeutung |
|---|---|
| «Einladung an … verschickt» | Resend hat die Mail angenommen → kommt trotzdem nichts an, weiter bei §4.2 |
| «der Server findet die Adresse nicht unter den Zugängen» | Die Einladung fehlt oder ist anders geschrieben — die Liste prüfen |
| «vor weniger als 30 Sekunden schon eine» | Die Sperre; die erste Einladung gilt |
| «Weder Anmeldung per Link noch Login mit Passwort ist erlaubt» | Beide Haken waren aus — einen setzen (in der Liste geht das nachträglich) |
| «Die Einladung liess sich nicht verschicken — …» | Der eigene Versand hat nicht geantwortet; der Grund steht dabei. Die Links stehen trotzdem unter «Links kopieren» |

Dazu schreibt die App den technischen Grund in die Browserkonsole:
`[zugang] /api/einladung antwortete HTTP …`.

**Schritt 1 — antwortet die Funktion überhaupt?** Der Aufruf verschickt nichts, weil die
Adresse nicht eingetragen ist:

```bash
curl -i -X POST https://fms.alae.app/api/einladung \
  -H 'Content-Type: application/json' -d '{"mail":"niemand@example.com"}'
```

| Antwort | Bedeutung |
|---|---|
| `200` + `{"stand":"erledigt"}` | Funktion läuft, Dienstkonto und Datenbank sind in Ordnung → weiter mit Schritt 2 |
| `503` | `FIREBASE_SERVICE_ACCOUNT` fehlt oder ist ungültig (§2.3/2.4) |
| HTML statt JSON, `404` | Funktion nicht veröffentlicht oder `/api/*` greift nicht (§2.5, `netlify.toml`) |

**Schritt 2 — nimmt Resend die Mail an?** Jetzt mit einer Adresse, die eingetragen ist. Bei
Erfolg geht wirklich eine Mail raus (Sperre: höchstens alle 30 Sekunden eine):

```bash
curl -i -X POST https://fms.alae.app/api/einladung \
  -H 'Content-Type: application/json' -d '{"mail":"eingetragene@adresse.ch"}'
```

`502` heisst: Resend hat abgelehnt. **Den Wortlaut nennt nur das Protokoll** — Netlify →
Site `fms` → **Logs** → **Functions** → `einladung`, Zeile `[einladung] Versand
fehlgeschlagen: Resend hat abgelehnt (HTTP …)`.

**Bestätigungsmail und Rücksetzmail:** Kommt statt der eigenen Mail die von Firebase, hat
der Rückfall gegriffen — der Aufruf der eigenen Schnittstelle ist gescheitert (die
Browserkonsole nennt den Grund: `[mail] /api/bestaetigung hat nicht übernommen (HTTP …)`).
Die Suche gilt dann nie der Adresse, sondern immer dem Aufruf: Schritt 1 und 2 sinngemäss
mit `/api/passwort`, Protokoll unter `bestaetigung` bzw. `passwort`.

### 4.2 Der Server sagt «verschickt», es kommt aber nichts an

Dann liegt es nicht mehr an dieser App: Resend hat die Mail angenommen, die Zustellung ist
danach gescheitert. Nachzusehen ist das in **Resend → Emails** — dort steht jede
angenommene Mail mit ihrem Ausgang:

| Dort steht | Bedeutung |
|---|---|
| gar kein Eintrag | Der Schlüssel gehört zu einem anderen Resend-Konto oder Team |
| `Delivered` | Zugestellt — dann liegt sie beim Empfänger (Spam, Filter, Weiterleitung) → §4.3 |
| `Bounced` | Der Empfänger hat abgelehnt; der Grund steht daneben |
| `Blocked` / Hinweis auf Testmodus | Ohne verifizierte Domain nimmt Resend nur die eigene Kontoadresse an |

Bis das geklärt ist: **«Links kopieren»** in der Liste und die Links per Chat weitergeben —
sie tun dasselbe wie die Knöpfe im Mail.

**Schritt 3 — Resend allein prüfen**, ohne Netlify und ohne Firebase dazwischen:

```bash
RESEND_API_KEY=re_… MAIL_ABSENDER='Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>' \
  npm run mailvorschau -- deine@adresse.ch
```

Scheitert schon das, liegt es am Schlüssel, an der Absenderadresse oder an der Domain —
und nicht an dieser App.

> **Der häufigste Fall zuerst:** Umgebungsvariablen wirken in den Funktionen erst mit
> einer neuen Veröffentlichung. Wer sie nach dem letzten Deploy gesetzt hat, muss einmal
> **Deploys → Trigger deploy → Clear cache and deploy site** auslösen — sonst läuft dort
> weiterhin der Stand ohne Schlüssel. Und: Bei gesperrtem Auto-Publishing muss der neue
> Deploy in Netlify **von Hand veröffentlicht** werden, sonst laufen die alten Funktionen
> weiter.

| Beobachtung | Ursache | Abhilfe |
|---|---|---|
| Firebase-Mail statt der eigenen (Bestätigung, Passwort) | Funktion antwortete nicht mit `gesendet` | §4.1 |
| Im Funktionsprotokoll steht gar nichts | Der Aufruf hat die Funktion nie erreicht | `netlify.toml` und Deploy prüfen (§2.5) |
| `502` mit `require() of ES Module …/jose/… not supported` | Die Funktion stirbt beim Laden von `firebase-admin`: Sein `jwks-rsa` holt `jose` per `require()`, und ab `jose` 6 ist das reines ESM — das lädt erst Node ≥ 22.12, AWS' `nodejs22.x` liegt darunter | Behoben durch `overrides: { "jose": "^5" }` in `package.json`. `npm run funktionstest` prüft es (läuft in der CI mit) |
| Log: `Resend hat abgelehnt (HTTP 401)` | Schlüssel falsch, abgelaufen oder aus einem anderen Resend-Konto | neuen Schlüssel erstellen (§2.2) |
| Log: `Einrichtung unvollständig` | `FIREBASE_SERVICE_ACCOUNT` fehlt oder ist kein gültiges JSON | 2.3/2.4 wiederholen, danach neu deployen |
| Log: `Resend hat abgelehnt (HTTP 403)` | Absenderdomain im Schlüssel nicht erlaubt | Schlüssel mit Domain `alae.app` neu erstellen |
| Log: `Resend hat abgelehnt (HTTP 422)` | `MAIL_ABSENDER` passt nicht zur verifizierten Domain | Adresse auf `…@alae.app` ändern |
| Mail kommt nur an die eigene Adresse | Resend läuft noch ohne verifizierte Domain | Resend → Domains → `alae.app` verifizieren |
| Mail landet im Spam oder unter «Werbung» | Ruf und Echtheitsnachweise des Absenders, Tracking, Aussehen der Mail | §4.3 |
| Logo fehlt im Mail | Bild wird von `SEITEN_URL` geladen | `SEITEN_URL` prüfen; `https://fms.alae.app/fms-neufeld.png` muss öffentlich erreichbar sein |
| «Link und E-Mail-Adresse passen nicht zusammen» | Andere Schreibweise als in der Einladung, oder der Code wurde inzwischen erneuert | Adresse genau wie eingetragen tippen; sonst «E-Mail schicken» — der Link im neuesten Mail gilt |
| «Zu viele Versuche» | Fünf Fehlversuche mit dieser Adresse | Zehn Minuten warten |

### 4.3 Mail landet im Spam oder unter «Werbung»

Zwei verschiedene Dinge, dieselbe Suche. Ob eine Mail **Spam** ist, entscheidet Gmail vor
allem nach Echtheit und Ruf des Absenders; ob sie unter **«Werbung»** einsortiert wird,
nach ihrem Aussehen (Knopf, Logo, Tracking, Abmelde-Link). Beides lernt Gmail je Postfach
dazu — was jemand einmal in den Posteingang zieht, bleibt dort.

**Was die App selbst tut** — nichts einzustellen, aber gut zu wissen:

- **Die Links der Einladung zeigen auf `fms.alae.app`**, nicht auf eine Firebase-Seite
  (`einladungsLinks` in `netlify/lib/mail.mjs`). Ein Link, der auf eine andere Domain
  zeigt als der Absender, ist für Spam-Filter ein Warnzeichen — und firebaseapp.com ist
  obendrein als Hoster von Phishing-Seiten berüchtigt.
- **Der Absender trägt immer einen Namen** (siehe §2.4).
- Jede Mail hat eine **reine Textfassung** neben dem HTML, **keinen Abmelde-Link** und
  **keine Zählpixel** — Merkmale von Werbung, die in einer Einladung nichts verloren haben.

**Was ausserhalb des Repos zu prüfen ist**, in dieser Reihenfolge:

| # | Wo | Was | Warum |
|---|---|---|---|
| 1 | Resend → **Domains** → `alae.app` | **Click Tracking** und **Open Tracking** ausschalten | Eingeschaltet schreibt Resend jeden Link auf eine Tracking-Domain um und hängt ein unsichtbares Bild an — zwei der stärksten Werbe-Signale, und der Link zeigt dann wieder auf eine fremde Domain. (Mail-Scanner, die Links vorab öffnen, verbrauchten früher den Einmal-Link; der Zugangscode übersteht das — das Tracking bleibt trotzdem aus.) |
| 2 | Netlify → **Environment variables** | `MAIL_ABSENDER` = `Besuchsmorgen FMS Neufeld <besuchsmorgen@alae.app>`, danach neu deployen | Steht nur die Adresse drin, zeigt Gmail sie nackt an. Die Funktion ergänzt den Namen zwar selbst; sauberer ist er in der Variablen. |
| 3 | Cloudflare → **DNS** (Seite 2 der Liste) | `_dmarc.alae.app` TXT muss vorhanden sein (`v=DMARC1; p=none;`, §2.1) | Gmail verlangt DMARC von Absendern mit Volumen und wertet fehlendes DMARC ab. Prüfen: `dig TXT _dmarc.alae.app +short` |
| 4 | Cloudflare → **Email** → **DMARC Management** | einschalten | Gratis. Cloudflare trägt eine `rua=`-Adresse in den DMARC-Eintrag und zeigt danach, wer alles im Namen von `alae.app` verschickt und ob SPF und DKIM stimmen. |
| 5 | wie 3 — nach ein, zwei Wochen ohne Befund in 4 | `p=none` → `p=quarantine` | Eine durchgesetzte Richtlinie zählt bei Gmail mehr als `p=none`. Sie gilt für **alle** Absender von alae.app, auch Photographic und die Firebase-Mails von `dt.alae.app` — darum erst die Berichte aus 4 abwarten. |
| 6 | Cloudflare → **Email** → **Routing Addresses** | Weiterleitung für `besuchsmorgen@alae.app` anlegen — oder `MAIL_ANTWORT` setzen (§2.4) | Rückfragen sollen ankommen; ein Absender, dessen Adresse keine Post annimmt, wirkt unseriös. |
| 7 | [postmaster.google.com](https://postmaster.google.com) | `alae.app` eintragen (ein TXT-Eintrag) | Zeigt Ruf der Domain und Spam-Quote aus Gmails Sicht — die einzige Stelle, an der man das sieht. |

Der SPF-Eintrag auf `alae.app` selbst (`include:_spf.mx.cloudflare.net`) muss Resend
**nicht** enthalten: Resend verschickt mit der Rücksendeadresse `…@send.alae.app`, und dort
steht der eigene SPF-Eintrag (§2.1). Für DMARC genügt das — Unterdomain und Domain gelten
als zusammengehörig.

**Beim Empfänger** — bei vier, fünf Betreuungspersonen der wirksamste Hebel: die Mail einmal
aus «Spam» beziehungsweise «Werbung» in den Posteingang holen («Kein Spam» / nach
«Allgemein» ziehen) und `besuchsmorgen@alae.app` als Kontakt speichern. Gmail merkt sich
das je Postfach; die weiteren Mails landen dann dort. Der Hinweis im Login («auch im
Spam-Ordner nachsehen») bleibt darum stehen.

**Was bleibt:** Bestätigungsmail und Passwort-Zurücksetzen zeigen weiterhin auf
`fmsbesuchstag.firebaseapp.com` (§6).

### 4.4 «Der Link zum Anmelden funktioniert nicht»

So hiess die Rückmeldung von zwei Personen am Tag der Umstellung. Aus der Ferne lässt sich
nicht sagen, welcher Fall es war — aber der frühere Einmal-Link von Firebase hatte vier
bekannte Stolpersteine, und jeder davon führte zu genau dieser Meldung:

| Was passiert ist | Warum | Heute |
|---|---|---|
| **Das Mail lag im Spam oder unter «Werbung»**, die Person fand es nicht | siehe §4.3 | unverändert — darum die Liste in §4.3 abarbeiten |
| **Im Mailprogramm angetippt, danach im Browser nicht angemeldet.** Die Gmail-App auf dem iPhone öffnet Links in einem eingebauten Browser mit eigenem Speicher. Dort war die Person angemeldet — in Safari nicht. Zweiter Versuch mit dem Link: «schon verwendet» | Der Einmal-Link galt einmal und nur dort, wo er geöffnet wurde | Der Zugangscode gilt beliebig oft: Link im richtigen Browser nochmals öffnen, Adresse tippen, drin |
| **Der Link wurde vorab «angeklickt»** — von einem Sicherheitsscanner des Schul-Postfachs oder vom Tracking in Resend | Das verbrauchte den Einmal-Link, bevor ein Mensch ihn sah | Der Zugangscode übersteht das; beim Einlösen braucht es die Adresse |
| **Eine andere Schreibweise der Adresse eingetippt** als in der Einladung (Alias, Tippfehler) | Firebase meldete nur `auth/invalid-action-code` — der Bildschirm zeigte den Kode roh | «Link und E-Mail-Adresse passen nicht zusammen», mit dem Hinweis, genau die eingeladene Adresse zu tippen |

Und ein Fünftes, das nichts mit dem Link zu tun hat: Die Korrektur aus dem vorherigen
Schritt (Link auf `fms.alae.app` statt `firebaseapp.com`) war zwar gemerged, aber bei
gesperrtem Auto-Publishing **noch nicht veröffentlicht** — die Mails vom selben Tag trugen
noch den alten Link.

**Was der Person zu sagen ist**, die es jetzt nochmals versucht:

1. Die Administration schickt die Einladung neu («E-Mail schicken» in der Liste) — oder die
   Person tippt im Login «Einladung nochmals per E-Mail schicken». Alte Anmeldelinks aus
   früheren Mails gelten nicht mehr; die App sagt das, wenn jemand einen öffnet.
2. Im Mail **«Jetzt anmelden»** tippen, in der App die **Adresse aus der Einladung**
   eintippen. Auf jedem weiteren Gerät denselben Link nochmals öffnen.
3. Wer lieber ein Passwort hat oder die App als Verknüpfung auf dem Startbildschirm nutzt:
   **«Login erstellen»** im Mail — einmal ein Passwort festlegen, danach überall mit E-Mail
   und Passwort anmelden.

---

## 5 · Text oder Aussehen ändern

Alles steckt in `netlify/lib/mail.mjs`:

- `einladungsMail()`, `bestaetigungsMail()` und `passwortMail()` — Betreff, Titel,
  Knopfbeschriftung, die Hinweiszeilen unter den Knöpfen und die Vorschauzeile fürs
  Postfach. Jede Mail steht **zweimal** da: als HTML und als reine Textfassung darunter —
  beide gehören geändert
- `einladungsLinks()` — welche Knöpfe die Einladung bekommt (Rolle, Haken)
- `KLEINGEDRUCKTES` (Bestätigung, Passwort) und `EINLADUNG_KLEIN` (Einladung) — der eine
  Satz unter den Knöpfen
- `geruest()` — Logo, Farben, Abstände; für alle Mails dasselbe, mit einem oder zwei
  Knöpfen (`knoepfe`). Die Farben sind dieselben wie in `src/index.css`.

Nach jeder Änderung `npm run mailvorschau` und die Datei im Browser ansehen.

Das Gerüst ist bewusst mit Tabellen und Attributen gebaut statt mit moderner Anordnung:
Outlook auf Windows rendert bis heute mit der Word-Maschine, und dort fällt alles andere
zusammen.

---

## 6 · Was bewusst **nicht** umgestellt wurde

- **Bestätigungslink und Rücksetzlink** zeigen weiterhin auf
  `fmsbesuchstag.firebaseapp.com`: Dort löst die Firebase-Seite den Code ein (Adresse
  bestätigen, neues Passwort setzen). Eine eigene Adresse dafür verlangt, dass die App
  diese beiden Abläufe selbst bedient (`applyActionCode`, `confirmPasswordReset` samt
  Bildschirm für das neue Passwort) — deutlich mehr Aufwand als Nutzen für vier Konten.
  **Die Einladung** ist die Ausnahme: Ihre Links werden ohnehin in der App eingelöst und
  zeigen darum direkt auf `fms.alae.app` (§1.1).
- **Gäste bekommen weiterhin keine Mail.** Das ist Absicht: Die App erhebt bewusst keine
  Personendaten (siehe [01-fachkonzept §7](01-fachkonzept.md)).

---

## 7 · Verwandtschaft zur Photographic-App

Beide Apps verschicken von derselben Domain `alae.app`, aber auf verschiedenen Wegen:

| | Besuchsmorgen (diese App) | Photographic |
|---|---|---|
| Versand | Resend-API aus einer Netlify-Funktion | SMTP (`nodemailer`) aus dem eigenen Backend |
| Vorlage | `netlify/lib/mail.mjs` | `backend/src/lib/email.ts` |
| Absender | `…@alae.app` | `no-reply@alae.app` |

Die verifizierte Resend-Domain gilt für beide. Photographic liesse sich mit
`SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`, `SMTP_PASS=<API-Key>`
ohne Kodeänderung ebenfalls über Resend schicken — dann liegt die Zustellung beider Apps
in einem Konto mit einer Statistik.
