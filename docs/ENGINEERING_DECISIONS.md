# ENGINEERING_DECISIONS.md — GoMove

Each decision follows the same shape: problem → approach → alternatives → why this won → trade-offs → how it is tested → likely interview questions. Facts cite files; verification results come from the recorded runs in `DEPLOYMENT.md`.

---

## 1. Atomic ride claims with conditional updates (not hope-based transactions)

**Problem.** The original accept/cancel/status flows did read-check-then-write (`findById` → mutate → `save`). Two drivers accepting the same ride, or a rider cancelling while a driver accepts, could both "succeed" — the read window corrupts state, and a transaction alone does not fix it (two transactions touching different documents serialize fine; both can pass the same check).

**Approach.** Every claim carries its precondition *inside the update filter*: `Ride.findOneAndUpdate({ _id, status: REQUESTED, rejectedBy: { $ne: profileId } }, { $set: {...} }, { returnDocument: "after", session })` (`driver.service.ts` accept, `ride.service.ts` cancel, `driver.service.ts` status transitions). Losing a claim yields `null` → a precise error (409 for contention, 400 for invalid state) — never silent mutation.

**Alternatives.**
- *Optimistic concurrency with `__v`*: works, but error semantics were vague (version conflict ≠ status conflict) and we already own the state enum.
- *Distributed lock (Redis)*: new infra for a problem Mongo solves natively.
- *Superset-always-write + reconcile*: worst option.

**Trade-offs / limitations.** Rapid transactions targeting the same documents can hit a MongoDB write-conflict; lifecycle writes share `withTransaction`, which retries only `TransientTransactionError` and otherwise returns a clean conflict. The same-driver case is serialized through a conditional `Driver.activeRideId` claim: two different rides write the same driver document, so only one claim can commit and the loser receives 409. A legacy active ride without the lock is still caught by the `Ride.exists` fallback.

**Tested.** `tests/ride-lifecycle.test.ts`: `Promise.all` of two accepts → exactly `[200, 409]`; cancel-vs-accept race → one of the pair wins, the other produces the precise conflict; full state walk (skip/repeat rejected), driver of another ride blocked, profile-gate, active-ride guard, same-driver two-ride lock, driver/admin cancellation, idempotent booking. The lifecycle suite runs offline with the deterministic fare provider; the full backend suite is **46/46 passed, 1 live-ORS smoke skipped**.

**Interview Q&A.**
- *Why not just serializable transactions?* MongoDB provides snapshot isolation with write-conflict retry; conditional filters make correctness local to one document and cheaper than escalations.
- *What happens under two concurrent accepts?* One conditional update matches; the loser's filter no longer matches → 409 with a user-facing reason; the DB never stores two assignments.

---

## 2. The server is the only price-setting authority (fail-closed fare)

**Problem.** `fareCalculator` swallowed OpenRouteService failures and returned `{distanceKm: 0, fare: 0}` — a bookable ride with zero fare; coordinates were just `z.tuple([number, number])` (no ranges), and the client could send its own fare fields.

**Approach.** Coordinates validated ([lng∈-180..180, lat∈-90..90], identical pickup/destination rejected in `ride.validation.ts` via a shared `validation/common.ts` geo schema); the calculator *throws* on any provider failure (`AppError 503`) and the booking transaction aborts — no document is created. The client's `distanceKm/fare` fields are no longer sent at all (contract cleanup); the client-side estimate is UX-only.

**Alternatives.** Haversine fallback (dishonest: straight line ≠ road); caching provider responses (worthwhile later; adds staleness concerns now). Keeping client-computed fares was rejected categorically: money belongs to the server.

**Trade-offs.** A working ORS key becomes a *functional dependency* for booking (documented; 503 tells the user to retry) versus silent corrupt data.

**Tested.** `ride-lifecycle.test.ts` uses the deterministic fare provider and asserts `fare = distance × 100`; `tests/live-ors.test.ts` is the opt-in real-provider smoke test. The provider-failure path is isolated in `tests/fare-failure.test.ts` with a throwing provider fake — no ride persists (`count 0`).

**Interview Q&A.**
- *Why fail closed?* A zero-fare ride is worse than a retryable 503: it looks operational while destroying revenue.
- *Why no haversine fallback?* Because we cannot honestly present wet-road kilometers for straight-line distance without labeling it; the demo prefers truthful failure.

---

## 3. Cancellation & expiry policy (business rules, not technical hacks)

**Problem.** Riders could only cancel while `REQUESTED`; after a driver accepted they were stuck (the double-booking guard blocked new rides indefinitely). Every ride lived forever waiting for a driver.

