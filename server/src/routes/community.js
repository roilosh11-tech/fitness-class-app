import { Router } from 'express';
import multer from 'multer';
import { one, many, q } from '../db.js';
import { requireAuth, staff } from '../auth.js';
import { HttpError, emit, joinMeetup, leaveMeetup } from '../logic.js';
import { h } from './core.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_, f, cb) => cb(null, /^(image|video)\//.test(f.mimetype)) });
const r = Router();

// Media is served publicly by id (unguessable uuid) so <img src> works without headers.
export const serveMedia = h(async (req, res) => {
  const m = await one('select mime, data from media where id=$1', [req.params.id]);
  if (!m) return res.sendStatus(404);
  res.set('Content-Type', m.mime).set('Cache-Control', 'public, max-age=31536000, immutable').send(m.data);
});

r.use(requireAuth);

r.post('/media', upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'file_required');
  const m = await one('insert into media(studio_id, owner_id, mime, data) values ($1,$2,$3,$4) returning id', [req.user.studio_id, req.user.id, req.file.mimetype, req.file.buffer]);
  res.json({ id: m.id, url: `/api/media/${m.id}` });
}));

// ── feed ─────────────────────────────────────────────────────────────────────
r.get('/posts', h(async (req, res) => {
  const before = req.query.before || new Date(Date.now() + 1e3).toISOString();
  const posts = await many(`
    select p.id, p.body, p.created_at, '/api/media/' || p.media_id url, u.id author_id, u.full_name author, (p.author_id=$1) own,
      coalesce((select jsonb_object_agg(emoji, n) from (select emoji, count(*)::int n from reactions where post_id=p.id group by emoji) x), '{}') counts,
      (select emoji from reactions where post_id=p.id and user_id=$1) mine,
      coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'author',cu.full_name,'body',c.body,'created_at',c.created_at) order by c.created_at)
        from comments c join users cu on cu.id=c.author_id where c.post_id=p.id), '[]') comments
    from posts p join users u on u.id=p.author_id
    where p.studio_id=$2 and p.hidden_at is null and p.created_at < $3
    order by p.created_at desc limit 20`, [req.user.id, req.user.studio_id, before]);
  res.json(posts);
}));

r.post('/posts', upload.single('file'), h(async (req, res) => {
  let mediaId = req.body.media_id;
  if (req.file) mediaId = (await one('insert into media(studio_id, owner_id, mime, data) values ($1,$2,$3,$4) returning id', [req.user.studio_id, req.user.id, req.file.mimetype, req.file.buffer])).id;
  if (!mediaId) throw new HttpError(400, 'photo_required');
  const p = await one('insert into posts(studio_id, author_id, body, media_id) values ($1,$2,$3,$4) returning *',
    [req.user.studio_id, req.user.id, (req.body.body || '').trim() || 'הגעתי היום.', mediaId]);
  emit(req.user.studio_id, 'post', { id: p.id });
  res.json(p);
}));

r.post('/posts/:id/react', h(async (req, res) => {
  const { emoji } = req.body || {};
  const p = await one('select author_id from posts where id=$1 and studio_id=$2', [req.params.id, req.user.studio_id]);
  if (!p) throw new HttpError(404, 'not_found');
  if (p.author_id === req.user.id) throw new HttpError(409, 'own_post');
  const cur = await one('select emoji from reactions where post_id=$1 and user_id=$2', [req.params.id, req.user.id]);
  if (cur && cur.emoji === emoji) await q('delete from reactions where post_id=$1 and user_id=$2', [req.params.id, req.user.id]);
  else await q(`insert into reactions(post_id, user_id, emoji) values ($1,$2,$3) on conflict (post_id, user_id) do update set emoji=excluded.emoji`, [req.params.id, req.user.id, emoji]);
  emit(req.user.studio_id, 'post', { id: req.params.id });
  res.json({ ok: true });
}));

