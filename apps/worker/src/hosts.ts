import { Client } from 'basic-ftp';
import { stat } from 'node:fs/promises';

/**
 * Upload auf das Podcast-Hosting. Neues Hosting: Funktion ergänzen und in `uploaders` registrieren
 * (Gegenstück zu apps/server/src/providers/podcastHost).
 */
export interface HostSpec {
  type: string;
  config: Record<string, any>;
  secrets: Record<string, any>;
}

type Uploader = (host: HostSpec, localFile: string, remoteName: string, onProgress: (fraction: number) => void) => Promise<void>;

const ftp: Uploader = async ({ config, secrets }, localFile, remoteName, onProgress) => {
  const client = new Client(60_000);
  try {
    await client.access({
      host: config.host,
      port: Number(config.port || 21),
      user: config.user,
      password: secrets.password,
      secure: config.secure === 'implicit' ? 'implicit' : config.secure === 'explicit',
      secureOptions: { rejectUnauthorized: config.allowSelfSigned !== true },
    });
    if (config.directory) await client.ensureDir(config.directory);
    const { size } = await stat(localFile);
    client.trackProgress((info) => onProgress(size ? info.bytes / size : 0));
    // Erst unter temporärem Namen hochladen und dann umbenennen -> nie halbe Dateien im Feed
    const tmpName = `${remoteName}.part`;
    await client.uploadFrom(localFile, tmpName);
    client.trackProgress();
    await client.remove(remoteName, true);
    await client.rename(tmpName, remoteName);
  } finally {
    client.close();
  }
};

const uploaders: Record<string, Uploader> = { ftp };

export function upload(host: HostSpec, localFile: string, remoteName: string, onProgress: (fraction: number) => void) {
  const uploader = uploaders[host.type];
  if (!uploader) throw new Error(`Podcast-Hosting "${host.type}" wird vom Worker nicht unterstützt`);
  return uploader(host, localFile, remoteName, onProgress);
}
