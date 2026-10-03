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
- **Prisma pinned to 6.19.3** (CLI + `@prisma/client`). npm `latest` resolves the
  `prisma` CLI to an 8.0.0-rc and `@prisma/client` to 7.x — a mismatched, bleeding-edge
  pair, and Prisma 7+ overhauls the generator the TDD schema uses
  (`provider = "prisma-client-js"`, default client output). 6.19.3 is the latest stable
  line matching the TDD. Revisit when 7/8 are stable and the schema is migrated.
- **Next.js 16.3 / React 19.3** for `apps/web`; **Express 5.2** for `apps/api`.
- `pnpm -r build` order: `@holocast/shared` builds before `apps/api` (workspace dep);
  `@shivam-dhyani/unified-storage` is linked from the sibling repo and pre-built.

## API / behavior deviations
(none yet — M2 skeleton)

## Unknowns kept behind interfaces (TDD §17)
- `BotEventSource` (U-03): botapi vs mtproto membership events — selected by
  `BOT_EVENT_SOURCE`.
- Channel access resolution (U-04): in the unified-storage Telegram backend.
- Frame acquisition (U-05/06): recorder, built in M5.

Last updated: 2026-10-03
