import { config } from '../../config.js';
import { globalApp } from '../../services/oauthApps.js';
import { HttpError } from '../../lib/http.js';
import { mockProvider } from './mock.js';
import { pcoProvider } from './pco.js';
import type { PlanningProvider } from './types.js';

export * from './types.js';

/** Registrierte Planungstools. Neues Tool: Provider implementieren und hier ergänzen. */
const providers: PlanningProvider[] = [pcoProvider, ...(config.enableMockPlanning ? [mockProvider] : [])];

export function listPlanningProviders() {
  return providers.map((p) => ({ key: p.key, label: p.label, requiresApp: p.requiresApp, globalApp: !p.requiresApp || Boolean(globalApp(p.key)) }));
}

export function getPlanningProvider(key: string): PlanningProvider {
  const provider = providers.find((p) => p.key === key);
  if (!provider) throw new HttpError(400, `Planungstool "${key}" ist nicht verfügbar`);
  return provider;
}
