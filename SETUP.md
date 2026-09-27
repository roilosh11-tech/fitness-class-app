# Setup: go live on Railway (about 10 minutes, no code)

## 1. Create the project
1. Go to **railway.com** → sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → choose `fitness-class-app`.
3. When it asks, or later in the service's **Settings → Source → Root Directory**, set it to `server`.

## 2. Add the database
1. In the project, click **+ Create → Database → PostgreSQL**. Railway creates it for you.

## 3. Set 3 variables
Open your app service (not Postgres) → **Variables** → **New Variable**:
| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly; Railway links it) |
| `JWT_SECRET` | any long random text, e.g. from passwordsgenerator.net (32+ characters) |
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com (only needed for the AI workout builder) |

Railway redeploys automatically. On first start, the server **creates all tables and fills in the studio**: rooms, plans, 4 coaches, a weekly timetable, the store and prizes. No SQL needed.

## 4. Get your URL
Service → **Settings → Networking → Generate Domain**. Open `https://<your-domain>/health`; you should see `{"ok":true}`.

## 5. Become the owner
**The first person to sign up becomes the studio owner.** Sign up right away with your own email:
```
curl -X POST https://<your-domain>/api/auth/signup -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"your-password","full_name":"Your Name"}'
```
(Or just sign up in the app once it's connected.)

Coaches were created from `server/src/seed.js` (nina@, lior@, amira@, shai@formstudio.co.il). A coach activates their account by signing up with their email. Change those emails in `seed.js` **before the first deploy**, or add real coaches later with `POST /api/owner/staff`.

## 6. Connect the app
Send me your Railway domain and I'll connect the prototype to it, so every screen uses real data.

## Updating
Push to GitHub and Railway redeploys. New database changes go in `server/db/migrations/002_*.sql`; they run automatically on the next start.

## Payments
Checkout and store orders currently use a **mock payment** that always succeeds. When you choose a provider (Tranzila / Cardcom / Meshulam / Stripe), replace the mock in `POST /api/subscribe` and `POST /api/orders` with that provider's checkout plus a webhook.
