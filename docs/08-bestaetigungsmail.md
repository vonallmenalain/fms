# 08 · Eigene Mails an die Betreuung (Resend)

Der Betreuungsbereich verschickt zwei Mails:

| Mail | Wann |
|---|---|
| **Bestätigungsmail** | nach «Konto erstellen» — `firestore.rules` verlangt `email_verified` |
| **Anmeldelink** | Anmelden ohne Passwort; auch beim Einladen unter «Steuerung → Zugänge» |
| **Passwort zurücksetzen** | über «Passwort vergessen?» im Login |

Bisher verschickte **Firebase** sie alle: englisch angehauchtes Standardlayout, Absender
`noreply@fmsbesuchstag.firebaseapp.com`.

Neu verschickt die App sie **selbst**: eigene Gestaltung mit FMS-Logo, Absender auf
`alae.app`, Zustellung über **Resend**.

---

## 1 · Wie es funktioniert

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

**Wer darf eine Mail auslösen?** Die beiden Wege beantworten das verschieden:

- **Bestätigungsmail:** Es zählt das mitgeschickte **ID-Token**, nicht die Adresse im
  Formular. Verschickt wird nur an die Adresse, die im Token steht — sonst könnte jede und
  jeder über diese Schnittstelle fremde Adressen anschreiben lassen.
- **Anmeldelink und Passwort:** Hier ist noch niemand angemeldet, die Adresse kommt
  ungeprüft aus dem Formular. Darum verschicken diese Funktionen nur an Adressen, die
  **eingeladen** (Dokument in `zugang`) oder **bereits freigeschaltet** (Konto in `admins`)
  sind — die gemeinsame Schranke `darfPostBekommen` in `netlify/lib/dienst.mjs`. Alle
  anderen bekommen nichts, und **dieselbe Antwort wie alle**, damit sich nicht
  durchprobieren lässt, wer an der Schule Zugang hat. Für die Person am Bildschirm ändert
  das nichts: Ein Link an eine nicht eingeladene Adresse führte ohnehin nur auf «Kein
  Zugang».

  Beim Zurücksetzen kommt eine zweite Bedingung dazu: Es muss zu der Adresse ein **Konto
  mit Passwort** geben. Firebase liesse ein Zurücksetzen auch für reine Google-Konten zu —
  und legte dort stillschweigend ein Passwort an.

Beide Wege lassen an dieselbe Adresse höchstens alle 30 Sekunden eine Mail zu.

Warum ein Server nötig ist: Der Resend-Schlüssel und der Firebase-Dienstschlüssel dürfen
niemals ins Browser-Bündel — wer sie hat, verschickt Post von deiner Domain.

**Fällt irgendetwas davon aus** (Schlüssel fehlt, Resend gestört, lokaler
Entwicklungsserver ohne Funktionen), verschickt Firebase die Mail wie bisher selbst.
Niemand bleibt vor der Tür stehen; die Mail sieht dann nur wieder nüchtern aus.

| Datei | Rolle |
|---|---|
| `netlify/functions/bestaetigung.mjs` | `POST /api/bestaetigung` — Token prüfen, Link erzeugen, Mail auslösen |
| `netlify/functions/anmeldelink.mjs` | `POST /api/anmeldelink` — Adresse prüfen, Link erzeugen, Mail auslösen |
| `netlify/functions/passwort.mjs` | `POST /api/passwort` — dasselbe für das Zurücksetzen |
| `netlify/lib/mail.mjs` | Vorlagen (Logo, Farben, Text) und Versand über die Resend-API |
| `netlify/lib/dienst.mjs` | Admin-SDK, die Schranke, einheitliche Antworten, die 30-Sekunden-Sperre |
| `src/zugang.ts` | Ruft die Schnittstellen auf, mit Rückfall auf Firebase |
| `scripts/mailvorschau.mjs` | Vorschau im Browser und Testversand |
| `scripts/mailtest.mjs` | 19 Prüfungen gegen die Emulator Suite (`npm run mailtest`) |

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
| `MAIL_ABSENDER` | `FMS Neufeld <besuchsmorgen@alae.app>` | ja |
| `FIREBASE_SERVICE_ACCOUNT` | **der ganze Inhalt** der JSON-Datei aus 2.3 | ja |
| `MAIL_ANTWORT` | Adresse für Antworten, z. B. deine eigene | nein |
| `SEITEN_URL` | nur falls die Hauptadresse nicht `https://fms.alae.app` ist | nein |

Zum Einfügen von `FIREBASE_SERVICE_ACCOUNT`: JSON-Datei im Editor öffnen, **alles**
markieren (inklusive der geschweiften Klammern) und ins Wertfeld einfügen. Zeilenumbrüche
im Schlüssel sind kein Problem — die Funktion behandelt beide Schreibweisen.

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

**Echter Testversand** (beide Mails an eine beliebige Adresse):

