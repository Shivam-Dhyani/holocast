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

- **Confirmation message & bot-leave go through the Bot API** (`sendMessage` /
  `leaveChat`), not the `unified-storage` Telegram adapter. The storage adapter is
  document-only by design; adding text-messaging to it would widen the library's
  scope. The Bot API path needs only the bot token and works for both event sources.
- **`resolveAccessHash` (U-04)** calls the storage adapter's `attachChannel`
  (`channels.getChannels` with access hash 0). If it fails the channel is marked
  ERROR and the user sees "storage disconnected" — exactly the signal T-ONB-04
  measures.
- **MTProto event source is experimental (U-03).** It runs a second bot MTProto
  connection with its own session file and parses raw `UpdateChannelParticipant`;
  the access hash and whether it coexists with the storage client are what T-ONB-03
  measures. The default is `botapi` (long-poll `my_chat_member`), which is fully
  implemented and needs no second client.
- **Playback cache invalidation on disconnect is a no-op until M7** (caches don't
  exist yet); the hook is in place.

## M4 Lab notes

- **Server tests run in-process**, not via BullMQ (which arrives in M6). The Lab
  creates a RUNNING LabRun and executes in the background; the web page polls
  `GET /api/lab/tests`. Each test builds its own metrics-instrumented encrypted
  Telegram adapter (session `lab.session`) against the admin's CONNECTED channel.
- **T-TG-06 (ref-refresh cost)** is approximated by uploading N small packs and
  timing the first read of each (first read triggers one `channels.getMessages`,
  surfaced via the `refresh_ref` metric), rather than bypassing the 10-min doc
  cache directly.
- **T-TG-07 (stale ref ≥24h)** records a single-run recovery check; the real 24h
  arm is run by the owner across two days (TDD §13.3). It is INFO either way.
- **Lab CLI token**: `POST /api/lab/results` accepts an admin session or a bearer
  equal to `LAB_CLI_TOKEN` (env). The hashed-token-in-DB flow (TDD §13.1) is
  deferred to M8 when the CLI tests (T-PLY-05, T-INF-03) are wired.
- Report export (`report.md`/`.json`) and the browser/manual Lab tabs are M8; M4
  ships the catalog + server-test run + results storage so the owner can run the
  Telegram tests and see PASS/FAIL (M4 done-when).

## Unknowns kept behind interfaces (TDD §17)
- `BotEventSource` (U-03): botapi vs mtproto membership events — selected by
  `BOT_EVENT_SOURCE`.
- Channel access resolution (U-04): in the unified-storage Telegram backend.
- Frame acquisition (U-05/06): recorder, built in M5.

Last updated: 2026-10-03