**Approach (owner decisions).** Rider may cancel `REQUESTED`/`ACCEPTED` until pickup (`BY_RIDER`); the assigned driver may cancel an `ACCEPTED` ride before pickup (`BY_DRIVER`); an admin may cancel any non-terminal ride with a required reason (`BY_ADMIN`). Cancellation releases the rider to `IDLE`, clears the driver's `activeRideId` lock, and records `cancelledBy`/`cancelNote`. There is no cancellation fee in this MVP. Orphaned requests expire lazily after 15 min (`NO_DRIVER`) — scanned *before* booking/listing/accepting flows so no cron infrastructure is needed.

**Alternatives.** Mongo TTL index (fires deletes/updates in the background but interacts poorly with the state machine and observability); cron (new infra for M0); automatic no-show timers (policy complexity without payments).

**Tested.** Expired ride disappears from the driver queue, becomes `CANCELLED/NO_DRIVER` with `cancelledAt`, and the rider can book again; cancel after pickup rejected; driver cancel before pickup frees both parties; admin cancel of an in-progress ride releases the rider and driver lock; a terminal retry is rejected.

**Interview Q&A.** *Why lazy expiry?* Determinism with zero moving parts: the scan costs an indexed query per ride action, and expiry can never fight a live accept (the claim filter still requires status REQUESTED).

---

## 4. Query pushdown: no more in-memory dataset scans

**Problem.** The admin ride list fetched **the entire collection**, built concatenated strings per row and paginated in JS; driver incoming requests paginated first and filtered *after* `skip/limit` (wrong totals when searching); `QueryBuilder` was used by exactly one endpoint; list endpoints disagreed about default page size and `totalPage` empties.

**Approach.** Admin list and incoming requests became Mongo `$lookup` + `$facet` pipelines (rider/driver text and `_id` matching in the DB, `count` for meta); `GET /user` switched to `QueryBuilder` with filter-aware `getMeta` (it now counts with `getFilter()` and clamps `totalPage ≥ 1`); the frontend deduplicates glue via `useListQueryState(clampTo…)` and shares fare-range/status options.

**Alternatives.** Text indexes on denormalized names (denormalization cost + sync complexity); leaving as is (documented as O(N) tech debt).

**Tested.** Backend admin test asserts server-side pagination of a filtered search (`status=COMPLETED`, single row + `meta.total=1` with populated rider fields). Behavior parity covered by the rest of the suite.

**Interview Q&A.** *Why `search` spans populated fields now?* Because admin search is a lookup problem; `$lookup`+`$facet` keeps one round-trip and correct totals.

---

## 5. One session gate, one toast flow, one role map (deduplication with intent)

**Problem.** The audit counted: 6 copy-pasted copies (+1 divergent variant) of user-status normalization; **18** repeated `try { unwrap() } catch { toast(getApiErrorMessage) }` handlers; **8** role→path maps across 5 files; 4 distinct polling intervals at 8 sites; 3 bespoke full-screen loaders, 3 stat-card implementations, 2 fare-filter widgets and 3 handwritten `statusOptions` while enum arrays sat unused.

**Approach.** Small, named abstractions — no layers: `useAccount()` (session + blocked/suspended resolution), `useToastAction()` (unwrap + success/failure toasts), `constants/paths.ts` (`getPathByRole`), `constants/polling.ts`, shared `DataStateView`/`StatCard`(AnalyticsStatCard)/`FareRangeInputs`/`RIDE_STATUS_FILTER_OPTIONS` and shared ride semantics (`types/ride.ts`: coordinate/driver readers + status sets consumed by rider and driver flows).

