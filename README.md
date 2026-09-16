# Job Queue Dashboard

A small job queue management dashboard: a NestJS + SQLite API and a React
dashboard on top of it. Built for the AIRTH React + NestJS intern
assignment.

- **Backend:** `backend/` — NestJS, TypeORM, SQLite (`better-sqlite3`)
- **Frontend:** `frontend/` — React + TypeScript (Vite)

## Live URLs

| | URL |
|---|---|
| Frontend | _add after deploying, see [Deployment](#deployment)_ |
| Backend API | _add after deploying, see [Deployment](#deployment)_ |

## Running locally

Requires Node.js 20+.

### Backend

```bash
cd backend
npm install
npm run start:dev    # http://localhost:3000
```

SQLite persists to `backend/jobs.sqlite` (created automatically, git-ignored).
Override with `DATABASE_PATH` and the port with `PORT`.

### Frontend

```bash
cd frontend
npm install
npm run dev           # http://localhost:5173
```

By default the frontend talks to `http://localhost:3000`. To point it at a
different API (e.g. a deployed backend), copy `.env.example` to `.env.local`
and set `VITE_API_URL`.

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/jobs` | Create a job (`{ title, type }`), status starts at `pending` |
| `GET` | `/jobs` | List jobs, optional `?status=pending\|running\|completed\|failed` |
| `PATCH` | `/jobs/:id/status` | Change status (`{ status }`) |
| `DELETE` | `/jobs/:id` | Delete a job |

A job is `{ id, title, type, status, createdAt }` (plus an internal,
optional `idempotencyKey` — see [Bonus](#bonus-idempotency-key-on-job-creation)).

Errors return `{ statusCode, message, path, timestamp }`:

- `400` — bad input (missing/invalid `title`, `type`, or `status` value)
- `404` — job not found
- `409` — the status changed underneath the request (see below)
- `422` — the requested status transition isn't legal from the job's current status

## Data model & the state machine

```
pending → running → completed
                   ↘ failed
```

`completed` and `failed` are terminal — nothing can leave them, and
`running` can't be re-entered once a job has completed or failed.

## Think About This: concurrency

The assignment's scenario: two browser tabs both see a job as `pending` and
both try to move it to `running` at nearly the same time.

**Where the rule is enforced.** Entirely on the server
(`backend/src/jobs/jobs.service.ts`). The frontend also disables buttons for
transitions it knows are illegal (e.g. it won't render a "Mark running"
button on a `completed` job), but that's a UX nicety, not the source of
truth — it just avoids sending requests the API would reject anyway.

**If someone bypasses the React app and calls the API directly.** They hit
the exact same validation the UI goes through, because there is no separate
"UI-only" path. `PATCH /jobs/:id/status` re-reads the job's current status
from the database and checks it against a single transition table
(`pending → [running]`, `running → [completed, failed]`, everything else →
`[]`) before doing anything else. An illegal transition — `pending →
completed`, `completed → running`, a nonsense status string, etc. — gets a
`422`/`400` regardless of who or what sent the request.

**Two requests arriving at nearly the same time.** This is the part that a
"read the job, check the rule, then write" implementation gets wrong: two
requests can both read `pending`, both pass the transition check, and both
write `running` — one silently clobbering the other, or (worse, e.g.
`running → completed` and `running → failed` racing) leaving the row's final
state dependent on write order instead of business logic.

The fix is to not trust the read by the time the write happens. The update
is a single conditional SQL statement:

```sql
UPDATE jobs SET status = :newStatus
WHERE id = :id AND status = :statusWeReadEarlier
```

(`jobs.service.ts`, `updateStatus`). This is an atomic compare-and-swap done
by the database, not the application. Whichever request's `UPDATE` runs
first wins and `affected = 1`. The second request's `WHERE` clause no longer
matches — `affected = 0` — and the service reports it as `409 Conflict`
("job was already updated by another request, refresh and try again")
instead of silently overwriting the winner or double-applying the
transition. No in-memory locks, no distributed lock manager, no
`SELECT ... FOR UPDATE` transaction needed — the row itself is the lock.

In this project's SQLite setup specifically, `better-sqlite3` executes
queries synchronously and the whole app runs in a single Node process, so in
practice one request's read-then-write finishes before the next one starts
and you'll usually see a `422` (racer B reads the *already-updated* row and
fails the transition check) rather than a `409` (racer B's `UPDATE` loses
the compare-and-swap). Both outcomes are safe — neither one can move the job
into an invalid state — but the `409` path is what actually matters once you
scale beyond one process: multiple API instances behind a load balancer, or
Postgres with a real connection pool, where two requests' reads genuinely
overlap in time. The `WHERE status = :expected` guard is what makes the
system correct under that condition, not the accident of single-threaded
SQLite.

**Preventing invalid/inconsistent state in general.** Three layers, cheapest
first:

1. `class-validator` DTOs reject malformed input before it reaches any
   business logic (`400`).
2. The transition table is the single source of truth for "is this move
   legal," checked server-side on every request (`422`).
3. The conditional `UPDATE` closes the read/write race so "legal when I
   checked" and "still legal when I write" can't diverge (`409`).

I did not reach for a distributed lock, a message queue, or
`SERIALIZABLE` transactions — for a queue of this size a single
compare-and-swap update is enough, and it's the same pattern that scales
cleanly to Postgres with multiple API instances without changing the logic
at all (only the driver changes).

## Bonus: Idempotency-Key on job creation

A job queue is exactly the kind of system where a client (a flaky network,
an impatient double-click, a retried request after a timeout) can end up
calling `POST /jobs` twice for what should be one job. Silently creating two
identical jobs is a realistic production bug, and it's the same "duplicate
request" class of problem as the concurrency question above, just on create
instead of update.

`POST /jobs` accepts an optional `Idempotency-Key` header. The first request
with a given key creates the job and stores the key on the row (unique
index). Any later request with the same key returns the original job
instead of creating a new one — including two copies of the same request
racing each other, which is handled by catching the unique-constraint
violation and re-reading the winning row rather than failing the loser.
It's a small addition (one column, one unique index, one extra branch in
`create()`), but it's the kind of thing that matters the moment a real
client (or a retrying `fetch`) is involved. The frontend in this repo
doesn't send the header — it's exposed for API consumers, same as a real
job-submission client would use it.

## Assumptions & trade-offs

- **SQLite over Postgres.** The assignment allows either; SQLite needs no
  external service to run or deploy, which fits the "small dashboard, two
  day deadline" scope. The concurrency fix (conditional `UPDATE`) is
  identical under Postgres — swapping the TypeORM driver is the only change
  that would be needed to move to it.
- **No auth.** Out of scope per the assignment; every endpoint is open.
  In a real deployment `job type` would likely be scoped to a user/tenant.
- **No pagination on `GET /jobs`.** Fine at dashboard scale; would add
  `limit`/`cursor` before this saw real job volume.
- **Filtering is a single `status` query param**, not a general query
  language — matches the one filter the UI actually needs.
- **Delete is hard delete**, not a soft-delete/audit trail. Simpler for
  this scope; would reconsider for a system where "who deleted what" needs
  to be answerable later.
- **Frontend re-syncs the full list on a failed status change or delete**
  (409/404) rather than trying to patch state locally, so the UI can never
  drift from the server after a conflict.

### With more time

- Server-Sent Events or WebSockets so a second tab sees a status change
  live instead of needing a manual refresh (the API already returns the
  canonical row on every mutation, so this is mostly transport work).
- Structured logging with a request ID, so a `409`/`422` in production logs
  is traceable to the exact request that caused it.
- Rate limiting on `POST /jobs` (`@nestjs/throttler`) — a public "create
  job" endpoint is an easy target for abuse.
- E2E tests around the transition table and the race condition (the race
  was verified manually during development — see the concurrency section —
  but it deserves an automated regression test).

## Deployment

Both services are plain Node apps, so any Node host works. Suggested free
options:

### Backend — Render

1. New **Web Service** → connect this repo → root directory `backend`.
2. Build command: `npm install && npm run build`
3. Start command: `npm run start:prod`
4. Add a persistent disk (Render free tier disk is ephemeral across
   deploys but survives while the instance is up) mounted wherever
   `DATABASE_PATH` points, or just accept that a redeploy resets the demo
   data — fine for this assignment's purposes.

### Frontend — Vercel / Netlify

1. Import this repo, root directory `frontend`.
2. Build command: `npm run build`, output directory `dist`.
3. Set environment variable `VITE_API_URL` to the deployed backend URL.

## Testing performed

- Full CRUD + status-transition flow exercised against the running API
  (valid transitions, illegal transitions, invalid status strings, 404s
  after delete).
- Concurrency: two requests fired at the same job at once (`Promise.all`
  against two parallel `fetch` calls) confirmed exactly one request wins
  and the other is rejected rather than both silently applying.
- Idempotency: repeating a `POST /jobs` with the same `Idempotency-Key`
  confirmed to return the original job, not a duplicate.
- `tsc -b` (frontend) and `nest build` (backend) both clean; `npm run lint`
  clean on the frontend.
