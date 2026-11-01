import { Router } from 'express';
import { prisma } from '../db.js';
import { notFound } from '../lib/http.js';
import { durationOf, matchingStreamUrl } from '../services/podcasts.js';
import { getSettings } from '../settings.js';

/**
 * Öffentliches Podcast-Widget zum Einbetten per iframe: /embed/<gemeinde>/podcast
 * Zeigt die neueste Episode mit Player und Link zum passenden YouTube-Stream (nur wenn vorhanden); mit Pfeilen durch ältere Episoden blättern.
 * Optionen: ?theme=light|dark|auto, ?accent=1f6f5c (beliebige Farbe als Hex ohne #), ?nr=0 (0 = neueste)
 */
export const embedRouter = Router();

const esc = (s: string | null | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function dateParts(date: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('de-CH', { timeZone, day: '2-digit', month: 'numeric', year: 'numeric' }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { day: p.day, month: MONTHS[Number(p.month) - 1], year: p.year };
}

/** Schrift auf der Akzentfarbe: weiss oder dunkel, je nach Helligkeit der Farbe */
function onAccent(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111' : '#fff';
}

const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 10.5 21 7.5v9l-5.5-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const STYLE = `
*{box-sizing:border-box;margin:0}
:root{color-scheme:light dark}
:root[data-theme=light]{color-scheme:light}
:root[data-theme=dark]{color-scheme:dark}
:root{--bg:#ffffff;--fg:#1c1f1e;--muted:#69706d;--line:#e4e6e3;--soft:#f3f4f1;--accent:#1f6f5c;--on-accent:#fff}
:root[data-theme=dark]{--bg:#161918;--fg:#ecefed;--muted:#9aa29e;--line:#2b302e;--soft:#202423;--accent:#5cb59b;--on-accent:#0f1513}
@media (prefers-color-scheme:dark){:root[data-theme=auto]{--bg:#161918;--fg:#ecefed;--muted:#9aa29e;--line:#2b302e;--soft:#202423;--accent:#5cb59b;--on-accent:#0f1513}}
html,body{background:transparent}
body{font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased}
.card{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:12px;max-width:560px}
.head{display:flex;gap:12px;align-items:flex-start}
.date{flex:none;width:54px;border-radius:10px;background:var(--soft);text-align:center;padding:6px 0 7px;line-height:1.1}
.date .d{font-size:20px;font-weight:700}
.date .m{font-size:12px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}
.date .y{font-size:11px;color:var(--muted)}
.info{min-width:0;flex:1}
.title{font-size:15px;font-weight:650;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta{color:var(--muted);font-size:13px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.player{display:flex;align-items:center;gap:10px}
.play{flex:none;width:38px;height:38px;border-radius:50%;border:0;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;cursor:pointer}
.play svg{width:18px;height:18px}
.play:focus-visible,.btn:focus-visible,.nav a:focus-visible,.bar:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bar{flex:1;height:6px;border-radius:3px;background:var(--soft);position:relative;cursor:pointer}
.bar span{position:absolute;inset:0 auto 0 0;width:0;border-radius:3px;background:var(--accent)}
.time{flex:none;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:74px;text-align:right}
.foot{display:flex;align-items:center;gap:8px}
.btn{width:42px;height:42px;display:grid;place-items:center;border-radius:10px;border:1px solid var(--line);color:var(--accent);text-decoration:none}
.btn:hover{background:var(--soft)}
.btn svg{width:24px;height:24px}
.nav{margin-left:auto;display:flex;gap:6px}
.nav a,.nav span{width:42px;height:42px;border-radius:10px;display:grid;place-items:center;color:var(--fg);border:1px solid var(--line)}
.nav a:hover{background:var(--soft)}
.nav span{opacity:.35}
.nav svg{width:20px;height:20px}
.empty{color:var(--muted);text-align:center;padding:24px 0}
`;

const SCRIPT = `
(function(){
  var a=document.getElementById('audio'),b=document.getElementById('play'),bar=document.getElementById('bar'),fill=bar&&bar.firstElementChild,t=document.getElementById('time');
  if(!a)return;
  var total=Number(a.dataset.duration)||0;
  function fmt(s){s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
  function draw(){var d=a.duration&&isFinite(a.duration)?a.duration:total;fill.style.width=(d?a.currentTime/d*100:0)+'%';t.textContent=fmt(a.currentTime)+' / '+fmt(d);bar.setAttribute('aria-valuenow',Math.round(d?a.currentTime/d*100:0))}
  b.addEventListener('click',function(){a.paused?a.play():a.pause()});
  a.addEventListener('play',function(){b.innerHTML=b.dataset.pause;b.setAttribute('aria-label','Pause')});
  a.addEventListener('pause',function(){b.innerHTML=b.dataset.play;b.setAttribute('aria-label','Abspielen')});
  a.addEventListener('timeupdate',draw);a.addEventListener('loadedmetadata',draw);
  function seek(x){var r=bar.getBoundingClientRect(),d=a.duration&&isFinite(a.duration)?a.duration:total;if(!d)return;a.currentTime=Math.min(1,Math.max(0,(x-r.left)/r.width))*d;draw()}
  bar.addEventListener('click',function(e){seek(e.clientX)});
  bar.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){a.currentTime+=15;draw()}if(e.key==='ArrowLeft'){a.currentTime-=15;draw()}});
})();
`;

embedRouter.get('/embed/:slug/podcast', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug: String(req.params.slug) } });
  if (!tenant) throw notFound('Gemeinde');

  const theme = ['light', 'dark', 'auto'].includes(String(req.query.theme)) ? String(req.query.theme) : 'auto';
  const accent = /^[0-9a-f]{6}$/i.test(String(req.query.accent ?? '')) ? `#${req.query.accent}` : null;
  const nr = Math.max(0, Math.min(100_000, Number.parseInt(String(req.query.nr ?? '0'), 10) || 0));
  const where = { tenantId: tenant.id, status: 'published', audioUrl: { not: null }, publishedAt: { lte: new Date() } };
  const [episode, total, settings] = await Promise.all([
    prisma.podcast.findFirst({ where, orderBy: { publishedAt: 'desc' }, skip: nr }),
    prisma.podcast.count({ where }),
    getSettings(tenant.id, 'podcast'),
  ]);

  const link = (n: number) => {
    const q = new URLSearchParams({ ...(n ? { nr: String(n) } : {}), ...(theme !== 'auto' ? { theme } : {}), ...(accent ? { accent: accent.slice(1) } : {}) });
    return `?${q.toString()}`;
  };

  let body: string;
  if (!episode) {
    body = `<div class="card"><div class="empty">Noch keine Predigten veröffentlicht.</div></div>`;
  } else {
    const d = dateParts(episode.publishedAt ?? episode.createdAt, tenant.timeZone);
    const meta = [episode.scripture, episode.speaker].filter(Boolean).map(esc).join(' · ');
    const duration = durationOf(episode);
    const video = await matchingStreamUrl(episode);
    body = `<article class="card">
  <div class="head">
    <div class="date" aria-hidden="true"><div class="d">${esc(d.day)}</div><div class="m">${esc(d.month)}</div><div class="y">${esc(d.year)}</div></div>
    <div class="info">
      <h1 class="title">${esc(episode.title)}</h1>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
    </div>
  </div>
  <div class="player">
    <button class="play" id="play" type="button" aria-label="Abspielen" data-play='${ICONS.play}' data-pause='${ICONS.pause}'>${ICONS.play}</button>
    <div class="bar" id="bar" role="slider" tabindex="0" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
    <div class="time" id="time">0:00 / ${fmtTime(duration)}</div>
    <audio id="audio" preload="none" src="${esc(episode.audioUrl)}" data-duration="${duration}"></audio>
  </div>
  <div class="foot">
    ${video ? `<a class="btn" href="${esc(video)}" target="_blank" rel="noopener" title="Video ansehen" aria-label="Video ansehen">${ICONS.video}</a>` : ''}
    <a class="btn" href="${esc(episode.audioUrl)}" target="_blank" rel="noopener" download title="MP3 herunterladen" aria-label="MP3 herunterladen">${ICONS.headphones}</a>
    <nav class="nav" aria-label="Weitere Predigten">
      ${nr + 1 < total ? `<a href="${link(nr + 1)}" aria-label="Ältere Predigt">${ICONS.prev}</a>` : `<span>${ICONS.prev}</span>`}
      ${nr > 0 ? `<a href="${link(nr - 1)}" aria-label="Neuere Predigt">${ICONS.next}</a>` : `<span>${ICONS.next}</span>`}
    </nav>
  </div>
</article>
<script>${SCRIPT}</script>`;
  }

  const title = settings.feed.title || tenant.name;
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.type('html').send(`<!doctype html>
<html lang="de" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}${accent ? `:root:root{--accent:${accent};--on-accent:${onAccent(accent)}}` : ''}</style>
</head>
<body>
${body}
</body>
</html>`);
});
