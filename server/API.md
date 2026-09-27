# FORM API reference
Base: `https://<domain>/api`. Auth: `Authorization: Bearer <token>` (from signup/login). Errors: `{ "error": "code" }` with HTTP 400/401/403/404/409/429/5xx.
Live updates: `GET /api/events?token=<token>` (Server-Sent Events). Events: `session`, `post`, `meetup` with `{id}`; refetch on receipt.

## Auth & me
| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | /auth/signup | email, password (≥8), full_name | First signup = owner. A staff email created by the owner is claimed on signup. |
| POST | /auth/login | email, password | → `{token, user}` |
| GET | /me | | Profile, plan, credits (`null` = unlimited) |
| PATCH | /me | full_name?, theme? | |
| GET | /home | | me, next booked class, total_classes, this_week, minutes, streak |

## Plans & booking (member)
| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | /plans | | |
| POST | /subscribe | plan_id | Mock payment → subscription + credits |
| GET | /sessions | from, to (ISO), type?, coach=me?, open=1? | Includes spots, waitlist_count, my_status, my_booking_id |
| GET | /sessions/:id | | |
| POST | /sessions/:id/book | | → `{booking, reason}`; reason `full` / `no_credits` means waitlisted |
| POST | /bookings/:id/cancel | | ≥8h: refund. <8h: late, no refund. Promotes the waitlist. |
| GET | /bookings | tab=up\|past\|cancelled | |
| GET | /leaderboard | period=week\|month | rows, prizes, myRank, rules |

## Community
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | /media | multipart `file` | → `{id, url}` (≤8 MB image/video) |
| GET | /media/:id | | Public |
| GET | /posts | before? | 20 per page, with counts, mine, comments |
| POST | /posts | multipart `file` + `body`, or JSON media_id + body | Photo required |
| POST | /posts/:id/react | emoji (♥ 💪 🔥 👏) | Same emoji again = remove; own post → 409 |
| POST | /posts/:id/comments | body | |
| POST | /posts/:id/report | | Post stays visible until reviewed |
| GET | /reports | | staff |
| POST | /reports/:id/resolve | action=keep\|remove | staff |
| GET | /meetups | type? | Upcoming |
| GET | /meetups/:id | | |
| POST | /meetups | name, type, starts_at, place, capacity?, detail?, after?, media_id? | Host auto-joins |
| POST / DELETE | /meetups/:id/join | | +15 / −15 points; full → 409 |

## Store
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | /products | category? | |
| GET | /rewards | | Unused discount rewards |
| POST | /orders | items:[{product_id, qty}], reward_id? | Mock payment; pickup at reception |
| GET | /orders | | My orders |
| GET | /staff/orders | | Reception queue (staff) |
| POST | /staff/orders/:id/status | status=ready\|picked_up\|cancelled | staff |

## Coach (coach or owner)
| Method | Path | Body |
|---|---|---|
| GET | /sessions?coach=me | |
| GET | /sessions/:id/roster | → bookings with pinned_note, visits, plan |
| POST | /bookings/:id/attendance | present: bool (+25 pts; weekly goal +20 automatic) |
| POST | /sessions/:id/checkin-all | |
| POST | /sessions/:id/start, /sessions/:id/end | End marks non-checked-in members as no_show |
| PATCH | /sessions/:id/plan | session_plan: string[], workout_plan_id? |
| GET | /members?role= | |
| GET/POST | /members/:id/notes | body, pinned? (private; staff only) |
| GET/POST | /workout-plans | |
| GET/PATCH/DELETE | /workout-plans/:id | name, focus, level, duration_min, blocks |
| POST | /ai/workout | mode=generate\|refine\|swap, plan, request?, item? (30/hour) |

## Owner
| Method | Path | Body |
|---|---|---|
| GET | /owner/overview | KPIs + alerts (oversubscribed, past due, open reports) |
| POST | /sessions | name, type, starts_at, coach_id?, room_id?, capacity? (one-off class) |
| PATCH | /sessions/:id | name?, starts_at?, coach_id?, room_id?, capacity? (can't go below booked) |
| POST | /sessions/:id/cancel | → `{refunded}` credits returned |
| GET/POST | /slots | Recurring weekly timetable (dow 0=Sun, start_time "18:00"). Sessions auto-generate 28 days ahead. |
| PATCH | /slots/:id | coach_id?, room_id?, capacity?, is_active? |
| GET | /templates, /rooms | |
| GET/POST | /owner/plans · PATCH /owner/plans/:id | |
| POST | /owner/staff | email, full_name, role, coach_title? |
| GET/PATCH | /owner/settings | name, cancel_window_hours, late_cancels_per_month, waitlist_cutoff_minutes |
| POST | /owner/users/:id/password | password |
