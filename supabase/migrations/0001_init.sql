-- FORM · Supabase schema (Postgres 15). Run as the first migration.
-- Multi-studio ready: every row carries studio_id; RLS scopes everything by the caller's studio.

create extension if not exists pgcrypto;

create type user_role as enum ('member','coach','owner');
create type booking_status as enum ('booked','waitlist','cancelled','attended','no_show');
create type class_type as enum ('Strength','Mobility','Reformer','Conditioning');
create type meetup_type as enum ('Run','Hike','Ride','Social');
create type product_cat as enum ('Protein','Accessories','Apparel','Sessions');

create table studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,                              -- 'FORM הירקון'
  timezone text not null default 'Asia/Jerusalem',
  cancel_window_hours int not null default 8,
  late_cancels_per_month int not null default 2,
  waitlist_cutoff_minutes int not null default 60,
  created_at timestamptz default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  name text not null                               -- 'סטודיו A'
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  studio_id uuid not null references studios,
  role user_role not null default 'member',
  full_name text not null,
  initials text generated always as (left(full_name,1) || coalesce(substr(split_part(full_name,' ',2),1,1),'')) stored,
  avatar_url text,
  coach_title text,                                -- 'מאמנת כוח'
  theme text default 'light',
  created_at timestamptz default now()
);

-- plans & subscriptions ------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  name text not null, short_name text, subtitle text,
  price_ils numeric(10,2) not null,
  monthly_credits int,                             -- null = unlimited
  weekly_goal int not null,
  is_active boolean default true,
  sort int default 0
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references profiles on delete cascade,
  plan_id uuid not null references plans,
  status text not null default 'active' check (status in ('active','frozen','past_due','cancelled')),
  period_start date not null, period_end date not null,
  provider text, provider_ref text,                -- filled by PaymentProvider
  freeze_from date,
  created_at timestamptz default now()
);
create unique index one_active_sub on subscriptions(member_id) where status in ('active','frozen','past_due');

create table credit_ledger (
  id bigserial primary key,
  member_id uuid not null references profiles on delete cascade,
  delta int not null,                              -- +8 renewal, -1 booking, +1 refund
  reason text not null check (reason in ('renewal','booking','refund','session_cancelled','admin')),
  booking_id uuid,
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references profiles,
  kind text check (kind in ('subscription','order')),
  amount_ils numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  provider text, provider_ref text,
  created_at timestamptz default now()
);

-- classes --------------------------------------------------------------------
create table class_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  name text not null, type class_type not null,
  description text, image_url text,
  default_capacity int not null default 12,
  duration_min int not null default 50
);

create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  template_id uuid references class_templates,
  name text not null, type class_type not null,
  coach_id uuid references profiles,
  room_id uuid references rooms,
  starts_at timestamptz not null,
  duration_min int not null default 50,
  capacity int not null default 12 check (capacity > 0),
  session_plan jsonb default '[]',                 -- ["חימום ותבנית סקוואט · 10 דק׳", ...]
  workout_plan_id uuid,
  cancelled_at timestamptz,
  started_at timestamptz, ended_at timestamptz
);
create index on class_sessions(studio_id, starts_at);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions on delete cascade,
  member_id uuid not null references profiles on delete cascade,
  status booking_status not null,
  refunded boolean,
  late_cancel boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index one_live_booking on bookings(session_id, member_id) where status in ('booked','waitlist','attended');

create view session_availability as
select s.id, s.capacity,
  count(b.*) filter (where b.status in ('booked','attended')) as booked_count,
  count(b.*) filter (where b.status = 'waitlist') as waitlist_count,
  greatest(0, s.capacity - count(b.*) filter (where b.status in ('booked','attended'))) as spots
from class_sessions s left join bookings b on b.session_id = s.id
group by s.id;

create table member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references profiles on delete cascade,
  author_id uuid not null references profiles,
  body text not null,
  pinned boolean default false,
  created_at timestamptz default now()
);

-- community ------------------------------------------------------------------
create table posts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  author_id uuid not null references profiles,
  body text, media_url text not null,              -- photo/video required
  created_at timestamptz default now(),
  hidden_at timestamptz
);
create table reactions (
  post_id uuid references posts on delete cascade,
  user_id uuid references profiles on delete cascade,
  emoji text not null check (emoji in ('♥','💪','🔥','👏')),
  primary key (post_id, user_id)                   -- one reaction per user
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  author_id uuid not null references profiles,
  body text not null, created_at timestamptz default now()
);
create table reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  reporter_id uuid not null references profiles,
  status text default 'open' check (status in ('open','kept','removed')),
  created_at timestamptz default now()
);

