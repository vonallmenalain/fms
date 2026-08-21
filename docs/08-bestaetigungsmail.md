# 08 · Eigene Bestätigungsmail (Resend)

Wer im Betreuungsbereich ein Konto anlegt, muss seine E-Mail-Adresse bestätigen —
`firestore.rules` verlangt `email_verified`. Bisher verschickte **Firebase** diese Mail:
englisch angehauchtes Standardlayout, Absender `noreply@fmsbesuchstag.firebaseapp.com`.

Neu verschickt die App die Mail **selbst**: eigene Gestaltung mit FMS-Logo, Absender auf
`alae.app`, Zustellung über **Resend**.

---

## 1 · Wie es funktioniert

```
Browser                      Netlify-Funktion                 Firebase        Resend
  │  POST /api/bestaetigung        │                              │              │
  │  { idToken } ─────────────────►│                              │              │
  │                                │ ID-Token prüfen ────────────►│              │
  │                                │ Bestätigungslink erzeugen ──►│              │
  │                                │ Mail mit Logo + Link ───────────────────────►│
  │◄──── { stand: "gesendet" } ────│                              │       Zustellung
```

Wichtig: **Die Prüfung der Adresse bleibt bei Firebase.** Wir erzeugen mit dem Admin-SDK
genau denselben Einmal-Link, den Firebase sonst selbst verschickt hätte, und tauschen nur
Verpackung und Briefträger aus. Am Anmeldeablauf, an den Security Rules und am
`email_verified`-Merkmal ändert sich nichts.

Warum ein Server nötig ist: Der Resend-Schlüssel und der Firebase-Dienstschlüssel dürfen
niemals ins Browser-Bündel — wer sie hat, verschickt Post von deiner Domain.

**Fällt irgendetwas davon aus** (Schlüssel fehlt, Resend gestört, lokaler
Entwicklungsserver ohne Funktionen), verschickt Firebase die Mail wie bisher selbst.
Niemand bleibt vor der Tür stehen; die Mail sieht dann nur wieder nüchtern aus.

| Datei | Rolle |
|---|---|
| `netlify/functions/bestaetigung.mjs` | Die Schnittstelle: Token prüfen, Link erzeugen, Mail auslösen |
| `netlify/lib/mail.mjs` | Vorlage (Logo, Farben, Text) und Versand über die Resend-API |
| `src/zugang.ts` → `bestaetigungSenden` | Ruft die Schnittstelle auf, mit Rückfall auf Firebase |
| `scripts/mailvorschau.mjs` | Vorschau im Browser und Testversand |

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

**Echter Testversand** (an eine beliebige Adresse):

```bash
RESEND_API_KEY=re_… MAIL_ABSENDER='FMS Neufeld <besuchsmorgen@alae.app>' \
  npm run mailvorschau -- deine@adresse.ch
```

**Der ganze Weg durch die App:**

1. `https://fms.alae.app/admin` → **Konto erstellen** → eine Adresse verwenden, die noch
   kein Konto hat
2. Die Mail muss innert Sekunden ankommen — mit Logo, Absender `alae.app`
3. Auf **E-Mail bestätigen** tippen, danach in der App auf **Ich habe bestätigt**

Kommt trotzdem die Firebase-Mail, hat der Rückfall gegriffen: In Netlify → **Logs** →
**Functions** → `bestaetigung` steht die Ursache.

---

## 4 · Wenn etwas klemmt

| Beobachtung | Ursache | Abhilfe |
|---|---|---|
| Firebase-Mail statt der eigenen | Funktion antwortete nicht mit `gesendet` | Netlify-Funktionsprotokoll lesen |
| Log: `Einrichtung unvollständig` | `FIREBASE_SERVICE_ACCOUNT` fehlt oder ist kein gültiges JSON | 2.3/2.4 wiederholen, danach neu deployen |
| Log: `Resend hat abgelehnt (HTTP 403)` | Absenderdomain im Schlüssel nicht erlaubt | Schlüssel mit Domain `alae.app` neu erstellen |
| Log: `Resend hat abgelehnt (HTTP 422)` | `MAIL_ABSENDER` passt nicht zur verifizierten Domain | Adresse auf `…@alae.app` ändern |
| Mail kommt nur an die eigene Adresse | Resend läuft noch ohne verifizierte Domain | Resend → Domains → `alae.app` verifizieren |
| Mail landet im Spam | DMARC steht auf `p=none`, Domain ist neu im Versand | einige Mails abwarten; später `p=quarantine` erwägen |
| Logo fehlt im Mail | Bild wird von `SEITEN_URL` geladen | `SEITEN_URL` prüfen; `https://fms.alae.app/fms-neufeld.png` muss öffentlich erreichbar sein |

---

## 5 · Text oder Aussehen ändern

Alles steckt in `netlify/lib/mail.mjs`:

- `bestaetigungsMail()` — Betreff, Titel, der eine Satz, Knopfbeschriftung, Kleingedrucktes
- `geruest()` — Logo, Farben, Abstände. Die Farben sind dieselben wie in `src/index.css`.

Nach jeder Änderung `npm run mailvorschau` und die Datei im Browser ansehen.

Das Gerüst ist bewusst mit Tabellen und Attributen gebaut statt mit moderner Anordnung:
Outlook auf Windows rendert bis heute mit der Word-Maschine, und dort fällt alles andere
zusammen.

---

## 6 · Was bewusst **nicht** umgestellt wurde

- **Der Anmeldelink** (`sendSignInLinkToEmail` in `src/zugang.ts`) kommt weiterhin von
  Firebase. Er lässt sich mit derselben Mechanik umstellen —
  `getAuth().generateSignInWithEmailLink(mail, { url, handleCodeInApp: true })` in einer
  zweiten Funktion, dazu eine zweite Vorlage in `netlify/lib/mail.mjs`.
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
