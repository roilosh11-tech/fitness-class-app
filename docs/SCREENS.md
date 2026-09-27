# FORM: screen inventory
Screen IDs match `<sc-if value="{{ is.<id> }}">` in `design/FORM Prototype HE.dc.html`. Copy is in the prototype. Data sources refer to `schema.sql`.

## Member
| ID | Screen | Data | Actions |
|---|---|---|---|
| m_welcome | Welcome: 230 px hero image, pitch, "get started" / "sign in" | none | → packages (onboarding), → sign-in |
| m_signin | Sign in | auth | Validate, sign in, forgot password (reset email) |
| m_home | Greeting by time of day ("בוקר טוב / צהריים טובים / ערב טוב, <first name>"); dark hero card with the weekly streak; credits; next class card; weekly goal (attended / plan goal); minutes; leaderboard rank | subscription, credit_balance, bookings, leaderboard_week | Open next class, → bookings, → schedule |
| m_schedule | Week day chips (Mon–Fri) + type filters (All, Strength, Mobility, Reformer, Conditioning, Open spots); class rows showing time, name, coach, spots, and a status badge (booked / waitlist / full / open) with an inline book button | class_sessions + session_availability (realtime) | Filter, open class, book |
| m_class | Image, day and time eyebrow, description, coach card, spots | session, my booking | Book / join waitlist / cancel |
| m_booked | Confirmation panel (lime check) with day-of tips | last booking | Add to calendar (.ics), back to schedule |
| m_packages | 3 plan cards (the selected one gets tint fill + 2 px #3f9c55 border) | plans | Select → checkout |
| m_checkout | Card form + "pay ₪X.00" (shows "processing…" while paying) | PaymentProvider | Pay → home (onboarding) or → bookings |
| m_bookings | Tabs: upcoming / past / cancelled; badges: booked, waitlist, credit refunded, no refund; plan + credits header | bookings | Open class, manage plan |
| m_profile | Avatar and stats (classes, meetups, streak); rows: bookings, store, plan & payment, personal details, notifications, privacy & safety, WhatsApp the studio; log out | profile | Navigate |
| store | Reward toggle card (top-3 → 10% off); category chips; product rows with qty stepper; sticky cart summary (subtotal, discount, total) | products, rewards | Add/remove, buy |

## Community (all roles; tabs follow the current role)
| ID | Screen | Notes |
|---|---|---|
| community | Segmented control (**Feed** / Meetups / Leaderboard); new-post CTA; post cards with image, text, reaction bar (4 emoji + counts, mine highlighted), first comment, comments toggle, inline comment input, report | Realtime inserts |
| meetups | The same segmented control (**Meetups** active); type filters (All, Run, Hike, Social); meetup rows (day badge, name, host, going/cap, place); "create meetup" | Switching segments replaces the screen rather than pushing a new one |
| meetup | Image, when/where/detail/after card, avatars + going count, join/leave (lime when not joined), message host, disclaimer | Full → join disabled |
| newmeetup | Name, type chips, date & time, meeting point, capacity (optional), notes; inline error | Host auto-joins |
| post | Author row, photo picker (required), caption, code of conduct, share (45% opacity until a photo is added) | Upload to Storage |
| leaderboard | Segmented control (**Leaderboard** active); week/month chips; "ends in N days"; podium (heights 78/60/48, "me" in lime); ranked rows ("me" row tinted); prizes list; "how points work" | leaderboard views |

## Coach
| ID | Screen | Notes |
|---|---|---|
| c_home | Greeting; hero "next class · 12:15" card; today's stats; today's classes (book counts) | |
| c_schedule | Day chips; my sessions, each with booked/cap and a full badge | |
| c_class | Tint headline "N booked · M spots"; session plan (numbered, with edit/done toggle); attendee rows with a note badge; → check-in; → programs | |
| c_checkin | Present / expected counters; attendee rows (tap toggles present in green / expected in orange); check in all; start/end class; message all | set_attendance, end_session |
| c_notes | Member header; member switcher chips; pinned caution note; dated note log; add a note | member_notes (staff only) |
| c_programs | Plan library cards (focus, #exercises, duration, updated); new plan (auto-generates with AI) | workout_plans |
| c_builder | Editable name; focus chips; 4 blocks each with a count and "+ add" (library picker); exercise rows that expand to edit dose, **AI swap** (3 options with a why), and remove; AI bar with quick chips + free text; AI summary card with undo/restore and dismiss; busy spinner ("drafting…" / "refining…"); save; assign to class | ai-workout Edge Function |

## Owner
| ID | Screen | Notes |
|---|---|---|
| o_overview | 2×2 KPI grid (revenue, members, attendance, trial→paid); alerts list (warn/ok) with CTAs; → manage | Computed server-side |
| o_schedule | Day chips; studio filter (All / Studio A / Studio B); rows with booked/cap + waitlist count and an open/waitlist badge | → roster |
| o_manage | "N scheduled" + add; session rows (selected row gets a 2 px green border); edit panel (name, time, coach, capacity); save; cancel class | cancel_session |
| o_roster | Booked / cap, waitlist, attendance stats; attendee list | |
| o_packages | Plans with member counts and prices; create package; cancellation policy (8 h window, 2 late cancels/month) | |
| o_trainers | Coach rows (initials, name, focus, classes this week); invite link; permissions | Invite = magic link with role=coach |
| o_settings | Hero studio card; rows: studio details & hours, rooms & capacity, packages & pricing, trainers, payouts, waivers & policies, notifications, staff permissions | |
| o_cancelled | Confirmation: N credits refunded, members notified; schedule a replacement / back to schedule | |

## Shared components to build first
Screen shell (header + scroll + tab bar), Segmented, Chip, Card, ListRow (time column + title/sub + badge + optional trailing action), PillButton (primary lime / secondary / dark), Field (11 px uppercase label + input; error text in orange), Avatar (initials on tint), Badge, Toast, Stepper, EmptyState.
