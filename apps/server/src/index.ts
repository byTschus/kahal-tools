import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth/middleware.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { errorHandler, HttpError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { feedsRouter } from './routes/feeds.js';
import { integrationsRouter } from './routes/integrations.js';
import { livestreamsRouter } from './routes/livestreams.js';
import { meRouter } from './routes/me.js';
import { planningRouter } from './routes/planning.js';
import { podcastsRouter } from './routes/podcasts.js';
import { settingsRouter } from './routes/settings.js';
import { usersRouter } from './routes/users.js';
import { visitorsRouter } from './routes/visitors.js';
import { workerRouter } from './routes/worker.js';
import { workerServerRouter } from './routes/workerServer.js';
import { startScheduler } from './services/scheduler.js';
import './services/podcasts.js';

/** Datenbank-Migrationen beim Start ausführen (Produktion), damit ein "git pull + Neustart" genügt. */
function migrate() {
  const require = createRequire(import.meta.url);
  const cli = require.resolve('prisma/build/index.js');
  const schema = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
  console.log('Datenbank-Migrationen werden ausgeführt …');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], { stdio: 'inherit', env: process.env });
}

if (config.isProduction && config.migrateOnStart) migrate();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CSRF-Schutz: schreibende API-Aufrufe nur von der eigenen Origin
const appOrigin = new URL(config.appUrl).origin;
app.use((req: Request, _res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api/') && !req.path.startsWith('/api/worker/') && origin && origin !== appOrigin) {
    throw new HttpError(403, 'Ungültige Herkunft der Anfrage');
  }
  next();
});

app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.use(workerRouter);
app.use(feedsRouter);
app.use(loadUser);
app.use(authRouter);
app.use(meRouter);
app.use(usersRouter);
app.use(planningRouter);
app.use(settingsRouter);
app.use(integrationsRouter);
app.use(livestreamsRouter);
app.use(podcastsRouter);
app.use(visitorsRouter);
app.use(workerServerRouter);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API-Endpunkt nicht gefunden')));

// Frontend (gebautes React-App) ausliefern
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|auth\/|feeds\/).*/, (_req, res) => {
    res.sendFile(`${webDist}/index.html`);
  });
}

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`kahal.tools Server läuft auf Port ${config.port} (${config.appUrl})`);
  if (config.runScheduler) startScheduler();
});
