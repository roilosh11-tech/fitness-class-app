import { EventEmitter } from 'node:events';
import { tx, q, one } from './db.js';

// ── realtime bus (SSE) ────────────────────────────────────────────────────────
export const bus = new EventEmitter();
bus.setMaxListeners(1000);
export const emit = (studio_id, type, data = {}) => bus.emit('evt', { studio_id, type, data });

export class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new HttpError(status, code); };

// ── booking ──────────────────────────────────────────────────────────────────
export async function book(user, sessionId) {
  const r = await tx(async (t) => {
    const s = await t.one('select * from class_sessions where id = $1 and studio_id = $2 for update', [sessionId, user.studio_id]);
    if (!s || s.cancelled_at || new Date(s.starts_at) <= new Date()) fail(409, 'session_unavailable');
    const dup = await t.one(`select id from bookings where session_id=$1 and member_id=$2 and status in ('booked','waitlist','attended')`, [sessionId, user.id]);
    if (dup) fail(409, 'already_booked');
    const { taken } = await t.one(`select count(*)::int taken from bookings where session_id=$1 and status in ('booked','attended')`, [sessionId]);
    const { bal } = await t.one('select coalesce(credit_balance($1),0) bal', [user.id]);
    const status = taken < s.capacity && bal > 0 ? 'booked' : 'waitlist';
    const b = await t.one('insert into bookings(session_id, member_id, status) values ($1,$2,$3) returning *', [sessionId, user.id, status]);
    if (status === 'booked') await t.q(`insert into credit_ledger(member_id, delta, reason, booking_id) values ($1,-1,'booking',$2)`, [user.id, b.id]);
    return { booking: b, reason: status === 'waitlist' ? (bal > 0 ? 'full' : 'no_credits') : null };
  });
  emit(user.studio_id, 'session', { id: sessionId });
  return r;
}

export async function cancelBooking(user, bookingId) {
  const r = await tx(async (t) => {
    const b = await t.one('select * from bookings where id=$1 and member_id=$2 for update', [bookingId, user.id]);
    if (!b || !['booked', 'waitlist'].includes(b.status)) fail(409, 'not_cancellable');
    const s = await t.one('select s.*, st.cancel_window_hours from class_sessions s join studios st on st.id=s.studio_id where s.id=$1', [b.session_id]);
    if (b.status === 'waitlist') {
      return t.one(`update bookings set status='cancelled', updated_at=now() where id=$1 returning *`, [b.id]);
    }
    const late = new Date(s.starts_at) - Date.now() < s.cancel_window_hours * 3600e3;
    const nb = await t.one(`update bookings set status='cancelled', late_cancel=$2, refunded=$3, updated_at=now() where id=$1 returning *`, [b.id, late, !late]);
    if (!late) await t.q(`insert into credit_ledger(member_id, delta, reason, booking_id) values ($1,1,'refund',$2)`, [user.id, b.id]);
    await promote(t, s.id);
    return nb;
  });
  emit(user.studio_id, 'session', { id: r.session_id });
  return r;
}

// Fill freed spots from the waitlist (oldest first, must have credits). Call inside a tx.
export async function promote(t, sessionId) {
  const s = await t.one('select s.*, st.waitlist_cutoff_minutes from class_sessions s join studios st on st.id=s.studio_id where s.id=$1 for update', [sessionId]);
  if (!s || s.cancelled_at || new Date(s.starts_at) - Date.now() < s.waitlist_cutoff_minutes * 60e3) return [];
  let { free } = await t.one(`select ($2::int - count(*))::int free from bookings where session_id=$1 and status in ('booked','attended')`, [sessionId, s.capacity]);
  const promoted = [];
  const waiting = await t.many(`select * from bookings where session_id=$1 and status='waitlist' order by created_at`, [sessionId]);
  for (const w of waiting) {
    if (free <= 0) break;
    const { bal } = await t.one('select coalesce(credit_balance($1),0) bal', [w.member_id]);
    if (bal <= 0) continue;
    await t.q(`update bookings set status='booked', updated_at=now() where id=$1`, [w.id]);
    await t.q(`insert into credit_ledger(member_id, delta, reason, booking_id) values ($1,-1,'booking',$2)`, [w.member_id, w.id]);
    promoted.push(w.member_id); free--;
  }
  return promoted;
}

// ── owner: cancel a whole session ──────────────────────────────────────────────
export async function cancelSession(user, sessionId) {
  const n = await tx(async (t) => {
    const s = await t.one('update class_sessions set cancelled_at=now() where id=$1 and studio_id=$2 and cancelled_at is null returning *', [sessionId, user.studio_id]);
    if (!s) fail(404, 'not_found');
    const booked = await t.many(`select id, member_id from bookings where session_id=$1 and status='booked'`, [sessionId]);
    for (const b of booked) await t.q(`insert into credit_ledger(member_id, delta, reason, booking_id) values ($1,1,'session_cancelled',$2)`, [b.member_id, b.id]);
    await t.q(`update bookings set refunded = (status='booked'), status='cancelled', updated_at=now() where session_id=$1 and status in ('booked','waitlist')`, [sessionId]);
    return booked.length;
  });
  emit(user.studio_id, 'session', { id: sessionId });
  return n;
}

