import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireUser, tid } from '../auth/middleware.js';
import { HttpError } from '../lib/http.js';
import { can, type ToolKey } from '../permissions.js';
import { syncFeed } from '../services/podcasts.js';
import { getSettings, isSettingsKey, saveSettings, type SettingsKey } from '../settings.js';

export const settingsRouter = Router();

/** planning-Einstellungen: nur Admins; Tool-Einstellungen: Recht "settings" des Tools */
function checkAccess(req: Request, key: SettingsKey, write: boolean) {
  if (key === 'planning') {
    if (write && !req.user!.isAdmin) throw new HttpError(403, 'Nur für Administratoren');
    return;
  }
  if (!can(req.perms!, key as ToolKey, write ? 'settings' : 'view')) throw new HttpError(403, 'Keine Berechtigung');
}

function settingsKey(req: Request, _res: Response, next: NextFunction) {
  if (!isSettingsKey(String(req.params.tool))) throw new HttpError(404, 'Unbekanntes Tool');
  next();
}

settingsRouter.get('/api/settings/:tool', requireUser, settingsKey, async (req, res) => {
  const key = String(req.params.tool) as SettingsKey;
  checkAccess(req, key, false);
  res.json(await getSettings(tid(req), key));
});

settingsRouter.put('/api/settings/:tool', requireUser, settingsKey, async (req, res) => {
  const key = String(req.params.tool) as SettingsKey;
  checkAccess(req, key, true);
  const saved = await saveSettings(tid(req), key, req.body);
  // Feed-Angaben geändert: feed.xml beim nächsten Worker-Lauf aktualisieren
  if (key === 'podcast') await syncFeed(tid(req));
  res.json(saved);
});
