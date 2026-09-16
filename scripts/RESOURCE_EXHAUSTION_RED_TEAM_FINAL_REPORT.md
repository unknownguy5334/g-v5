# Resource Exhaustion Red-Team Audit — Domain 21

**Source of truth:** latest supplied `gadwal-api-discovery-rate-limits-redteam-fixed.zip`.

## Scope

**Audit domain:** huge JSON, strings, arrays, files/images, OCR input and Gemini calls, optimizer search, concurrency/CPU/memory/DB connections/storage, slow requests, timeout abuse, retry storms, queues, exports, response sizes, and any disproportionate server/provider resource consumption. The review also followed connected authentication, authorization, IDOR/BOLA, input-validation, upload, injection, SSRF, CORS/CSRF, admin, and rate-limit paths when they materially affected resource consumption.

**Final archive working-tree count before packaging:** 289 regular files. All 289 final files were byte-read on the last pass. The source-of-truth archive contributed 287 files; this audit added the Domain 21 regression gate and this report.

## Files fully read

Every file in the final working tree was fully byte-read. The following files were classified as directly/materially related to Domain 21 and were re-read explicitly during the final pass:

- server.ts
- server/config.ts
- server/db.ts
- server/accountMaintenance.ts
- server/accountRoutes.ts
- server/optimizerRoutes.ts
- server/paymentRoutes.ts
- server/profileRoutes.ts
- server/healthRoutes.ts
- server/ocrExtractionService.ts
- server/ocrModelFallback.ts
- server/persistentRateLimiter.ts
- server/rateLimitMiddleware.ts
- server/upstream.ts
- server/requestSecurity.ts
- server/services/accountService.ts
- server/services/accessService.ts
- server/services/courseService.ts
- server/services/paymentService.ts
- server/services/scheduleService.ts
- server/services/notificationService.ts
- server/optimizer/optimizer.ts
- server/optimizer/optimizerCore.ts
- src/utils/ocrApiContract.ts
- src/utils/ocrExtractionCore.ts
- src/utils/optimizer.ts
- src/utils/optimizerWorkerClient.ts
- src/utils/imageOptimizer.ts
- src/utils/imageOptimizationPolicy.ts
- src/utils/imageFileAnalysis.ts
- src/utils/persistenceQueue.ts
- src/utils/persistenceValidation.ts
- src/utils/export.ts
- src/utils/exportCalendar.ts
- src/components/StepAddCourses.tsx
- src/components/StepResults.tsx
- src/components/AccountCenter.tsx
- src/components/UpgradeModal.tsx
- scripts/test-resource-exhaustion-redteam-21.mjs
- scripts/test-rate-limits-redteam-16.mjs
- scripts/test-resilience-audit-4.mjs
- scripts/test-file-upload-redteam.mjs
- scripts/test-injection-redteam-15.mjs
- scripts/test-input-validation-redteam-13.mjs
- scripts/test-admin-surfaces-redteam.mjs
- scripts/test-idor-bola-redteam-12.mjs
- scripts/test-authorization-redteam-11.mjs
- scripts/test-ssrf-redteam-17.mjs
- package.json

All remaining files, including documentation, migrations, generated fixtures, configuration, deployment scripts, tests, and assets, were also byte-read in full as part of the final 289-file pass.

## Findings

### F-21-01 — Unbounded account-deletion maintenance batch

**Severity:** HIGH  
**Status:** FIXED  
**Classification:** observed resource-amplification defect.

**Location:** `server/accountMaintenance.ts`, `purgeDueDeletedAccounts()`.

**Evidence:** the source-of-truth implementation selected every due deletion row into one in-memory result set and then processed every row inside a single transaction.

**Impact:** accumulated expired/deletion-ready accounts could cause large result sets, prolonged transaction time, lock duration, memory use, and a large burst of tombstone inserts/deletes in one maintenance invocation.