// ── coach: attendance + points ───────────────────────────────────────────────
const WEEK_START = `(date_trunc('week', (now() at time zone st.timezone) + interval '1 day') - interval '1 day')::date`;

export async function setAttendance(user, bookingId, present) {
  await tx(async (t) => {
    const b = await t.one(`select b.*, s.studio_id from bookings b join class_sessions s on s.id=b.session_id
      where b.id=$1 and s.studio_id=$2 and b.status in ('booked','attended','no_show') for update of b`, [bookingId, user.studio_id]);
    if (!b) fail(404, 'not_found');
    await t.q(`update bookings set status=$2, updated_at=now() where id=$1`, [b.id, present ? 'attended' : 'booked']);
    if (present) await t.q(`insert into point_events(studio_id, member_id, kind, points, ref_key) values ($1,$2,'class',25,$3) on conflict do nothing`, [b.studio_id, b.member_id, b.id]);
    else await t.q(`delete from point_events where member_id=$1 and kind='class' and ref_key=$2`, [b.member_id, b.id]);
    await checkWeeklyGoal(t, b.member_id);
  });
}

async function checkWeeklyGoal(t, memberId) {
  const r = await t.one(`
    select ${WEEK_START}::text wk, u.studio_id, p.weekly_goal,
      (select count(*)::int from bookings b join class_sessions s on s.id=b.session_id
        where b.member_id=u.id and b.status='attended'
          and (s.starts_at at time zone st.timezone)::date >= ${WEEK_START}) attended
    from users u join studios st on st.id=u.studio_id
    left join subscriptions sb on sb.member_id=u.id and sb.status='active'
    left join plans p on p.id=sb.plan_id
    where u.id=$1`, [memberId]);
  if (!r || !r.weekly_goal) return;
  const key = r.wk;
  if (r.attended >= r.weekly_goal)
    await t.q(`insert into point_events(studio_id, member_id, kind, points, ref_key) values ($1,$2,'weekly_goal',20,$3) on conflict do nothing`, [r.studio_id, memberId, key]);
  else await t.q(`delete from point_events where member_id=$1 and kind='weekly_goal' and ref_key=$2`, [memberId, key]);
}

export async function endSession(user, sessionId) {
  await q(`update class_sessions set ended_at=now() where id=$1 and studio_id=$2`, [sessionId, user.studio_id]);
  await q(`update bookings set status='no_show', updated_at=now() where session_id=$1 and status='booked'`, [sessionId]);
  emit(user.studio_id, 'session', { id: sessionId });
}

// ── meetups ──────────────────────────────────────────────────────────────────
export async function joinMeetup(user, meetupId) {
  await tx(async (t) => {
    const m = await t.one('select * from meetups where id=$1 and studio_id=$2 for update', [meetupId, user.studio_id]);
    if (!m) fail(404, 'not_found');
    const { n } = await t.one('select count(*)::int n from meetup_attendees where meetup_id=$1', [meetupId]);
    if (m.capacity && n >= m.capacity) fail(409, 'meetup_full');
    await t.q('insert into meetup_attendees(meetup_id, user_id) values ($1,$2) on conflict do nothing', [meetupId, user.id]);
    await t.q(`insert into point_events(studio_id, member_id, kind, points, ref_key) values ($1,$2,'meetup',15,$3) on conflict do nothing`, [user.studio_id, user.id, meetupId]);
  });
  emit(user.studio_id, 'meetup', { id: meetupId });
}
export async function leaveMeetup(user, meetupId) {
  await q('delete from meetup_attendees where meetup_id=$1 and user_id=$2', [meetupId, user.id]);
  await q(`delete from point_events where member_id=$1 and kind='meetup' and ref_key=$2`, [user.id, meetupId]);
  emit(user.studio_id, 'meetup', { id: meetupId });
}

// ── timetable → sessions (rolling 28 days) ──────────────────────────────────
export async function ensureSessions() {
  const r = await q(`
    insert into class_sessions(studio_id, template_id, slot_id, name, type, coach_id, room_id, starts_at, duration_min, capacity)
    select s.studio_id, t.id, s.id, t.name, t.type, s.coach_id, s.room_id,
           ((d::date + s.start_time) at time zone st.timezone), t.duration_min, s.capacity
    from weekly_slots s
    join class_templates t on t.id = s.template_id
    join studios st on st.id = s.studio_id
    cross join lateral generate_series((now() at time zone st.timezone)::date, (now() at time zone st.timezone)::date + 27, interval '1 day') d
    where s.is_active and extract(dow from d)::int = s.dow
      and ((d::date + s.start_time) at time zone st.timezone) > now()
    on conflict (slot_id, starts_at) do nothing`);
  if (r.rowCount) console.log('generated sessions:', r.rowCount);
}

export async function me(userId) {
  return one(`
    select u.id, u.email, u.full_name, u.role, u.theme, u.coach_title, u.studio_id, st.name studio_name,
      case when p.monthly_credits is null and p.id is not null then null else coalesce(credit_balance(u.id),0) end credits,
      p.id plan_id, p.name plan_name, p.weekly_goal, p.monthly_credits, sb.status sub_status, sb.period_end
    from users u join studios st on st.id=u.studio_id
    left join subscriptions sb on sb.member_id=u.id and sb.status in ('active','frozen','past_due')
    left join plans p on p.id=sb.plan_id
    where u.id=$1`, [userId]);
}
