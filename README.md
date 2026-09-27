# Handoff: FORM — Studio OS (member, coach and owner apps)

## Getting started
```bash
npx create-expo-app@latest . --template tabs   # scaffold into this repo
cp .env.example .env                         # add Supabase keys
npx supabase init && npx supabase db push    # apply the schema
npx expo start --web
```

## Overview
FORM is a Hebrew-first (RTL) app for a small-group fitness studio ("FORM הירקון"). One codebase serves three roles:
- **Member** — book classes, manage plan and credits, community feed, meetups, leaderboard, store.
- **Coach** — today's classes, check-in, session plans, private member notes, AI workout builder.
- **Owner** — KPIs and alerts, studio schedule, class management, rosters, packages and pricing, trainers, settings.

v1 scope: **all of the above.**

## About the design files
Everything in `design/` is a **design reference built in HTML**: an interactive prototype that shows the intended look and behavior. It is **not production code**. Rebuild it in the target stack below. Open `design/FORM Prototype HE.dc.html` in a browser: the side panel switches role, theme and screen, and describes each screen. `FORM Prototype.dc.html` is the English version.

## Fidelity
**High fidelity.** Colors, type, spacing, copy and interactions are final. Match them closely. All copy is in the Hebrew prototype; use it verbatim, extracted into i18n files (`he` as the default, `en` from the English prototype).

