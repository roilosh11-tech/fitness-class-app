-- FORM · Postgres schema (Railway). Applied automatically by the server on boot.

create type user_role as enum ('member','coach','owner');
create type booking_status as enum ('booked','waitlist','cancelled','attended','no_show');
create type class_type as enum ('Strength','Mobility','Reformer','Conditioning');
create type meetup_type as enum ('Run','Hike','Ride','Social');
create type product_cat as enum ('Protein','Accessories','Apparel','Sessions');

create table studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Jerusalem',
  cancel_window_hours int not null default 8,
  late_cancels_per_month int not null default 2,
  waitlist_cutoff_minutes int not null default 60,
  created_at timestamptz default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios on delete cascade,
  name text not null
);

create table users (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  email text unique,
  password_hash text,                -- null = staff record without login yet
  role user_role not null default 'member',
  full_name text not null,
  coach_title text,
  avatar_media_id uuid,
  theme text default 'light',
  created_at timestamptz default now()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  owner_id uuid references users,
  mime text not null,
  data bytea not null,
  created_at timestamptz default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  name text not null, short_name text, subtitle text,
  price_ils numeric(10,2) not null,
  monthly_credits int,               -- null = unlimited
  weekly_goal int not null,
  is_active boolean default true,
  sort int default 0
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references users on delete cascade,
  plan_id uuid not null references plans,
  status text not null default 'active' check (status in ('active','frozen','past_due','cancelled')),
  period_start date not null, period_end date not null,
  provider text, provider_ref text,
  created_at timestamptz default now()
);
create unique index one_live_sub on subscriptions(member_id) where status in ('active','frozen','past_due');

create table credit_ledger (
  id bigserial primary key,
  member_id uuid not null references users on delete cascade,
  delta int not null,
  reason text not null check (reason in ('renewal','booking','refund','session_cancelled','admin')),
  booking_id uuid,
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references users,
  kind text check (kind in ('subscription','order')),
  amount_ils numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  provider text, provider_ref text,
  created_at timestamptz default now()
);

create table class_templates (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  name text not null, type class_type not null,
  description text, image_url text,
  default_capacity int not null default 12,
  duration_min int not null default 50
);

-- Recurring weekly timetable; the server generates class_sessions 28 days ahead from this.
create table weekly_slots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  template_id uuid not null references class_templates on delete cascade,
  dow int not null check (dow between 0 and 6),   -- 0 = Sunday
  start_time time not null,
  room_id uuid references rooms,
  coach_id uuid references users,
  capacity int not null default 12,
  is_active boolean default true
);

create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  template_id uuid references class_templates,
  slot_id uuid references weekly_slots on delete set null,
  name text not null, type class_type not null,
  coach_id uuid references users,
  room_id uuid references rooms,
  starts_at timestamptz not null,
  duration_min int not null default 50,
  capacity int not null default 12 check (capacity > 0),
  session_plan jsonb default '[]',
  workout_plan_id uuid,
  cancelled_at timestamptz,
  started_at timestamptz, ended_at timestamptz
);
create index on class_sessions(studio_id, starts_at);
create unique index one_session_per_slot on class_sessions(slot_id, starts_at);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_sessions on delete cascade,
  member_id uuid not null references users on delete cascade,
  status booking_status not null,
  refunded boolean,
  late_cancel boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index one_live_booking on bookings(session_id, member_id) where status in ('booked','waitlist','attended');

create table member_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references users on delete cascade,
  author_id uuid not null references users,
  body text not null,
  pinned boolean default false,
  created_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  author_id uuid not null references users,
  body text,
  media_id uuid not null references media,
  created_at timestamptz default now(),
  hidden_at timestamptz
);
create table reactions (
  post_id uuid references posts on delete cascade,
  user_id uuid references users on delete cascade,
  emoji text not null check (emoji in ('♥','💪','🔥','👏')),
  primary key (post_id, user_id)
);
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  author_id uuid not null references users,
  body text not null, created_at timestamptz default now()
);
create table reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  reporter_id uuid not null references users,
  status text default 'open' check (status in ('open','kept','removed')),
  created_at timestamptz default now()
);

create table meetups (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  host_id uuid not null references users,
  name text not null, type meetup_type not null,
  starts_at timestamptz not null, place text not null,
  capacity int, detail text, after text, media_id uuid references media,
  created_at timestamptz default now()
);
create table meetup_attendees (
  meetup_id uuid references meetups on delete cascade,
  user_id uuid references users on delete cascade,
  joined_at timestamptz default now(),
  primary key (meetup_id, user_id)
);

create table point_events (
  id bigserial primary key,
  studio_id uuid not null references studios,
  member_id uuid not null references users on delete cascade,
  kind text not null check (kind in ('class','meetup','weekly_goal')),
  points int not null,
  ref_key text not null,             -- booking id / meetup id / week start date
  occurred_at timestamptz not null default now(),
  unique (member_id, kind, ref_key)
);

create table prizes (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  period text check (period in ('week','month')), rank int, title text, subtitle text,
  discount_pct int
);
create table rewards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references users,
  prize_id uuid references prizes,
  discount_pct int, expires_at timestamptz, used_at timestamptz
);

create table products (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  category product_cat not null, name text not null, subtitle text,
  price_ils numeric(10,2) not null, media_id uuid references media, is_active boolean default true
);
create table orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references users,
  subtotal numeric(10,2), discount numeric(10,2) default 0, total numeric(10,2),
  reward_id uuid references rewards, payment_id uuid references payments,
  status text default 'paid' check (status in ('pending','paid','ready','picked_up','cancelled')),
  created_at timestamptz default now()
);
create table order_items (
  order_id uuid references orders on delete cascade,
  product_id uuid references products,
  qty int not null check (qty > 0), unit_price numeric(10,2) not null,
  primary key (order_id, product_id)
);

create table workout_plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios,
  coach_id uuid not null references users,
  name text not null, focus class_type not null,
  level text default 'כל הרמות', duration_min int default 50,
  blocks jsonb not null,
  updated_at timestamptz default now()
);

-- helpers
create view session_availability as
select s.id, s.capacity,
  count(b.*) filter (where b.status in ('booked','attended'))::int as booked_count,
  count(b.*) filter (where b.status = 'waitlist')::int as waitlist_count,
  greatest(0, s.capacity - count(b.*) filter (where b.status in ('booked','attended')))::int as spots
from class_sessions s left join bookings b on b.session_id = s.id
group by s.id;

create function credit_balance(p_member uuid) returns int language sql stable as $$
  select case when p.monthly_credits is null then 999999
    else coalesce((select sum(delta) from credit_ledger l where l.member_id = p_member and l.created_at >= s.period_start),0)::int end
  from subscriptions s join plans p on p.id = s.plan_id
  where s.member_id = p_member and s.status = 'active'
$$;
