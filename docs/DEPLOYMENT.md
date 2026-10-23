# DEPLOYMENT.md — GoMove deployment readiness

Status as of this phase. Verification is recorded; anything marked "owner action" must be done by the repository owner before production trust.

## 1. Verified quality gates

| Repo | Command | Result |
|---|---|---|
| backend | `npm run build` (`tsc`) | ✅ exit 0 |
| backend | `npm run lint` | ✅ 0 errors, 2 intentional console-logging warnings |
| backend | `npm test` (vitest) | ✅ 46/46 passed, 1 opt-in live-ORS test skipped (deterministic fare provider + in-memory Mongo replica) |
| backend | `npm run seed` | ✅ compiles; run against an owning database (additive write) |
| frontend | `npm run build` (`tsc -b && vite build`) | ✅ ~8s |
| frontend | `npm run lint` | ✅ 0 errors, 2 shadcn upstream warnings |
| frontend | `npx vitest run` | ✅ 28/28 |

## 2. Runtime configuration matrix

**Backend (Vercel, Node 20.19+ per Mongoose 9)**
| Var | Needed | Notes |
|---|---|---|
| DB_URL | yes | MongoDB Atlas — shared prod DB, never destructive ops |
| JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, JWT *_EXPIRES | yes | rotate if `.env.dev` ever held production secrets |
| BCRYPT_SALT_ROUND | yes | 10 is fine |
| SUPER_ADMIN_EMAIL/PASSWORD | yes | seeded at boot (idempotent) |
| FRONTEND_URL | yes | must match the deployed frontend origin exactly (CORS + OAuth return) |
| GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL | optional | OAuth only; deployed-only verified, not development |
| ORS_API_KEY | required for booking | route distances; free tier 2000 req/day, 2 req/s |
| SMTP_* | optional | OTP/verification emails degrade to "send failed → 503" |
| REDIS_* | optional | OTP TTL storage only; app still boots without |
| NODE_ENV, PORT, EXPRESS_SESSION_SECRET | yes | cookie mode depends on NODE_ENV=production |

**Frontend (Vercel)**
| Var | Needed | Notes |
|---|---|---|
| VITE_API_URL_PROD | yes | produced build uses it; must equal backend URL incl. `/api/v1` |
| VITE_ORS_API_KEY | nice-to-have | enables route polyline + live client estimate; ride flow works without (server computes fare) |
| VITE_ENABLE_DEMO_LOGIN + VITE_DEMO_*_EMAIL/PASSWORD | optional | recruiter demo shortcut; keep empty in a serious deployment |

**Cookies/CORS**: production cookie sets `Secure + SameSite=None` — must be served from HTTPS; CORS allow-list = `FRONTEND_URL` + localhost:5173. Changing the Vercel project names updates both origins — update `FRONTEND_URL` and `VITE_API_URL_PROD` in the same deploy.

## 3. External service requirements (honest list)

- Mongo Atlas (required), ORS (required to book; failure = 503 not a 0-fare booking), SMTP + Redis (optional, degraded-experience features), Google OAuth (deployed-only verification).
- No queues/websockets/AI required. No paid provider is bundled silently: ORS + email costs are only hit where features exist.

## 4. Deployment runbook (owner action checklist)

1. Rotate any SECRETS that may have been exposed through git history of `.env.dev` (tracked pre-rename; rotation is not code-fixable).
2. `npm run seed` against the target database creates: admin/rider/driver seed accounts + 1 completed + 1 cancelled ride through real service flows (fare from live ORS).
3. Verify the Vercel build settings use `npm run build` and `dist/server.js` (backend) and the SPA rewrite (frontend).
4. Smoke the deployed pair: register → verify → login → book (accept only after admin approves driver) — the OTP email and logout drive the cookies; confirm `FRONTEND_URL` matches.
5. `GET /` returns `{ success:false, message: "Welcome to the GoMove API" }`-style payload as a health probe.

## 5. Known operational risks

- Rate limiting is per-instance on Vercel (serverless) — approximate by design (see rateLimiter.ts).
- ORS free-tier rate (2 rps) can jitter the opt-in live smoke test; the default suite uses a deterministic fare provider and does not call ORS.
- Driver claims use the driver document's `activeRideId` lock, so two different rides cannot both be accepted by the same driver; the unique `Driver.user` index blocks duplicate profiles.
- No cancellation fees exist; a driver may cancel only before pickup, and admin cancellation is the recovery path for stuck rides.
- Completion is status/timestamp-based (no location or duration proof).
- `Driver.totalEarnings` remains unused (stats derive earnings from fares) — remove or implement with a payments module later.
- MongoDB indexes for `Driver.user` (unique) and `Ride.idempotencyKey` (unique sparse) must build successfully on deploy; check for pre-existing duplicates before the first rollout.
- Mongo EOL note: Mongoose 8.x support ended Feb 2026; we are on Mongoose 9 now.

## 6. Production deployment record (2026-10-23)

- Backend: `https://ride-booking-system-kappa.vercel.app/` — deployment Ready, `GET /` returns 200, `NODE_ENV=production`, `ORS_API_KEY` present.
- Frontend: `https://ride-booking-frontend-drab.vercel.app/` — deployment Ready, production bundle contains `https://ride-booking-system-kappa.vercel.app/api/v1`.
- CORS preflight from the frontend origin returns `Access-Control-Allow-Origin: https://ride-booking-frontend-drab.vercel.app` and `Access-Control-Allow-Credentials: true`.
- Invalid login returns 401 with `err`/`stack` null, confirming production error handling and Atlas connectivity.
- Remaining owner checks: duplicate `Driver.user` / `Ride.idempotencyKey` queries, a real OTP send, seed-admin rotation, and secret rotation.
