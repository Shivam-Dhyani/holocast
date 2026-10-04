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

## M5 recorder — Mediabunny verification (CLAUDE.md rule 3/8)

Verified mediabunny **1.61.0** against the TDD §10.4 requirement before coding:
- **Fragmented MP4 is supported**: `new Mp4OutputFormat({ fastStart: 'fragmented',
  minimumFragmentDuration: 4 })` writes fMP4 monotonically, with `onFtyp`/`onMoov`
  (init) and `onMoof` (per-fragment, with start timestamp) callbacks. Rule-8 gate
  passes — no need to stop/ask.
- **Keyframe-aligned ~4 s fragments**: `VideoEncodingConfig.keyFrameInterval` (s)
  set to 4 so fragments start on keyframes.
- **Frame acquisition (U-05/U-06)**: `MediaStreamVideoTrackSource(track, cfg, {
  frameRate: 30 })` samples the MediaStreamTrack itself (not the page rAF) — the
  TDD's preferred path for background-tab recording. `MediaStreamAudioTrackSource`
  for audio. Both exposed behind our own `FrameSource` seam so an alternative
  (MediaStreamTrackProcessor) can be swapped if a browser needs it.
- **Streaming to the segmenter**: `AppendOnlyStreamTarget(new WritableStream<
  Uint8Array>({ write }))` delivers ordered bytes to our box-parsing segmenter
  (TDD §10.5), keeping the segmenter library-agnostic.
- Codec support probed with mediabunny `canEncodeVideo('avc')` /
  `canEncodeAudio('aac'|'opus')` plus WebCodecs `VideoEncoder.isConfigSupported`.

## M6 ingest / packer

- **BullMQ 6.3** over local Redis; queues (`pack-upload`, `finalize`, + M7 stubs)
  are lazily constructed with dedicated `maxRetriesPerRequest: null` connections so
  the API boots without Redis (health).
- **argon2id via `@node-rs/argon2`** (prebuilt binaries, no node-gyp) rather than the
  `argon2` package, to avoid a native build in the container. Same algorithm the TDD
  names (FR-SHR-05); used at video-creation time for PASSWORD links.
- **Segment PUT** uses `express.raw({type:'application/octet-stream', limit:'8mb'})`
  per route (init capped to 1 MB logically); global `express.json` ignores octet
  streams. Idempotent by sha256; spool writes are temp-then-rename (atomic).
- **finalize job** long-polls (5 s, cap 24 h) for segments then packs then sets
  READY, as TDD §11.3 specifies; it runs in the worker (concurrency 2).
- Pack-upload maps `ACCESS_LOST` → Pack FAILED + channel ERROR (spool kept);
  other errors (FLOOD_WAIT) rethrow for BullMQ retry.

## Unknowns kept behind interfaces (TDD §17)
- `BotEventSource` (U-03): botapi vs mtproto membership events — selected by
  `BOT_EVENT_SOURCE`.
- Channel access resolution (U-04): in the unified-storage Telegram backend.
- Frame acquisition (U-05/06): recorder, built in M5.

## M8c — browser Lab runners (`apps/web/lib/lab/`)
- **First-frame timing** uses `HTMLVideoElement.requestVideoFrameCallback` where the
  browser exposes it (recorded in the submission as `frameMethod`), falling back to the
  `playing` / `seeked` events (Firefox lacks rVFC). This matches TDD §9.4's "record
  which" note for T-PLY-01/03.
- **Per-browser tests (T-PLY-04, T-INF-05)** whose threshold needs all four browsers
  are accumulated client-side: before submitting, the runner reads the latest run's
  `browsersOk` via `GET /api/lab/runs?testId=` and submits the union with the current
  browser. The Nth browser's submission therefore carries the full set and evaluates
  PASS — no change to the stateless `/api/lab/results` evaluator was needed.
- **FR-LAB-05 admin stats submit** is driven by `?lab=<T-REC-id>` on `/record` (set by
  the Lab's guided-recording buttons). On finalize the recorder maps §10.8 stats to the
  test's metric keys and POSTs to `/api/lab/results`; the endpoint rejects non-admins, so
  `submitLabResult` swallows 401/403 and it is a silent no-op for ordinary users.
- **Honest gaps:** `maxEncoderQueue` (T-REC-04) and per-frame `maxFrozenMs` (T-REC-05)
  are only emitted when Mediabunny exposes a real sample (it does not in 1.61.0 — see the
  M5 note); T-REC-05 falls back to the longest hidden→visible span from the visibility
  timeline as a documented proxy. A missing sample makes the threshold FAIL rather than
  pass on a fabricated value.

Last updated: 2026-10-04
