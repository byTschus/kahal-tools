import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Eintrag') => new HttpError(404, `${what} nicht gefunden`);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Die Datei ist zu gross' });
    return;
  }
  // Eindeutigkeit verletzt (z.B. Plan bereits einem anderen Eintrag zugeordnet)
  if ((err as { code?: string })?.code === 'P2002') {
    const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? '');
    res.status(409).json({ error: /planId/.test(target) ? 'Dieser Plan ist bereits einem anderen Eintrag zugeordnet' : 'Dieser Eintrag existiert bereits' });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Ungültige Eingabe', details: err.issues });
    return;
  }
  console.error(err);
  const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
  res.status(500).json({ error: message });
}

/** Fetch-Hilfsfunktion für externe JSON-APIs mit verständlichen Fehlermeldungen. */
export async function fetchJson<T = any>(url: string, init: RequestInit & { service?: string } = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body?.error?.message ??
      body?.errors?.[0]?.detail ??
      body?.errors?.[0]?.title ??
      body?.error_description ??
      (typeof body?.error === 'string' ? body.error : undefined) ??
      res.statusText;
    const err = new HttpError(res.status === 401 ? 401 : 502, `${init.service ?? 'API'}: ${detail}`, 'upstream');
    (err as any).upstreamStatus = res.status;
    throw err;
  }
  return body as T;
}
