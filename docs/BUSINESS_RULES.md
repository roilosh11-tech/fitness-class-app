# FORM: business rules
All of these rules are implemented **server-side** in `server/src/logic.js` and `server/src/routes/`. The client only displays their results.

## Plans and credits
| Plan | Price (₪/month) | Credits/month | Weekly goal |
|---|---|---|---|
| שיעור 1 בשבוע | 79 | 4 | 1 |
| 2 שיעורים בשבוע (most popular) | 129 | 8 | 2 |
| ללא הגבלה | 179 | unlimited (`null`, shown as ∞) | 3 |

- Plans are monthly and can be frozen with 7 days' notice.
- Credits reset on each successful renewal. Unused credits do not roll over (the owner can change this in settings later).
- Every credit change writes a row to `credit_ledger`. The balance is `sum(delta)` for the current period; unlimited plans skip the check.
- New members: welcome → "get started" → packages → checkout → home (onboarding hides the tab bar).

## Booking (`book_class(session_id)`)
1. The session must be in the future and not cancelled.
2. The member has no active booking or waitlist entry for this session.
3. If `booked_count < capacity` **and** the member has credits → create a `booked` booking and spend 1 credit (ledger −1). Navigate to the confirmation screen (tips + add to calendar via `.ics`).
4. Otherwise → create a `waitlist` booking with no charge. Toast: the class is full, you've joined the waitlist, and we'll book you automatically if a spot opens.
5. Wrap steps 3–4 in a transaction with `SELECT … FOR UPDATE` on the session row, so two members can never take the last spot.

## Cancellation (`cancel_booking(booking_id)`)
- Waitlist entry → remove it; no credit change. Toast "יצאת מרשימת ההמתנה".
- Booking at least **8 hours** before start → refund 1 credit (`refund = true`).
- Within 8 hours → a late cancel with no refund. Members get **2 late cancels per month**; after that, late cancels are still allowed but always lose the credit. The owner edits this policy in settings.
- The freed spot triggers **waitlist promotion**.

## Waitlist promotion (trigger on booking cancel or capacity increase)
- Take the oldest `waitlist` entry whose member has credits → set it to `booked`, spend 1 credit, and send a push/in-app notification.
- If that member has no credits, skip them and leave their entry in place.
- Stop promotions 1 hour before start.

## Check-in and attendance (coach)
- The coach taps a member to toggle `attended`. "Check in all" marks everyone.
- Start class → `sessions.started_at`; end class → `ended_at`. At the end, any `booked` entry not checked in becomes `no_show` (no refund).
- Attendance adds to member stats (visits and minutes = classes × 50) and to the leaderboard.

## Owner: class management
- Create or edit a session: name, time, coach, room/studio, capacity (default 12).
- Raising capacity triggers waitlist promotion. Lowering it below `booked_count` is blocked.
- **Cancel session** → every `booked` member gets a refund (+1 credit each), waitlist entries are removed, and everyone is notified. The confirmation screen shows the refund count and offers "schedule a replacement."
- Overview alerts are computed: oversubscribed sessions (waitlist > 0), failed renewals (count and ₪ at risk, with a "send payment reminder" action), and high-attendance highlights.
- KPIs: monthly revenue with change vs. last month, active members with net change this month, attendance % (attended / booked), trial→paid conversion (45% target).

## Community
- Private: visible only to members and staff of the same studio.
- A post **requires a photo or video**; text is optional ("הגעתי היום." is used if empty). The code of conduct is shown on the post screen.
- Reactions: ♥ 💪 🔥 👏, **one per user per post**. Tapping your reaction removes it; tapping another one switches. You **can't react to your own post** (toast).
- Comments are always visible to the studio. The card shows the first comment and a "N supportive comments" toggle.
- Report → a `reports` row goes to the owner's moderation queue. **The post stays visible until reviewed.** Coaches can moderate too (a permission).

## Meetups (member-organized)
- Types: Run, Hike, Ride, Social. Required: name, date + time, meeting point. Optional: capacity, notes.
- The host automatically joins. Join/leave; a full meetup (going ≥ cap) cannot be joined.
- Disclaimer: meetups are community-organized, participation is at your own risk, and the studio doesn't supervise.
- "Message host" → in-app DM (v1 can be a push notification to the host with the text).

## Points and leaderboard
Points come from `point_events`; the leaderboard is a view grouped by week (Sun–Sat, ends Sunday) and by calendar month.
| Event | Points |
|---|---|
| Attended class | 25 |
| Joined meetup (awarded when it happens; reversed if you leave before) | 15 |
| Hit your weekly plan goal | 20 |

Prizes (owner-editable):
- Week: #1 20% store discount · #2 free recovery session (30 min) · #3 10% store discount (valid 7 days)
- Month: #1 free 1:1 PT (60 min) · #2 two guest passes + protein shake · #3 priority booking (24 hours early next month)

Store discount prizes become a `reward` row that the member toggles at store checkout.

## Store
- Categories: Protein, Accessories, Apparel, Sessions. There's a cart with a quantity stepper. An active reward shows the discount line; total = subtotal − discount.
- Order → `orders` + `order_items`, pickup at reception. Toast shows the total. Payment goes through the same `PaymentProvider`.

## Coach notes
- Private per member and visible **only to staff**. Pinned note (injuries, cautions) plus a dated log ("12 במאי · נינה — …").
- Class attendee rows show a short badge (e.g. "shoulder note").

## AI workout builder (`POST /api/ai/workout`)
Plans always have 4 blocks, in order: **חימום, עיקרי, פיניש, שחרור**. Each item is `{name, dose, note}`.
Modes:
- `generate`: a full plan from focus, level and duration (the prototype runs this automatically for "new plan").
- `refine`: free-text request plus quick chips: "easier", "shoulder-friendly" (can reference a member's pinned note), "shorten to 45 min".
- `swap`: 3 alternatives for one exercise `{name, dose, why}`.
Prompt contract (from the prototype): *expert small-group coach assistant; up to 12 people; return ONLY JSON; keep exactly the 4 Hebrew block names; all text in Hebrew; short doses like "3×8 לצד"; notes ≤ 6 words.* Validate the JSON server-side and retry once. Return `{summary, blocks}`.
The client keeps the previous version for **undo/redo** of the last AI change. "Assign to class" writes the plan into that session's plan. Rate limit: 30 requests per coach per hour.

## Validation (client and server)
- Email must match `^\S+@\S+\.\S+$`; password ≥ 8 characters; "forgot password" sends a reset link.
- Card fields (mock provider only): name ≥ 2 characters, 16 digits formatted in 4s, `MM / YY`, CVC 3–4 digits. A real provider replaces these with its hosted fields.

## Notifications
Booking confirmed, waitlist promoted, class cancelled (with refund), reaction/comment on your post, meetup changes, payment failed. Channels: web push (PWA) plus an in-app inbox.
