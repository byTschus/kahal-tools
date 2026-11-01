import { prisma } from '../db.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { getPodcastHost, type HostConfig } from '../providers/podcastHost/index.js';
import { getStreamingProvider, type StreamingSecrets } from '../providers/streaming/index.js';

export type IntegrationKind = 'streaming' | 'podcastHost';

export async function getIntegration(tenantId: string, kind: IntegrationKind) {
  return prisma.integration.findUnique({ where: { tenantId_kind: { tenantId, kind } } });
}

/** Streaming-Client der Gemeinde (oder null, falls nicht verbunden) */
export async function streamingFor(tenantId: string) {
  const integration = await getIntegration(tenantId, 'streaming');
  if (!integration) return null;
  const provider = getStreamingProvider(integration.provider);
  const secrets = decryptJson<StreamingSecrets>(integration.secrets);
  if (!secrets) return null;
  const client = provider.createClient(secrets, async (updated) => {
    await prisma.integration.update({ where: { id: integration.id }, data: { secrets: encryptJson(updated) } });
  });
  return { integration, provider, client };
}

export async function requireStreaming(tenantId: string) {
  const s = await streamingFor(tenantId);
  if (!s) throw new HttpError(400, 'Es ist keine Streaming-Plattform verbunden (Einstellungen → Livestream)', 'no-streaming');
  return s;
}

export async function podcastHostFor(tenantId: string) {
  const integration = await getIntegration(tenantId, 'podcastHost');
  if (!integration) return null;
  const provider = getPodcastHost(integration.provider);
  return {
    integration,
    provider,
    config: (integration.config ?? {}) as HostConfig,
    secrets: decryptJson<HostConfig>(integration.secrets) ?? {},
  };
}

export async function requirePodcastHost(tenantId: string) {
  const h = await podcastHostFor(tenantId);
  if (!h) throw new HttpError(400, 'Es ist kein Podcast-Hosting eingerichtet (Einstellungen → Podcast)', 'no-host');
  return h;
}
