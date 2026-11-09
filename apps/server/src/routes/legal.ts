import { Router } from 'express';
import { config } from '../config.js';

/**
 * Öffentliche rechtliche Seiten für die ganze Anwendung: /datenschutz (Alias /privacy) und /impressum (Alias /imprint).
 * Serverseitig gerendert, damit sie ohne Anmeldung und ohne JavaScript erreichbar sind
 * (wird u.a. bei der Google-Prüfung und in der Planning-Center-App verlinkt).
 * Angaben zum Betreiber kommen aus der .env (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL).
 */
export const legalRouter = Router();

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stand der Erklärung – bei inhaltlichen Änderungen anpassen */
const UPDATED = '9. November 2026';

/** Gemeinsame Hülle der rechtlichen Seiten */
function shell(title: string, description: string, content: string) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – kahal.tools</title>
<meta name="description" content="${description}">
<style>
  :root { color-scheme: light dark; --bg: #f6f7f5; --card: #fff; --text: #1d2420; --muted: #5d6a63; --accent: #1f6f5c; --line: #dfe5e1; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111513; --card: #181d1a; --text: #e8efe9; --muted: #9aa8a0; --accent: #5cb59b; --line: #2a322e; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; }
  header { margin-bottom: 28px; }
  header a { color: var(--accent); text-decoration: none; font-weight: 600; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 12px 0 4px; }
  h2 { font-size: 1.2rem; margin: 36px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
  h3 { font-size: 1rem; margin: 20px 0 4px; }
  p, ul { margin: 8px 0; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  a { color: var(--accent); }
  .muted { color: var(--muted); }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); display: flex; gap: 18px; font-size: 0.9rem; }
  .todo { padding: 10px 14px; border-radius: 8px; background: #fff3cd; color: #664d03; }
  code { font-size: 0.9em; }
  nav ol { padding-left: 22px; columns: 2; column-gap: 32px; }
  @media (max-width: 560px) { nav ol { columns: 1; } h1 { font-size: 1.6rem; } }
</style>
</head>
<body>
<main>
${content}
<footer><a href="/">kahal.tools</a><a href="/datenschutz">Datenschutz</a><a href="/impressum">Impressum</a></footer>
</main>
</body>
</html>`;
}

/** Name, Adresse und E-Mail des Betreibers als HTML (oder Hinweis, dass die Angaben fehlen) */
function operatorBlock() {
  const { name, address, email } = config.legal;
  return name
    ? `<p><b>${esc(name)}</b>${address ? `<br>${esc(address).replace(/\n/g, '<br>')}` : ''}${email ? `<br>E-Mail: <a href="mailto:${esc(email)}">${esc(email)}</a>` : ''}</p>`
    : `<p class="todo">Angaben zum Betreiber fehlen: bitte <code>LEGAL_NAME</code>, <code>LEGAL_ADDRESS</code> und <code>LEGAL_EMAIL</code> in der Server-.env setzen.</p>`;
}

function impressum() {
  return shell(
    'Impressum',
    'Impressum von kahal.tools',
    `<header>
  <a href="/">kahal.tools</a>
  <h1>Impressum</h1>
</header>

<h2>Betreiber und verantwortlich für den Inhalt</h2>
${operatorBlock()}

<h2>Angebot</h2>
<p>kahal.tools ist eine Webanwendung für Kirchgemeinden zur Planung von Livestreams, zur Veröffentlichung von Podcasts und zur Erfassung von Besucherzahlen. Für die Inhalte, die eine Gemeinde damit erstellt und veröffentlicht (z.B. Livestreams, Podcast-Episoden), ist die jeweilige Gemeinde verantwortlich.</p>

<h2>Haftung für Links</h2>
<p>Diese Website enthält Links zu Websites Dritter (z.B. Planning Center, YouTube). Für deren Inhalte sind ausschliesslich die jeweiligen Anbieter verantwortlich.</p>

<h2>Marken</h2>
<p>Planning Center ist eine Marke von Planning Center Online, Inc. YouTube und Google sind Marken der Google LLC. kahal.tools steht in keiner Verbindung zu diesen Unternehmen und wird von ihnen weder unterstützt noch geprüft.</p>

<h2>Datenschutz</h2>
<p>Wie Personendaten bearbeitet werden, steht in der <a href="/datenschutz">Datenschutzerklärung</a>.</p>`,
  );
}

function page() {
  const { email } = config.legal;
  const operator = operatorBlock();
  const contact = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : 'den oben genannten Betreiber';
  const host = esc(new URL(config.appUrl).host);

  return shell('Datenschutzerklärung', 'Datenschutzerklärung von kahal.tools: welche Daten verarbeitet werden, wozu und wo.', `<header>
  <a href="/">kahal.tools</a>
  <h1>Datenschutzerklärung</h1>
  <p class="muted">Stand: ${UPDATED}</p>
</header>

<p>kahal.tools (${host}) ist eine Webanwendung für Kirchgemeinden. Sie verbindet Planning Center mit YouTube-Livestreams, Podcasts und einem Besucherzähler. Diese Erklärung beschreibt, welche Personendaten dabei bearbeitet werden, wozu, wo und wie lange. Sie richtet sich nach dem Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, nach der EU-Datenschutz-Grundverordnung (DSGVO).</p>

<nav>
<ol>
  <li><a href="#verantwortlich">Verantwortlich</a></li>
  <li><a href="#daten">Welche Daten wir bearbeiten</a></li>
  <li><a href="#google">YouTube und Google-Daten</a></li>
  <li><a href="#pco">Planning Center</a></li>
  <li><a href="#oeffentlich">Öffentliche Inhalte</a></li>
  <li><a href="#cookies">Cookies und lokale Speicherung</a></li>
  <li><a href="#empfaenger">Dienstleister und Speicherort</a></li>
  <li><a href="#dauer">Aufbewahrung und Löschung</a></li>
  <li><a href="#sicherheit">Sicherheit</a></li>
  <li><a href="#rechte">Deine Rechte</a></li>
</ol>
</nav>

<h2 id="verantwortlich">1. Verantwortlich</h2>
${operator}
<p>Für die Inhalte, die eine Gemeinde in kahal.tools erfasst (z.B. Livestream-Titel, Podcast-Episoden, Besucherzahlen), ist die jeweilige Gemeinde verantwortlich. Der Betreiber bearbeitet diese Daten in ihrem Auftrag, um die Anwendung bereitzustellen.</p>

<h2 id="daten">2. Welche Daten wir bearbeiten</h2>
<h3>Benutzerkonto</h3>
<ul>
  <li>Name, E-Mail-Adresse, Profilbild und die Personen-ID aus Planning Center</li>
  <li>Name, ID, Zeitzone und Logo der Organisation (Gemeinde) aus Planning Center</li>
  <li>Rolle, Rechte und Gruppen in kahal.tools, Zeitpunkt der letzten Anmeldung</li>
  <li>Zugangs-Tokens für Planning Center (verschlüsselt gespeichert)</li>
</ul>
<p><b>Zweck:</b> Anmeldung, Zuordnung zur richtigen Gemeinde und Rechteverwaltung.</p>

<h3>Einladungen</h3>
<p>Lädt ein Administrator eine Person ein, werden deren Name und E-Mail-Adresse gespeichert und ihr eine E-Mail mit dem Login-Link geschickt.</p>

<h3>Planungsdaten</h3>
<p>Pläne, Ablauf-Elemente, Notizen und Team-Einteilungen (Namen und Positionen) werden bei Bedarf direkt aus Planning Center abgerufen, um Vorschläge für Livestreams und Podcasts zu erstellen. Gespeichert werden davon nur die ID und der Titel des verknüpften Plans sowie die Texte, die du daraus übernimmst (z.B. Titel, Beschreibung, Name des Predigers).</p>

<h3>Livestreams</h3>
<p>Titel, Beschreibung, Startzeit, Playlist, Vorschaubild und die YouTube-Video-ID der Livestreams sowie Zuschauerzahlen (Spitzenwert und Aufrufe) des YouTube-Kanals der Gemeinde.</p>

<h3>Podcasts</h3>
<p>Titel, Sprecher, Bibelstelle, Beschreibung, Bild, Veröffentlichungsdatum und die Audiodatei der Episoden. Die Audiodatei wird aus dem öffentlichen YouTube-Video der Gemeinde geschnitten und auf den Speicherplatz (FTP-Server) der Gemeinde hochgeladen. Die Zugangsdaten zu diesem Speicherplatz werden verschlüsselt gespeichert.</p>

<h3>Besucherzähler</h3>
<p>Anzahl Besucher pro Ort und Gottesdienst sowie Bemerkungen. Es werden keine Daten über einzelne Besucher erfasst.</p>

<h3>Technische Daten</h3>
<p>Beim Aufruf der Anwendung verarbeitet der Webserver technisch notwendige Angaben wie IP-Adresse, Zeitpunkt, aufgerufene Adresse und Browser-Kennung. Sie dienen dem Betrieb und der Sicherheit und werden vom Hosting-Anbieter nach kurzer Zeit gelöscht. Es gibt keine Werbung, kein Tracking und keine Analyse-Tools.</p>

<h2 id="google">3. YouTube und Google-Daten</h2>
<p>Verbindet eine Gemeinde ihren YouTube-Kanal, erhält kahal.tools über die YouTube Data API Zugriff auf diesen Kanal (Berechtigung <code>https://www.googleapis.com/auth/youtube</code>). kahal.tools verwendet diesen Zugriff ausschliesslich, um:</p>
<ul>
  <li>Livestreams anzulegen, zu bearbeiten, zu löschen und Playlists zuzuordnen,</li>
  <li>Vorschaubilder hochzuladen und Playlists anzulegen,</li>
  <li>vergangene Livestreams aufzulisten und deren Zuschauerzahlen abzurufen,</li>
  <li>Name und Bild des Kanals anzuzeigen.</li>
</ul>
<p>Gespeichert werden Kanal-ID, Kanalname, Kanalbild, die Zugangs-Tokens (verschlüsselt) sowie die oben genannten Angaben zu den Livestreams. Daten aus Google-APIs werden nicht verkauft, nicht für Werbung verwendet, nicht an Dritte weitergegeben (ausser soweit für den Betrieb nötig, siehe <a href="#empfaenger">Dienstleister</a>) und nicht zum Trainieren von KI-Modellen genutzt. Menschen lesen diese Daten nur, wenn die Gemeinde es ausdrücklich wünscht (z.B. bei Support), wenn es aus Sicherheitsgründen oder gesetzlich nötig ist.</p>
<p>Die Nutzung und Weitergabe von Informationen, die kahal.tools von Google-APIs erhält, hält sich an die <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener">Google API Services User Data Policy</a>, einschliesslich der Anforderungen zur eingeschränkten Nutzung (Limited Use requirements).</p>
<p>Es gelten zusätzlich die <a href="https://www.youtube.com/t/terms" rel="noopener">Nutzungsbedingungen von YouTube</a> und die <a href="https://policies.google.com/privacy" rel="noopener">Datenschutzerklärung von Google</a>. Den Zugriff kannst du jederzeit in kahal.tools unter Einstellungen → Livestream → „Trennen“ oder in deinem Google-Konto unter <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a> widerrufen. Beim Trennen löscht kahal.tools die gespeicherten Zugangs-Tokens.</p>

<h2 id="pco">4. Planning Center</h2>
<p>Die Anmeldung erfolgt über Planning Center (Planning Center Online, Inc., USA). kahal.tools erhält dabei Zugriff auf die Bereiche „People“ (eigene Person und Organisation, Personensuche beim Einladen) und „Services“ (Pläne, Teams, Ablauf). Es werden nur Daten abgerufen, auf die die angemeldete Person in Planning Center selbst Zugriff hat. Es gilt zusätzlich die <a href="https://www.planningcenter.com/privacy" rel="noopener">Datenschutzerklärung von Planning Center</a>. Den Zugriff kannst du in Planning Center unter den autorisierten Apps deines Kontos widerrufen.</p>

<h2 id="oeffentlich">5. Öffentliche Inhalte</h2>
<p>Bewusst öffentlich sind der Podcast-Feed (<code>/feeds/…</code>), das Podcast-Widget zum Einbetten (<code>/embed/…</code>) und die Livestreams auf YouTube. Sie enthalten die Angaben, die die Gemeinde zur Veröffentlichung bestimmt hat (z.B. Titel, Sprecher, Beschreibung, Bild). Das Widget setzt keine Cookies. Die Audiodatei wird vom Speicherplatz der Gemeinde geladen; YouTube wird erst aufgerufen, wenn jemand auf den Video-Link klickt.</p>

<h2 id="cookies">6. Cookies und lokale Speicherung</h2>
<ul>
  <li><code>kt_session</code>: hält dich angemeldet (30 Tage, technisch notwendig).</li>
  <li><code>kt_oauth</code>: schützt die Anmeldung bei Planning Center bzw. die Verbindung mit YouTube (15 Minuten, technisch notwendig).</li>
</ul>
<p>Weitere Daten werden nicht im Browser gespeichert, und es werden keine Cookies von Drittanbietern gesetzt.</p>

<h2 id="empfaenger">7. Dienstleister und Speicherort</h2>
<ul>
  <li><b>Infomaniak Network SA</b>, Genf, Schweiz: Hosting der Anwendung und der Datenbank, Rechenserver für die Podcast-Verarbeitung, Versand der E-Mails. Die Daten liegen in Rechenzentren in der Schweiz.</li>
  <li><b>Planning Center Online, Inc.</b>, USA: Anmeldung und Planungsdaten (siehe <a href="#pco">Abschnitt 4</a>).</li>
  <li><b>Google LLC / Google Ireland Ltd.</b>: YouTube-Livestreams und -Statistiken (siehe <a href="#google">Abschnitt 3</a>).</li>
  <li><b>Speicherplatz der Gemeinde</b> (FTP-Server, von der Gemeinde gewählt): Ablage der Podcast-Audiodateien und des Feeds.</li>
</ul>
<p>Bei Planning Center und Google können Daten in die USA übermittelt werden. Diese Anbieter stützen sich dafür auf anerkannte Garantien (z.B. das Swiss-U.S. bzw. EU-U.S. Data Privacy Framework oder Standardvertragsklauseln).</p>

<h2 id="dauer">8. Aufbewahrung und Löschung</h2>
<ul>
  <li>Konto- und Gemeindedaten bleiben gespeichert, solange die Gemeinde kahal.tools nutzt. Entfernt ein Administrator eine Person, wird ihr Konto gelöscht.</li>
  <li>Livestream-, Podcast- und Besucherdaten bleiben, bis die Gemeinde sie löscht. Löscht eine Gemeinde einen Livestream, wird er auch auf YouTube gelöscht.</li>
  <li>Zugangs-Tokens werden beim Trennen der Verbindung bzw. beim Widerruf gelöscht oder ungültig.</li>
  <li>Beendet eine Gemeinde die Nutzung, werden ihre Daten auf Anfrage innert 30 Tagen gelöscht. Inhalte auf YouTube und auf dem Speicherplatz der Gemeinde bleiben dort, bis die Gemeinde sie selbst entfernt.</li>
</ul>

<h2 id="sicherheit">9. Sicherheit</h2>
<p>Die Verbindung ist durchgehend per HTTPS verschlüsselt. Zugangs-Tokens und Passwörter für Drittdienste werden verschlüsselt in der Datenbank abgelegt. Der Zugriff innerhalb einer Gemeinde ist über Rollen und Rechte geregelt; Gemeinden sehen nur ihre eigenen Daten.</p>

<h2 id="rechte">10. Deine Rechte</h2>
<p>Du kannst Auskunft über deine Daten verlangen sowie deren Berichtigung, Löschung, Herausgabe oder die Einschränkung der Bearbeitung. Wende dich dafür an ${contact} oder an einen Administrator deiner Gemeinde. Du hast zudem das Recht, dich beim Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (<a href="https://www.edoeb.admin.ch" rel="noopener">EDÖB</a>) oder, im EU-Raum, bei der zuständigen Aufsichtsbehörde zu beschweren.</p>
<p>Wird diese Erklärung geändert, gilt die hier veröffentlichte Fassung.</p>`);
}

legalRouter.get(['/datenschutz', '/privacy'], (_req, res) => {
  res.type('html').send(page());
});

legalRouter.get(['/impressum', '/imprint'], (_req, res) => {
  res.type('html').send(impressum());
});