```bash
RESEND_API_KEY=re_… MAIL_ABSENDER='FMS Neufeld <besuchsmorgen@alae.app>' \
  npm run mailvorschau -- deine@adresse.ch
```

**Automatisch prüfen** — der echte Funktionskode gegen die Firebase-Emulatoren,
Resend wird dabei abgefangen, es geht keine Post raus:

```bash
npm run mailtest                # 19 Prüfungen, startet die Emulatoren selbst
```

Darin steckt auch die Schranke aus §1: eingeladen → Mail, nicht eingeladen → keine Mail,
beide Male dieselbe Antwort.

**Der ganze Weg durch die App:**

1. `https://fms.alae.app/admin` → **Konto erstellen** → eine Adresse verwenden, die noch
   kein Konto hat
2. Die Mail muss innert Sekunden ankommen — mit Logo, Absender `alae.app`
3. Auf **E-Mail bestätigen** tippen, danach in der App auf **Ich habe bestätigt**
4. Für den Anmeldelink: **Steuerung → Zugänge** → eine Adresse eintragen und
   «Anmeldelink schicken» ankreuzen — oder im Login **«Anmeldelink per E-Mail schicken»**
   mit einer bereits eingeladenen Adresse
5. Für das Zurücksetzen: im Login die Adresse eintippen und **«Passwort vergessen?»**

Kommt trotzdem die Firebase-Mail, hat der Rückfall gegriffen: In Netlify → **Logs** →
**Functions** → `bestaetigung` steht die Ursache.

---

## 4 · Wenn etwas klemmt

### 4.1 Kommt weiterhin die Firebase-Mail — in drei Schritten eingrenzen

Eine Firebase-Mail **beweist**, dass der Aufruf der eigenen Schnittstelle fehlgeschlagen
ist: Hätte die Funktion geantwortet, gäbe es gar keinen Rückfall — auch dann nicht, wenn
sie bewusst nichts verschickt (nicht eingeladene Adresse). Die Suche gilt also nie der
Adresse, sondern immer dem Aufruf.

**Schritt 0 — die Meldung beim Einladen lesen.** Wer als Administration einlädt, schickt
sein ID-Token mit, und die Schnittstelle antwortet dann **ehrlich** statt neutral. Der
Bildschirm sagt also direkt, was passiert ist:

| Meldung | Bedeutung |
|---|---|
| «Anmeldelink an … verschickt» | Resend hat die Mail angenommen → kommt trotzdem nichts an, weiter bei §4.2 |
| «der Server findet die Adresse weder unter den Zugängen noch unter den Konten» | Die Schranke hat abgeblockt — meist eine andere Schreibweise der Adresse |
| «vor weniger als 30 Sekunden schon einer» | Die Sperre; der erste Link gilt weiterhin |
| «über Firebase statt über alae.app» | Der eigene Versand hat nicht geantwortet, der Grund steht dabei |

Dazu schreibt die App den technischen Grund in die Browserkonsole:
`[mail] /api/anmeldelink hat nicht übernommen (HTTP …)`.

**Schritt 1 — antwortet die Funktion überhaupt?** Der Aufruf verschickt nichts, weil die
Adresse nicht eingeladen ist:

```bash
curl -i -X POST https://fms.alae.app/api/anmeldelink \
  -H 'Content-Type: application/json' -d '{"mail":"niemand@example.com"}'
```

| Antwort | Bedeutung |
|---|---|
| `200` + `{"stand":"erledigt"}` | Funktion läuft, Dienstkonto und Datenbank sind in Ordnung → weiter mit Schritt 2 |
| `503` | `FIREBASE_SERVICE_ACCOUNT` fehlt oder ist ungültig (§2.3/2.4) |
| HTML statt JSON, `404` | Funktion nicht veröffentlicht oder `/api/*` greift nicht (§2.5, `netlify.toml`) |

**Schritt 2 — nimmt Resend die Mail an?** Jetzt mit der Adresse, die eingeladen ist. Bei
Erfolg geht wirklich eine Mail raus (Sperre: höchstens alle 30 Sekunden eine):

```bash
curl -i -X POST https://fms.alae.app/api/anmeldelink \
  -H 'Content-Type: application/json' -d '{"mail":"eingeladene@adresse.ch"}'
```

`502` heisst: Resend hat abgelehnt. **Den Wortlaut nennt nur das Protokoll** — Netlify →
Site `fms` → **Logs** → **Functions** → `anmeldelink`, Zeile `[anmeldelink] Versand
fehlgeschlagen: Resend hat abgelehnt (HTTP …)`.

### 4.2 Der Server sagt «verschickt», es kommt aber nichts an

Dann liegt es nicht mehr an dieser App: Resend hat die Mail angenommen, die Zustellung ist
danach gescheitert. Nachzusehen ist das in **Resend → Emails** — dort steht jede
angenommene Mail mit ihrem Ausgang:

