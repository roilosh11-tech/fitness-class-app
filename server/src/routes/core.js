import { Router } from 'express';
import { one, many, q, tx } from '../db.js';
import { hash, check, sign, requireAuth } from '../auth.js';
import { book, cancelBooking, me, HttpError } from '../logic.js';

export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (code) => { throw new HttpError(400, code); };
const r = Router();

// ── auth ─────────────────────────────────────────────────────────────────────
r.post('/auth/signup', h(async (req, res) => {
  const { email, password, full_name } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) bad('invalid_email');
  if ((password || '').length < 8) bad('password_too_short');
  if ((full_name || '').trim().length < 2) bad('name_required');
  const studio = await one('select id from studios order by created_at limit 1');
  const exists = await one('select id, password_hash from users where lower(email)=lower($1)', [email]);
  let u;
  if (exists && exists.password_hash) throw new HttpError(409, 'email_taken');
  if (exists) // staff record created by the owner, claiming it now
    u = await one('update users set password_hash=$2, full_name=coalesce(nullif($3,\'\'),full_name) where id=$1 returning *', [exists.id, await hash(password), full_name.trim()]);
  else {
    // The very first person to sign up becomes the studio owner.
    const hasOwner = await one(`select 1 from users where role='owner' and password_hash is not null`);
    u = await one('insert into users(studio_id, email, password_hash, full_name, role) values ($1,lower($2),$3,$4,$5) returning *', [studio.id, email, await hash(password), full_name.trim(), hasOwner ? 'member' : 'owner']);
  }
  res.json({ token: sign(u), user: await me(u.id) });
}));

r.post('/auth/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('select * from users where lower(email)=lower($1)', [email || '']);
  if (!u || !(await check(password || '', u.password_hash))) throw new HttpError(401, 'invalid_credentials');
  res.json({ token: sign(u), user: await me(u.id) });
}));

r.use(requireAuth);

r.get('/me', h(async (req, res) => res.json(await me(req.user.id))));
r.patch('/me', h(async (req, res) => {
  const { full_name, theme } = req.body || {};
  await q('update users set full_name=coalesce($2,full_name), theme=coalesce($3,theme) where id=$1', [req.user.id, full_name, theme]);
  res.json(await me(req.user.id));
}));

// ── plans & subscription (mock payment until a provider is chosen) ───────────
r.get('/plans', h(async (req, res) => res.json(await many('select * from plans where studio_id=$1 and is_active order by sort', [req.user.studio_id]))));

r.post('/subscribe', h(async (req, res) => {
  const { plan_id } = req.body || {};
  await tx(async (t) => {
    const p = await t.one('select * from plans where id=$1 and studio_id=$2 and is_active', [plan_id, req.user.studio_id]);
    if (!p) throw new HttpError(404, 'plan_not_found');
    await t.q(`update subscriptions set status='cancelled' where member_id=$1 and status in ('active','frozen','past_due')`, [req.user.id]);
    const pay = await t.one(`insert into payments(member_id, kind, amount_ils, status, provider) values ($1,'subscription',$2,'succeeded','mock') returning id`, [req.user.id, p.price_ils]);
    await t.q(`insert into subscriptions(member_id, plan_id, status, period_start, period_end, provider, provider_ref) values ($1,$2,'active',current_date,current_date + interval '1 month','mock',$3)`, [req.user.id, p.id, pay.id]);
    if (p.monthly_credits != null) await t.q(`insert into credit_ledger(member_id, delta, reason) values ($1,$2,'renewal')`, [req.user.id, p.monthly_credits]);
  });
  res.json(await me(req.user.id));
}));

// ── schedule ─────────────────────────────────────────────────────────────────
const SESSION_SELECT = `
  select s.id, s.name, s.type, s.starts_at, s.duration_min, s.capacity, s.cancelled_at, s.started_at, s.ended_at, s.session_plan,
    t.description, t.image_url, r.name room, c.id coach_id, c.full_name coach_name, c.coach_title,
    a.booked_count, a.waitlist_count, a.spots,
    (select b.status from bookings b where b.session_id=s.id and b.member_id=$1 and b.status in ('booked','waitlist','attended') limit 1) my_status,
    (select b.id from bookings b where b.session_id=s.id and b.member_id=$1 and b.status in ('booked','waitlist','attended') limit 1) my_booking_id
  from class_sessions s
  join session_availability a on a.id=s.id
  left join class_templates t on t.id=s.template_id
  left join rooms r on r.id=s.room_id
  left join users c on c.id=s.coach_id`;

r.get('/sessions', h(async (req, res) => {
  const from = req.query.from || new Date().toISOString();
  const to = req.query.to || new Date(Date.now() + 7 * 864e5).toISOString();
  const rows = await many(`${SESSION_SELECT}
    where s.studio_id=$2 and s.starts_at between $3 and $4
      and ($5::text is null or s.type::text=$5) and ($6::uuid is null or s.coach_id=$6)
      and (s.cancelled_at is null or $7)
    order by s.starts_at`,
    [req.user.id, req.user.studio_id, from, to, req.query.type || null, req.query.coach === 'me' ? req.user.id : (req.query.coach || null), req.query.includeCancelled === '1']);
  res.json(req.query.open === '1' ? rows.filter((x) => x.spots > 0) : rows);
}));

