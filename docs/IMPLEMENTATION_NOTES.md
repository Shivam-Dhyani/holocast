# Holocast — implementation notes & deviations

Decisions and deviations from PRD/TDD, recorded per CLAUDE.md. Newest at the bottom
of each section.

## Toolchain / monorepo

- **pnpm monorepo** (D-13): `apps/web` (Next.js), `apps/api` (Express + worker),
  `packages/shared` (zod contracts). `@shivam-dhyani/unified-storage` is a **separate
  repo**; during development it's linked via `link:../unified-storage` (sibling dir),
  and on the VM the published alpha is used (TDD §5.2).
- **TypeScript pinned to 5.9.3** across the monorepo — npm `latest` is the 7.x native
  port which current build tooling (tsup/rollup-plugin-dts, and others) doesn't yet
  support. Same reasoning as the package repo.

## API / behavior deviations
(none yet — M2 skeleton)

## Unknowns kept behind interfaces (TDD §17)
- `BotEventSource` (U-03): botapi vs mtproto membership events — selected by
  `BOT_EVENT_SOURCE`.
- Channel access resolution (U-04): in the unified-storage Telegram backend.
- Frame acquisition (U-05/06): recorder, built in M5.

Last updated: 2026-10-03