**Abuse scenario:** an attacker creates many accounts and schedules deletion, or operational backlog accumulates. The hourly maintenance process then attempts to process the entire backlog at once, consuming DB connections and CPU for an extended transaction.

**Fix:** changed maintenance to process at most 100 due accounts per invocation, ordered by due time, insert tombstones for that batch, and delete only the selected IDs.

**Post-fix verification:** reopened `server/accountMaintenance.ts`; bounded `LIMIT 100` and ID-targeted deletion are present. Domain 21 regression check passed.

### F-21-02 — Unbounded payment-submission history in account/admin overview queries

**Severity:** MEDIUM  
**Status:** FIXED  
**Classification:** observed response/DB growth risk.

**Location:** `server/services/paymentService.ts`, `getStudentSubmissions()`.

**Evidence:** the query selected a student's complete payment-submission history without a row limit. This function is used by account overview/export and admin student detail, so the same unbounded data set could be repeatedly materialized through high-level endpoints.

**Impact:** long-lived accounts could accumulate large rows and inflate DB transfer, heap use, JSON response size, and downstream serialization cost.

**Abuse scenario:** repeatedly create valid payment submissions or exploit normal lifecycle retries to grow submission history, then repeatedly load the account overview/export or admin detail to force repeated large materializations.

**Fix:** added `LIMIT 100` to `getStudentSubmissions()`.

**Post-fix verification:** reopened the function and confirmed the limit; Domain 21 regression gate passed.

### F-21-03 — Account overview/course-set/notification reads lacked endpoint throttles

**Severity:** MEDIUM  
**Status:** FIXED  
**Classification:** observed request amplification risk, connected to Domain 16.

**Location:** `server/accountRoutes.ts`.

**Evidence:** `/api/account/overview`, `/api/account/course-sets`, and `/api/account/notifications` required authentication but had no endpoint-specific persistent request limit. `getAccountOverview()` executes multiple DB/provider-backed operations concurrently.

**Impact:** a valid session could repeatedly trigger expensive multi-query account reads, multiplying DB work without the protections applied to exports and writes.

**Abuse scenario:** a compromised or automated authenticated session loops the overview endpoint, causing roughly a fan-out of multiple queries per HTTP request and consuming DB pool capacity and CPU.

**Fix:** added per-user persistent rate limits: overview 30/min, course sets 30/min, notifications 60/min.

**Post-fix verification:** route declarations reopened and verified; Rate Limits gate 23/23 and Domain 21 gate 26/26 passed.

### F-21-04 — Admin student directory spawned up to 500 concurrent enrichment chains

**Severity:** HIGH  
**Status:** FIXED  
**Classification:** observed DB connection/concurrency amplification defect.

**Location:** `server/services/accountService.ts`, `getAdminStudentDirectory()`.

**Evidence:** the source-of-truth implementation did `Promise.all(filtered.map(...))` across as many as 500 students, with each student performing multiple DB queries and access calculations.

**Impact:** one admin request could fan out hundreds of simultaneous DB operations, causing connection contention, queueing, CPU pressure, and latency spikes despite the bounded 500-row input list.

**Abuse scenario:** an admin session—or a compromised admin session—hits `/api/admin/students` repeatedly. Each request can fan out hundreds of operations, exhausting the per-instance DB pool and increasing Neon load.

**Fix:** replaced unrestricted `Promise.all` with an eight-worker bounded concurrency loop while retaining deterministic result order.

**Post-fix verification:** reopened `getAdminStudentDirectory()`; concurrency is capped at 8. Admin and Domain 21 regressions passed.

## Verified controls