r.get('/sessions/:id', h(async (req, res) => {
  const s = await one(`${SESSION_SELECT} where s.id=$2 and s.studio_id=$3`, [req.user.id, req.params.id, req.user.studio_id]);
  if (!s) throw new HttpError(404, 'not_found');
  res.json(s);
}));

r.post('/sessions/:id/book', h(async (req, res) => res.json(await book(req.user, req.params.id))));
r.post('/bookings/:id/cancel', h(async (req, res) => res.json(await cancelBooking(req.user, req.params.id))));

r.get('/bookings', h(async (req, res) => {
  const tab = req.query.tab || 'up';
  const where = {
    up: `b.status in ('booked','waitlist') and s.starts_at > now() and s.cancelled_at is null`,
    past: `(b.status in ('attended','no_show') or (b.status='booked' and s.starts_at <= now()))`,
    cancelled: `b.status='cancelled'`,
  }[tab] || 'false';
  res.json(await many(`
    select b.id, b.status, b.refunded, b.late_cancel, s.id session_id, s.name, s.type, s.starts_at, r.name room, c.full_name coach_name
    from bookings b join class_sessions s on s.id=b.session_id
    left join rooms r on r.id=s.room_id left join users c on c.id=s.coach_id
    where b.member_id=$1 and ${where}
    order by s.starts_at ${tab === 'up' ? 'asc' : 'desc'} limit 100`, [req.user.id]));
}));

// ── member home summary ──────────────────────────────────────────────────────
r.get('/home', h(async (req, res) => {
  const [m, next, stats] = await Promise.all([
    me(req.user.id),
    one(`${SESSION_SELECT} join bookings mb on mb.session_id=s.id and mb.member_id=$1 and mb.status='booked'
         where s.studio_id=$2 and s.starts_at > now() and s.cancelled_at is null order by s.starts_at limit 1`, [req.user.id, req.user.studio_id]),
    one(`select
        count(*) filter (where b.status='attended')::int total_classes,
        count(*) filter (where b.status='attended' and (s.starts_at at time zone st.timezone)::date >= (date_trunc('week', (now() at time zone st.timezone) + interval '1 day') - interval '1 day')::date)::int this_week
      from bookings b join class_sessions s on s.id=b.session_id join studios st on st.id=s.studio_id where b.member_id=$1`, [req.user.id]),
  ]);
  // streak = consecutive weeks (Sun–Sat) with ≥1 attended class, counting back from this week (or last week if none yet)
  const WK = `(date_trunc('week', (X at time zone st.timezone) + interval '1 day') - interval '1 day')::date`;
  const { cur } = await one(`select ${WK.replace('X', 'now()')}::text cur from studios st where id=$1`, [req.user.studio_id]);
  const weeks = new Set((await many(`select distinct ${WK.replace('X', 's.starts_at')}::text wk
    from bookings b join class_sessions s on s.id=b.session_id join studios st on st.id=s.studio_id
    where b.member_id=$1 and b.status='attended'`, [req.user.id])).map((x) => x.wk));
  const iso = (d) => d.toISOString().slice(0, 10);
  let w = new Date(cur + 'T00:00:00Z'), streak = 0;
  if (!weeks.has(iso(w))) w.setUTCDate(w.getUTCDate() - 7);
  while (weeks.has(iso(w))) { streak++; w.setUTCDate(w.getUTCDate() - 7); }
  res.json({ me: m, next, ...stats, minutes: stats.total_classes * 50, streak });
}));

// ── leaderboard ──────────────────────────────────────────────────────────────
r.get('/leaderboard', h(async (req, res) => {
  const period = req.query.period === 'month' ? 'month' : 'week';
  const start = period === 'week'
    ? `(date_trunc('week', (now() at time zone st.timezone) + interval '1 day') - interval '1 day')`
    : `date_trunc('month', now() at time zone st.timezone)`;
  const rows = await many(`
    select u.id, u.full_name, sum(pe.points)::int pts,
      count(*) filter (where pe.kind='class')::int classes, count(*) filter (where pe.kind='meetup')::int meetups,
      bool_or(pe.kind='weekly_goal') hit_goal
    from point_events pe join users u on u.id=pe.member_id join studios st on st.id=pe.studio_id
    where pe.studio_id=$1 and (pe.occurred_at at time zone st.timezone) >= ${start}
    group by u.id order by pts desc limit 50`, [req.user.studio_id]);
  const prizes = await many('select rank, title, subtitle from prizes where studio_id=$1 and period=$2 order by rank', [req.user.studio_id, period]);
  const myRank = rows.findIndex((x) => x.id === req.user.id) + 1 || null;
  res.json({ period, rows, prizes, myRank, rules: { class: 25, meetup: 15, weekly_goal: 20 } });
}));

export default r;
