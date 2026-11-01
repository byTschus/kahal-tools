import { HttpError } from '../../lib/http.js';
import { ftpProvider } from './ftp.js';
import type { PodcastHostProvider } from './types.js';

export * from './types.js';

const providers: PodcastHostProvider[] = [ftpProvider];

export function listPodcastHosts() {
  return providers.map((p) => ({ key: p.key, label: p.label, fields: p.fields }));
}

export function getPodcastHost(key: string): PodcastHostProvider {
  const provider = providers.find((p) => p.key === key);
  if (!provider) throw new HttpError(400, `Podcast-Hosting "${key}" ist nicht verfügbar`);
  return provider;
}
