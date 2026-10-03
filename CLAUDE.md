# CLAUDE.md — Rules for building Holocast (Phase 1)

You are implementing **Phase 1** of Holocast and the `@shivam-dhyani/unified-storage` package.

## Read first, every session
1. `docs/PRD.md` — what to build (requirement IDs `FR-*`, `NFR-*`; tests `T-*`; manual questions `MQ-*`).
2. `docs/TDD.md` — how to build it (architecture, schema, APIs, Lab, milestones §16, unknowns §17).
3. `docs/IMPLEMENTATION_NOTES.md` — decisions and deviations recorded so far (create it if missing).

## Hard rules
1. **Phase 1 only.** Never implement anything tagged `[P2]` or listed in PRD §3.2 / TDD §15. If something seems to need a Phase 2 feature, stop and ask.
2. **Follow the milestone order** in TDD §16. After M4, stop and tell the owner to run the Telegram tests before starting M5.
3. **Never invent APIs.** Before using any library function or option (GramJS `telegram`, `mediabunny`, `hls.js`, Prisma, BullMQ, AWS SDK, express-rate-limit, argon2, Next.js), check the installed version's types/source or official docs. The TDD describes required *behavior*; if a named API differs, implement the behavior with the real API and log the difference in `docs/IMPLEMENTATION_NOTES.md`.
4. **Unknowns (TDD §17) must stay swappable.** Code that depends on an unknown goes behind an interface (e.g., `BotEventSource`, channel access resolution, frame acquisition). Do not hard-code one guess.
5. **Never weaken security to make something work:** no secrets in code, logs, client bundles or the DB; no storing Telegram user sessions in Holocast; no caching PASSWORD/PRIVATE videos in R2; no cascade deletes on storage-related tables.
6. **Free tier only.** Do not add any paid service or dependency that requires payment.
7. **Thresholds** live only in `apps/api/src/lab/thresholds.ts` and must equal PRD §9. A unit test enforces that every PRD §9 test ID exists there.
8. **Stop and ask the owner** when: a requirement conflicts with another; a library cannot do what the TDD requires (especially Mediabunny fragmented output, TDD §10.4); a step needs credentials or a manual action (TDD §4); or a change would alter a public API contract in `packages/shared`.

## Engineering standards
- TypeScript `strict`, ESLint + Prettier, zod validation at every API boundary, shared contracts in `packages/shared`.
- Telegram IDs: `BigInt` in DB, strings in JSON.
- Tests: vitest (unit), supertest (API integration). Every `FR-*` implemented gets at least one test where testable.
- Small commits with clear messages referencing IDs, e.g. `feat(ingest): segment PUT idempotency (FR-REC-06)`.
- Keep `docs/VERSIONS.md` updated with exact dependency versions.

## Definition of done for Phase 1
All milestones M0–M8 done, the app works end-to-end on the production domain, the Lab lists every PRD §9 test, and the owner can export `PHASE1_RESULTS.md`. Then the owner runs the protocol (TDD §13.3) — M9.
