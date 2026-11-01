let timeZone = 'Europe/Zurich';
export const setTimeZone = (tz: string) => {
  timeZone = tz;
};

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('de-CH', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** ISO -> Wert für <input type="datetime-local"> in der Zeitzone der Gemeinde */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** <input type="datetime-local">-Wert (Zeitzone der Gemeinde) -> ISO */
export function fromLocalInput(value: string) {
  if (!value) return '';
  const asUtc = new Date(`${value}:00Z`);
  // Offset der Zeitzone zu diesem Zeitpunkt bestimmen
  const local = new Date(toLocalInput(asUtc.toISOString()) + ':00Z');
  const offset = local.getTime() - asUtc.getTime();
  return new Date(asUtc.getTime() - offset).toISOString();
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null || !isFinite(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** "1:02:03" / "62:03" / "3723" -> Sekunden */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function fmtBytes(bytes: number | null | undefined) {
  if (!bytes) return '–';
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`;
}

export const fmtNumber = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('de-CH'));

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
