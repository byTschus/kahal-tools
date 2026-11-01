import ExcelJS from 'exceljs';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';

/**
 * Import von Besucherzahlen aus CSV oder Excel.
 * Erste Zeile = Spaltenüberschriften. Erkannt werden Datum (Pflicht), Uhrzeit, Titel, Livestream,
 * Bemerkung und Total (wird ignoriert); alle übrigen Spalten sind Orte (Zuordnung über den Namen).
 */

type Cell = string | number | Date | null;
type ColumnKind = 'date' | 'time' | 'title' | 'livestream' | 'notes' | 'total' | 'location' | 'newLocation' | 'ignored';

export interface ImportColumn {
  header: string;
  kind: ColumnKind;
  locationId?: string;
}

export interface ImportRow {
  line: number;
  date: string;
  title: string;
  values: Record<string, number>;
  livestream: number | null;
  notes: string | null;
  duplicate: boolean;
  /** Uhrzeit fehlte in der Datei (Standard 10:00) */
  timeGuessed: boolean;
  /** Titel fehlte in der Datei (Standard „Gottesdienst“) */
  titleGuessed: boolean;
  /** Automatisch zugeordneter Plan */
  plan?: { planId: string; title: string; startsAt: string | null } | null;
  /** Mehrere Pläne passen gleich gut */
  ambiguous?: boolean;
}

export interface ImportResult {
  columns: ImportColumn[];
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

const DEFAULT_TITLE = 'Gottesdienst';
const DEFAULT_TIME = { h: 10, m: 0 };

// ----- Datei lesen -----

function decodeText(buf: Buffer) {
  let text = buf.toString('utf8');
  // Excel speichert CSV unter Windows oft als Windows-1252
  if (text.includes('�')) text = buf.toString('latin1');
  return text.replace(/^﻿/, '');
}

export function parseCsv(text: string): Cell[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ';');
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
}

async function parseXlsx(buf: Buffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'Die Excel-Datei konnte nicht gelesen werden');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new HttpError(400, 'Die Excel-Datei enthält keine Tabelle');
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells: Cell[] = [];
    for (let i = 1; i <= sheet.columnCount; i++) {
      let v: unknown = r.getCell(i).value;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
        v = o.result ?? o.text ?? o.richText?.map((t) => t.text).join('') ?? null;
      }
      cells.push(v instanceof Date || typeof v === 'number' || typeof v === 'string' ? v : v == null ? null : String(v));
    }
    rows.push(cells);
  });
  return rows;
}

export async function readTable(fileName: string, buf: Buffer): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(fileName)) return parseXlsx(buf);
  if (/\.xls$/i.test(fileName)) throw new HttpError(400, 'Alte .xls-Dateien werden nicht unterstützt – bitte als .xlsx oder .csv speichern');
  return parseCsv(decodeText(buf));
}

// ----- Werte interpretieren -----

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function classify(header: string): ColumnKind | null {
  const h = norm(header);
  if (/^(datum|date|tag)$/.test(h) || h.startsWith('datum')) return 'date';
  if (/^(zeit|uhrzeit|time|beginn|start)$/.test(h)) return 'time';
  if (/^(titel|anlass|event|gottesdienst|veranstaltung|title|plan)$/.test(h)) return 'title';
  if (/livestream|online|stream|youtube/.test(h)) return 'livestream';
  if (/bemerkung|notiz|kommentar|notes|anmerkung/.test(h)) return 'notes';
  if (/^(total|summe|gesamt|insgesamt|anzahl total|vor ort|vor ort total|total vor ort)$/.test(h)) return 'total';
  return null;
}

/** Datum (und ggf. Uhrzeit) aus Zelle: Date, Excel-Seriennummer, "31.12.2025", "31.12.25 10:00", "2025-12-31" */
function parseDate(cell: Cell): { y: number; mo: number; d: number; h?: number; m?: number } | null {
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return null;
    const hasTime = cell.getUTCHours() !== 0 || cell.getUTCMinutes() !== 0;
    return { y: cell.getUTCFullYear(), mo: cell.getUTCMonth() + 1, d: cell.getUTCDate(), ...(hasTime ? { h: cell.getUTCHours(), m: cell.getUTCMinutes() } : {}) };
  }
  if (typeof cell === 'number') return cell > 20000 && cell < 80000 ? parseDate(new Date(Math.round((cell - 25569) * 86400_000))) : null;
  const s = String(cell ?? '').trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ ,]+(\d{1,2})[:.](\d{2}))?/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return { y, mo: Number(m[2]), d: Number(m[1]), ...(m[4] ? { h: Number(m[4]), m: Number(m[5]) } : {}) };
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), ...(m[4] ? { h: Number(m[4]), m: Number(m[5]) } : {}) };
  return null;
}

function parseTime(cell: Cell): { h: number; m: number } | null {
  if (cell instanceof Date) return { h: cell.getUTCHours(), m: cell.getUTCMinutes() };
  if (typeof cell === 'number' && cell >= 0 && cell < 1) {
    const min = Math.round(cell * 1440);
    return { h: Math.floor(min / 60), m: min % 60 };
  }
  const m = String(cell ?? '').trim().match(/^(\d{1,2})[:.](\d{2})/);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
}