create table meetups (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  host_id uuid not null references profiles,
  name text not null, type meetup_type not null,
  starts_at timestamptz not null, place text not null,
  capacity int, detail text, after text, image_url text,
  created_at timestamptz default now()
);
create table meetup_attendees (
  meetup_id uuid references meetups on delete cascade,
  user_id uuid references profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (meetup_id, user_id)
);

create table point_events (
  id bigserial primary key,
  studio_id uuid not null references studios,
  member_id uuid not null references profiles on delete cascade,
  kind text not null check (kind in ('class','meetup','weekly_goal')),
  points int not null,
  ref_id uuid,
  occurred_at timestamptz not null default now()
);
create view leaderboard_week as
select studio_id, member_id, sum(points) pts,
  count(*) filter (where kind='class') classes, count(*) filter (where kind='meetup') meetups,
  bool_or(kind='weekly_goal') hit_goal
from point_events
where occurred_at >= date_trunc('week', now() + interval '1 day') - interval '1 day'  -- week starts Sunday
group by 1,2;
create view leaderboard_month as
select studio_id, member_id, sum(points) pts,
  count(*) filter (where kind='class') classes, count(*) filter (where kind='meetup') meetups
from point_events where occurred_at >= date_trunc('month', now()) group by 1,2;

create table prizes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  period text check (period in ('week','month')), rank int, title text, subtitle text,
  discount_pct int                                 -- store prizes
);
create table rewards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references profiles,
  prize_id uuid references prizes,
  discount_pct int, expires_at timestamptz, used_at timestamptz
);

-- store ----------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  category product_cat not null, name text not null, subtitle text,
  price_ils numeric(10,2) not null, image_url text, is_active boolean default true
);
create table orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references profiles,
  subtotal numeric(10,2), discount numeric(10,2) default 0, total numeric(10,2),
  reward_id uuid references rewards, payment_id uuid references payments,
  status text default 'pending' check (status in ('pending','paid','ready','picked_up','cancelled')),
  created_at timestamptz default now()
);
create table order_items (
  order_id uuid references orders on delete cascade,
  product_id uuid references products,
  qty int not null check (qty > 0), unit_price numeric(10,2) not null,
  primary key (order_id, product_id)
);

-- workout plans (coach) -------------------------------------------------------
create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  coach_id uuid not null references profiles,
  name text not null, focus class_type not null,
  level text default 'כל הרמות', duration_min int default 50,
  blocks jsonb not null,  -- [{"name":"חימום","items":[{"id","name","dose","note"}]}, …] exactly 4 blocks
  updated_at timestamptz default now()
);

-- helpers --------------------------------------------------------------------
create function my_studio() returns uuid language sql stable security definer as
$$ select studio_id from profiles where id = auth.uid() $$;
create function my_role() returns user_role language sql stable security definer as
$$ select role from profiles where id = auth.uid() $$;
create function is_staff() returns boolean language sql stable as $$ select my_role() in ('coach','owner') $$;

create function credit_balance(p_member uuid) returns int language sql stable as $$
  select case when p.monthly_credits is null then 999999
    else coalesce((select sum(delta) from credit_ledger l where l.member_id = p_member and l.created_at >= s.period_start),0) end
  from subscriptions s join plans p on p.id = s.plan_id
  where s.member_id = p_member and s.status = 'active'
$$;

-- RPC: book --------------------------------------------------------------------
create function book_class(p_session uuid) returns bookings language plpgsql security definer as $$
declare s class_sessions; taken int; bal int; b bookings;
begin
  select * into s from class_sessions where id = p_session and studio_id = my_studio() for update;
  if s is null or s.cancelled_at is not null or s.starts_at <= now() then raise exception 'session_unavailable'; end if;
  select count(*) into taken from bookings where session_id = p_session and status in ('booked','attended');
  bal := coalesce(credit_balance(auth.uid()),0);
  if taken < s.capacity and bal > 0 then
    insert into bookings(session_id, member_id, status) values (p_session, auth.uid(), 'booked') returning * into b;
    insert into credit_ledger(member_id, delta, reason, booking_id) values (auth.uid(), -1, 'booking', b.id);
  else
    insert into bookings(session_id, member_id, status) values (p_session, auth.uid(), 'waitlist') returning * into b;
  end if;
  return b;
end $$;