## Target stack
| Layer | Choice |
|---|---|
| App | **Expo (React Native) + Expo Router**, shipped as a **PWA** (`expo export --platform web`). iOS/Android builds come later from the same code. |
| Language | TypeScript, strict |
| Styling | StyleSheet or NativeWind; tokens in `theme.ts` (light + dark) |
| Data | **Supabase**: Postgres, Auth (email + password, magic link for resets), Storage (post and meetup photos), Realtime (class spots, feed, waitlist) |
| Server logic | Postgres RPC functions (`SECURITY DEFINER`) for anything touching credits or capacity; Supabase Edge Functions for AI and payments |
| AI | Edge Function `ai-workout` → Claude API (the key stays server-side) |
| Payments | **Not decided yet.** Build a `PaymentProvider` interface with a `MockProvider` (the prototype's 1.3 s simulated charge). Tranzila, Cardcom, Meshulam or Stripe plug in later. |
| Client state | TanStack Query for server state; Zustand for UI state (theme, drafts) |
| RTL | `I18nManager.forceRTL(true)` on native; `dir="rtl"` on web. Use logical start/end styles only. |

See `supabase/migrations/0001_init.sql` (database, RLS, RPCs) and `docs/BUSINESS_RULES.md` (booking, waitlist, credits, points, moderation, AI). `docs/SCREENS.md` lists every screen with its data and actions.

## Suggested project structure
```
app/
  (auth)/welcome.tsx, signin.tsx
  (member)/_layout.tsx            # 4 tabs: home, schedule, community, profile
    home.tsx, schedule/index.tsx, schedule/[classId].tsx, schedule/booked.tsx
    profile/index.tsx, profile/bookings.tsx, profile/packages.tsx, profile/checkout.tsx, profile/store.tsx
  (coach)/_layout.tsx             # home, schedule, community, member notes
    home.tsx, schedule/…, class/[id].tsx, class/[id]/checkin.tsx, notes/[memberId].tsx, programs/index.tsx, programs/[planId].tsx
  (owner)/_layout.tsx             # overview, schedule, community, settings
    overview.tsx, schedule.tsx, manage.tsx, roster/[sessionId].tsx, packages.tsx, trainers.tsx, settings.tsx, cancelled.tsx
  community/                      # shared by all roles
    index.tsx (feed), post.tsx, meetups/index.tsx, meetups/[id].tsx, meetups/new.tsx, leaderboard.tsx
lib/ supabase.ts, payments/, ai.ts, i18n/
components/ Screen, Header, TabBar, Segmented, Chip, Card, ListRow, PillButton, Field, Toast, Avatar, Badge
supabase/ migrations/, functions/ai-workout, functions/payments-webhook
```
The role comes from `profiles.role` after sign-in; the root layout redirects to the right group. Community is shared, but its bottom tab bar belongs to the current role.

## Layout shell (every screen)
- Viewport width 390 (mobile first). On desktop web, center a 390–430 px column on the `page` color.
- **Header** (on `card`): back chevron (accent color, 16 px, only when the stack depth is > 1), **eyebrow** 11 px uppercase, letter-spacing .05em, accent color; **title** 27 px / 500, letter-spacing −.01em, line-height 1.15. Padding 6/20/16.
- **Content**: scrolls; padding 16/18/28; vertical gap 12. Enter animation `opacity 0→1, translateY 6→0, 280 ms ease`. Reset scroll to top on navigation.
- **Tab bar**: 4 tabs; active tab uses `accent`, inactive uses `#8b8f88`. Hidden on welcome/sign-in and during onboarding packages/checkout.
- **Toast**: bottom-center, auto-dismiss after 2.4 s, enters with fade + 8 px rise. It confirms nearly every action (see the copy in the prototype).

## Design tokens
### Color — light / dark
| Token | Light | Dark | Use |
|---|---|---|---|
| page | #e8e8e3 | #0b0d0b | outside the app column |
| bg | #f4f4f1 | #121512 | screen background |
| card | #ffffff | #1b1f1b | cards, header |
| ink | #161916 | #eef0ea | primary text |
| muted | #555a53 (secondary #6e726b, tertiary #8b8f88) | #a3a89f | secondary text |
| line | #e8e8e3 (inputs #e0e0da) | #2c312c | borders |
| tint | #eef8d6 | #1f3324 | selected card, success panels |
| tint2 | #e2f5c4 | #28432d | "open" badges |
| tintInk | #1d3a12 | #d4f0a6 | text on tint2 |
| warn | #fdf0e2 | #3a2b1b | alert rows, waitlist badges |
| chip | #f0f0ec | #262b26 | neutral badges |
| seg | #e6e6e0 | #232823 | segmented-control track |
| hero | #13261a | #1f3527 | dark hero cards |
| sel / selFg | #13261a / #fff | #c3f03f / #15260c | active chip |
| accent | #2c8a4b | #7fd08f | links, eyebrows, active tab |
| lime | #c3f03f | — | primary CTA fill (ink text), podium "me" avatar |
| selectedBorder | #3f9c55 (2 px) | — | selected plan or card |
| orange | #d9822b | — | warnings, "expected" attendance |
| heroSub | #b9c4bb | — | secondary text on hero |

The theme is user-selectable (light/dark) and persisted locally.

### Typography
- Latin: **Geist** 400/500/600. Hebrew: **Heebo** 400/500/600 (stack `Geist, Heebo, system-ui`). Numbers and indices: **Geist Mono** 400/500.
- Scale: 27 (screen title) · 20 (hero numbers) · 18–19 (section heading, 500) · 16 (lead) · 15 (buttons) · 14 (body) · 13 (chips, meta) · 12 (captions) · 11 (eyebrow, labels: uppercase, .04–.06em).
- Body line-height 1.45; use `text-wrap: pretty` on web.

### Shape and spacing
- Radii: 16 (hero, images), 14 (cards, list rows), 18 (confirmation panels), 10 (small rows), 999 (pills, chips, segmented controls, buttons).
- Primary button: height 50, full width, pill, `lime` fill, ink text 15/500. Secondary: `card` fill with a 1 px `line` border.
- Segmented control: `seg` track, 3 px padding, 4 px gap, 32 px items; active item uses `card` fill, 500 weight, ink text.
- Chip: pill with a 1 px border; active uses `sel`/`selFg`.
- Card padding 14–16 px; list rows 14/16. Images 170 px tall (230 on welcome), `cover`.
- Frame shadow (desktop only): `0 30px 80px rgba(20,30,20,.18)`.

## Assets
`design/assets/`: `welcome.png`, `strength.png`, `community.png`, `meetups.png`, `riverside.png`. These are placeholder studio photography; replace them with real shots. Store products use labeled placeholders, so real product images are needed. Icons are simple strokes (1.8 px, round caps); use `lucide-react-native`.

## Files
- `design/FORM Prototype HE.dc.html`: the primary reference (Hebrew, RTL). Screen templates are marked `<sc-if value="{{ is.<screenId> }}">`. Logic, seed data and copy are in the `<script>` at the bottom.
- `design/FORM Prototype.dc.html`: the English version.
- `design/support.js`: the runtime needed to open the prototypes locally.
- `supabase/migrations/0001_init.sql`, `docs/BUSINESS_RULES.md`, `docs/SCREENS.md`: the backend and behavior spec.

## Build order
1. Supabase project: run `supabase db push` (applies `supabase/migrations/0001_init.sql`), seed it from the prototype data (classes, plans, products, members).
2. Auth and role routing, app shell, theme, i18n, RTL.
3. Member: schedule → class → book/cancel/waitlist (RPCs) → bookings → packages/checkout (mock payments) → home.
4. Coach: home, schedule, class, check-in, notes.
5. Owner: overview, schedule, manage (create/edit/cancel), roster, packages, trainers, settings.
6. Community: feed, reactions, comments, reports, post creation (Storage), meetups, leaderboard (points view).
7. Store and orders; AI workout builder (Edge Function).
8. PWA manifest, icons, offline shell, web push for booking and waitlist notifications.
