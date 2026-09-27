import { Router } from 'express';
import { one, many, q, tx } from '../db.js';
import { requireAuth, staff, owner, hash } from '../auth.js';
import { HttpError, emit, setAttendance, endSession, cancelSession, promote, ensureSessions } from '../logic.js';
import { h } from './core.js';
import { aiWorkout } from '../ai.js';

const r = Router();
r.use(requireAuth);

// ── coach: roster, check-in, session plan ─────────────────────────────────────
r.get('/sessions/:id/roster', staff, h(async (req, res) => {
  res.json(await many(`
    select b.id booking_id, b.status, b.created_at, u.id member_id, u.full_name,
      (select body from member_notes n where n.member_id=u.id and n.pinned order by created_at desc limit 1) pinned_note,
      (select count(*)::int from bookings x where x.member_id=u.id and x.status='attended') visits,
      p.name plan_name
    from bookings b join users u on u.id=b.member_id join class_sessions s on s.id=b.session_id
    left join subscriptions sb on sb.member_id=u.id and sb.status='active' left join plans p on p.id=sb.plan_id
    where b.session_id=$1 and s.studio_id=$2 and b.status in ('booked','attended','waitlist','no_show')
    order by (b.status='waitlist'), b.created_at`, [req.params.id, req.user.studio_id]));
}));

r.post('/bookings/:id/attendance', staff, h(async (req, res) => { await setAttendance(req.user, req.params.id, !!req.body?.present); res.json({ ok: true }); }));

r.post('/sessions/:id/checkin-all', staff, h(async (req, res) => {
  const ids = await many(`select b.id from bookings b join class_sessions s on s.id=b.session_id where b.session_id=$1 and s.studio_id=$2 and b.status='booked'`, [req.params.id, req.user.studio_id]);
  for (const { id } of ids) await setAttendance(req.user, id, true);
  res.json({ checked: ids.length });
}));

r.post('/sessions/:id/start', staff, h(async (req, res) => {
  await q('update class_sessions set started_at=now() where id=$1 and studio_id=$2', [req.params.id, req.user.studio_id]);
  emit(req.user.studio_id, 'session', { id: req.params.id }); res.json({ ok: true });
}));
r.post('/sessions/:id/end', staff, h(async (req, res) => { await endSession(req.user, req.params.id); res.json({ ok: true }); }));

r.patch('/sessions/:id/plan', staff, h(async (req, res) => {
  const { session_plan, workout_plan_id } = req.body || {};
  await q('update class_sessions set session_plan=coalesce($3::jsonb, session_plan), workout_plan_id=coalesce($4, workout_plan_id) where id=$1 and studio_id=$2',
    [req.params.id, req.user.studio_id, session_plan ? JSON.stringify(session_plan) : null, workout_plan_id || null]);
  res.json({ ok: true });
}));

// ── private member notes (staff only; never exposed to members) ──────────────
r.get('/members', staff, h(async (req, res) => res.json(await many(`
  select u.id, u.full_name, u.email, u.role, p.name plan_name, sb.status sub_status,
    (select count(*)::int from bookings b where b.member_id=u.id and b.status='attended') visits
  from users u left join subscriptions sb on sb.member_id=u.id and sb.status in ('active','frozen','past_due') left join plans p on p.id=sb.plan_id
  where u.studio_id=$1 ${req.query.role ? 'and u.role=$2' : ''} order by u.full_name`, req.query.role ? [req.user.studio_id, req.query.role] : [req.user.studio_id]))));

r.get('/members/:id/notes', staff, h(async (req, res) => res.json(await many(`
  select n.id, n.body, n.pinned, n.created_at, a.full_name author from member_notes n join users a on a.id=n.author_id
  join users m on m.id=n.member_id where n.member_id=$1 and m.studio_id=$2 order by n.pinned desc, n.created_at desc`, [req.params.id, req.user.studio_id]))));

