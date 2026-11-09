function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example)`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3000),
  appUrl: env('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
  sessionSecret: env('SESSION_SECRET'),
  encryptionKey: env('ENCRYPTION_KEY'),
  workerToken: process.env.WORKER_TOKEN ?? '',
  runScheduler: process.env.RUN_SCHEDULER !== 'false',
  migrateOnStart: process.env.MIGRATE_ON_START !== 'false',
  enableMockPlanning: process.env.ENABLE_MOCK_PLANNING === 'true' && !isProduction,
  pco: {
    clientId: process.env.PCO_CLIENT_ID ?? '',
    clientSecret: process.env.PCO_CLIENT_SECRET ?? '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
  /** Betreiber für die Datenschutzerklärung (/datenschutz) */
  legal: {
    name: (process.env.LEGAL_NAME ?? '').trim(),
    /** Adresse, Zeilen mit "\n" oder "|" trennen */
    address: (process.env.LEGAL_ADDRESS ?? '').replace(/\s*\|\s*/g, '\n').replace(/\\n/g, '\n').trim(),
    email: (process.env.LEGAL_EMAIL ?? '').trim(),
  },
  /** E-Mail-Versand (z.B. Einladungen). Ohne SMTP_HOST werden keine E-Mails verschickt. */
  smtp: {
    host: (process.env.SMTP_HOST ?? '').trim(),
    port: Number(process.env.SMTP_PORT?.trim() || 465),
    /** true = TLS ab Verbindungsbeginn (Port 465), false = STARTTLS (Port 587); leer = nach Port */
    secure: process.env.SMTP_SECURE?.trim() ? process.env.SMTP_SECURE.trim() === 'true' : Number(process.env.SMTP_PORT?.trim() || 465) === 465,
    user: (process.env.SMTP_USER ?? '').trim(),
    password: process.env.SMTP_PASSWORD ?? '',
    /** Absender, z.B. "kahal.tools <noreply@deine-domain.ch>" (Standard: SMTP_USER) */
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  },
  /** Worker-Server in der OpenStack-Cloud nach Bedarf starten/stoppen (optional, für alle Gemeinden gemeinsam) */
  workerServer: {
    authUrl: process.env.OPENSTACK_AUTH_URL || 'https://api.pub1.infomaniak.cloud/identity/v3',
    region: process.env.OPENSTACK_REGION || null,
    appCredId: process.env.OPENSTACK_APP_CRED_ID ?? '',
    appCredSecret: process.env.OPENSTACK_APP_CRED_SECRET ?? '',
    serverId: process.env.WORKER_SERVER_ID ?? '',
    autoStart: process.env.WORKER_SERVER_AUTO_START !== 'false',
    autoStop: process.env.WORKER_SERVER_AUTO_STOP !== 'false',
    idleMinutes: Math.max(5, Number(process.env.WORKER_SERVER_IDLE_MINUTES ?? 15) || 15),
  },
};

if (isProduction) {
  for (const [name, value] of [
    ['SESSION_SECRET', config.sessionSecret],
    ['ENCRYPTION_KEY', config.encryptionKey],
  ] as const) {
    if (value.length < 32 || value.startsWith('change-me')) {
      throw new Error(`${name} muss in Produktion ein zufälliger String mit mind. 32 Zeichen sein`);
    }
  }
}