- Standard JSON request bodies are capped at 2 MB.
- OCR JSON transport has explicit raw-size and concurrency limits.
- OCR image count, per-image bytes, aggregate bytes, dimensions, and pixels are bounded.
- OCR model execution uses global concurrency control, per-request concurrency limits, timeouts, and bounded retry attempts.
- Schedule generation has persistent rate limiting and bounded optimizer search budgets.
- Optimizer input section count is capped at 500.
- DB pool connections are bounded to 2–10 per process.
- Account exports are rate limited and contain bounded activity/schedule/course-set collections.
- Payment multipart processing is byte/part/header/file bounded.
- Provider outbound requests have timeouts and redirect controls from earlier audits.
- The persistent rate limiter fails closed when required by critical paths.
- Admin directory initial result count is bounded to 500, with bounded enrichment concurrency after this audit.

## Tests/checks run

- `node scripts/test-resource-exhaustion-redteam-21.mjs` — **26/26 PASS/VERIFIED**.
- `node scripts/test-rate-limits-redteam-16.mjs` — **23/23 PASS/VERIFIED**.
- `node scripts/test-cors-csrf-redteam.mjs` — **24/24 PASS/VERIFIED**.
- `node scripts/test-file-upload-redteam.mjs` — **22/22 PASS/VERIFIED**.
- `node scripts/test-injection-redteam-15.mjs` — **13/13 PASS/VERIFIED**.
- `node scripts/test-idor-bola-redteam-12.mjs` — **23/23 PASS/VERIFIED**.
- `node scripts/test-input-validation-redteam-13.mjs` — **15/15 PASS/VERIFIED**.
- `node scripts/test-admin-surfaces-redteam.mjs` — **30/30 PASS/VERIFIED**.
- `node scripts/test-authorization-redteam-11.mjs` — **28/28 PASS/VERIFIED**.
- `node scripts/test-ssrf-redteam-17.mjs` — **20/20 PASS/VERIFIED**.
- `node scripts/test-resilience-audit-4.mjs` — **19/19 PASS/VERIFIED**.
- Final JavaScript syntax checks on all JS/MJS/CJS files — **PASS/VERIFIED**.
- Security/source scans — **PASS/VERIFIED**.
- Final archive extraction test — **PASS/VERIFIED**.
- Final 289-file byte/hash comparison — **PASS/VERIFIED**.

## Cross-file findings

1. `accountRoutes.ts` → `accountService.ts` → `paymentService.ts`: one authenticated overview request fan-out was amplified by an uncapped payment-history query; both the endpoint and data set are now bounded.
2. `accountRoutes.ts` → `accountService.ts` → `savedSchedules` / `savedCourses` / `getAccessState`: the admin directory previously converted a 500-row page into hundreds of concurrent DB operations; concurrency is now capped at eight workers.
3. `accountMaintenance.ts` → `students` / `account_deletion_tombstones`: deletion backlogs previously became one large transaction; the maintenance unit is now bounded to 100 records.
4. Domain 16 rate limiting + Domain 21 resource controls are intentionally layered: request frequency is capped, while each request also has bounded body size, row count, provider calls, and concurrency.

## Unresolved / environment-limited

### WARN — Fixed-window boundary bursting

The existing persistent limiter uses a fixed window. A caller can make traffic near both sides of a window boundary and achieve a burst greater than the nominal per-window number. This is an architectural throttling characteristic rather than a newly observed unbounded-resource defect. A sliding/token-bucket limiter would reduce boundary bursts.

### ENVIRONMENT-LIMITED — Live load/concurrency testing

No live production/staging server, Neon database session, reverse proxy, or external load generator was supplied. Therefore this pass could not conclusively measure real connection-pool saturation, memory high-water marks, GC pressure, provider quotas, Cloud Run concurrency behavior, or queue latency under sustained parallel traffic.

### ENVIRONMENT-LIMITED — Full dependency-backed typecheck/build

The supplied archive does not contain an installed dependency tree. Static syntax/security checks were run, but a complete dependency-backed TypeScript typecheck and production build could not be executed in this environment.

## Final conclusion

The Domain 21 review found and fixed four concrete resource-amplification defects. The remaining resource-exhaustion items are explicitly classified as `WARN` or `ENVIRONMENT-LIMITED`; no additional confirmed defect was found during the final source-level pass.