r.post('/members/:id/notes', staff, h(async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) throw new HttpError(400, 'empty');
  if (req.body.pinned) await q('update member_notes set pinned=false where member_id=$1', [req.params.id]);
  res.json(await one(`insert into member_notes(member_id, author_id, body, pinned) select id, $2, $3, $4 from users where id=$1 and studio_id=$5 returning *`,
    [req.params.id, req.user.id, body, !!req.body.pinned, req.user.studio_id]));
}));

// ── workout plans + AI ────────────────────────────────────────────────────────
const BLOCKS = ['חימום', 'עיקרי', 'פיניש', 'שחרור'];
r.get('/workout-plans', staff, h(async (req, res) => res.json(await many('select * from workout_plans where studio_id=$1 order by updated_at desc', [req.user.studio_id]))));
r.get('/workout-plans/:id', staff, h(async (req, res) => res.json(await one('select * from workout_plans where id=$1 and studio_id=$2', [req.params.id, req.user.studio_id]))));
r.post('/workout-plans', staff, h(async (req, res) => {
  const { name = 'אימון כוח חדש', focus = 'Strength', level = 'כל הרמות', duration_min = 50, blocks } = req.body || {};
  res.json(await one(`insert into workout_plans(studio_id, coach_id, name, focus, level, duration_min, blocks) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.user.studio_id, req.user.id, name, focus, level, duration_min, JSON.stringify(blocks || BLOCKS.map((n) => ({ name: n, items: [] })))]));
}));
r.patch('/workout-plans/:id', staff, h(async (req, res) => {
  const { name, focus, level, duration_min, blocks } = req.body || {};
  res.json(await one(`update workout_plans set name=coalesce($3,name), focus=coalesce($4,focus), level=coalesce($5,level), duration_min=coalesce($6,duration_min),
    blocks=coalesce($7::jsonb,blocks), updated_at=now() where id=$1 and studio_id=$2 returning *`,
    [req.params.id, req.user.studio_id, name, focus, level, duration_min, blocks ? JSON.stringify(blocks) : null]));
}));
r.delete('/workout-plans/:id', staff, h(async (req, res) => { await q('delete from workout_plans where id=$1 and studio_id=$2', [req.params.id, req.user.studio_id]); res.json({ ok: true }); }));

const aiHits = new Map();
r.post('/ai/workout', staff, h(async (req, res) => {
  const now = Date.now(), hits = (aiHits.get(req.user.id) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= 30) throw new HttpError(429, 'rate_limited');
  aiHits.set(req.user.id, [...hits, now]);
  res.json(await aiWorkout(req.body || {}));
}));

// ── owner: overview ───────────────────────────────────────────────────────────
r.get('/owner/overview', owner, h(async (req, res) => {
  const s = req.user.studio_id;
  const k = await one(`
    select
      (select coalesce(sum(p.amount_ils),0) from payments p join users u on u.id=p.member_id where u.studio_id=$1 and p.status='succeeded' and p.created_at >= date_trunc('month', now())) revenue,
      (select coalesce(sum(p.amount_ils),0) from payments p join users u on u.id=p.member_id where u.studio_id=$1 and p.status='succeeded' and p.created_at >= date_trunc('month', now()) - interval '1 month' and p.created_at < date_trunc('month', now())) revenue_prev,
      (select count(*)::int from subscriptions sb join users u on u.id=sb.member_id where u.studio_id=$1 and sb.status='active') members,
      (select count(*)::int from subscriptions sb join users u on u.id=sb.member_id where u.studio_id=$1 and sb.status='active' and sb.created_at >= date_trunc('month', now())) members_new,
      (select round(100.0 * count(*) filter (where b.status='attended') / nullif(count(*) filter (where b.status in ('attended','no_show')),0))::int
         from bookings b join class_sessions cs on cs.id=b.session_id where cs.studio_id=$1 and cs.starts_at > now() - interval '30 days') attendance_pct,
      (select round(100.0 * count(distinct sb.member_id) / nullif((select count(*) from users where studio_id=$1 and role='member' and created_at > now() - interval '90 days'),0))::int
         from subscriptions sb join users u on u.id=sb.member_id where u.studio_id=$1 and u.created_at > now() - interval '90 days') signup_to_paid_pct`, [s]);
  const oversub = await many(`select s.id, s.name, s.starts_at, a.waitlist_count from class_sessions s join session_availability a on a.id=s.id
    where s.studio_id=$1 and s.starts_at between now() and now() + interval '7 days' and s.cancelled_at is null and a.waitlist_count > 0 order by s.starts_at`, [s]);
  const pastDue = await one(`select count(*)::int n, coalesce(sum(p.price_ils),0) amount from subscriptions sb join plans p on p.id=sb.plan_id join users u on u.id=sb.member_id
    where u.studio_id=$1 and sb.status='past_due'`, [s]);
  const openReports = await one(`select count(*)::int n from reports r join posts p on p.id=r.post_id where p.studio_id=$1 and r.status='open'`, [s]);
  res.json({ kpis: k, alerts: { oversubscribed: oversub, pastDue, openReports: openReports.n } });
}));

// ── owner: sessions ───────────────────────────────────────────────────────────
r.post('/sessions', owner, h(async (req, res) => {
  const { name, type = 'Strength', starts_at, coach_id, room_id, capacity = 12, duration_min = 50, template_id } = req.body || {};
  if (!name?.trim() || !starts_at) throw new HttpError(400, 'name_time_required');
  const s = await one(`insert into class_sessions(studio_id, template_id, name, type, starts_at, coach_id, room_id, capacity, duration_min)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [req.user.studio_id, template_id || null, name.trim(), type, starts_at, coach_id || null, room_id || null, parseInt(capacity), duration_min]);
  emit(req.user.studio_id, 'session', { id: s.id }); res.json(s);
}));

r.patch('/sessions/:id', owner, h(async (req, res) => {
  const { name, starts_at, coach_id, room_id, capacity } = req.body || {};
  const s = await tx(async (t) => {
    if (capacity != null) {
      const { n } = await t.one(`select count(*)::int n from bookings where session_id=$1 and status in ('booked','attended')`, [req.params.id]);
      if (parseInt(capacity) < n) throw new HttpError(409, 'capacity_below_booked');
    }
    const row = await t.one(`update class_sessions set name=coalesce($3,name), starts_at=coalesce($4,starts_at), coach_id=coalesce($5,coach_id),
      room_id=coalesce($6,room_id), capacity=coalesce($7,capacity) where id=$1 and studio_id=$2 returning *`,
      [req.params.id, req.user.studio_id, name, starts_at, coach_id, room_id, capacity != null ? parseInt(capacity) : null]);
    if (!row) throw new HttpError(404, 'not_found');
    await promote(t, row.id);
    return row;
  });
  emit(req.user.studio_id, 'session', { id: s.id }); res.json(s);
}));

r.post('/sessions/:id/cancel', owner, h(async (req, res) => res.json({ refunded: await cancelSession(req.user, req.params.id) })));

// ── owner: timetable (recurring weekly slots) ────────────────────────────────
r.get('/slots', staff, h(async (req, res) => res.json(await many(`
  select sl.*, t.name, t.type, r.name room, c.full_name coach_name from weekly_slots sl join class_templates t on t.id=sl.template_id
  left join rooms r on r.id=sl.room_id left join users c on c.id=sl.coach_id where sl.studio_id=$1 order by sl.dow, sl.start_time`, [req.user.studio_id]))));
r.post('/slots', owner, h(async (req, res) => {
  const { template_id, dow, start_time, room_id, coach_id, capacity = 12 } = req.body || {};
  const sl = await one(`insert into weekly_slots(studio_id, template_id, dow, start_time, room_id, coach_id, capacity) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [req.user.studio_id, template_id, dow, start_time, room_id || null, coach_id || null, capacity]);
  await ensureSessions(); res.json(sl);
}));
r.patch('/slots/:id', owner, h(async (req, res) => {
  const { coach_id, room_id, capacity, is_active } = req.body || {};
  res.json(await one(`update weekly_slots set coach_id=coalesce($3,coach_id), room_id=coalesce($4,room_id), capacity=coalesce($5,capacity), is_active=coalesce($6,is_active)
    where id=$1 and studio_id=$2 returning *`, [req.params.id, req.user.studio_id, coach_id, room_id, capacity, is_active]));
}));
r.get('/templates', staff, h(async (req, res) => res.json(await many('select * from class_templates where studio_id=$1 order by name', [req.user.studio_id]))));
r.get('/rooms', staff, h(async (req, res) => res.json(await many('select * from rooms where studio_id=$1 order by name', [req.user.studio_id]))));

// ── owner: plans, staff, settings ─────────────────────────────────────────────
r.get('/owner/plans', owner, h(async (req, res) => res.json(await many(`
  select p.*, (select count(*)::int from subscriptions sb where sb.plan_id=p.id and sb.status='active') members
  from plans p where p.studio_id=$1 order by sort`, [req.user.studio_id]))));
r.post('/owner/plans', owner, h(async (req, res) => {
  const { name, subtitle, price_ils, monthly_credits, weekly_goal = 2 } = req.body || {};
  res.json(await one(`insert into plans(studio_id, name, subtitle, price_ils, monthly_credits, weekly_goal, sort) values ($1,$2,$3,$4,$5,$6,99) returning *`,
    [req.user.studio_id, name, subtitle, price_ils, monthly_credits ?? null, weekly_goal]));
}));
r.patch('/owner/plans/:id', owner, h(async (req, res) => {
  const { name, subtitle, price_ils, monthly_credits, is_active } = req.body || {};
  res.json(await one(`update plans set name=coalesce($3,name), subtitle=coalesce($4,subtitle), price_ils=coalesce($5,price_ils),
    monthly_credits=case when $6::text = 'unset' then monthly_credits else $6::int end, is_active=coalesce($7,is_active) where id=$1 and studio_id=$2 returning *`,
    [req.params.id, req.user.studio_id, name, subtitle, price_ils, monthly_credits === undefined ? 'unset' : monthly_credits, is_active]));
}));

// Add a coach/owner. If they have no account yet, a login-less record is created; they sign up with the same email to claim it.
r.post('/owner/staff', owner, h(async (req, res) => {
  const { email, full_name, role = 'coach', coach_title } = req.body || {};
  if (!['coach', 'owner', 'member'].includes(role)) throw new HttpError(400, 'bad_role');
  const u = await one(`insert into users(studio_id, email, full_name, role, coach_title) values ($1, lower($2), $3, $4, $5)
    on conflict (email) do update set role=excluded.role, coach_title=coalesce(excluded.coach_title, users.coach_title) returning id, email, full_name, role`,
    [req.user.studio_id, email, full_name || email.split('@')[0], role, coach_title || null]);
  res.json(u);
}));

r.get('/owner/settings', owner, h(async (req, res) => res.json(await one('select * from studios where id=$1', [req.user.studio_id]))));
r.patch('/owner/settings', owner, h(async (req, res) => {
  const { name, cancel_window_hours, late_cancels_per_month, waitlist_cutoff_minutes } = req.body || {};
  res.json(await one(`update studios set name=coalesce($2,name), cancel_window_hours=coalesce($3,cancel_window_hours),
    late_cancels_per_month=coalesce($4,late_cancels_per_month), waitlist_cutoff_minutes=coalesce($5,waitlist_cutoff_minutes) where id=$1 returning *`,
    [req.user.studio_id, name, cancel_window_hours, late_cancels_per_month, waitlist_cutoff_minutes]));
}));

// Owner can reset a password (e.g. for a member who can't access email yet)
r.post('/owner/users/:id/password', owner, h(async (req, res) => {
  if ((req.body?.password || '').length < 8) throw new HttpError(400, 'password_too_short');
  await q('update users set password_hash=$3 where id=$1 and studio_id=$2', [req.params.id, req.user.studio_id, await hash(req.body.password)]);
  res.json({ ok: true });
}));

export default r;
