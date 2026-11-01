import { Client } from 'basic-ftp';
import { Readable } from 'node:stream';
import type { HostConfig, PodcastHostProvider } from './types.js';

async function connect(config: HostConfig, secrets: HostConfig) {
  const client = new Client(30_000);
  await client.access({
    host: config.host,
    port: Number(config.port || 21),
    user: config.user,
    password: secrets.password,
    secure: config.secure === 'implicit' ? 'implicit' : config.secure === 'explicit',
    secureOptions: { rejectUnauthorized: config.allowSelfSigned !== true },
  });
  if (config.directory) await client.ensureDir(config.directory);
  return client;
}

export const ftpProvider: PodcastHostProvider = {
  key: 'ftp',
  label: 'FTP-Server',
  fields: [
    { key: 'host', label: 'Server', type: 'text', required: true, placeholder: 'ftp.example.ch' },
    { key: 'port', label: 'Port', type: 'number', default: 21 },
    {
      key: 'secure',
      label: 'Verschlüsselung',
      type: 'select',
      default: 'explicit',
      options: [
        { value: 'explicit', label: 'FTPS (explizit, empfohlen)' },
        { value: 'implicit', label: 'FTPS (implizit, Port 990)' },
        { value: 'none', label: 'Keine (unsicher)' },
      ],
    },
    { key: 'allowSelfSigned', label: 'Selbstsignierte Zertifikate erlauben', type: 'checkbox', default: false },
    { key: 'user', label: 'Benutzername', type: 'text', required: true },
    { key: 'password', label: 'Passwort', type: 'password', secret: true, required: true },
    { key: 'directory', label: 'Verzeichnis', type: 'text', placeholder: '/podcast', help: 'Ordner auf dem FTP-Server, in den die MP3-Dateien hochgeladen werden' },
    {
      key: 'publicBaseUrl',
      label: 'Öffentliche URL des Verzeichnisses',
      type: 'text',
      required: true,
      placeholder: 'https://www.gemeinde.ch/podcast',
      help: 'Unter dieser Adresse sind die hochgeladenen Dateien im Internet erreichbar',
    },
  ],

  async test(config, secrets) {
    const client = await connect(config, secrets);
    try {
      const list = await client.list();
      return `Verbindung erfolgreich (${list.length} Einträge im Verzeichnis)`;
    } finally {
      client.close();
    }
  },

  async deleteFile(config, secrets, fileName) {
    const client = await connect(config, secrets);
    try {
      await client.remove(fileName, true);
    } finally {
      client.close();
    }
  },

  async uploadText(config, secrets, fileName, content) {
    const client = await connect(config, secrets);
    try {
      await client.uploadFrom(Readable.from([Buffer.from(content, 'utf8')]), fileName);
    } finally {
      client.close();
    }
  },

  publicUrl(config, fileName) {
    return `${String(config.publicBaseUrl ?? '').replace(/\/$/, '')}/${encodeURIComponent(fileName)}`;
  },
};
