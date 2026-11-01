import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { ACTIONS, TOOLS } from '../permissions.js';

export const meRouter = Router();

meRouter.get('/api/me', (req, res) => {
  const user = req.user;
  if (!user) throw new HttpError(401, 'Nicht angemeldet', 'unauthenticated');
  res.json({
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: user.isAdmin, status: user.status },
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, provider: user.tenant.planningProvider, timeZone: user.tenant.timeZone },
    permissions: user.status === 'active' ? req.perms : {},
    tools: TOOLS,
    actions: ACTIONS,
  });
});
