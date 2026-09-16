# Job Queue Dashboard

Small job queue management dashboard built for the AIRTH React + NestJS
intern assignment — a NestJS API backed by SQLite, and a React dashboard
on top of it.

- **Backend:** `backend/` — NestJS, TypeORM, SQLite (`better-sqlite3`)
- **Frontend:** `frontend/` — React + TypeScript (Vite)

## Live URLs

| | URL |
|---|---|
| Frontend | https://frontend-beta-inky-m3homacvo4.vercel.app/ |
| Backend API | https://airth-anshul.onrender.com |

Backend is on Render's free tier, so it sleeps after ~15 minutes of no
traffic. First request after that takes 30-50s to wake back up — that's
Render, not a bug.

## Running it locally

Needs Node 20+.

**Backend**

```bash
cd backend
npm install
npm run start:dev    # http://localhost:3000
```

SQLite file gets created at `backend/jobs.sqlite` automatically (it's
git-ignored). You can override the path with `DATABASE_PATH` and the port
with `PORT` if you need to.

**Frontend**

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173
```

It points at `http://localhost:3000` by default. If you want it hitting a
different API (like the deployed one), copy `.env.example` to `.env.local`
and set `VITE_API_URL`.

## API

| Method | Path | What it does |
|---|---|---|
| `POST` | `/jobs` | Create a job — `{ title, type }`, starts as `pending` |
| `GET` | `/jobs` | List jobs, optionally `?status=pending\|running\|completed\|failed` |
| `PATCH` | `/jobs/:id/status` | Change status — `{ status }` |
| `DELETE` | `/jobs/:id` | Delete a job |

Job shape: `{ id, title, type, status, createdAt }` (there's also an
internal `idempotencyKey` field, see the bonus section below).

Errors come back as `{ statusCode, message, path, timestamp }`:

- `400` — bad input (missing title/type, garbage status value)
- `404` — job doesn't exist
- `409` — someone else changed this job's status first, try again
- `422` — the status change you're asking for isn't a legal move from where the job currently is

## The state machine

```
pending → running → completed
                   ↘ failed
```

`completed` and `failed` are dead ends — once a job lands there it can't
move anywhere else, and it definitely can't go back to `running`.

## The concurrency question (two tabs, same job)

This was the main thing the assignment wanted me to think through, so
here's my reasoning:

**Where should the rule live?** On the server, full stop. The frontend does
disable buttons for moves it already knows are illegal (you won't even see
a "mark running" button on a completed job), but that's just to avoid
firing off requests that would get rejected anyway — it's not what's
actually protecting the data.

**What if someone skips the UI and hits the API directly?** They go through
exactly the same check the frontend's requests do, because there isn't a
separate path for "trusted UI request" vs "raw API call." Every
`PATCH /jobs/:id/status` re-reads the job's current status from the DB and
checks it against one transition table before touching anything. Try to
jump `pending` straight to `completed`, or push a `completed` job back to
`running`, and you get a `422` no matter how the request was made.

**What actually happens with two simultaneous requests?** This is the part
that's easy to get subtly wrong. If you write the obvious version — read
the job, check if the transition is legal, then write the new status — two
requests can both read `pending`, both pass the check, and both write
`running`. One of them just silently overwrites the other and you'd never
know it happened.

To avoid that, the update itself isn't "read then write," it's one
conditional SQL statement:

```sql
UPDATE jobs SET status = :newStatus
WHERE id = :id AND status = :statusWeReadEarlier
```

(see `updateStatus` in `backend/src/jobs/jobs.service.ts`). Whichever
request's `UPDATE` actually runs first wins, and its `WHERE` clause still
matches, so it succeeds. By the time the second request's `UPDATE` runs,
the row's status has already moved — its `WHERE` clause no longer matches
anything, `affected` comes back `0`, and the service turns that into a
`409` instead of quietly clobbering the winner. The database row is
basically doing the locking for you, no extra lock table or queue needed.

