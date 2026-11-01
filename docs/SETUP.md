# Einrichtung – Schritt für Schritt

Diese Anleitung beschreibt alles, was **von Hand** gemacht werden muss. Reihenfolge:

1. [GitHub-Repository anlegen und Code hochladen](#1-github-repository)
2. [Lokale Entwicklungsumgebung (VS Code + Docker)](#2-lokale-entwicklungsumgebung)
3. [Planning Center: OAuth-App pro Gemeinde](#3-planning-center-oauth-app-pro-gemeinde)
4. [Google / YouTube: API-Zugang pro Gemeinde](#4-google--youtube-api-pro-gemeinde)
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

## 3. Planning Center: OAuth-App pro Gemeinde

Jede Gemeinde verwendet **ihre eigene** Planning-Center-OAuth-App. Die Zugangsdaten werden **im Webinterface** eingegeben und verschlüsselt pro Gemeinde gespeichert – auf dem Server muss dafür nichts konfiguriert werden.

### Neue Gemeinde einrichten (einmalig, durch die erste Person der Gemeinde)

1. kahal.tools öffnen → **„Neue Gemeinde einrichten“**.
2. In einem neuen Tab mit dem Planning-Center-Konto anmelden und <https://api.planningcenteronline.com/oauth/applications> öffnen.
3. **New Application** → Name `kahal.tools` (optional Beschreibung/Logo).
4. Als **Callback URL / Redirect URI** die Adresse eintragen, die auf der Einrichtungsseite angezeigt wird:
   `https://tools.deine-domain.ch/auth/pco/callback`
   (für die lokale Entwicklung zusätzlich `http://localhost:5173/auth/pco/callback`)
5. Speichern, **Client ID** und **Secret** in kahal.tools eintragen → **Weiter zur Anmeldung bei Planning Center** → Zugriff erlauben.
6. Die Gemeinde wird anhand des PCO-Kontos erkannt und angelegt, du bist **Administrator**.

Danach findest du unter **Einstellungen → Planungstool** den **Login-Link der Gemeinde** (`https://tools.deine-domain.ch/login/<kürzel>`). Diesen an alle Mitarbeitenden weitergeben – darüber melden sie sich mit ihrem eigenen PCO-Konto an. Dort lassen sich die Zugangsdaten auch später ändern.

Benötigte Rechte (werden beim Login abgefragt): `people` (Person & Gemeinde erkennen, Personen zum Einladen suchen) und `services` (Pläne, Teams, Items).

> **Schutz:** Wer sich über den Login-Link einer Gemeinde anmeldet, muss in Planning Center auch zu dieser Organisation gehören. Ist eine Gemeinde bereits eingerichtet, kann nur ein Administrator ihre Zugangsdaten ändern.

> **Optional – globale App:** Wer kahal.tools für viele Gemeinden betreibt, kann stattdessen *eine* App in der Server-`.env` hinterlegen (`PCO_CLIENT_ID` / `PCO_CLIENT_SECRET`). Sie gilt für alle Gemeinden ohne eigene Zugangsdaten; auf der Login-Seite erscheint dann zusätzlich „Mit Planning Center anmelden (ohne Kürzel)“.

---

## 4. Google / YouTube API pro Gemeinde

Auch die Google-Zugangsdaten werden pro Gemeinde im Webinterface eingetragen: **Einstellungen → Livestream → Google / YouTube API-Zugangsdaten** (dort steht die Anleitung auch noch einmal).

1. <https://console.cloud.google.com> öffnen → **Projekt auswählen → Neues Projekt** → Name `kahal-tools` → Erstellen.
2. **APIs & Dienste → Bibliothek** → „**YouTube Data API v3**“ suchen → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (bzw. „Google Auth Platform“):
   * Nutzertyp **Extern**, App-Name `kahal.tools`, Support-E-Mail, Kontakt-E-Mail.
   * **Datenzugriff / Bereiche:** `https://www.googleapis.com/auth/youtube` hinzufügen.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID**:
   * Anwendungstyp **Webanwendung**
   * **Autorisierte Weiterleitungs-URI:** die in kahal.tools angezeigte Adresse, also
     `https://tools.deine-domain.ch/api/integrations/streaming/youtube/callback`
     (lokal zusätzlich `http://localhost:5173/api/integrations/streaming/youtube/callback`)
5. **Client-ID** und **Clientschlüssel** in kahal.tools eintragen → **Zugangsdaten speichern** → **Mit YouTube verbinden** (mit dem Google-Konto, das den Kanal verwaltet).

> ⚠️ **Wichtig – App veröffentlichen:** Solange die Google-App im Status „Testing“ ist, laufen die Tokens **nach 7 Tagen ab** und YouTube muss neu verbunden werden. Unter **Zielgruppe → App veröffentlichen** auf „In Produktion“ stellen. Ohne Google-Verifizierung erscheint beim Verbinden ein Warnhinweis („Google hat diese App nicht überprüft“) → **Erweitert → Weiter zu kahal.tools**. Für den Eigengebrauch einer Gemeinde ist das in Ordnung.

> **Kontingent:** 10'000 Einheiten pro Tag und Google-Projekt (Livestream erstellen ≈ 50–100, Liste abrufen = 1). Da jede Gemeinde ihr eigenes Google-Projekt hat, teilen sich die Gemeinden das Kontingent nicht.

> **Optional – globale App:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in der Server-`.env` gelten für alle Gemeinden ohne eigene Zugangsdaten.

> Werden Zugangsdaten geändert, müssen sich Benutzer (PCO) einmal neu anmelden bzw. YouTube neu verbunden werden.

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
# PCO_/GOOGLE_CLIENT_ID/SECRET leer lassen – die Gemeinden tragen ihre eigenen im Webinterface ein
ENABLE_MOCK_PLANNING=false
RUN_SCHEDULER=true
# Optional: OPENSTACK_* / WORKER_SERVER_* – Worker-Server nur bei Bedarf starten, siehe 6.4
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

### 6.3 YouTube über IPv6

YouTube blockiert Downloads von IPv4-Adressen aus Rechenzentren oft mit „Sign in to confirm you're not a bot“. Über IPv6 klappt es in der Regel ohne Cookies. Der Worker läuft deshalb im Host-Netzwerk (`network_mode: host` in `docker-compose.yml`) und lädt mit `YTDLP_IP_VERSION=6` über IPv6.

Prüfen, ob die Instanz IPv6 hat (`HTTP/2 200` = ja):

```bash
curl -6 -sI https://www.youtube.com | head -1
```

Bestehende Installationen: in `apps/worker/.env` die Zeile `YTDLP_IP_VERSION=6` ergänzen, dann `docker compose up -d --build`. Ohne IPv6 die Zeile leer lassen.

### 6.4 Server nur bei Bedarf laufen lassen (optional, spart Kosten)

kahal.tools kann die Instanz automatisch starten, sobald ein Podcast in der Warteschlange ist, und sie nach einer einstellbaren Leerlaufzeit wieder herunterfahren. Gestoppte Instanzen werden bei Infomaniak nicht mehr verrechnet – nur der Speicher (Volume) und die öffentliche IPv4-Adresse kosten weiter.

**1. Application Credential erstellen** (ein Zugang nur für dieses Projekt, ohne dein Passwort):

1. Im Horizon-Dashboard oben links das richtige Projekt wählen.
2. **Identity → Application Credentials → Create Application Credential**
   * **Name:** `kahal-tools`
   * **Secret:** leer lassen (wird erzeugt)
   * **Expiration:** leer lassen (läuft nicht ab)
   * **Roles:** leer lassen (übernimmt deine Rolle im Projekt)
   * „Unrestricted“ **nicht** anhaken
3. **Create** → **ID** und **Secret** kopieren. Das Secret wird nur dieses eine Mal angezeigt.
4. Auth-URL nachschauen: **Project → API Access → Identity**, z.B. `https://api.pub1.infomaniak.cloud/identity/v3` (bei neueren Projekten `pub2`).

**2. Instanz-ID nachschauen:** **Compute → Instances** → Name der Worker-Instanz anklicken → **ID** kopieren.

**3. In der `.env` von kahal.tools eintragen** (auf dem Node.js-Hosting, gilt für alle Gemeinden):

```
OPENSTACK_AUTH_URL=https://api.pub1.infomaniak.cloud/identity/v3
OPENSTACK_APP_CRED_ID=...          # ID aus Schritt 1
OPENSTACK_APP_CRED_SECRET=...      # Secret aus Schritt 1
WORKER_SERVER_ID=...               # ID aus Schritt 2
WORKER_SERVER_IDLE_MINUTES=15      # herunterfahren nach 15 Minuten ohne Auftrag
```

`OPENSTACK_REGION` leer lassen (wird automatisch erkannt). Danach die Node.js-Site im Manager neu starten.

Ab jetzt: Podcast erstellen → Instanz startet (ca. 1 Minute) → Docker startet den Worker automatisch → Auftrag wird verarbeitet → nach der Leerlaufzeit fährt die Instanz wieder herunter. Unter Einstellungen → Podcast → **Worker-Server** sieht man den Status und kann die Instanz von Hand starten oder stoppen; nach einem manuellen Start bleibt sie mindestens die Leerlaufzeit lang an.

> Wichtig: Den Worker auf der Instanz nicht mit `docker compose stop` anhalten – sonst startet er nach dem Hochfahren nicht automatisch. Zum Aktualisieren `docker compose up -d --build` verwenden.

---

## 7. Erste Schritte im Tool

1. <https://tools.deine-domain.ch> öffnen → **Neue Gemeinde einrichten** (siehe [Abschnitt 3](#3-planning-center-oauth-app-pro-gemeinde)). Du bist als erste Person deiner Gemeinde automatisch **Administrator**.
2. **Einstellungen → Planungstool:** Login-Link der Gemeinde kopieren und weitergeben, Service Types auswählen.
3. **Einstellungen → Livestream:** Google-Zugangsdaten eintragen ([Abschnitt 4](#4-google--youtube-api-pro-gemeinde)), dann **Mit YouTube verbinden**. Danach Vorlagen, Startzeit-Item (z.B. „Livestream“), Streamschlüssel und Playlist einstellen.
   * Beim Erstellen eines Livestreams lassen sich eine **Playlist** wählen (oder direkt eine neue erstellen) und ein **Thumbnail** setzen: das Bild aus dem Plan (Vorlage „Thumbnail-Vorschlag“, z.B. `{{series.artwork}}`) oder ein eigenes Bild. Eigene Thumbnails erlaubt YouTube nur für bestätigte Kanäle: einmalig unter <https://www.youtube.com/verify> per SMS bestätigen.
   * Der **Streamschlüssel** sorgt dafür, dass OBS/der Encoder immer an denselben Schlüssel sendet; neue Livestreams werden automatisch damit verbunden.
4. **Einstellungen → Podcast:** FTP-Daten eintragen → **Verbindung testen** → Vorlagen und Feed-Angaben ausfüllen.
5. **Einstellungen → Besucherzähler:** Orte anlegen (Saal EG, Saal OG, …), Livestream-Zählung einstellen.
6. **Einstellungen → Benutzer:** Personen aus PCO **einladen** und Rechte vergeben, oder **Gruppen** (z.B. „Technik“) anlegen. Personen, die sich selbst anmelden, erscheinen als Zugangsanfrage.

7. **Bestehende Daten übernehmen (optional):**
   * **Podcast → Feed importieren:** Adresse des bisherigen RSS-Feeds eingeben. Die Episoden erscheinen in der Liste und im neuen Feed; die Audiodateien bleiben beim bisherigen Anbieter.
   * **Besucherzähler → Importieren:** CSV- oder Excel-Datei mit den Spalten `Datum`, optional `Uhrzeit`, `Titel`, `Livestream`, `Bemerkung` und je einer Spalte pro Ort. Die Vorschau zeigt, wie jede Spalte verstanden wird.
   * Importierte Einträge brauchen keinen Plan. Beim Bearbeiten lässt sich einer verknüpfen.
8. **Podcast → Einbetten:** iframe-Code für die Webseite kopieren. Er zeigt die neueste Predigt mit Player und – falls vorhanden – einem Link zum passenden YouTube-Stream.

> **Ein Plan, ein Eintrag:** Jeder neue Livestream, Podcast und jede Besucher-Erfassung gehört zu genau einem Plan, und jeder Plan kann pro Tool nur einmal verwendet werden. Bereits verwendete Pläne sind in der Auswahl ausgegraut.

> **Dateinamen:** Die MP3-Dateien heissen nach dem Erstellungszeitpunkt in Sekunden seit 1970, z.B. `1787908529.mp3`.

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

Server und Worker immer zusammen aktualisieren: Neue Auftragsarten (z.B. feed.xml-Upload) bearbeitet nur ein aktueller Worker; bis dahin bleiben sie in der Warteschlange.

---

## 10. Probleme & Lösungen

| Problem | Lösung |
| --- | --- |
| Login: „Für Planning Center sind noch keine Zugangsdaten hinterlegt“ | Gemeinde noch nicht eingerichtet → „Neue Gemeinde einrichten“. Oder über den Login-Link der Gemeinde anmelden statt über die allgemeine Login-Seite. |
| Login: „redirect_uri mismatch“ / „invalid_client“ | Die Callback-URL in der PCO-/Google-App muss **exakt** der im Tool angezeigten Adresse entsprechen (https, ohne `/` am Ende). Client ID/Secret auf Tippfehler prüfen. |
| Login: „Dieses Konto gehört zu …, nicht zu …“ | Das PCO-Konto gehört zu einer anderen Organisation. Mit dem richtigen Konto anmelden oder den Login-Link der eigenen Gemeinde verwenden. |
| „… ist bereits eingerichtet“ beim Einrichten | Die Gemeinde existiert schon. Über ihren Login-Link anmelden; Zugangsdaten ändert ein Admin unter Einstellungen → Planungstool. |
| Nach Änderung der PCO-Zugangsdaten: „Bitte neu anmelden“ | Erwartet – Tokens gehören zur alten App. Einmal ab- und wieder anmelden. |
| YouTube muss jede Woche neu verbunden werden | Google-App ist noch im Status „Testing“ → in Produktion stellen (siehe 4). |
| Podcast bleibt „In Warteschlange“ | Läuft der Worker? `docker compose logs -f` auf der Cloud-Instanz. Stimmen `SERVER_URL` und `WORKER_TOKEN`? |
| FTP-Test meldete früher „Timeout when trying to open data connection“ | Das Infomaniak-Webhosting lässt keine passiven FTP-Datenverbindungen nach aussen zu. Der Verbindungstest prüft deshalb nur über Port 21 (Anmeldung, Verzeichnis, Schreibrechte). Alle Uploads (MP3, feed.xml) macht der Worker, Löschen funktioniert auch über Port 21. |
| Worker-Fehler „Sign in to confirm you're not a bot“ | YouTube blockiert Downloads von Rechenzentrums-IPs teilweise. Zuerst IPv6 einrichten (Abschnitt 6.3). Falls das nicht reicht: Mit einem (Zweit-)Google-Konto im Browser bei YouTube anmelden, Cookies mit einer Erweiterung wie „Get cookies.txt LOCALLY“ als `cookies.txt` exportieren und auf der Instanz nach `~/kahal-tools/apps/worker/data/cookies.txt` kopieren (`scp cookies.txt ubuntu@IP:~/kahal-tools/apps/worker/data/`). Der Worker verwendet die Datei automatisch. Cookies laufen nach einiger Zeit ab und müssen dann erneuert werden. |
| Worker-Fehler bei YouTube nach längerer Zeit | `yt-dlp` ist veraltet → Worker neu starten (aktualisiert sich beim Start) oder `docker compose build --no-cache && docker compose up -d`. |
| „Datei konnte auf dem Server nicht gelöscht werden“ | FTP-Benutzer braucht Löschrechte im Podcast-Verzeichnis. |
| Gleichzeitige Zuschauer fehlen | Nur für Streams verfügbar, die über kahal.tools erstellt wurden, und nur, wenn der Server während des Streams lief. Alternativ in den Einstellungen auf „Aufrufe“ umstellen. |
| `ENCRYPTION_KEY` verloren/geändert | Gespeicherte Zugangsdaten sind unlesbar: YouTube neu verbinden, FTP-Passwort neu eingeben, alle Benutzer neu anmelden. |
