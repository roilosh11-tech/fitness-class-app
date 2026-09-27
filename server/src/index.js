import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, q } from './db.js';
import { seedIfEmpty } from './seed.js';
import { ensureSessions, bus, HttpError } from './logic.js';
import { requireAuth } from './auth.js';
import core from './routes/core.js';
import community, { serveMedia } from './routes/community.js';
import staff from './routes/staff.js';
import store from './routes/store.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(','), credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_, res) => { await q('select 1'); res.json({ ok: true }); });

// Server-sent events: live updates (spots, feed, meetups). Client: new EventSource('/api/events?token=…')
app.get('/api/events', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const on = (e) => { if (e.studio_id === req.user.studio_id) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`); };
  bus.on('evt', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { bus.off('evt', on); clearInterval(ping); });
});

app.get('/api/media/:id', serveMedia);       // public (unguessable ids)
app.use('/api', core);                        // /auth/* public, rest authed
app.use('/api', community);
app.use('/api', staff);
app.use('/api', store);

// Serve a built web app (Expo `npx expo export --platform web` → ../dist) if present
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^\/(?!api\/).*/, (_, res) => res.sendFile(path.join(web, 'index.html')));
} else {
  app.get('/', (_, res) => res.json({ name: 'FORM API', ok: true, docs: 'see server/API.md' }));
}

app.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
  if (err?.code === '23505') return res.status(409).json({ error: 'duplicate' });
  if (err?.code === '22P02') return res.status(400).json({ error: 'invalid_id' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const port = process.env.PORT || 3000;
await migrate();
await seedIfEmpty();
await ensureSessions();
setInterval(() => ensureSessions().catch(console.error), 6 * 3600e3);
app.listen(port, () => console.log(`FORM API listening on :${port}`));