function parseCount(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? Math.max(0, Math.round(cell)) : null;
  const s = String(cell ?? '').replace(/['’\s]/g, '').trim();
  if (!s || s === '-' || s === '–') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

/** Lokale Zeit in der Zeitzone der Gemeinde -> UTC */
function zonedToUtc(y: number, mo: number, d: number, h: number, m: number, timeZone: string) {
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  );
  const asZoned = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (asZoned - guess));
}

// ----- Auswertung -----

export async function analyzeImport(tenantId: string, timeZone: string, table: Cell[][], createLocations: boolean): Promise<ImportResult> {
  if (table.length < 2) throw new HttpError(400, 'Die Datei enthält keine Daten (erste Zeile = Überschriften, danach eine Zeile pro Event)');
  const locations = await prisma.visitorLocation.findMany({ where: { tenantId } });
  const byName = new Map(locations.map((l) => [norm(l.name), l]));

  const columns: ImportColumn[] = table[0].map((h) => {
    const header = String(h ?? '').trim();
    if (!header) return { header, kind: 'ignored' };
    const kind = classify(header);
    if (kind) return { header, kind };
    const loc = byName.get(norm(header));
    if (loc) return { header, kind: 'location', locationId: loc.id };
    return { header, kind: createLocations ? 'newLocation' : 'ignored' };
  });
  if (!columns.some((c) => c.kind === 'date')) throw new HttpError(400, 'Keine Spalte „Datum“ gefunden');

  const existing = await prisma.visitorCount.findMany({ where: { tenantId }, select: { eventDate: true, eventTitle: true } });
  const existingKeys = new Set(existing.map((e) => `${e.eventDate.toISOString()}|${norm(e.eventTitle)}`));

  const rows: ImportRow[] = [];
  const errors: ImportResult['errors'] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    let date: ReturnType<typeof parseDate> = null;
    let time: { h: number; m: number } | null = null;
    let title = '';
    let livestream: number | null = null;
    let notes: string | null = null;
    const values: Record<string, number> = {};
    columns.forEach((col, ci) => {
      const cell = cells[ci] ?? null;
      if (col.kind === 'date') date = parseDate(cell);
      else if (col.kind === 'time') time = parseTime(cell);
      else if (col.kind === 'title') title = String(cell ?? '').trim();
      else if (col.kind === 'livestream') livestream = parseCount(cell);
      else if (col.kind === 'notes') notes = String(cell ?? '').trim() || null;
      else if (col.kind === 'location' || col.kind === 'newLocation') {
        const n = parseCount(cell);
        if (n !== null) values[col.header] = n;
      }
    });
    const rawDate = cells[columns.findIndex((c) => c.kind === 'date')];
    if (!date) {
      if (String(rawDate ?? '').trim()) errors.push({ line, message: `Datum „${String(rawDate)}“ nicht erkannt` });
      return;
    }
    if (!Object.keys(values).length && livestream === null) return; // leere Zeile
    const d = date as { y: number; mo: number; d: number; h?: number; m?: number };
    const t = time ?? (d.h !== undefined ? { h: d.h, m: d.m ?? 0 } : DEFAULT_TIME);
    const eventDate = zonedToUtc(d.y, d.mo, d.d, t.h, t.m, timeZone);
    if (isNaN(eventDate.getTime())) {
      errors.push({ line, message: 'Ungültiges Datum' });
      return;
    }
    const finalTitle = (title || DEFAULT_TITLE).slice(0, 190);
    const key = `${eventDate.toISOString()}|${norm(finalTitle)}`;
    rows.push({
      line,
      date: eventDate.toISOString(),
      title: finalTitle,
      values,
      livestream,
      notes,
      duplicate: existingKeys.has(key) || seen.has(key),
      timeGuessed: !time && d.h === undefined,
      titleGuessed: !title,
    });
    seen.add(key);
  });
  return { columns, rows, errors };
}

export async function commitImport(tenantId: string, userId: string, result: ImportResult) {
  // Neue Orte anlegen
  const max = await prisma.visitorLocation.aggregate({ where: { tenantId }, _max: { sortOrder: true } });
  let sort = max._max.sortOrder ?? 0;
  const locationIds = new Map<string, string>();
  for (const col of result.columns) {
    if (col.kind === 'location') locationIds.set(col.header, col.locationId!);
    if (col.kind === 'newLocation') {
      const loc = await prisma.visitorLocation.create({ data: { tenantId, name: col.header.slice(0, 100), sortOrder: ++sort } });
      locationIds.set(col.header, loc.id);
    }
  }
  const rows = result.rows.filter((r) => !r.duplicate);
  for (let i = 0; i < rows.length; i += 100) {
    await prisma.$transaction(
      rows.slice(i, i + 100).map((r) =>
        prisma.visitorCount.create({
          data: {
            tenantId,
            // Fehlende Angaben aus dem zugeordneten Plan übernehmen
            eventTitle: r.plan && r.titleGuessed ? r.plan.title.slice(0, 190) : r.title,
            eventDate: r.plan?.startsAt && r.timeGuessed ? new Date(r.plan.startsAt) : new Date(r.date),
            planId: r.plan?.planId ?? null,
            livestreamEnabled: r.livestream !== null,
            livestreamCount: r.livestream,
            notes: r.notes,
            imported: true,
            createdById: userId,
            values: {
              create: Object.entries(r.values)
                .filter(([header]) => locationIds.has(header))
                .map(([header, value]) => ({ locationId: locationIds.get(header)!, value })),
            },
          },
        }),
      ),
    );
  }
  return { imported: rows.length, skipped: result.rows.length - rows.length, linked: rows.filter((r) => r.plan).length };
}