| Dort steht | Bedeutung |
|---|---|
| gar kein Eintrag | Der Schlüssel gehört zu einem anderen Resend-Konto oder Team |
| `Delivered` | Zugestellt — dann liegt sie beim Empfänger (Spam, Filter, Weiterleitung) |
| `Bounced` | Der Empfänger hat abgelehnt; der Grund steht daneben |
| `Blocked` / Hinweis auf Testmodus | Ohne verifizierte Domain nimmt Resend nur die eigene Kontoadresse an |

**Schritt 3 — Resend allein prüfen**, ohne Netlify und ohne Firebase dazwischen:

```bash
RESEND_API_KEY=re_… MAIL_ABSENDER='FMS Neufeld <besuchsmorgen@alae.app>' \
  npm run mailvorschau -- deine@adresse.ch
```

Scheitert schon das, liegt es am Schlüssel, an der Absenderadresse oder an der Domain —
und nicht an dieser App.

> **Der häufigste Fall zuerst:** Umgebungsvariablen wirken in den Funktionen erst mit
> einer neuen Veröffentlichung. Wer sie nach dem letzten Deploy gesetzt hat, muss einmal
> **Deploys → Trigger deploy → Clear cache and deploy site** auslösen — sonst läuft dort
> weiterhin der Stand ohne Schlüssel.

| Beobachtung | Ursache | Abhilfe |
|---|---|---|
| Firebase-Mail statt der eigenen | Funktion antwortete nicht mit `gesendet` | Schritt 0–3 oben |
| Im Funktionsprotokoll steht gar nichts | Der Aufruf hat die Funktion nie erreicht | `netlify.toml` und Deploy prüfen (§2.5) |
| `502` mit `require() of ES Module …/jose/… not supported` | Die Funktion stirbt beim Laden von `firebase-admin`: Sein `jwks-rsa` holt `jose` per `require()`, und ab `jose` 6 ist das reines ESM — das lädt erst Node ≥ 22.12, AWS' `nodejs22.x` liegt darunter | Behoben durch `overrides: { "jose": "^5" }` in `package.json`. `npm run funktionstest` prüft es (läuft in der CI mit) |
| Log: `Resend hat abgelehnt (HTTP 401)` | Schlüssel falsch, abgelaufen oder aus einem anderen Resend-Konto | neuen Schlüssel erstellen (§2.2) |
| Log: `Einrichtung unvollständig` | `FIREBASE_SERVICE_ACCOUNT` fehlt oder ist kein gültiges JSON | 2.3/2.4 wiederholen, danach neu deployen |
| Log: `Resend hat abgelehnt (HTTP 403)` | Absenderdomain im Schlüssel nicht erlaubt | Schlüssel mit Domain `alae.app` neu erstellen |
| Log: `Resend hat abgelehnt (HTTP 422)` | `MAIL_ABSENDER` passt nicht zur verifizierten Domain | Adresse auf `…@alae.app` ändern |
| Mail kommt nur an die eigene Adresse | Resend läuft noch ohne verifizierte Domain | Resend → Domains → `alae.app` verifizieren |
| Mail landet im Spam | DMARC steht auf `p=none`, Domain ist neu im Versand | einige Mails abwarten; später `p=quarantine` erwägen |
| Logo fehlt im Mail | Bild wird von `SEITEN_URL` geladen | `SEITEN_URL` prüfen; `https://fms.alae.app/fms-neufeld.png` muss öffentlich erreichbar sein |

---

## 5 · Text oder Aussehen ändern

Alles steckt in `netlify/lib/mail.mjs`:

- `bestaetigungsMail()`, `anmeldelinkMail()` und `passwortMail()` — Betreff, Titel,
  Knopfbeschriftung und die Vorschauzeile fürs Postfach. Jede Mail steht **zweimal** da:
  als HTML und als reine Textfassung darunter — beide gehören geändert
- `KLEINGEDRUCKTES` — der eine Satz unter dem Knopf, in allen drei Mails derselbe
- `geruest()` — Logo, Farben, Abstände; für alle drei Mails dasselbe. Die Farben sind dieselben
  wie in `src/index.css`.

Nach jeder Änderung `npm run mailvorschau` und die Datei im Browser ansehen.

Das Gerüst ist bewusst mit Tabellen und Attributen gebaut statt mit moderner Anordnung:
Outlook auf Windows rendert bis heute mit der Word-Maschine, und dort fällt alles andere
zusammen.

---

## 6 · Was bewusst **nicht** umgestellt wurde

- **Die Adresse hinter dem Link** zeigt weiterhin auf `fmsbesuchstag.firebaseapp.com`.
  Eine eigene Adresse dafür verlangt, dass die App den Firebase-Aktionsablauf
  (`/__/auth/action`) selbst bedient — deutlich mehr Aufwand als Nutzen für vier Konten.
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