-- RPC: cancel ------------------------------------------------------------------
create function cancel_booking(p_booking uuid) returns bookings language plpgsql security definer as $$
declare b bookings; s class_sessions; st studios; late boolean; used int;
begin
  select * into b from bookings where id = p_booking and member_id = auth.uid() for update;
  if b is null or b.status not in ('booked','waitlist') then raise exception 'not_cancellable'; end if;
  select * into s from class_sessions where id = b.session_id;
  select * into st from studios where id = s.studio_id;
  if b.status = 'waitlist' then
    update bookings set status='cancelled', refunded=null, updated_at=now() where id=b.id returning * into b; return b;
  end if;
  late := s.starts_at - now() < make_interval(hours => st.cancel_window_hours);
  update bookings set status='cancelled', late_cancel=late, refunded=not late, updated_at=now() where id=b.id returning * into b;
  if not late then insert into credit_ledger(member_id, delta, reason, booking_id) values (auth.uid(), 1, 'refund', b.id); end if;
  perform promote_waitlist(s.id);
  return b;
end $$;

create function promote_waitlist(p_session uuid) returns void language plpgsql security definer as $$
declare s class_sessions; w bookings; free int;
begin
  select * into s from class_sessions where id = p_session for update;
  if s.cancelled_at is not null or s.starts_at - now() < interval '60 minutes' then return; end if;
  select s.capacity - count(*) into free from bookings where session_id = p_session and status in ('booked','attended');
  for w in select * from bookings where session_id = p_session and status='waitlist' order by created_at loop
    exit when free <= 0;
    if coalesce(credit_balance(w.member_id),0) > 0 then
      update bookings set status='booked', updated_at=now() where id = w.id;
      insert into credit_ledger(member_id, delta, reason, booking_id) values (w.member_id, -1, 'booking', w.id);
      free := free - 1;  -- + enqueue notification (pg_net → Edge Function)
    end if;
  end loop;
end $$;

-- RPC: owner cancels a session → refund everyone ---------------------------------
create function cancel_session(p_session uuid) returns int language plpgsql security definer as $$
declare n int;
begin
  if my_role() <> 'owner' then raise exception 'forbidden'; end if;
  update class_sessions set cancelled_at = now() where id = p_session and studio_id = my_studio();
  insert into credit_ledger(member_id, delta, reason, booking_id)
    select member_id, 1, 'session_cancelled', id from bookings where session_id = p_session and status = 'booked';
  get diagnostics n = row_count;
  update bookings set status='cancelled', refunded = (status='booked'), updated_at=now()
    where session_id = p_session and status in ('booked','waitlist');
  return n;  -- shown on the "class cancelled" screen
end $$;

-- RPC: coach check-in / end class ----------------------------------------------
create function set_attendance(p_booking uuid, p_in boolean) returns void language plpgsql security definer as $$
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  update bookings set status = case when p_in then 'attended' else 'booked' end::booking_status, updated_at=now()
    where id = p_booking and status in ('booked','attended');
  if p_in then
    insert into point_events(studio_id, member_id, kind, points, ref_id)
      select my_studio(), member_id, 'class', 25, id from bookings where id = p_booking
      on conflict do nothing;
  else
    delete from point_events where ref_id = p_booking and kind='class';
  end if;
end $$;

create function end_session(p_session uuid) returns void language plpgsql security definer as $$
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  update class_sessions set ended_at = now() where id = p_session;
  update bookings set status='no_show' where session_id = p_session and status='booked';
end $$;

-- Row Level Security (pattern — apply to every table) ----------------------------
alter table profiles enable row level security;
create policy "same studio can read" on profiles for select using (studio_id = my_studio());
create policy "self update" on profiles for update using (id = auth.uid());

alter table class_sessions enable row level security;
create policy "read" on class_sessions for select using (studio_id = my_studio());
create policy "owner write" on class_sessions for all using (studio_id = my_studio() and my_role()='owner');
create policy "coach edits own plan" on class_sessions for update using (coach_id = auth.uid());

alter table bookings enable row level security;
create policy "own or staff" on bookings for select using (member_id = auth.uid() or is_staff());
-- no insert/update policies: bookings change only via RPCs above

alter table credit_ledger enable row level security;
create policy "own or owner" on credit_ledger for select using (member_id = auth.uid() or my_role()='owner');

alter table member_notes enable row level security;
create policy "staff only" on member_notes for all using (is_staff());  -- members never see coach notes

alter table posts enable row level security;
create policy "studio read" on posts for select using (studio_id = my_studio() and hidden_at is null);
create policy "author insert" on posts for insert with check (author_id = auth.uid() and studio_id = my_studio());
create policy "staff moderate" on posts for update using (is_staff());

alter table reactions enable row level security;
create policy "read" on reactions for select using (true);
create policy "own, not own post" on reactions for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and not exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()));

alter table workout_plans enable row level security;
create policy "staff" on workout_plans for all using (studio_id = my_studio() and is_staff());

-- Realtime: add class_sessions, bookings, posts, reactions, comments, meetup_attendees to the supabase_realtime publication.
-- Storage buckets: 'post-media' (studio-scoped path: {studio_id}/{uuid}.jpg), 'meetup-images', 'avatars', 'products'.