**Alternatives.** Leaving per-file improvements (keeps the 1-off bugs — e.g. `MyRideDetails` reading a `vehicle` object shape the backend doesn't store); a full feature-folder refactor (rejecting: violates "no unnecessary architecture").

**Tested.** Best-value unit suites target these exact surfaces: `types/ride.test.ts` (shape derivation, malformed polls), `paths.test.ts` (routing + fallback), `StatusBadge.test.tsx` (token classes, no dark-variant forks), `apiResponse.test.ts` (double envelope), `rideStats.test.ts` (period buckets), `DataStateView.test.tsx` (error/retry). FE suite: **28/28**.

**Interview Q&A.** *Why hook-per-concern instead of a `useAuth` context?* RTK Query already caches identity; context would add a parallel state source to reconcile. Hooks compose; singletons freeze the architecture.

---

## 6. Design tokens: one brand, both modes (no redesign)

**Problem.** Three competing brand hues (light `--primary` green-500, dark emerald-500, gradients emerald→teal), a `default2` button variant hardcoding `bg-emerald-500` as the *default* variant, `hsl(var(--chart-N))` wrapping oklch values (invalid CSS ×7), ~375 hardcoded color classes concentrated in marketing pages, `StatusBadge` with 0 dark variants on every table.

**Approach.** One emerald `oklch(0.696 0.17 162.48)` for light+dark primary/ring/sidebar/charts; token chips for statuses (`/10` fill, `/25` border — contrast holds in both modes without `dark:` forks); a graded `--brand-*` ramp; `button.tsx` pruned; recorded script migrated 149 utility classes across hotspots onto tokens; loaders/polyline/chart colors go through `var(--primary)`/chart tokens. No layout changes.

**Alternatives.** Full redesign + new palette (rejected: violates "preserve visual identity"); leaving hex remapping per-touch (keeps drift).

**Tested.** Build + lint green after each batch; `StatusBadge.test.tsx` forbids `bg-emerald` remnants and asserts token classes; chart wiring fixed via recorded replacement pass (7 invalid + 4 hex + loader tokenized).

**Interview Q&A.** *Why oklch?* Perceptual lightness makes token-contrast math (primary/10 vs token) predictable across the ramp — the reason the same numbers work in dark mode.

---

## 7. Mongoose 8 → 9 with a plan, not hope

**Problem.** Mongoose 8.x support ended Feb 2026. Upgrade touches `new: true` deprecation, stricter `QueryFilter` typing and model recompile semantics.

**Approach.** Migration review first (official guide), then: 7 update sites → `returnDocument: "after"`; `countDocuments` enums via the `Role` enum; model exports guarded (`models.X ?? model(...)`); typed provider predicates where the stricter inference surfaced implicit `any`.

**Trade-offs.** None risky: deprecation warnings would have surfaced at runtime on Vercel otherwise.

**Tested.** Full 21-test suite + `tsc` after each step (results in DEPLOYMENT.md).

---

## 8. Real data over mocks (only simulated where the real thing is impossible)

**Approach.** Tests run against an in-memory *replica set* (transaction semantics ≈ Atlas), while fare calculation goes through `utils/fareProvider.ts`. The lifecycle suite replaces that provider with a deterministic fake (5.2 km / 520 BDT), so the core state machine runs offline; a separate `tests/live-ors.test.ts` smoke test is opt-in via `RUN_LIVE_ORS=true`. User fixtures use real bcrypt hashes and authority flow; the `seed` script books/cancels rides through the same service functions the HTTP layer calls (`src/scripts/seed.ts`). Fault injection is a second provider fake in `fare-failure.test.ts`.

**Alternatives.** Calling real ORS in every test run (rejected: quota/network flakiness, CI failure); fake metrics/arrays (the "demo data everywhere" pattern — rejected); mocking MongoDB (rejected: transaction/race behavior is the point).

**Tested.** The default suite is **46 passed, 1 skipped, 0 failed**; the skipped test is the live-ORS smoke. `ride-lifecycle.test.ts` asserts `fare = distance × 100` using the deterministic provider. Seed is verified for compilation and its first run is intentionally left to the owner (it writes to the real DB).

---

## 9. Package manager, testing and import-map decisions

- **npm only.** Both lockfiles existed in the FE (bun.lock + package-lock.json). npm won: the backend already teams on npm, Vercel builds from npm lockfiles comfortably, less new tooling on Windows, single lockfile per repo. (Owner asked "which works better" — npm for this project; bun remains a viable swap later.)
- **Vitest pinned to v3** after an honest v5 compatibility spike on this machine/runtime (documented in the conversation + prerequisites note).
- **No monorepo.** Two repos with a *documented contract* (`response envelope`, endpoint tables in both READMEs) beat a workspace for a portfolio this size; `utils/apiResponse.ts` centralizes envelope parsing so future consolidation is cheap.

---

## 10. Scope honesty (what was said "no" to)

- **AI feature skipped** after evaluation (no concrete user problem for an optional LLM dependency in a ride-flow product; decision recorded in the plan).
- No payments module (fares settle off-platform; UI says so), no websockets (polling is correct for this scale), no vehicle categories or surge pricing, no address geocoding (map-only destinations). Each is listed as a *known limitation*, not hidden.

---

## Final verification record (at the time of writing)

| Repo | Command | Result |
|---|---|---|
| backend | `npm run build` | ✅ |
| backend | `npm run lint` | ✅ 0 errors, 2 intentional console warnings |
| backend | `npm test` | ✅ 46/46 passed, 1 opt-in live-ORS test skipped (deterministic fare provider, replica set) |
| frontend | `npm run build` | ✅ (~8 s) |
| frontend | `npm run lint` | ✅ 0 errors |
| frontend | `npx vitest run` | ✅ 28/28 |

Outstanding owner actions: rotate/delete the deployed seed admin and any potentially-leaked secrets; rename Vercel projects + update `FRONTEND_URL`/`VITE_API_URL_PROD` together; first `npm run seed` against a temporary/demo DB with `SEED_PASSWORD`/`SEED_ADMIN_PASSWORD`; browser pass of the rebranded screens for demo recording.
