import type { Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.sessionSecret);
const SESSION_COOKIE = 'kt_session';
const STATE_COOKIE = 'kt_oauth';
const SESSION_DAYS = 30;

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.appUrl.startsWith('https://'),
    path: '/',
    maxAge: maxAgeMs,
  };
}

export interface SessionData {
  uid: string;
  tid: string;
}

export async function setSession(res: Response, data: SessionData) {
  const token = await new SignJWT({ ...data })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret);
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_DAYS * 86400_000));
}

export async function readSession(req: Request): Promise<SessionData | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.uid !== 'string' || typeof payload.tid !== 'string') return null;
    return { uid: payload.uid, tid: payload.tid };
  } catch {
    return null;
  }
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Kurzlebiger, signierter OAuth-State (CSRF-Schutz) inkl. Kontext (z.B. returnTo, Tenant). */
export async function createOAuthState(res: Response, data: Record<string, string>): Promise<string> {
  const nonce = crypto.randomUUID();
  const token = await new SignJWT({ ...data, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(secret);
  res.cookie(STATE_COOKIE, token, cookieOptions(15 * 60_000));
  return nonce;
}

export async function consumeOAuthState(req: Request, res: Response, nonce: unknown): Promise<Record<string, string>> {
  const token = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });
  if (!token || typeof nonce !== 'string') throw new Error('OAuth-Status fehlt – bitte erneut versuchen');
  const { payload } = await jwtVerify(token, secret);
  if (payload.nonce !== nonce) throw new Error('OAuth-Status ungültig – bitte erneut versuchen');
  return payload as Record<string, string>;
}
