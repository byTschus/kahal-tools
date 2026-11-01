# Einrichtung – Schritt für Schritt

Diese Anleitung beschreibt alles, was **von Hand** gemacht werden muss. Reihenfolge:

1. [GitHub-Repository anlegen und Code hochladen](#1-github-repository)
2. [Lokale Entwicklungsumgebung (VS Code + Docker)](#2-lokale-entwicklungsumgebung)
3. [Planning Center: OAuth-App registrieren](#3-planning-center-oauth-app)
4. [Google / YouTube: API-Zugang einrichten](#4-google--youtube-api)
5. [Infomaniak: Node.js-Hosting + Datenbank](#5-infomaniak-nodejs-hosting)
6. [Infomaniak Public Cloud: Podcast-Worker](#6-infomaniak-public-cloud-podcast-worker)
7. [Erste Schritte im Tool](#7-erste-schritte-im-tool)
8. [Podcast bei Apple / Spotify anmelden](#8-podcast-bei-apple--spotify-anmelden)
9. [Updates einspielen](#9-updates-einspielen)
10. [Probleme & Lösungen](#10-probleme--lösungen)

> **Platzhalter:** `tools.deine-domain.ch` steht für die Domain, unter der das Tool später läuft. Ersetze sie überall durch deine echte Domain.

---

## 1. GitHub-Repository

Der Code liegt bereits lokal in `C:\Repos\kahal.tools` (Git-Repository mit erstem Commit). Es fehlt nur das Repository auf GitHub:

1. Auf <https://github.com/new> gehen.
2. **Repository name:** `kahal-tools`
3. **Private** wählen (empfohlen).
4. **Nichts** ankreuzen (kein README, keine .gitignore, keine Lizenz) – sonst gibt es Konflikte.
5. **Create repository** klicken.
6. In PowerShell oder im VS-Code-Terminal (`DEIN-GITHUB-NAME` ersetzen):

   ```bash
   cd C:\Repos\kahal.tools
   git remote add origin https://github.com/DEIN-GITHUB-NAME/kahal-tools.git
   git push -u origin main
   ```

   Beim ersten Push öffnet sich ein Browserfenster zur GitHub-Anmeldung (Git Credential Manager).

> Tipp: Mit der GitHub CLI geht es in einem Schritt: `winget install GitHub.cli`, dann `gh auth login` und `gh repo create kahal-tools --private --source . --push`.

---

## 2. Lokale Entwicklungsumgebung

### Voraussetzungen (einmalig)

* [Node.js LTS](https://nodejs.org) (≥ 20.12)
* [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* [VS Code](https://code.visualstudio.com) – beim Öffnen des Ordners schlägt VS Code die empfohlenen Erweiterungen vor (installieren).

### Variante A: Node direkt unter Windows, Datenbank in Docker (empfohlen, am schnellsten)

```bash
cd C:\Repos\kahal.tools
copy .env.example .env
npm install
docker compose up -d db
npm run db:deploy
npm run dev
```

Öffne <http://localhost:5173>. Solange `ENABLE_MOCK_PLANNING=true` in der `.env` steht, gibt es den Button **„Mit Demo (lokal) anmelden“** – eine Fake-Gemeinde mit Testplänen. Damit kannst du alles ohne Planning Center ausprobieren.

Debuggen: In VS Code **Ausführen und Debuggen → „Server debuggen“**.

### Variante B: Alles im Container (VS Code Dev Container)

1. Erweiterung **Dev Containers** installieren.
2. `F1` → **Dev Containers: Reopen in Container**.
3. Im VS-Code-Terminal: `npm run dev`.

### Podcast-Worker lokal testen

```bash
docker compose --profile worker up --build
```

Der Worker holt sich Aufträge von deinem lokalen Server. Für einen echten Test braucht es ein FTP-Ziel (Einstellungen → Podcast) und einen verbundenen YouTube-Kanal.

### Echte Planning-Center- / YouTube-Logins lokal

Trage die Zugangsdaten aus Schritt 3 und 4 in die `.env` ein und registriere zusätzlich die lokalen Redirect-URLs (siehe dort). Danach `npm run dev` neu starten.

---

## 3. Planning Center: OAuth-App

1. Mit einem Planning-Center-Konto anmelden und <https://api.planningcenteronline.com/oauth/applications> öffnen.
2. **New Application** → Name `kahal.tools`, optional Beschreibung/Logo.
3. **Callback URLs / Redirect URIs** – beide eintragen:
   * `https://tools.deine-domain.ch/auth/pco/callback`
   * `http://localhost:5173/auth/pco/callback` (für die lokale Entwicklung)
4. Speichern. Kopiere **Client ID** und **Secret** in die `.env`:

   ```
   PCO_CLIENT_ID=...
   PCO_CLIENT_SECRET=...
   ```

Benötigte Rechte (werden beim Login abgefragt): `people` (Person & Gemeinde erkennen, Personen zum Einladen suchen) und `services` (Pläne, Teams, Items).

> Diese eine App funktioniert für **alle** Gemeinden. Jede Person meldet sich mit ihrem eigenen PCO-Konto an; das Tool erkennt die Gemeinde automatisch.

---

## 4. Google / YouTube API

1. <https://console.cloud.google.com> öffnen → oben **Projekt auswählen → Neues Projekt** → Name `kahal-tools` → Erstellen.
2. **APIs & Dienste → Bibliothek** → „**YouTube Data API v3**“ suchen → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. „Google Auth Platform“):
   * Nutzertyp **Extern**, App-Name `kahal.tools`, Support-E-Mail, Kontakt-E-Mail.
   * **Datenzugriff / Bereiche:** `https://www.googleapis.com/auth/youtube` hinzufügen.
   * **Zielgruppe / Testnutzer:** die Google-Konten eintragen, die YouTube verbinden werden.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   * Anwendungstyp **Webanwendung**
   * **Autorisierte Weiterleitungs-URIs:**
     * `https://tools.deine-domain.ch/api/integrations/streaming/youtube/callback`
     * `http://localhost:5173/api/integrations/streaming/youtube/callback`
5. **Client-ID** und **Clientschlüssel** in die `.env`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

> ⚠️ **Wichtig – App veröffentlichen:** Solange die App im Status „Testing“ ist, laufen die Google-Tokens **nach 7 Tagen ab** und YouTube muss neu verbunden werden. Unter **Zielgruppe → App veröffentlichen** auf „In Produktion“ stellen. Ohne Google-Verifizierung erscheint beim Verbinden ein Warnhinweis („Google hat diese App nicht überprüft“) → **Erweitert → Weiter zu kahal.tools**. Das ist für den Eigengebrauch in Ordnung (bis 100 Nutzer). Für viele Gemeinden später die Verifizierung bei Google beantragen.

> **Kontingent:** Die YouTube-API erlaubt 10'000 Einheiten pro Tag und Google-Projekt (Livestream erstellen ≈ 50–100, Liste abrufen = 1). Für einige Gemeinden reicht das gut. Bei vielen Gemeinden in der Google Console unter „Kontingente“ eine Erhöhung beantragen.

---

## 5. Infomaniak Node.js-Hosting

> Die Bezeichnungen im Infomaniak Manager können leicht abweichen; das Prinzip bleibt gleich.

### 5.1 Datenbank anlegen

1. Infomaniak Manager → **Webhosting** → dein Hosting → **Datenbanken** → **Datenbank hinzufügen** (MySQL/MariaDB).
2. Einen **Datenbank-Benutzer** mit Lese-/Schreibrechten für diese Datenbank anlegen.
3. Notiere **Server/Host**, **Datenbankname**, **Benutzer**, **Passwort**.

### 5.2 Node.js-Site anlegen

1. Manager → Webhosting → **Website hinzufügen** → Typ **Node.js** → Domain `tools.deine-domain.ch` wählen.
2. **Node.js-Version:** die neueste LTS (mind. 20).
3. **SSL-Zertifikat** (Let's Encrypt) für die Domain aktivieren.

### 5.3 Code per SSH holen

1. Manager → Hosting → **FTP / SSH** → SSH-Zugang aktivieren und Benutzer/Passwort notieren.
2. Damit der Server das **private** GitHub-Repo klonen darf, einen Deploy-Key anlegen (per SSH auf dem Hosting):

   ```bash
   ssh-keygen -t ed25519 -C "infomaniak-kahal" -f ~/.ssh/kahal_deploy -N ""
   cat ~/.ssh/kahal_deploy.pub
   ```

   Ausgabe kopieren → GitHub → Repository `kahal-tools` → **Settings → Deploy keys → Add deploy key** (nur lesen genügt).

   ```bash
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     IdentityFile ~/.ssh/kahal_deploy
   EOF
   ```

3. In den Ordner der Site wechseln (der Pfad wird im Manager bei der Site angezeigt) und klonen:

   ```bash
   cd ~/sites/tools.deine-domain.ch      # Pfad anpassen
   git clone git@github.com:DEIN-GITHUB-NAME/kahal-tools.git .
   ```

### 5.4 Konfiguration (.env)

```bash
cp .env.example .env
nano .env
```

Werte setzen:

```
APP_URL=https://tools.deine-domain.ch
NODE_ENV=production
PORT=3000                          # muss mit dem Port in den Site-Einstellungen übereinstimmen
DATABASE_URL=mysql://BENUTZER:PASSWORT@HOST:3306/DATENBANK
SESSION_SECRET=...                 # zufällig, mind. 32 Zeichen
ENCRYPTION_KEY=...                 # zufällig, mind. 32 Zeichen – NIE mehr ändern!
WORKER_TOKEN=...                   # zufällig, mind. 32 Zeichen – gleicher Wert beim Worker
PCO_CLIENT_ID=...
PCO_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ENABLE_MOCK_PLANNING=false
RUN_SCHEDULER=true
```

Zufallswerte erzeugen (auf dem Server): `openssl rand -base64 48`
Sonderzeichen im DB-Passwort müssen in der `DATABASE_URL` URL-kodiert werden (z.B. `@` → `%40`).

### 5.5 Build- und Startbefehl

In den Einstellungen der Node.js-Site:

| Feld | Wert |
| --- | --- |
| **Build-Befehl** | `npm ci --include=dev && npm run build` |
| **Start-/Ausführungsbefehl** | `npm start` |
| **Port** | `3000` (gleich wie `PORT` in der `.env`) |

Alternativ per SSH: `npm ci --include=dev && npm run build`, danach die Site im Manager (neu) starten.
Beim Start werden die Datenbank-Tabellen automatisch angelegt bzw. migriert.

Test: <https://tools.deine-domain.ch/api/health> sollte `{"ok":true}` zeigen.

---

## 6. Infomaniak Public Cloud: Podcast-Worker

Der Worker lädt den YouTube-Ausschnitt, erstellt die MP3 und lädt sie hoch. Er braucht **keine eingehenden Ports** und fragt den Server selbst nach Arbeit.

### 6.1 Instanz erstellen (so günstig wie möglich)

1. Manager → **Public Cloud** → Projekt erstellen (falls noch nicht vorhanden) → **Horizon-Dashboard** öffnen.
2. **Compute → Key Pairs → Create Key Pair** (oder deinen öffentlichen SSH-Schlüssel importieren).
3. **Compute → Instances → Launch Instance:**
   * **Source:** Image **Ubuntu 24.04**
   * **Flavor:** die **kleinste verfügbare** Variante (1 vCPU, 1–2 GB RAM). Das reicht für einen Podcast nach dem anderen.
   * **Volume:** Standard (z.B. 20 GB) genügt – Dateien werden nach dem Upload sofort gelöscht.
   * **Networks:** `ext-net1` (öffentlich)
   * **Security Groups:** eine Gruppe, die **eingehend nur SSH (Port 22)** erlaubt – am besten nur von deiner IP. Ausgehend: alles erlaubt (Standard).
   * **Key Pair:** das aus Schritt 2.
4. Nach dem Start die öffentliche IP notieren.

> Kosten sparen: Der Worker braucht im Leerlauf praktisch keine CPU (eine kurze Anfrage alle 20 s). Mit `WORKER_CONCURRENCY=1` werden Aufträge nacheinander abgearbeitet – mehrere gleichzeitige Podcasts landen einfach in der Warteschlange.

### 6.2 Docker installieren und Worker starten

```bash
ssh ubuntu@IP-DER-INSTANZ

# Docker installieren
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit          # neu verbinden, damit die Gruppe aktiv wird
ssh ubuntu@IP-DER-INSTANZ

# Code holen (nur der Worker-Ordner wird gebraucht).
# Privates Repo: wie in 5.3 einen Deploy-Key anlegen und bei GitHub hinterlegen.
git clone --depth 1 git@github.com:DEIN-GITHUB-NAME/kahal-tools.git
cd kahal-tools/apps/worker

cp .env.example .env
nano .env     # SERVER_URL=https://tools.deine-domain.ch und WORKER_TOKEN (gleich wie auf dem Server)

docker compose up -d --build
docker compose logs -f        # sollte "Worker ... startet" zeigen; mit Strg+C verlassen
```

Der Container startet nach einem Neustart der Instanz automatisch wieder und aktualisiert `yt-dlp` beim Start und täglich.

**Skalieren:** Bei viel Last `WORKER_CONCURRENCY=2` setzen (dann braucht es eher 2 vCPU) oder eine zweite Instanz mit derselben `.env` starten.

---

## 7. Erste Schritte im Tool

1. <https://tools.deine-domain.ch> öffnen → **Mit Planning Center anmelden**. Du bist als erste Person deiner Gemeinde automatisch **Administrator**.
2. **Einstellungen → Planungstool:** Service Types auswählen, die in den Tools erscheinen sollen.
3. **Einstellungen → Livestream:** **Mit YouTube verbinden** (mit dem Google-Konto, das den Kanal verwaltet). Danach Vorlagen, Startzeit-Item (z.B. „Livestream“), Streamschlüssel und Playlist einstellen.
   * Der **Streamschlüssel** sorgt dafür, dass OBS/der Encoder immer an denselben Schlüssel sendet; neue Livestreams werden automatisch damit verbunden.
4. **Einstellungen → Podcast:** FTP-Daten eintragen → **Verbindung testen** → Vorlagen und Feed-Angaben ausfüllen.
5. **Einstellungen → Besucherzähler:** Orte anlegen (Saal EG, Saal OG, …), Livestream-Zählung einstellen.
6. **Einstellungen → Benutzer:** Personen aus PCO **einladen** und Rechte vergeben, oder **Gruppen** (z.B. „Technik“) anlegen. Personen, die sich selbst anmelden, erscheinen als Zugangsanfrage.

> **Gleichzeitige Zuschauer:** YouTube liefert diese Zahl nur **während** des Streams. kahal.tools fragt sie bei Streams, die über das Tool erstellt wurden, alle 2 Minuten ab und speichert den Spitzenwert.

---

## 8. Podcast bei Apple / Spotify anmelden

Der Feed-Link steht im Tool unter **Podcast** (Format `https://tools.deine-domain.ch/feeds/<gemeinde>/podcast.xml`).

* **Apple Podcasts:** <https://podcastsconnect.apple.com> → „+“ → „Neue Show“ → „RSS-Feed hinzufügen“.
* **Spotify:** <https://podcasters.spotify.com> → „Podcast hinzufügen“ → RSS-Feed-Link.

Vorher in **Einstellungen → Podcast → Feed** mindestens Titel, Autor, E-Mail und ein quadratisches Cover (1400–3000 px) eintragen und einen ersten Podcast veröffentlichen.

---

## 9. Updates einspielen

Lokal entwickeln → committen → `git push`. Danach:

**Server (Infomaniak Node.js):**

```bash
cd ~/sites/tools.deine-domain.ch
git pull
npm ci --include=dev && npm run build
```

Dann die Site im Manager neu starten. Datenbank-Migrationen laufen beim Start automatisch.

**Worker (Public Cloud):**

```bash
cd ~/kahal-tools && git pull
cd apps/worker && docker compose up -d --build
```

---

## 10. Probleme & Lösungen

| Problem | Lösung |
| --- | --- |
| Login: „Planning Center ist auf dem Server noch nicht konfiguriert“ | `PCO_CLIENT_ID` / `PCO_CLIENT_SECRET` in der `.env` fehlen → eintragen und neu starten. |
| Login: „redirect_uri mismatch“ | Die Callback-URL in der PCO-/Google-App muss **exakt** `APP_URL` + Pfad entsprechen (https, ohne `/` am Ende). |
| YouTube muss jede Woche neu verbunden werden | Google-App ist noch im Status „Testing“ → in Produktion stellen (siehe 4). |
| Podcast bleibt „In Warteschlange“ | Läuft der Worker? `docker compose logs -f` auf der Cloud-Instanz. Stimmen `SERVER_URL` und `WORKER_TOKEN`? |
| Worker-Fehler „Sign in to confirm you're not a bot“ | YouTube blockiert Downloads von Rechenzentrums-IPs teilweise. Lösung: Mit einem (Zweit-)Google-Konto im Browser bei YouTube anmelden, Cookies mit einer Erweiterung wie „Get cookies.txt LOCALLY“ als `cookies.txt` exportieren und auf der Instanz nach `~/kahal-tools/apps/worker/data/cookies.txt` kopieren (`scp cookies.txt ubuntu@IP:~/kahal-tools/apps/worker/data/`). Der Worker verwendet die Datei automatisch. Cookies laufen nach einiger Zeit ab und müssen dann erneuert werden. |
| Worker-Fehler bei YouTube nach längerer Zeit | `yt-dlp` ist veraltet → Worker neu starten (aktualisiert sich beim Start) oder `docker compose build --no-cache && docker compose up -d`. |
| „Datei konnte auf dem Server nicht gelöscht werden“ | FTP-Benutzer braucht Löschrechte im Podcast-Verzeichnis. |
| Gleichzeitige Zuschauer fehlen | Nur für Streams verfügbar, die über kahal.tools erstellt wurden, und nur, wenn der Server während des Streams lief. Alternativ in den Einstellungen auf „Aufrufe“ umstellen. |
| `ENCRYPTION_KEY` verloren/geändert | Gespeicherte Zugangsdaten sind unlesbar: YouTube neu verbinden, FTP-Passwort neu eingeben, alle Benutzer neu anmelden. |
