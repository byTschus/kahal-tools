import { HttpError } from '../../lib/http.js';
import { globalApp } from '../../services/oauthApps.js';
import type { StreamingProvider } from './types.js';
import { youtubeProvider } from './youtube.js';

export * from './types.js';

const providers: StreamingProvider[] = [youtubeProvider];

export function listStreamingProviders() {
  return providers.map((p) => ({ key: p.key, label: p.label, globalApp: Boolean(globalApp(p.key)) }));
}

export function getStreamingProvider(key: string): StreamingProvider {
  const provider = providers.find((p) => p.key === key);
  if (!provider) throw new HttpError(400, `Streaming-Plattform "${key}" ist nicht verfügbar`);
  return provider;
}
