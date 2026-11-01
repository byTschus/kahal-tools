/**
 * Mini-Template-Engine für Titel/Beschreibungen aus Planungstool-Variablen.
 *
 *   {{event.title}}
 *   {{event.date | date:"EEEE, dd.MM.yyyy"}}
 *   {{people["Worship Leader"] | default:"-"}}
 *   {{items.Predigt.description | strip_html | truncate:200}}
 */

export type Vars = Record<string, unknown>;

export interface RenderOptions {
  timeZone?: string;
}

const TAG = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function render(template: string, vars: Vars, opts: RenderOptions = {}): string {
  if (!template) return '';
  return template.replace(TAG, (_m, expr: string) => {
    try {
      return toText(evaluate(expr, vars, opts));
    } catch {
      return '';
    }
  });
}

function evaluate(expr: string, vars: Vars, opts: RenderOptions): unknown {
  const parts = splitPipes(expr);
  let value = resolvePath(vars, parts[0].trim());
  for (const raw of parts.slice(1)) {
    const { name, args } = parseFilter(raw.trim());
    const fn = filters[name];
    if (!fn) throw new Error(`Unbekannter Filter: ${name}`);
    value = fn(value, args, opts);
  }
  return value;
}

/** Trennt an "|" – ausser innerhalb von Anführungszeichen. */
function splitPipes(expr: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of expr) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === '|') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseFilter(raw: string): { name: string; args: string[] } {
  const idx = raw.indexOf(':');
  if (idx === -1) return { name: raw, args: [] };
  const name = raw.slice(0, idx).trim();
  const args: string[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))\s*(?:,|$)/g;
  const rest = raw.slice(idx + 1);
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) && m[0] !== '') {
    args.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1').trim());
  }
  return { name, args };
}

export function parsePath(path: string): string[] {
  const keys: string[] = [];
  const re = /\[\s*"([^"]*)"\s*\]|\[\s*'([^']*)'\s*\]|\[\s*(\d+)\s*\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) keys.push((m[1] ?? m[2] ?? m[3] ?? m[4]).trim());
  return keys;
}

export function resolvePath(vars: unknown, path: string): unknown {
  let current: any = vars;
  for (const key of parsePath(path)) {
    if (current == null) return undefined;
    if (typeof current === 'object' && key in current) {
      current = current[key];
      continue;
    }
    // Tolerant: Gross-/Kleinschreibung und Leerzeichen/Unterstriche ignorieren
    if (typeof current === 'object') {
      const norm = normalizeKey(key);
      const match = Object.keys(current).find((k) => normalizeKey(k) === norm);
      current = match ? current[match] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

const normalizeKey = (k: string) => k.toLowerCase().replace(/[\s_-]+/g, '');

function toText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.name === 'string') return v.name;
    if (typeof v.title === 'string') return v.title;
    return '';
  }
  return String(value);
}

function isEmpty(value: unknown) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

type Filter = (value: unknown, args: string[], opts: RenderOptions) => unknown;

const filters: Record<string, Filter> = {
  default: (v, [fallback = '']) => (isEmpty(v) ? fallback : v),
  upper: (v) => toText(v).toUpperCase(),
  lower: (v) => toText(v).toLowerCase(),
  trim: (v) => toText(v).trim(),
  first: (v) => (Array.isArray(v) ? v[0] : toText(v).split(/\s*,\s*/)[0]),
  join: (v, [sep = ', ']) => (Array.isArray(v) ? v.map(toText).join(sep) : toText(v)),
  truncate: (v, [len = '100']) => {
    const s = toText(v);
    const n = Number(len);
    return s.length > n ? s.slice(0, Math.max(0, n - 1)).trimEnd() + '…' : s;
  },
  strip_html: (v) => stripHtml(toText(v)),
  replace: (v, [search = '', replacement = '']) => toText(v).split(search).join(replacement),
  date: (v, [pattern = 'dd.MM.yyyy'], opts) => {
    const d = toDate(v);
    return d ? formatDate(d, pattern, opts.timeZone) : '';
  },
  time: (v, [pattern = 'HH:mm'], opts) => {
    const d = toDate(v);
    return d ? formatDate(d, pattern, opts.timeZone) : '';
  },
};

export const filterNames = Object.keys(filters);

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Zerlegt ein Datum in die Bestandteile in der gewünschten Zeitzone. */
export function dateParts(date: Date, timeZone = 'Europe/Zurich') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday,
  };
}

/** Datumsformat ähnlich Unicode/date-fns: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H mm ss 'Text' */
export function formatDate(date: Date, pattern: string, timeZone?: string): string {
  const p = dateParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, () => string> = {
    yyyy: () => String(p.year),
    yy: () => String(p.year).slice(-2),
    MMMM: () => MONTHS[p.month - 1],
    MMM: () => MONTHS[p.month - 1].slice(0, 3),
    MM: () => pad(p.month),
    M: () => String(p.month),
    dd: () => pad(p.day),
    d: () => String(p.day),
    EEEE: () => WEEKDAYS[p.weekday],
    EEE: () => WEEKDAYS[p.weekday].slice(0, 2),
    HH: () => pad(p.hour),
    H: () => String(p.hour),
    mm: () => pad(p.minute),
    ss: () => pad(p.second),
  };
  return pattern.replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|mm|ss/g, (tok, literal) =>
    literal !== undefined ? literal : tokens[tok](),
  );
}

export interface VariableInfo {
  path: string;
  sample: string;
}

/** Listet alle verfügbaren Variablen (für die Einstellungs-Oberfläche). */
export function listVariables(vars: Vars, prefix = '', depth = 0): VariableInfo[] {
  const out: VariableInfo[] = [];
  for (const [key, value] of Object.entries(vars)) {
    const path = prefix ? (IDENT.test(key) ? `${prefix}.${key}` : `${prefix}["${key}"]`) : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && depth < 4) {
      out.push(...listVariables(value as Vars, path, depth + 1));
    } else {
      out.push({ path, sample: toText(value).slice(0, 200) });
    }
  }
  return out;
}

/** Wandelt einen Text in einen sicheren Dateinamen um. */
export function slugify(text: string, maxLength = 120): string {
  return text
    .normalize('NFC')
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .toLowerCase();
}
