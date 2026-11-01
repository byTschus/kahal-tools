# kahal.tools

Webtool, das technische Aufgaben in der Gemeinde vereinfacht – verknüpft mit dem Planungstool (zu Beginn **Planning Center**).

| Tool | Was es macht |
| --- | --- |
| 📡 **Livestream** | YouTube-Livestreams aus einem PCO-Plan erstellen. Titel/Beschreibung per Vorlage mit PCO-Variablen, Startzeit aus einem Plan-Item. Bestehende Streams ansehen, bearbeiten, löschen. |
| 🎙️ **Podcast** | Aus einem vergangenen Stream einen Podcast erstellen: Ausschnitt im Video-Player wählen, Angaben automatisch aus dem Plan, Verarbeitung (Download, Schnitt, MP3, Upload per FTP) im Hintergrund auf einem günstigen Cloud-Server. RSS-Feed für Apple/Spotify inklusive. |
| 👥 **Besucherzähler** | Besucher pro Ort und Event erfassen, Livestream-Zuschauer automatisch von YouTube übernehmen, Statistik und Excel-Export. |
| ⚙️ **Einstellungen** | Benutzer & Gruppen mit Rechten pro Tool, Einladungen aus PCO, alle Tool-Einstellungen. |

**Anmeldung:** mit dem Planning-Center-Login. Die Gemeinde wird automatisch erkannt; die erste Person einer Gemeinde wird Administrator. Weitere Personen werden eingeladen oder stellen beim ersten Login eine Zugangsanfrage.

👉 **Einrichtung Schritt für Schritt: [docs/SETUP.md](docs/SETUP.md)**
👉 Aufbau & Erweiterung: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Schnellstart (lokal)

Voraussetzungen: Node.js ≥ 20.12, Docker Desktop, VS Code.

```bash
cp .env.example .env          # Werte ggf. anpassen
npm install
docker compose up -d db       # MariaDB starten
npm run db:deploy             # Tabellen anlegen
npm run dev                   # Server (3000) + Web (5173)
```

Dann <http://localhost:5173> öffnen. Mit `ENABLE_MOCK_PLANNING=true` gibt es einen **Demo-Login** mit einer Fake-Gemeinde, so lässt sich alles ohne Planning-Center-Zugang ausprobieren.

## Projektstruktur

```
apps/
  server/   Node.js API (Express, Prisma, MySQL/MariaDB) – liefert auch das gebaute Frontend aus
  web/      React-Frontend (Vite)
  worker/   Podcast-Worker (Docker: yt-dlp + ffmpeg) für den Public-Cloud-Server
docs/       Anleitungen
```

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklung mit Hot Reload |
| `npm run build` | Produktions-Build (Web + Server) |
| `npm start` | Produktionsserver starten (führt DB-Migrationen automatisch aus) |
| `npm run db:migrate` | Nach Änderungen an `schema.prisma`: neue Migration erstellen |
| `npm run typecheck` / `npm test` | Prüfen |