r.post('/posts/:id/comments', h(async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) throw new HttpError(400, 'empty');
  const c = await one('insert into comments(post_id, author_id, body) select id, $2, $3 from posts where id=$1 and studio_id=$4 returning *', [req.params.id, req.user.id, body, req.user.studio_id]);
  emit(req.user.studio_id, 'post', { id: req.params.id });
  res.json(c);
}));

r.post('/posts/:id/report', h(async (req, res) => {
  await q('insert into reports(post_id, reporter_id) select id, $2 from posts where id=$1 and studio_id=$3', [req.params.id, req.user.id, req.user.studio_id]);
  res.json({ ok: true });
}));

// moderation (staff)
r.get('/reports', staff, h(async (req, res) => res.json(await many(`
  select rp.id, rp.status, rp.created_at, p.id post_id, p.body, '/api/media/' || p.media_id url, a.full_name author, rr.full_name reporter
  from reports rp join posts p on p.id=rp.post_id join users a on a.id=p.author_id join users rr on rr.id=rp.reporter_id
  where p.studio_id=$1 and rp.status='open' order by rp.created_at`, [req.user.studio_id]))));
r.post('/reports/:id/resolve', staff, h(async (req, res) => {
  const action = req.body?.action === 'remove' ? 'removed' : 'kept';
  const rp = await one('update reports set status=$2 where id=$1 returning post_id', [req.params.id, action]);
  if (rp && action === 'removed') await q('update posts set hidden_at=now() where id=$1 and studio_id=$2', [rp.post_id, req.user.studio_id]);
  res.json({ ok: true });
}));

// ── meetups ──────────────────────────────────────────────────────────────────
const MEETUP = `
  select m.id, m.name, m.type, m.starts_at, m.place, m.capacity, m.detail, m.after, m.host_id, u.full_name host,
    case when m.media_id is null then null else '/api/media/' || m.media_id end url,
    (select count(*)::int from meetup_attendees where meetup_id=m.id) going,
    exists(select 1 from meetup_attendees where meetup_id=m.id and user_id=$1) joined,
    (select coalesce(jsonb_agg(x.full_name), '[]') from (select au.full_name from meetup_attendees ma join users au on au.id=ma.user_id where ma.meetup_id=m.id order by ma.joined_at limit 5) x) attendees
  from meetups m join users u on u.id=m.host_id`;

r.get('/meetups', h(async (req, res) => res.json(await many(`${MEETUP}
  where m.studio_id=$2 and m.starts_at > now() - interval '3 hours' and ($3::text is null or m.type::text=$3)
  order by m.starts_at`, [req.user.id, req.user.studio_id, req.query.type || null]))));

r.get('/meetups/:id', h(async (req, res) => {
  const m = await one(`${MEETUP} where m.id=$2 and m.studio_id=$3`, [req.user.id, req.params.id, req.user.studio_id]);
  if (!m) throw new HttpError(404, 'not_found');
  res.json(m);
}));

r.post('/meetups', h(async (req, res) => {
  const { name, type = 'Run', starts_at, place, capacity, detail, after, media_id } = req.body || {};
  if (!name?.trim() || !starts_at || !place?.trim()) throw new HttpError(400, 'name_date_place_required');
  const m = await one(`insert into meetups(studio_id, host_id, name, type, starts_at, place, capacity, detail, after, media_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [req.user.studio_id, req.user.id, name.trim(), type, starts_at, place.trim(), capacity ? parseInt(capacity) : null, detail || null, after || null, media_id || null]);
  await joinMeetup(req.user, m.id);
  res.json(m);
}));

r.post('/meetups/:id/join', h(async (req, res) => { await joinMeetup(req.user, req.params.id); res.json({ ok: true }); }));
r.delete('/meetups/:id/join', h(async (req, res) => { await leaveMeetup(req.user, req.params.id); res.json({ ok: true }); }));

export default r;