One thing worth being upfront about: because this app runs on SQLite via
`better-sqlite3`, which executes queries synchronously in a single Node
process, in practice you'll usually see a `422` in this race rather than a
`409` — the second request's *read* happens after the first request's
*write* has already landed, so it just fails the transition check instead
of losing the compare-and-swap. I actually tested this with two parallel
requests hitting the same job and that's exactly what I saw. Both outcomes
are safe (nothing gets double-applied either way), but the `409` path is
the one that matters once you're not running a single process anymore —
multiple API instances behind a load balancer, or Postgres with a real
connection pool, where two requests' reads can genuinely overlap. The
`WHERE status = :expected` guard is what makes that case correct, the
single-process SQLite behavior is just a side effect of this project's
scale.

**So, three things are doing the work here, cheapest first:** input
validation catches garbage before it's even considered (`400`), the
transition table decides what's legal (`422`), and the conditional update
closes the race between "legal when I checked" and "legal when I actually
write" (`409`). I didn't reach for anything heavier than that — no
distributed locks, no message queue — a job queue this size doesn't need
it, and the same pattern carries over to Postgres without changing any
logic, just the driver.

## Bonus: Idempotency-Key on job creation

A job queue is a pretty natural place for a client to accidentally send the
same "create job" request twice — flaky network, a retry after a timeout,
a double click before a button disables. Silently ending up with two
identical jobs is a real bug, not a hypothetical one.

`POST /jobs` accepts an optional `Idempotency-Key` header. First request
with a given key creates the job and stores the key (unique index on the
column). Send the same key again and you get the original job back instead
of a duplicate — including if two copies of the same request race each
other, which is handled by catching the unique constraint violation and
just re-reading the row that won instead of erroring out. It's a small
change (one column, one index, a couple extra lines in `create()`), but it
felt like the more realistic "production-readiness" gap for this specific
kind of system, compared to something more generic. The frontend here
doesn't send the header itself — it's there for API consumers, the same
way an actual job-submitting service would use it.

## Assumptions & trade-offs

- **SQLite instead of Postgres.** Both were allowed, and SQLite meant no
  extra service to spin up for a two-day assignment. The concurrency fix
  doesn't change at all under Postgres — it's the same `UPDATE ... WHERE`
  pattern, just a different driver.
- **No auth.** Not asked for, so every endpoint is open. In a real version
  jobs would probably be scoped to a user.
- **No pagination on `GET /jobs`.** Fine at this scale, would add before
  job volume got large.
- **Filtering is just the one `status` query param** since that's the only
  filter the UI actually needs — didn't build out a general query system.
- **Delete is a hard delete**, no soft-delete/audit trail. Kept it simple;
  would reconsider if "who deleted what and when" needed to be answerable.
- **On a failed status change or delete, the frontend re-fetches the whole
  list** instead of trying to patch its local state — after a 409/404 I'd
  rather resync from the server than guess.

### If I had more time

- Live updates (SSE or websockets) so a second tab sees a status change
  without a manual refresh — the API already returns the full row on every
  mutation, so most of the plumbing is already there.
- Rate limiting on `POST /jobs`, since a public create endpoint is an easy
  target.
- Request-ID logging so a `409`/`422` in the logs is traceable back to the
  exact request that triggered it.
- An actual automated test for the race condition instead of just the
  manual `Promise.all` check I ran during development.

## Deploying it yourself

### Backend — Render

1. New Web Service → connect this repo, root directory `backend`.
2. Build: `npm install && npm run build`
3. Start: `npm run start` (or `npm run start:prod`, same thing)
4. Free tier is fine. SQLite data resets on redeploy on the free tier —
   acceptable for a demo, wouldn't be for anything real.

### Frontend — Vercel / Netlify

1. Import the repo, root directory `frontend`.
2. Build: `npm run build`, output: `dist`.
3. Set `VITE_API_URL` to the Render URL from above.
