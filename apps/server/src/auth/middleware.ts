import type { NextFunction, Request, Response } from 'express';
import type { Group, GroupMember, Tenant, User } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../lib/http.js';
import { readSession } from '../lib/session.js';
import { can, effectivePermissions, type ActionKey, type PermissionMap, type ToolKey } from '../permissions.js';

export type SessionUser = User & { tenant: Tenant; groups: (GroupMember & { group: Group })[] };

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      perms?: PermissionMap;
    }
  }
}

/** Lädt den angemeldeten Benutzer (falls vorhanden). */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const session = await readSession(req);
  if (session) {
    const user = await prisma.user.findFirst({
      where: { id: session.uid, tenantId: session.tid },
      include: { tenant: true, groups: { include: { group: true } } },
    });
    if (user) {
      req.user = user;
      req.perms = effectivePermissions(user);
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Nicht angemeldet', 'unauthenticated');
  if (req.user.status !== 'active') throw new HttpError(403, 'Zugang noch nicht freigeschaltet', 'pending');
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireUser(req, res, () => {
    if (!req.user!.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
    next();
  });
}

export function requirePerm(tool: ToolKey, action: ActionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireUser(req, res, () => {
      if (!can(req.perms!, tool, action)) throw new HttpError(403, 'Keine Berechtigung für diese Aktion');
      next();
    });
  };
}

/** Kurzform: Tenant-ID des angemeldeten Benutzers */
export const tid = (req: Request) => req.user!.tenantId;
