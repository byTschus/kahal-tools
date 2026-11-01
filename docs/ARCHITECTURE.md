# Architektur

```
 Browser ──HTTPS──▶  Node.js-Server (Infomaniak Node.js-Hosting)  ◀──HTTPS (Pull)── Podcast-Worker (Infomaniak Public Cloud)
                      │  Express-API + React-Frontend                                │  yt-dlp + ffmpeg (Docker)
                      │  Scheduler (Zuschauerzahlen, Job-Timeouts)                    │
                      ▼                                                              ▼
                   MySQL/MariaDB                                              FTP / Podcast-Hosting
                      ▲
        Planning Center API · YouTube Data API
```

## Mandantenfähigkeit

* Jede Gemeinde ist ein `Tenant`. Er wird beim ersten Login anhand der **Organisation im Planungstool** (`planningProvider` + `externalOrgId`) angelegt.
* Alle Tabellen hängen am Tenant; jede API-Abfrage filtert nach dem Tenant des angemeldeten Benutzers.
* Zugangsdaten (OAuth-Tokens, FTP-Passwörter) werden mit AES-256-GCM verschlüsselt gespeichert (`ENCRYPTION_KEY`).

## Login & Benutzer

0. OAuth-App-Zugangsdaten (Client ID/Secret) liegen **pro Gemeinde** verschlüsselt in der Tabelle `OAuthApp` (`services/oauthApps.ts`). Neue Gemeinde: „Gemeinde einrichten“ – die eingegebenen Zugangsdaten reisen verschlüsselt im OAuth-State mit und werden nach erfolgreichem Login gespeichert. Bestehende Gemeinde: Login-Link `/login/<slug>` → `/auth/pco/login?tenant=<slug>`. Fallback: globale App aus der `.env`. Jedes Token merkt sich die `clientId` der ausstellenden App, damit es mit der richtigen App erneuert wird.
1. „Mit Planning Center anmelden“ → OAuth → `/auth/pco/callback`
2. Organisation + Person werden abgefragt (`/people/v2`, `/people/v2/me`)
3. Neue Organisation → Tenant + Admin. Bekannte Organisation → eingeladene Person wird aktiv, unbekannte Person wird `pending` (Zugangsanfrage).
4. Session: signiertes HttpOnly-Cookie (JWT). Zustandslos → mehrere Server-Instanzen möglich.

Die PCO-Tokens jedes Benutzers werden gespeichert und automatisch erneuert. Abfragen an PCO laufen **im Namen des Benutzers** – jeder sieht nur, was er auch in PCO sehen darf.

## Rechte

`apps/server/src/permissions.ts`: Tools × Aktionen (`view`, `create`, `edit`, `delete`, `settings`). Rechte werden direkt am Benutzer und/oder über Gruppen vergeben (Vereinigung). Admins haben alles und verwalten Benutzer/Gruppen.

## Podcast-Warteschlange (Skalierung)

* Ein neuer Podcast erzeugt einen Eintrag in der Tabelle `Job` (Status `queued`).
* Worker fragen per `POST /api/worker/claim` nach Arbeit. Die Zuteilung erfolgt atomar (`UPDATE … WHERE status='queued'`), damit beliebig viele Worker parallel laufen können, ohne dass ein Auftrag doppelt verarbeitet wird.
* Der Worker meldet Fortschritt (zugleich Lebenszeichen). Antwortet ein Worker 10 Minuten nicht, wird der Auftrag wieder freigegeben (max. 3 Versuche, mit Wartezeit).
* Die Zugangsdaten für das Hosting erhält der Worker erst beim Abholen – in der Warteschlange liegen keine Geheimnisse.
* Mehr Last → `WORKER_CONCURRENCY` erhöhen oder weitere Worker-Server mit derselben `.env` starten. Keine eingehenden Ports am Worker nötig.

Ressourcen sparen: Der Worker lädt **nur die Audiospur** und **nur den gewählten Ausschnitt** (`yt-dlp --download-sections`), kodiert einmal direkt nach MP3 (Standard 96 kbit/s mono) und löscht alle temporären Dateien sofort.

## Erweiterungspunkte

| Was | Wo |
| --- | --- |
| Neues **Planungstool** (z.B. ChurchTools) | `apps/server/src/providers/planning/` – `PlanningProvider` + `PlanningClient` implementieren, in `index.ts` registrieren, Auth-Route funktioniert automatisch (`/auth/<key>/login`). |
| Neue **Streaming-Plattform** (z.B. Vimeo) | `apps/server/src/providers/streaming/` – `StreamingProvider` implementieren und registrieren. |
| Neues **Podcast-Hosting** (z.B. Podigee, S3) | Server: `apps/server/src/providers/podcastHost/` (Formularfelder werden automatisch im UI angezeigt). Worker: Upload-Funktion in `apps/worker/src/hosts.ts`. |
| Neues **Tool** | `TOOLS` in `permissions.ts`, Einstellungs-Schema in `settings.ts`, Route in `src/routes/`, Seite in `apps/web/src/pages/` + Eintrag in `TOOL_META` (`Layout.tsx`). |
| Neue **Job-Art** | `registerJobHandler()` im Server, Verarbeitung im Worker (`handle()`). |

## Template-Variablen

`apps/server/src/lib/template.ts` – Syntax `{{pfad | filter:"arg"}}`. Für PCO stehen u.a. zur Verfügung:

| Variable | Inhalt |
| --- | --- |
| `event.title`, `event.seriesTitle`, `event.serviceType`, `event.date` | Plan-Grunddaten |
| `plan.*` | alle Rohfelder des PCO-Plans |
| `series.title`, `series.artwork` | Serie inkl. Serienbild |
| `people.<Position>` | Namen der eingeteilten Personen pro Position, z.B. `people.Pastor` oder `people["Worship Leader"]` |
| `teams.<Team>` | Namen pro Team |
| `items.<Item-Titel>.description` / `.notes.<Kategorie>` / `.startsAt` | Plan-Items |
| `notes.<Kategorie>` | Plan-Notizen |
| `times.service`, `times.rehearsal` | Zeiten |
| `freitext` | Freitext beim Erstellen |

Filter: `date:"EEEE, dd.MM.yyyy HH:mm"`, `time`, `default:"-"`, `first`, `join:" & "`, `upper`, `lower`, `trim`, `strip_html`, `truncate:100`, `replace:"a","b"`.
In den Einstellungen werden alle Variablen eines Beispiel-Plans zum Anklicken angezeigt.
