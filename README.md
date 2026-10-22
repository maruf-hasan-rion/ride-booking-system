# GoMove — Backend API

Ride-booking backend (rider → driver → admin) built with Express 5, TypeScript, MongoDB via Mongoose 9, and Zod validation. Runs on Vercel in production and connects to a MongoDB Atlas cluster.

## What actually works (verified)

- **Roles:** Rider · Driver · Admin · Super Admin (seeded from env at first boot, idempotent).
- **Auth:** email+password (Passport Local) issuing JWT access+refresh tokens in httpOnly cookies *and* response body; `POST /auth/refresh-token` exchange; Google OAuth routes (deployed-environment feature). Blocked/suspended accounts are refused at the auth middleware level.
- **Ride lifecycle (conflict-safe):** riders book pickup/destination with server-computed road fare (OpenRouteService directions, 100 BDT/km). Drivers view pending requests, accept atomically (`concurrent accepts → one winner + 409`), reject without stealing the ride (ride stays pending for others and the rejecting driver is excluded), and advance `ACCEPTED → PICKED_UP → IN_TRANSIT → ARRIVED → COMPLETED` (skip/repeat → 400/409). Rider cancellation is allowed **until pickup** (`REQUESTED`/`ACCEPTED`), and unaccepted requests expire after **15 minutes** (`cancelReason: NO_DRIVER`) releasing the rider to book again.
- **Stats:** admin system stats, driver earnings (daily/weekly/monthly) and rider report — earned amounts are derived from collected fares (there is no payments module yet; the split convention exists as `driverIncome = fare`).
- **Reliability:** request bodies validated with Zod (auth, OTP, rides, profiles); login/OTP/ride-request rate limiters; helmet; consistent error envelope (`success/message/errorSources`); unconditional 5xx never leak `stack` in production.
- **Testing:** Vitest + `mongodb-memory-server` replica set with **real OpenRouteService** calls — 21 tests covering the whole state machine, both races, ownership/authorization, expiry and validation. `npm test`.

## Requirements

- Node.js ≥ 20.19
- npm
- MongoDB connection string (Atlas or local replica set for transactions)
- (optional) Redis + SMTP for OTP emails, Google credentials for OAuth, an OpenRouteService key — the booking flow requires ORS; everything else degrades gracefully.

## Local setup

```bash
npm install
npm run seed      # creates admin/rider/driver demo accounts + sample rides through REAL service flows
npm run dev       # starts on http://localhost:5000
```

.env.example documents every variable; copy it to `.env` and fill values (real credentials stay local, never committed).

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | `ts-node-dev` watch mode |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | run built server (Vercel target) |
| `npm test` | Vitest suite (real ORS, in-memory Mongo) |
| `npm run seed` | idempotent seed via service layer (admin/rider/driver + completed/cancelled rides) |
| `npm run lint` | eslint over `src` |

## API (base `/api/v1`)

| Group | Route | Role(s) | Notes |
|---|---|---|---|
| auth | `POST /auth/login`, `/logout`, `/refresh-token`, `/change-password` | any | Zod-validated; rate-limited login |
| auth | `GET /auth/google`, `/auth/google/callback` | — | deployed OAuth only |
| otp | `POST /otp/send`, `/otp/verify` | — | Redis TTL 2 min, throttled |
| user | `POST /user/register`, `GET /user/me`, `PATCH /user/:id` | public/self | one-time role choice (RIDER/DRIVER) |
| user | `GET /user`, `PATCH /user/block/:id`, `/unblock/:id` | admin+ | paginated, filtered |
| ride | `POST /ride/request` | rider | server computes distance+fare |
| ride | `GET /ride/latest-ride`, `/my-ride/:id`, `/all-my-rides`, `/me` | rider | status tracking/history |
| ride | `PATCH /ride/cancel/:id` | rider | until pickup (`BY_RIDER`) |
| ride | `GET /ride/single-ride/:id`, `/all-rides-admin` | admin | db-level pagination/search |
| driver | `POST/PATCH /driver/profile`, `GET /driver/profile/me` | driver | vehicle info gate |
| driver | `PATCH /driver/status` | driver | online toggle (needs approval) |
| driver | `GET /driver/incoming-requests`, `/driver/active-ride` | driver | live queue + own active ride |
| driver | `PATCH /driver/:id/accept`, `/:id/reject`, `/:id/status` | driver | atomic claims + transition map |
| driver | `GET /driver/earnings/me` | driver | completed fares |
| stats | `GET /stats/earning-history` | admin | rides + earned money (fare-derived) |
| stats | `GET /stats/my-earning-history`, `/my-all-ride-history` | driver/rider | scoped reports |

## Ride state machine

```
REQUESTED ──accept──> ACCEPTED ──> PICKED_UP ──> IN_TRANSIT ──> ARRIVED ──> COMPLETED
    │  cancel (rider, until pickup)                         (no moves are allowed
    ├──> CANCELLED  (BY_RIDER)                               out of terminal states)
    └──(15 min TTL, no driver)──> CANCELLED (NO_DRIVER)
REJECTED rides keep status REQUESTED; the rejecting driver is excluded only.
```

## Structure

```text
src/
  app/
    config/          env, passport, redis
    middlewares/     checkAuth (JWT+roles), validateRequest (Zod), rateLimiter,
                     globalErrorHandler, notFound
    modules/
      ride/          constants, model, validation, service, controller, route
      driver/ driver authoring, gating, ride actions
      user/ admin/ auth/ otp/ stats/
    validation/      common field schemas shared by modules
    routes/ index mounts every module under /api/v1
    utils/           fareCalculator (ORS), QueryBuilder, cookies, tokens, email
  scripts/           seed.ts (service-level seed)
  server.ts          connection, super-admin seed, graceful shutdown
tests/               vitest suites (replica set + real ORS)
```

Known limitations: no payments module (fares settle off-platform), no websockets (5 s polling), same-driver double-accept across two different rides is best-effort guarded. See `../DEPLOYMENT.md` for deployment details and `../ENGINEERING_DECISIONS.md` for the reasoning behind these gloves-off choices.
