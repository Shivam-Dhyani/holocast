# Holocast — Technical Design Document (TDD)

| Field | Value |
|---|---|
| Covers | Holocast app (repo `holocast`) and `@shivam-dhyani/unified-storage` (repo `unified-storage`) |
| Document version | 1.0 |
| Date | 2026-10-03 |
| Status | **Phase 1: APPROVED FOR DEVELOPMENT** · **Phase 2 (§15): PROVISIONAL — will be rewritten from Phase 1 results** |
| Requirements source | `docs/PRD.md` (requirement IDs FR-*, NFR-*, test IDs T-*, MQ-*) |

---

## 1. Conventions and rules for the implementer

1. **Build Phase 1 only.** Anything tagged `[P2]` or listed in §15 MUST NOT be implemented.
2. **Never invent library APIs.** Where this document names a third-party function or option, it describes the *required behavior*. Before coding against any library (GramJS `telegram`, `mediabunny`, `hls.js`, Prisma, BullMQ, AWS SDK, etc.), the implementer MUST check the installed version's type definitions/source or official docs. If the named API does not exist or behaves differently, implement the required behavior with the real API and record the difference in `docs/IMPLEMENTATION_NOTES.md`.
3. **Unknowns are explicit.** §17 lists every technical assumption not yet proven (U-01…). Code paths that depend on an unknown MUST be isolated behind an interface so the alternative can be swapped in, and MUST be covered by the Lab test listed for that unknown.
4. **Versions:** use the latest stable release of each dependency at implementation time; Node.js = current Active LTS. Record exact versions in `docs/VERSIONS.md`.
5. **Language:** TypeScript everywhere, `strict: true`. Validation with `zod` at every API boundary.
6. **IDs:** database primary keys are UUIDv7 strings unless stated. Telegram IDs are `BigInt` in Postgres and **strings** in JSON (never JS `number`).
7. **Time:** all timestamps UTC; durations in the DB in microseconds (`Int`/`BigInt` as stated).

---

## 2. System overview

```
 Creator browser                                   Oracle Cloud VM (Always Free, ARM)
 ┌───────────────────────────────┐                ┌───────────────────────────────────────────┐
 │ Next.js UI (served by VM)     │   HTTPS        │ Caddy (TLS, reverse proxy)                │
 │ Recorder:                     │──────────────▶ │   /api/*  → Express API  (:4000)          │
 │  getDisplayMedia + mic        │                │   /*      → Next.js      (:3000)          │
 │  → Mediabunny (WebCodecs)     │                │                                           │
 │  → fMP4 init + ~4 s segments  │                │ Express API ──── Redis (local, BullMQ)    │
 │  → OPFS queue → PUT segments  │                │     │                                     │
 └───────────────────────────────┘                │     ├── Spool disk (/var/lib/holocast)    │
                                                  │     ├── Neon Postgres (remote, free)      │
 Viewer browser                                   │     └── Worker process:                   │
 ┌───────────────────────────────┐   HTTPS        │          pack upload, bot events, Lab     │
 │ /v/<shareId> page + hls.js    │──────────────▶ │                                           │
 │ playlist → signed segment URLs│                │ @shivam-dhyani/unified-storage            │
 └──────────────┬────────────────┘                │   ├─ Telegram adapter (bot, MTProto)  ────┼──▶ Creator's private channel
                │ 302 (cached public segments)    │   ├─ R2 adapter (S3 API)              ────┼──▶ Cloudflare R2 (cache)
                └────────────────────────────────▶│   └─ Encryption layer (AES-256-GCM)       │
                                                  └───────────────────────────────────────────┘
```

**Data path summary**
- **Write:** browser → `PUT /api/videos/:id/segments/:seq` → spool file → packer groups 15 segments into a pack → encryption layer → Telegram adapter uploads the pack as one document to the creator's channel → DB records `(channel, messageId)` and each segment's byte offset inside the pack.
- **Read:** player → signed segment URL → API resolves: (1) spool file if not yet packed, (2) R2 presigned redirect if cached, (3) else ranged decrypt-read from Telegram.

---

## 3. Architecture decisions (with rationale)

### 3.1 The browser does all video encoding
The free VM cannot transcode many hours of video. The browser encodes H.264 via WebCodecs (through Mediabunny) and produces fMP4 segments that HLS players accept directly. The server never decodes or re-encodes video. (Exception: T-TRN-01 uses `ffmpeg` on the VM only to extract audio for a benchmark.)

### 3.2 Storage access is through a platform bot, not user sessions
Users add the Holocast bot as an admin of their own private channel. The bot (MTProto, logged in with a bot token) uploads and reads files. Holocast stores **no user session** (FR-AUTH-07). Logout and re-login never affect storage; the stable identity anchor is the Telegram user ID.

### 3.3 Web and API on the same VM and origin (change from earlier plan)
Vercel (web) + VM (API) on a free subdomain would make the API a different *site*, so the session cookie becomes a third-party cookie (blocked by Safari and Firefox by default). Proxying the API through Vercel would push video bytes through Vercel's bandwidth limits. Therefore Next.js runs on the VM, and Caddy serves both under **one origin** (`https://<sub>.duckdns.org`). Vercel MAY be reconsidered in Phase 2 with a custom domain.

### 3.4 Neon for data, Redis for hot lookups
Neon free Postgres holds all metadata. Per-request lookups on the playback path (share → video, segment map) are cached in local Redis so playback does not wait on cross-region DB round trips. Neon latency and cold start are measured (T-INF-04).

### 3.5 R2 is a cache, never the source of truth
Telegram is the only durable store of video data. R2 holds **plaintext** copies of selected segments of **Public and Unlisted** videos only, for fast start/popular videos. Private and Password videos are never cached in R2 (NFR-03).

### 3.6 Encryption lives in the package
Encryption is a generic layer in `unified-storage` with random-access range decryption (§6.4), so Holocast (ranged segment reads) and PocketVerse (large files) can both use it.

### 3.7 Two interchangeable bot event sources
How the bot learns "who added me to which channel" is an unknown (U-03). Two implementations exist behind one interface: Bot API long polling and MTProto updates. Config selects which is active; the Lab tests both (T-ONB-03).

---

## 4. Infrastructure setup (manual steps for the owner; Claude Code writes scripts/config where marked)

Do these in order. Record anything unusual in the Lab manual answers (MQ-01, MQ-02).

### 4.1 Telegram
1. **API credentials:** go to `https://my.telegram.org` → *API development tools* → create an app (or reuse the PocketVerse one). Save `api_id` and `api_hash`.
2. **Bot:** in Telegram, open `@BotFather` → `/newbot` → name `Holocast Storage` → username ending in `bot` (e.g., `HolocastStorageBot`; pick any available). Save the **token** and **username**.
3. **Login domain:** in BotFather → `/setdomain` → select the bot → enter the DuckDNS domain from §4.3 (e.g., `holocast.duckdns.org`). The Login Widget only works on this domain.
4. (Optional for T-ONB-03 coexistence experiments) Create a second test bot the same way. Not required.

### 4.2 GitHub and npm
1. Create public GitHub repos `unified-storage` and `holocast` under `Shivam-Dhyani`.
2. npm: the scope `@shivam-dhyani` exists only if your **npm username is `shivam-dhyani`** or you create an **npm organization** named `shivam-dhyani`. Create one of these before publishing. Enable 2FA on npm.

### 4.3 Free domain (DuckDNS)
1. Sign in at `https://www.duckdns.org`, create a subdomain (e.g., `holocast`).
2. After the VM exists (§4.4), set the subdomain's IP to the VM's public IP.
3. Claude Code provides `infra/duckdns-update.sh` + a cron entry (every 5 min) so the record follows the VM IP if it ever changes.

### 4.4 Oracle Cloud (Always Free)
1. Sign up at `https://www.oracle.com/cloud/free/`. A card is required for verification.
2. **Home region is permanent.** Choose the region closest to you: *India West (Mumbai)* `ap-mumbai-1` or *India South (Hyderabad)* `ap-hyderabad-1`. Record the choice (MQ-01).
3. Networking → *Virtual Cloud Networks* → **Start VCN Wizard** → "Create VCN with Internet Connectivity" → defaults.
4. Compute → *Instances* → **Create instance**:
   - Image: **Canonical Ubuntu 24.04** (aarch64).
   - Shape: **VM.Standard.A1.Flex**, **2 OCPU, 12 GB RAM** (fits the reduced Always Free limit reported for 2026; if your account shows 4 OCPU/24 GB free, you MAY use more — record it).
   - Boot volume: 100 GB.
   - Upload your SSH public key. Assign a public IPv4 address.
   - If you get **"Out of capacity"**: retry at different times of day for up to 7 days and record attempts (T-INF-01). Fallback for continuing Phase 1: create a free **VM.Standard.E2.1.Micro** (1 GB RAM, x86) and run tests that fit (record BLOCKED for tests that do not). Upgrading the account to Pay-As-You-Go is the owner's decision (Always Free resources stay free, but charges become possible) — do not do it without deciding explicitly.
5. Security list of the subnet → add **Ingress** rules: TCP 80 and 443 from `0.0.0.0/0`; TCP 22 only from your IP.
6. Ubuntu images on OCI also block ports with **iptables**. On the VM:
   ```bash
   sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
   sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
   ```
7. Oracle may reclaim Always Free instances it considers idle. Record any notice email (T-INF-02).

### 4.5 VM software (Claude Code writes `infra/setup-vm.sh` that performs these, idempotently)
- System: `build-essential cmake git curl ffmpeg redis-server` (Redis bound to `127.0.0.1`, `maxmemory 256mb`, `maxmemory-policy noeviction` — BullMQ requires noeviction).
- Node.js Active LTS (via NodeSource or `nvm`), `corepack enable` for pnpm.
- **Caddy** (official apt repo) with `infra/Caddyfile`:
  ```caddyfile
  {$HOLOCAST_DOMAIN} {
      @api path /api/*
      handle @api {
          reverse_proxy 127.0.0.1:4000
      }
      handle {
          encode zstd gzip
          reverse_proxy 127.0.0.1:3000
      }
  }
  ```
  Caddy obtains HTTPS certificates automatically (ports 80/443 must be open).
- Directories: `/var/lib/holocast/spool`, `/var/lib/holocast/tg-sessions` (owner `holocast`, mode 700).
- systemd units (in `infra/systemd/`): `holocast-web.service` (Next.js `next start -p 3000`), `holocast-api.service` (`node dist/server.js`), `holocast-worker.service` (`node dist/worker.js`). All `Restart=always`, run as user `holocast`, `EnvironmentFile=/etc/holocast/holocast.env` (mode 600).
- whisper.cpp for T-TRN-01: clone, build with CMake, download the `base` model (multilingual). Path configured by `WHISPER_BIN`, `WHISPER_MODEL`.
- `infra/deploy.sh`: `git pull` → `pnpm install --frozen-lockfile` → `pnpm build` → `prisma migrate deploy` → restart services.

### 4.6 Neon
1. Create a project at `https://neon.tech`; choose the region nearest the VM (record it).
2. Copy the **pooled** connection string → `DATABASE_URL`, and the **direct** connection string → `DIRECT_URL` (Prisma uses `directUrl` for migrations).

### 4.7 Cloudflare R2
1. Cloudflare dashboard → R2 → enable (payment method required for verification).
2. Create bucket `holocast-cache` (location hint: Asia-Pacific).
3. Create an R2 API token: *Object Read & Write*, scoped to this bucket. Save Access Key ID, Secret, and the account's S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Bucket → Settings → CORS policy:
   ```json
   [
     {
       "AllowedOrigins": ["https://holocast.duckdns.org"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

### 4.8 Environment variables (`/etc/holocast/holocast.env`; `.env.example` committed with placeholders)
| Name | Example / format | Used by |
|---|---|---|
| `HOLOCAST_DOMAIN` | `holocast.duckdns.org` | Caddy, API, web |
| `PUBLIC_BASE_URL` | `https://holocast.duckdns.org` | API, web |
| `NODE_ENV` | `production` | all |
| `DATABASE_URL`, `DIRECT_URL` | Neon strings | API, worker |
| `REDIS_URL` | `redis://127.0.0.1:6379` | API, worker |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | from my.telegram.org | API, worker |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC…` | API, worker |
| `TELEGRAM_BOT_USERNAME` | `HolocastStorageBot` (no `@`) | API, web |
| `BOT_EVENT_SOURCE` | `botapi` \| `mtproto` (default `botapi`) | worker |
| `TG_SESSION_DIR` | `/var/lib/holocast/tg-sessions` | API, worker |
| `STORAGE_KEKS` | `k2026a:<base64 32 bytes>[,k…]` — first = active | API, worker |
| `APP_SECRET_KEY` | base64 32 bytes — encrypts `shareIdEnc` | API |
| `MEDIA_URL_SECRET` | base64 32 bytes — HMAC for signed media URLs | API |
| `UNLOCK_COOKIE_SECRET` | base64 32 bytes | API |
| `ADMIN_TELEGRAM_IDS` | `12345678,87654321` | API |
| `SPOOL_DIR` | `/var/lib/holocast/spool` | API, worker |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | — | API, worker |
| `R2_MAX_BYTES` | `9000000000` | worker |
| `R2_MAX_CLASS_A_PER_MONTH` | `900000` | worker |
| `R2_MAX_CLASS_B_PER_MONTH` | `9000000` | API |
| `RATE_*` | see §11.8 | API |
| `WHISPER_BIN`, `WHISPER_MODEL` | paths | worker |

Generate secrets with `openssl rand -base64 32`. Secrets MUST never be logged, committed, or sent to the client.

---

## 5. Repositories and layout

### 5.1 `unified-storage` (separate repo)
```
unified-storage/
  src/
    index.ts                 # public exports
    types.ts                 # StorageAdapter, ObjectRef, errors, metrics types
    errors.ts
    crypto/
      format.ts              # header/chunk layout constants + math
      encrypted-store.ts     # createEncryptedStore()
      keyring.ts             # parseKeyring(), KeyProvider
    adapters/
      telegram/
        index.ts             # createTelegramAdapter()
        client.ts            # GramJS client lifecycle, session persistence
        range.ts             # aligned range-read math
        refs.ts              # file reference refresh
        container.ts         # attach (bot) / findOrCreate (user)
        flood.ts             # FLOOD_WAIT handling
      r2/
        index.ts             # createR2Adapter()
  test/                      # vitest unit tests
  scripts/
    integration-telegram.ts  # gated by env vars
    bench.ts                 # throughput bench used by CLI tests (T-INF-03)
  README.md  LICENSE (MIT)  package.json  tsconfig.json  tsup.config.ts
```

### 5.2 `holocast` (pnpm monorepo)
```
holocast/
  CLAUDE.md
  docs/  PRD.md  TDD.md  PHASE1_RESULTS_TEMPLATE.md  VERSIONS.md  IMPLEMENTATION_NOTES.md
  apps/
    web/                     # Next.js (App Router)
      app/
        page.tsx             # landing
        login/page.tsx
        setup/page.tsx       # connect-storage wizard
        record/page.tsx
        videos/page.tsx
        v/[shareId]/page.tsx # viewer
        c/[creatorPublicId]/page.tsx  # public listing
        lab/page.tsx         # admin Lab
      lib/recorder/          # capture, encode, segmenter, opfs-queue, uploader, stats
      lib/player/            # hls setup + playback instrumentation
      lib/lab/               # browser test runners
    api/                     # Express
      src/
        server.ts            # HTTP entry
        worker.ts            # BullMQ workers + bot event source
        config.ts            # env parsing (zod)
        db.ts                # Prisma client
        storage.ts           # unified-storage instances (telegram bot, r2, encrypted)
        auth/ storage-connect/ videos/ ingest/ share/ media/ lab/ rate-limit/
        lab/thresholds.ts    # single source of thresholds (= PRD §9)
      prisma/schema.prisma
      scripts/lab-viewers.ts # CLI for T-PLY-05
      test/                  # integration tests (T-SEC-01/02, T-FAIR-01)
  packages/
    shared/                  # zod schemas + shared TS types (API contracts)
  infra/  Caddyfile  setup-vm.sh  deploy.sh  duckdns-update.sh  systemd/*.service
  .env.example  pnpm-workspace.yaml  package.json
```
During development Holocast depends on the package via a local link (`"@shivam-dhyani/unified-storage": "link:../unified-storage"`); for VM deployment it uses the published alpha version (FR-PKG-08).

---

## 6. `@shivam-dhyani/unified-storage` design

### 6.1 Goals
One API over many storage backends; encryption handled by the library; safe for both bot-owned and user-owned Telegram storage; observable (metrics hooks). Node.js only (server side).

### 6.2 Public interface
```ts
export type AdapterKind = 'telegram' | 'r2';

export interface ObjectRef {
  adapter: AdapterKind;
  container: string;              // telegram: channel id (string); r2: bucket
  key: string;                    // telegram: message id (string); r2: object key
  size: number;                   // stored size in bytes (ciphertext size if encrypted)
  meta?: Record<string, string>;  // adapter extras, e.g. { encrypted: '1' }
}

export interface PutInput {
  container: string;
  data: Uint8Array;               // Phase 1: whole object in memory (packs ≤ 32 MB)
  name: string;                   // file name (telegram document name / r2 key suffix)
  contentType?: string;
  caption?: string;               // telegram only, ≤ 1024 chars
  key?: string;                   // r2: explicit key
}

export interface RangeRequest { offset: number; length: number }

export interface StorageAdapter {
  readonly kind: AdapterKind;
  put(input: PutInput): Promise<ObjectRef>;
  get(ref: ObjectRef, range?: RangeRequest): Promise<Uint8Array>;
  delete(ref: ObjectRef): Promise<void>;
  stat(ref: ObjectRef): Promise<{ exists: boolean; size?: number }>;
  close(): Promise<void>;
}

export interface MetricEvent {
  adapter: AdapterKind;
  op: 'put' | 'get' | 'delete' | 'stat' | 'refresh_ref' | 'flood_wait' | 'retry';
  bytes?: number;
  ms?: number;
  waitSeconds?: number;
  ok: boolean;
  errorCode?: string;
}
export type MetricsHook = (e: MetricEvent) => void;
```

### 6.3 Errors (`src/errors.ts`)
`StorageError` (base, has `code`) with codes: `NOT_FOUND`, `ACCESS_LOST` (bot not admin / channel inaccessible), `FLOOD_WAIT_EXCEEDED`, `INTEGRITY` (decryption/tag failure), `RANGE_INVALID`, `CONFIG`, `UNKNOWN`. Adapters MUST map backend errors to these codes (e.g., Telegram `CHANNEL_PRIVATE`, `CHAT_ADMIN_REQUIRED` → `ACCESS_LOST`; deleted message → `NOT_FOUND`).

### 6.4 Encryption layer (`createEncryptedStore(adapter, keyProvider)`)
Returns a `StorageAdapter` whose `put` encrypts and whose `get(ref, range)` takes **plaintext** offsets and decrypts only the chunks needed.

**Algorithm:** AES-256-GCM (Node `crypto`). Envelope encryption: a fresh random 32-byte **DEK** per object, wrapped with a **KEK** from the keyring.

**Object layout (version 1):**
| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `"USE1"` (ASCII) |
| 4 | 1 | version = `1` |
| 5 | 1 | `chunkSizeLog2` = `16` (64 KiB plaintext chunks) |
| 6 | 16 | `kekId` (ASCII, NUL-padded) |
| 22 | 8 | `noncePrefix` (random) |
| 30 | 12 | `wrapNonce` (random) |
| 42 | 32 | wrapped DEK (AES-256-GCM ciphertext of DEK under KEK) |
| 74 | 16 | wrap tag |
| 90 | 8 | `plaintextSize` (uint64 BE) |
| 98 | 30 | reserved (zeros) |
| **128** | — | chunk 0, chunk 1, … |

- `HEADER = 128`, `C = 2^chunkSizeLog2 = 65536`, `TAG = 16`.
- Chunk *i* = `AES-GCM(DEK, nonce = noncePrefix ‖ uint32BE(i), aad = header[0..128) ‖ uint32BE(i) ‖ finalFlag)` → ciphertext (`min(C, remaining)` bytes) followed by its 16-byte tag. `finalFlag` = `0x01` for the last chunk, else `0x00` (detects truncation and reordering).
- Wrap AAD = bytes `0..42` of the header (magic, version, chunkSizeLog2, kekId, noncePrefix).
- Ciphertext offset of chunk *i* = `HEADER + i × (C + TAG)`. Total size = `HEADER + plaintextSize + ceil(plaintextSize / C) × TAG`. (`plaintextSize = 0` → one empty final chunk with tag only.)

**Ranged read for plaintext `[p, p+len)`:** `i0 = floor(p / C)`, `i1 = floor((p+len-1) / C)`; fetch the header (cached per ref in an in-memory LRU, max 1000 entries) and chunks `i0..i1` in one backend range read; decrypt each, verify tags, slice. Any tag failure → `StorageError('INTEGRITY')`.

**Keyring:** `parseKeyring('id1:base64,id2:base64')` → `KeyProvider { activeId, get(id) }`. Encrypt with the active KEK; decrypt with the KEK named in the header (enables rotation).

**Required unit tests:** round-trip for sizes 0, 1, C−1, C, C+1, 10 MB; every range boundary (start/end inside, at, across chunks); tamper of any single byte → INTEGRITY; truncated final chunk → INTEGRITY; swapped chunks → INTEGRITY; wrong KEK → INTEGRITY; decrypt with a rotated (non-active) KEK works.

### 6.5 Telegram adapter (`createTelegramAdapter(options)`)
Library: **GramJS** (npm package `telegram`).

```ts
type TelegramAdapterOptions =
  | { mode: 'bot';  apiId: number; apiHash: string; botToken: string;  sessionFile: string; metrics?: MetricsHook; maxParallelPerDc?: number }
  | { mode: 'user'; apiId: number; apiHash: string; session: string; metrics?: MetricsHook; maxParallelPerDc?: number };
```

**Client lifecycle (`client.ts`):** one connected client per adapter instance. Bot mode persists its `StringSession` to `sessionFile` (mode 600) so restarts do not re-login (repeated bot logins can trigger FLOOD_WAIT). Reconnect automatically on disconnect.

**Containers (`container.ts`):**
- `attachChannel(channelId: string): Promise<{ channelId: string; accessHash: string; title: string; botIsAdmin: boolean; canPost: boolean; canDelete: boolean }>` — **bot mode.** Resolves the channel for MTProto. Required behavior: obtain an `InputChannel` usable by this bot. **U-04:** the primary method is `channels.getChannels` with `InputChannel(channelId, accessHash = 0)` (believed to work for bots); fallback: use the access hash delivered with the membership update (MTProto event source, §8.3). Cache the resolved access hash per channel (also stored in Holocast DB).
- `findOrCreateChannel({ marker, title }): Promise<...>` — **user mode** (for PocketVerse later). Iterate the user's dialogs, find a channel created by the user whose description (`about`) contains the exact marker string (e.g., `unified-storage:v1:<appNamespace>:<ownerKey>`); if none, create it with that description. MUST never create a second channel when one with the marker exists. Covered by an integration test with a test account.

**put:** upload `data` as a **document** (force document, never as video/photo) with the given file name and caption, via the library's file-upload method (it chooses big-file upload parts automatically). Return `ObjectRef { container: channelId, key: messageId, size }`.

**get (range read, `range.ts`):**
1. Fetch the message by ID (`channels.getMessages`) to obtain a **fresh** document (id, access hash, **file reference**, `dc_id`, size). Cache the document object in memory for **10 minutes** (LRU, 5000 entries). On `FILE_REFERENCE_EXPIRED` / `FILE_REFERENCE_INVALID` → drop cache, refetch once, retry.
2. Translate the requested byte range into Telegram-aligned requests (safe rules that work without the `precise` flag): each request has `offset % 4096 == 0`, `limit % 4096 == 0`, `limit ≤ 1048576`, `1048576 % limit == 0`, and must not cross a 1 MiB boundary (`floor(offset / 1MiB) == floor((offset + limit − 1) / 1MiB)`). Simplest compliant scheme: read whole aligned 1 MiB blocks (`limit = 1048576`, `offset = k × 1048576`), except the final block (may use a smaller 4 KiB-multiple limit); trim the result to the requested range.
3. Issue `upload.getFile` requests to the document's DC. If the library offers a ranged download iterator that accepts arbitrary offsets and handles DC routing, the implementer MAY use it after verifying (rule §1.2) that it follows the alignment rules above.
4. Parallelism: at most `maxParallelPerDc` (default 4) concurrent `getFile` calls per DC.
5. Metrics: emit `get` (bytes, ms), `refresh_ref` (ms), `flood_wait`, `retry`.

**delete:** `channels.deleteMessages`. Missing message → success (idempotent).

**FLOOD_WAIT (`flood.ts`):** on `FLOOD_WAIT_X`: if `X ≤ 60` wait `X` seconds then retry (max 3 times per call) and emit a `flood_wait` metric; if `X > 60` throw `FLOOD_WAIT_EXCEEDED` with `waitSeconds`. Disable or lower the library's own automatic flood sleep so that every wait is observable.

**Errors:** map as in §6.3. A Telegram error not mapped → `UNKNOWN` with the original message attached (never swallowed).

### 6.6 R2 adapter (`createR2Adapter`)
Uses `@aws-sdk/client-s3` with `region: 'auto'`, custom `endpoint`, `forcePathStyle: true`. `put` → `PutObject`; `get` with range → `GetObject` with `Range: bytes=a-b`; `delete` → `DeleteObject`; `stat` → `HeadObject`. Extra method `presignGet(ref, expiresSeconds)` using `@aws-sdk/s3-request-presigner`. Every operation emits a metric so Holocast can count Class A/B operations.

### 6.7 Build, tests, publishing
- Build with `tsup` → ESM + CJS + `.d.ts`. `"engines": { "node": ">=20" }`. Zero runtime dependencies other than GramJS and the AWS SDK packages (both marked as dependencies; R2 SDK MAY be an optional peer dependency).
- `vitest` unit tests (crypto, range math, error mapping with mocked client). Integration script `scripts/integration-telegram.ts` runs only when `IT_TELEGRAM_*` env vars are set.
- README: install, quick start (bot mode, R2, encrypted store), API reference, **security section** (threat model: DB leak, token leak, server compromise), limitations.
- Publish `0.1.0-alpha.N` with `npm publish --access public --tag alpha`.

---

## 7. Holocast backend structure (`apps/api`)
- **server.ts:** Express 5, `helmet`, JSON body limit 64 KB, raw body (`application/octet-stream`) limit **8 MB** only on the segment/init PUT routes, cookie parser, pino-http logger with redaction (`authorization`, `cookie`, any field named `token`, `secret`, `password`, `session`).
- **worker.ts:** BullMQ workers: `pack-upload`, `finalize`, `r2-promote`, `delete-video`, `lab`; plus the active bot event source. Concurrency: `pack-upload` 2, `lab` 1, others 2.
- **storage.ts:** creates one Telegram adapter (bot mode) per process (API and worker each persist their own session file: `tg-sessions/api.session`, `tg-sessions/worker.session`), one R2 adapter, and `encryptedTelegram = createEncryptedStore(telegram, keyring)`.

---

## 8. Authentication and storage onboarding

### 8.1 Telegram Login Widget
- Web: `/login` renders the official widget script (`https://telegram.org/js/telegram-widget.js?<version>`) with `data-telegram-login={TELEGRAM_BOT_USERNAME}`, `data-size="large"`, `data-request-access="write"`, and an `data-onauth` callback that POSTs the user object to `POST /api/auth/telegram`.
- Server verification (FR-AUTH-02):
  1. Take all received fields except `hash`; sort keys alphabetically; build `data_check_string = "key=value"` lines joined with `\n`.
  2. `secret = SHA256(TELEGRAM_BOT_TOKEN)` (raw bytes); `expected = hex(HMAC_SHA256(secret, data_check_string))`.
  3. Compare with `hash` in constant time. Reject if `now − auth_date > 86400`.
- Upsert `User` by `telegramUserId`; update names/username/photo. Create session (§8.2). Response: `{ user, storageStatus }`.
- (Telegram also documents a newer OpenID Connect login flow. Phase 1 uses the widget; OIDC is a Phase 2 option.)

### 8.2 Sessions
`hc_session` cookie: 32 random bytes, base64url; `httpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. DB stores `sha256(token)`. Each authenticated request with `lastSeenAt` older than 24 h extends `expiresAt` by 30 days. State-changing requests (POST/PUT/PATCH/DELETE) MUST have an `Origin` header equal to `PUBLIC_BASE_URL` (CSRF defense), except the segment PUT routes, which additionally require the session cookie and a per-video upload token (§11.1).

### 8.3 Bot event sources and channel linking
Interface:
```ts
interface BotMembershipEvent {
  channelId: string;            // positive MTProto channel id as string
  channelTitle: string;
  actorTelegramUserId: string;  // who made the change
  newStatus: 'administrator' | 'member' | 'left' | 'kicked';
  canPostMessages: boolean;
  canDeleteMessages: boolean;
  accessHash?: string;          // only from MTProto source
  source: 'botapi' | 'mtproto';
  receivedAt: Date;
}
interface BotEventSource { start(onEvent: (e: BotMembershipEvent) => Promise<void>): Promise<void>; stop(): Promise<void>; }
```
- **`botapi` source:** long-poll `https://api.telegram.org/bot<TOKEN>/getUpdates` with `allowed_updates=["my_chat_member"]`, `timeout=50`, tracking `offset`. Map `my_chat_member`: `chat.type == "channel"`, `from.id` = actor, `new_chat_member.status` and `can_post_messages` / `can_delete_messages`. Convert Bot API chat ID to MTProto channel ID: `channelId = −chatId − 1000000000000` (Bot API channel IDs are `-100…`).
- **`mtproto` source:** listen to raw updates on the worker's bot client for the bot's own channel-participant changes (`UpdateChannelParticipant` where the participant is the bot), taking the actor and the channel's access hash from the update and its attached chats.
- Exactly one source is active (`BOT_EVENT_SOURCE`). The Lab test T-ONB-03 can temporarily start **both** and log which delivers events, and whether running both breaks either (U-03).
- Every event is stored in `BotEventLog` (raw JSON) for the Lab.

**Linking state machine (`storage-connect/handler.ts`), on each event:**
1. `newStatus = administrator` and `canPostMessages`:
   - Find `User` by `actorTelegramUserId`. If none → bot leaves the channel; log `UNKNOWN_ACTOR`.
   - If `StorageChannel` with this `channelId` exists for the same user → set `CONNECTED`, refresh title/accessHash (**reconnect**, FR-STO-07).
   - Else if the user already has a different `CONNECTED` channel → bot leaves this new channel; log `ALREADY_CONNECTED`.
   - Else if the channel ID belongs to another user → bot leaves; log `CHANNEL_OWNED_BY_OTHER`.
   - Else create `StorageChannel(CONNECTED)` (also when a user's previous channel is `DISCONNECTED` — the user is switching to a new channel; their old videos stay unavailable until that old channel is reconnected, which Phase 1 does not support at the same time).
   - Resolve access via `attachChannel` (U-04). On failure → status `ERROR`, log.
   - Post the confirmation message: `✅ Holocast storage connected.\nVideos you record will be saved here, encrypted. Don't delete this channel.\n#holocast:v1 user=<telegramUserId>`.
2. `administrator` without post rights, or `member`, `left`, `kicked` → if a `StorageChannel` exists, set `DISCONNECTED`, `disconnectedAt = now`.
3. Invalidate Redis caches for that user's videos.

The wizard polls `GET /api/storage` every 2 s (max 10 min) and shows the state.

### 8.4 App-initiated disconnect
`POST /api/storage/disconnect` → bot calls `channels.leaveChannel` → set `DISCONNECTED`. Telegram data is untouched.

---

## 9. Data model (`apps/api/prisma/schema.prisma`)

```prisma
generator client { provider = "prisma-client-js" }
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum ChannelStatus { CONNECTED DISCONNECTED ERROR }
enum VideoStatus   { RECORDING FINALIZING READY FAILED DELETED }
enum Visibility    { PUBLIC UNLISTED PASSWORD PRIVATE }
enum PackStatus    { PENDING UPLOADING STORED FAILED }
enum SegmentLoc    { SPOOL PACK }
enum LabStatus     { PASS FAIL BLOCKED INFO NOT_RUN RUNNING }

model User {
  id              String   @id                 // UUIDv7
  telegramUserId  BigInt   @unique
  firstName       String
  lastName        String?
  username        String?
  photoUrl        String?
  publicId        String   @unique             // 10-char random, used in /c/<publicId>
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  sessions        AuthSession[]
  channels        StorageChannel[]
  videos          Video[]
}

model AuthSession {
  id         String   @id
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  Bytes    @unique                    // sha256(token)
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  lastSeenAt DateTime @default(now())
  @@index([userId])
}

model StorageChannel {
  id                String        @id
  userId            String
  user              User          @relation(fields: [userId], references: [id], onDelete: Restrict)
  telegramChannelId BigInt        @unique
  accessHash        BigInt?
  title             String
  status            ChannelStatus
  botUsername       String
  connectedAt       DateTime
  disconnectedAt    DateTime?
  videos            Video[]
  @@index([userId, status])
}

model Video {
  id             String       @id
  ownerId        String
  owner          User         @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  channelId      String
  channel        StorageChannel @relation(fields: [channelId], references: [id], onDelete: Restrict)
  title          String
  status         VideoStatus
  visibility     Visibility
  shareIdHash    Bytes        @unique          // sha256(shareId)
  shareIdEnc     Bytes                         // AES-256-GCM(APP_SECRET_KEY, shareId), nonce prefixed
  passwordHash   String?                       // argon2id, only when PASSWORD
  uploadTokenHash Bytes                        // sha256 of per-video upload token
  durationUs     BigInt       @default(0)
  width          Int?
  height         Int?
  videoCodec     String?                       // e.g. avc1.640028
  audioCodec     String?                       // e.g. mp4a.40.2 or opus
  initSegment    Bytes?                        // fMP4 init (ftyp+moov), plaintext, small
  expectedSegments Int?                        // set at finalize
  bitrateBps     Int
  isLab          Boolean      @default(false)
  createdAt      DateTime     @default(now())
  finalizedAt    DateTime?
  deletedAt      DateTime?
  packs          Pack[]
  segments       Segment[]
  @@index([ownerId, createdAt])
  @@index([ownerId, visibility, status])
}

model Pack {
  id          String     @id
  videoId     String
  video       Video      @relation(fields: [videoId], references: [id], onDelete: Restrict)
  packNo      Int
  firstSeq    Int
  lastSeq     Int
  plainSize   Int
  storageRef  Json?                            // ObjectRef of the encrypted object
  status      PackStatus
  attempts    Int        @default(0)
  uploadedAt  DateTime?
  @@unique([videoId, packNo])
}

model Segment {
  videoId      String
  video        Video      @relation(fields: [videoId], references: [id], onDelete: Restrict)
  seq          Int                             // 1-based
  durationUs   Int
  sizeBytes    Int
  sha256       Bytes
  location     SegmentLoc
  packNo       Int?
  offsetInPack Int?                            // plaintext offset inside the pack
  createdAt    DateTime   @default(now())
  @@id([videoId, seq])
}

model R2CacheEntry {
  objectKey    String   @id                    // e.g. v/<videoId>/<seq>.m4s
  videoId      String
  seq          Int
  sizeBytes    Int
  hits         Int      @default(0)
  lastAccessAt DateTime @default(now())
  createdAt    DateTime @default(now())
  @@index([lastAccessAt])
  @@index([videoId])
}

model BotEventLog {
  id         String   @id
  source     String
  payload    Json
  outcome    String                            // LINKED, RECONNECTED, DISCONNECTED, UNKNOWN_ACTOR, ...
  receivedAt DateTime @default(now())
}

model LabRun {
  id          String    @id
  testId      String                           // e.g. T-TG-01
  status      LabStatus
  metrics     Json                             // raw numbers
  environment Json                             // browser/os/region/versions
  notes       String?
  runBy       String?                          // userId
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  @@index([testId, startedAt])
}

model LabManualAnswer {
  questionId String   @id                      // MQ-01 ...
  value      String
  updatedAt  DateTime @updatedAt
}

model UsageCounter {
  key       String   @id                       // e.g. r2:classA:2026-10
  value     BigInt   @default(0)
  updatedAt DateTime @updatedAt
}
```
Deletes of `User`, `StorageChannel`, `Video`, `Pack`, `Segment` are `Restrict` on purpose (the PocketVerse lesson): nothing that points at stored data can disappear through a cascade. Videos are soft-deleted (`status = DELETED`).

---

## 10. Recording pipeline (browser, `apps/web/lib/recorder`)

### 10.1 Flow
1. `probe()` (§10.2). If not recordable → show the unsupported message.
2. `POST /api/videos` → `{ videoId, shareUrl, uploadToken, segmentTargetSeconds: 4, bitrateBps }`. Show the share link (FR-REC-08).
3. `getDisplayMedia({ video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: <true on Chrome/Edge if user ticked tab audio> })` and `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
4. Mix audio: `AudioContext` → `MediaStreamAudioSourceNode` for mic and (if present) tab audio → `MediaStreamAudioDestinationNode` → one audio track.
5. Encode + mux with **Mediabunny** into **fragmented MP4** (§10.4); a segmenter splits the byte stream into init + media segments (§10.5).
6. Each segment → OPFS → uploader queue (§10.6).
7. Stop (user, 2-hour limit, or the screen-share "Stop sharing" event) → finalize Mediabunny output → upload remaining segments → `POST /api/videos/:id/finalize`.

### 10.2 Capability probe (also T-REC-01) — output JSON
```json
{
  "browser": { "name": "Chrome", "version": "…", "os": "Windows 11", "uaData": {} },
  "getDisplayMedia": true,
  "tabAudioCapture": "supported|unsupported|unknown",
  "mediaStreamTrackProcessor": { "window": false, "worker": true },
  "videoEncoder": true, "audioEncoder": true,
  "h264Configs": [{ "codec": "avc1.640028", "supported": true, "hardwareAcceleration": "prefer-hardware" }],
  "aacEncode": true, "opusEncode": true,
  "opfs": true, "opfsSyncAccessHandleInWorker": true,
  "mse": true, "managedMediaSource": false, "nativeHls": false,
  "mediabunnyCanEncode": { "avc": true, "aac": true, "opus": true },
  "recordable": true, "reasons": []
}
```
H.264 configs probed with `VideoEncoder.isConfigSupported` in order: High `avc1.640028`, Main `avc1.4d0028`, Baseline `avc1.42e028` (1920×1080, 30 fps, chosen bitrate), each with `hardwareAcceleration: 'prefer-hardware'` then `'no-preference'`. Audio: AAC `mp4a.40.2` first, Opus second (48 kHz, 128 kbps, 2 ch → fall back to 1 ch). `recordable = getDisplayMedia && (H.264 supported) && (AAC or Opus supported) && OPFS`. Tab-audio support is set by browser rule (Chrome/Edge = supported) and confirmed after capture by checking whether the display stream has an audio track.

### 10.3 Frame acquisition and background tabs (U-05, U-06)
Recording must keep working while the Holocast tab is in the background (FR-REC-10). Required behavior: frames must be pulled from the screen track by a mechanism that is **not** tied to `requestAnimationFrame` of the page. Preferred: Mediabunny's MediaStream track sources if they exist in the installed version (verify how they acquire frames per browser and record it in IMPLEMENTATION_NOTES); otherwise `MediaStreamTrackProcessor` (in a worker where available). Browsers where only canvas/`requestAnimationFrame` capture is possible MUST be reported by T-REC-05; do not attempt workarounds in Phase 1.

### 10.4 Encoding and muxing (Mediabunny)
Required output: **fragmented MP4** where each fragment starts with a video keyframe and lasts ~4 s; init (ftyp+moov) emitted before the first fragment; video track H.264 (from probe), audio track AAC or Opus; timestamps from the media stream clock, starting at 0. Settings: 30 fps, bitrate = `bitrateBps` (Lab override 1.0/1.5/2.5 Mbps), keyframe interval = **4 s**, fragment duration aligned to keyframes. Output bytes go to a streaming target that hands chunks to the segmenter in order. If Mediabunny cannot produce fragmented output with this control, record it in IMPLEMENTATION_NOTES and stop to ask the owner (do not switch libraries silently).

### 10.5 Segmenter (MP4 box parser)
Parses the output stream by box headers (`size` uint32 BE + `type`; `size == 1` → 64-bit largesize). Collects `ftyp` + `moov` (and anything before the first `moof`) as the **init segment**. Each `moof` + following `mdat` (plus any preceding `styp`/`sidx`) = one **media segment**. Ignores `mfra`. Segment duration: from the video track's `tfdt.baseMediaDecodeTime` difference between consecutive fragments ÷ the video track timescale (from `moov/trak/mdia/mdhd` for the video `trak`); the last segment's duration = total duration − its `tfdt`. Records per segment: `seq`, `durationUs`, `sizeBytes`, `sha256`. Logs a warning metric if any non-final duration is outside 3.5–4.5 s.

### 10.6 OPFS queue and uploader
- On creation each segment is written to OPFS `holocast/<videoId>/<seq>.m4s` (init: `init.mp4`) plus a manifest `holocast/<videoId>/manifest.json` (`videoId`, `uploadToken`, `nextSeq`, `acked: number[]`, `finalRequested`, `durationUs`).
- Uploader: one in-flight request at a time per video, in seq order; `PUT /api/videos/:id/segments/:seq` with body = bytes, headers `Content-Type: application/octet-stream`, `X-Upload-Token`, `X-Segment-Duration-Us`, `X-Segment-Sha256` (hex). Init: `PUT /api/videos/:id/init`.
- Retry: exponential backoff 1 s → 2 → 4 → 8 → 16 → 30 s (cap), infinite while the page is open; on success delete the OPFS file and update `acked`.
- `uploadLagSeconds` = recorded duration − acknowledged duration, shown in the UI (FR-REC-09) and sampled every 5 s for stats.

### 10.7 Crash recovery (FR-REC-07)
On any page load of the app, scan OPFS for manifests with unacked segments or `finalRequested` not completed; resume uploads (no re-encoding) and then finalize with the segments that exist. The video is marked READY with the duration actually uploaded.

### 10.8 Recording statistics (for T-REC-03…07)
Sent with finalize (and to the Lab when the user is admin): browser/env, chosen codecs and hardware acceleration, bitrate, wall-clock duration (Stop − Start), recorded duration (sum of segment durations), segment count, durations min/max/avg, max encoder queue size (`VideoEncoder.encodeQueueSize` if accessible, else the closest available metric — document which), max/avg `uploadLagSeconds`, time from Stop to final ack, `visibilitychange` timeline (hidden/visible timestamps), longest gap between consecutive video frame timestamps (detects frozen video), `performance.memory.usedJSHeapSize` samples where available (Chrome/Edge only).

---

## 11. Server: ingest, packing, playback, cache

### 11.1 Ingest
- `POST /api/videos` (auth; requires CONNECTED storage; FR-FAIR-01/02): body `{ title?, visibility, password?, bitrateBps? (lab only) }`. Creates `Video(RECORDING)`; generates `shareId` = nanoid(21), stores `shareIdHash`, `shareIdEnc`; `uploadToken` = 32 random bytes (base64url), stores its hash. Returns `{ videoId, shareUrl, uploadToken, segmentTargetSeconds: 4, bitrateBps }`.
- `PUT /api/videos/:id/init`: stores `initSegment` (max 1 MB) once; repeat with identical bytes → 200; different bytes → 409. Also sets codecs/width/height parsed from headers `X-Video-Codec`, `X-Audio-Codec`, `X-Width`, `X-Height`.
- `PUT /api/videos/:id/segments/:seq`: auth + `X-Upload-Token` must match; `seq` 1…1900; body ≤ 8 MB; verify SHA-256. Idempotent: if `Segment(videoId, seq)` exists with the same sha256 → 200; different → 409. Write `SPOOL_DIR/<videoId>/<seq>.m4s` (write to temp file then rename), insert `Segment(location=SPOOL)`, update `durationUs`. Then call the packer check.
- Reject segments when the video is `DELETED` (410) or `READY` (409).

### 11.2 Packer
- A pack = **15 consecutive segments** (`packNo = ceil(seq / 15)`; pack *n* covers seqs `15n−14 … 15n`). When all 15 are spooled, enqueue `pack-upload(videoId, packNo)`. On finalize, the last partial pack is enqueued.
- `pack-upload` job: concatenate segment files in order (record each `offsetInPack`), `encryptedTelegram.put({ container: channelId, data, name: 'hc_<videoId>_<packNo>.bin', caption: JSON })`. Caption (self-describing, ≤1024 chars): `{"hc":1,"v":"<videoId>","p":<packNo>,"s":[<firstSeq>,<lastSeq>],"o":[<offsets…>]}`. On success, in one DB transaction: `Pack(STORED, storageRef)`, segments → `location=PACK, packNo, offsetInPack`. Then delete spool files of that pack and invalidate the video's Redis segment map.
- Retries: BullMQ attempts 10, exponential backoff starting 5 s; `FLOOD_WAIT_EXCEEDED` → delay job by `waitSeconds`. `ACCESS_LOST` → stop retrying, `Pack(FAILED)`, leave spool intact (data not lost), mark channel ERROR → user sees "storage disconnected".

### 11.3 Finalize
`POST /api/videos/:id/finalize` `{ expectedSegments, durationUs, stats }`: status → FINALIZING; enqueue `finalize` job which waits (poll every 5 s, up to 24 h) until segments `1…expectedSegments` all exist, enqueues the last pack, waits until all packs STORED, then status → READY, `finalizedAt`. If after 24 h segments are missing → READY with the contiguous prefix only, warning logged. Spool directories of READY videos must be empty (T-INF-08).

### 11.4 Share, access check, playlist, signed URLs
- `GET /api/share/:shareId` → metadata `{ title, creatorName, creatorPublicId, visibility, status, durationUs, needsPassword, isOwner, storageConnected }`. Lookup by `sha256(shareId)` (cached in Redis 10 min).
- **Access rule** `canWatch(video, request)`: `PUBLIC`/`UNLISTED` → yes; `PASSWORD` → valid unlock cookie for this video **or** owner; `PRIVATE` → owner session only. Not watchable → 403 (`PRIVATE`) or 401 with `needsPassword` (`PASSWORD`).
- `POST /api/share/:shareId/unlock` `{ password }` → argon2id verify → set cookie `hc_unlock_<videoId>` = `base64url(exp).HMAC(UNLOCK_COOKIE_SECRET, videoId|exp)`, 24 h, `httpOnly; Secure; SameSite=Lax; Path=/api`. Rate limit FR-FAIR-05.
- `GET /api/share/:shareId/playlist.m3u8` (after `canWatch`): returns
  ```
  #EXTM3U
  #EXT-X-VERSION:7
  #EXT-X-TARGETDURATION:<ceil(max segment duration in s)>
  #EXT-X-MEDIA-SEQUENCE:1
  #EXT-X-PLAYLIST-TYPE:<VOD if READY, EVENT if RECORDING/FINALIZING>
  #EXT-X-INDEPENDENT-SEGMENTS
  #EXT-X-MAP:URI="/api/media/<videoId>/init.mp4?e=<exp>&s=<sig>"
  #EXTINF:<duration s, 3 decimals>,
  /api/media/<videoId>/<seq>.m4s?e=<exp>&s=<sig>
  …
  #EXT-X-ENDLIST            (only when READY)
  ```
  Only contiguous segments from seq 1 are listed. `Cache-Control: no-store`. Content type `application/vnd.apple.mpegurl`.
- **Signed URL:** `exp` = now + 6 h (unix seconds); `sig = base64url(HMAC_SHA256(MEDIA_URL_SECRET, "<videoId>.<seqOrInit>.<exp>"))`. Verified in constant time; expired → 403.
- Lab-only: `?nocache=1` on the playlist propagates `&nc=1` into segment URLs (signed too), which forces the Telegram path (T-PLY-02/03/05).

### 11.5 Media resolution — `GET /api/media/:videoId/:file`
1. Verify signature and expiry; load video (Redis-cached); if DELETED → 410; if channel not CONNECTED → 409 `{code:'STORAGE_DISCONNECTED'}`.
2. `init.mp4` → serve `initSegment` (`Content-Type: video/mp4`, `Cache-Control: private, max-age=3600`).
3. Segment `seq` (`Content-Type: video/iso.segment`):
   - `location = SPOOL` → stream the spool file.
   - Else, if not `nc=1` and an `R2CacheEntry` exists → increment hits (async) and **302** to an R2 presigned URL (expires 10 min).
   - Else → `encryptedTelegram.get(pack.storageRef, { offset: offsetInPack, length: sizeBytes })`, verify sha256, respond with bytes; then (async) consider promotion (§11.6).
4. Response headers for segments from the API: `Cache-Control: private, max-age=3600`. Record `bytesServed` counters by source (spool / r2 / telegram) for T-INF-07.

### 11.6 R2 cache policy and free-tier guards
- Only `PUBLIC` and `UNLISTED` videos.
- **On READY:** cache segments **1–3** (fast start). The init segment is always served from the database, so it is never cached in R2.
- **Hot promotion:** a segment fetched from Telegram ≥ 3 times within 1 hour (Redis counter) → enqueue `r2-promote`.
- **Eviction:** if total cached bytes > `R2_MAX_BYTES`, delete least-recently-accessed entries until below 90 % of it (runs after each promotion and hourly).
- **Monthly guards:** count Class A (put/delete/list) and Class B (get/head) operations in `UsageCounter` (`r2:classA:<YYYY-MM>`, `r2:classB:<YYYY-MM>`). Presigning a URL is not an operation; a viewer's GET of a presigned URL is a Class B operation — count each redirect issued as one Class B. At ≥ `R2_MAX_CLASS_A_PER_MONTH` stop promotions; at ≥ `R2_MAX_CLASS_B_PER_MONTH` stop redirecting (serve from Telegram). Visibility change to PASSWORD/PRIVATE or delete → remove the video's R2 entries.

### 11.7 Deletion
`DELETE /api/videos/:id` (owner) → status DELETED immediately (links show "deleted") → `delete-video` job: delete each STORED pack via the adapter, delete R2 entries, remove spool dir. Errors are retried; `ACCESS_LOST` → keep job failed and log (data cannot be reached; nothing else to do).

### 11.8 Rate limits (FR-FAIR; `express-rate-limit` with a Redis store)
| Env | Default | Key | Applies to |
|---|---|---|---|
| `RATE_ACTIVE_RECORDINGS` | 1 | user | `POST /api/videos` while another video is RECORDING (checked in DB, not the limiter) |
| `RATE_VIDEOS_PER_HOUR` | 30 | user | `POST /api/videos` |
| `RATE_SEGMENT_RPS` | 10 / s | user | segment & init PUT |
| `RATE_MEDIA_PER_MIN` | 300 / min | IP | `/api/media/*`, playlists |
| `RATE_UNLOCK` | 10 / 15 min | IP + video | unlock |
| `RATE_API_DEFAULT` | 120 / min | IP | all other `/api/*` |
Responses: 429 `{ code: 'RATE_LIMITED', message: 'You're doing that too often. Please wait a minute and try again.' }`.

### 11.9 Security headers and pages
- `helmet` defaults; CSP for the web app allowing `telegram.org` (widget script and frame), `oauth.telegram.org`, `*.r2.cloudflarestorage.com` for media, `blob:` for media.
- Viewer pages: PUBLIC → `index, follow` + Open Graph (title, creator); all others → `noindex, nofollow`.

### 11.10 Logging
pino JSON; one log line per request (method, path without query, status, ms, user id if any). Never log `shareId`, tokens, cookies, passwords, bot token, keys, or signed query strings.

---

## 12. API reference (Phase 1)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/telegram` | — | Verify widget payload, create session |
| POST | `/api/auth/logout` | session | Delete session |
| GET | `/api/me` | session | Current user + storage status |
| GET | `/api/storage` | session | `{ status, channelTitle?, deepLink, botUsername }` |
| POST | `/api/storage/disconnect` | session | Bot leaves channel |
| POST | `/api/videos` | session | Create video (instant link) |
| GET | `/api/videos` | session | List my videos (incl. decrypted share URL) |
| PATCH | `/api/videos/:id` | owner | `{ title?, visibility?, password? }` |
| DELETE | `/api/videos/:id` | owner | Delete |
| PUT | `/api/videos/:id/init` | owner + upload token | Init segment |
| PUT | `/api/videos/:id/segments/:seq` | owner + upload token | Media segment |
| POST | `/api/videos/:id/finalize` | owner + upload token | Finalize + stats |
| GET | `/api/share/:shareId` | — | Viewer metadata |
| POST | `/api/share/:shareId/unlock` | — | Password unlock |
| GET | `/api/share/:shareId/playlist.m3u8` | access rule | HLS playlist |
| GET | `/api/media/:videoId/init.mp4` | signed URL | Init segment |
| GET | `/api/media/:videoId/:seq.m4s` | signed URL | Segment |
| GET | `/api/creators/:publicId/videos` | — | Public videos of a creator |
| GET/POST | `/api/lab/*` | admin | §13 |
| GET | `/api/health` | — | `{ ok, db, redis, telegram, r2 }` |

All request/response schemas live in `packages/shared` (zod) and are used by both apps.

---

## 13. Phase 1 Lab — design, test procedures, protocol, report

### 13.1 Architecture
- **Web:** `/lab` (admin only) with tabs: *Overview* (status table of every test, FR-LAB-01), *Server tests* (Run buttons), *Browser tests* (Run buttons running in this browser), *CLI tests* (commands to copy), *Manual answers* (MQ form), *Report* (Export).
- **API:** `GET /api/lab/tests` (catalog + latest status), `POST /api/lab/run/:testId` (enqueue server test), `POST /api/lab/results` (browser/CLI submissions, body `{ testId, metrics, environment, notes? }`), `GET /api/lab/runs?testId=`, `PUT /api/lab/manual/:questionId`, `GET /api/lab/report.md`, `GET /api/lab/report.json`, `POST /api/lab/cleanup`.
- CLI authentication: admin generates a **Lab CLI token** in the Lab (random, stored hashed, valid 7 days), passed as `LAB_TOKEN` env to CLI scripts (`Authorization: Bearer`).
- **Status evaluation:** `apps/api/src/lab/thresholds.ts` exports one entry per test ID: `{ id, name, runner, thresholdText, evaluate(metrics) → 'PASS'|'FAIL'|'INFO' }`. These MUST match PRD §9 exactly (a unit test asserts every PRD §9 test ID exists in this file). BLOCKED is set manually with a required note.
- Lab synthetic data: Lab packs are uploaded to the **admin's own connected channel** with caption `{"hc":1,"lab":true,…}` and tracked in `LabRun.metrics.refs` so *Clean up Lab data* can delete them. Lab videos have `isLab = true`.

### 13.2 Test procedures
For each test: **How** (what the runner does) → **Metrics recorded** → **Evaluation** (thresholds from PRD §9).

**Telegram (SERVER, run on the VM; use the admin's channel):**
- **T-TG-01 Upload:** generate 10 random 12 MB plaintext buffers; for each, `encryptedTelegram.put` sequentially; record seconds and MB/s per upload (`MB = bytes / 1e6`). Metrics: `perUploadMBps[]`, `median`, `floodWaits[]`. PASS if median ≥ 1.0.
- **T-TG-02 Sequential download:** for each of the 10 refs from T-TG-01 (re-run T-TG-01 first if absent), `get(ref)` the whole object; MB/s each; PASS if median ≥ 2.0.
- **T-TG-03 Random ranges:** 50 reads of 1,000,000 plaintext bytes at uniformly random offsets across the 10 packs, sequentially; latency per read. PASS if p50 ≤ 800 ms and p95 ≤ 1500 ms.
- **T-TG-04 Concurrency:** 10 parallel loops for 60 s, each repeatedly reading 750,000 bytes (≈ one 4 s segment at 1.5 Mbps) at random offsets; aggregate MB/s = total bytes / 60 s; latency p95. PASS if aggregate ≥ 2.5 and p95 ≤ 2000 ms.
- **T-TG-05 Burst:** upload 30 × 12 MB packs back-to-back; record every FLOOD_WAIT (seconds) via the metrics hook. PASS if max single wait ≤ 10 s and sum ≤ 30 s.
- **T-TG-06 Ref refresh cost:** 30 iterations: time `channels.getMessages` for a random Lab message (bypassing the 10-min doc cache). PASS if p95 ≤ 300 ms.
- **T-TG-07 Stale reference:** Run 1 stores the raw document (including file reference) of one Lab message into `LabRun.metrics`. Run 2 (≥ 24 h later, button enabled only then) attempts a download **using the stored reference without refreshing**, records whether `FILE_REFERENCE_EXPIRED` occurred, then performs the normal refreshed download. INFO; recovery MUST succeed (else FAIL).

**Onboarding:**
- **T-ONB-01 (MANUAL + log):** In each browser, log out and log in with the widget. The API auto-records each successful login's browser into `LabRun(T-ONB-01)`. PASS when Chrome, Edge, Firefox, Safari all appear.
- **T-ONB-02 (MANUAL + check):** Owner adds the bot via the wizard. The handler records the received rights. PASS if `canPostMessages && canDeleteMessages` and the confirmation message was posted.
- **T-ONB-03 (SERVER):** Lab button starts *both* sources for 15 minutes (coexistence mode, events only logged, not acted upon twice — dedupe by `channelId + newStatus + 30 s window`). Owner removes and re-adds the bot to the channel 2 times during the window. Metrics: per source — events received, latency from the owner's button press (owner clicks "I just changed it" in the Lab, giving a timestamp), actor ID correct?; plus whether the non-active source broke the active one. PASS if at least one source delivered every change with the correct actor within 10 s. The metrics MUST state which source(s) worked and whether both work together.
- **T-ONB-04 (SERVER):** On a freshly restarted worker (cleared access-hash cache), call `attachChannel(channelId)` using only the channel ID; record method used (getChannels with hash 0 / update-provided hash) and success. PASS if resolved.
- **T-ONB-05 (MANUAL + check):** With a READY test video, owner removes the bot in Telegram; the Lab measures time until `DISCONNECTED` and verifies the share page shows the disconnected message; owner re-adds the bot; Lab verifies `CONNECTED` and fetches segment 1 of the old video through the normal path. PASS if detection ≤ 60 s and fetch succeeds.

**Recording (BROWSER; repeat in Chrome, Edge, Firefox, Safari; results keyed by browser):**
- **T-REC-01 Probe:** Lab button runs `probe()` and submits the JSON (§10.2). INFO.
- **T-REC-02 Codecs:** from the probe: PASS if `recordable`.
- **T-REC-03 5-min E2E:** Lab "Start guided recording (5 min)" → records with Lab flag; after finalize, the Lab plays the video from start to end at 4× speed (`playbackRate`) in a hidden player and confirms the `ended` event. PASS if playable to the end and non-final segment durations within 3.5–4.5 s.
- **T-REC-04 60-min:** same flow, 60 minutes, owner leaves a moving screen (e.g., a video or a scrolling page) on the shared screen. PASS per PRD thresholds using §10.8 stats.
- **T-REC-05 Background:** during a guided 10-minute recording, the Lab instructs: at minute 2 switch to another tab, return at minute 7. The `visibilitychange` timeline and frame-gap stats decide PASS/FAIL.
- **T-REC-06 Upload keep-up:** 30-minute recording at 1.5 Mbps; PASS per thresholds; the Lab displays MQ-03 next to it.
- **T-REC-07 Crash recovery:** guided: at minute 2 of a 4-minute recording the Lab tells the owner to press reload; after reload the app resumes uploads and finalizes; the Lab verifies all pre-reload segments exist and the video plays. PASS if so.
- **T-REC-08 Webcam composite experiment (Chrome/Edge only):** a Lab-only page composites webcam (circle, bottom-left, 200 px) over the screen in a worker using frames from `MediaStreamTrackProcessor` and an `OffscreenCanvas`, encodes for 3 minutes (1 minute in background). Records dropped/duplicated frames and frame gaps. INFO. Not used in the product.

**Playback (BROWSER, each browser; uses a READY Lab video of 10 minutes, PUBLIC, created by T-REC-03 or uploaded by the Lab "Create benchmark video" button which re-records 10 min):**
- **T-PLY-01 TTFF cached:** 10 runs: create a fresh `<video>` + hls.js instance (or native), load playlist, call `play()`; TTFF = time from `play()` to the first rendered frame (`requestVideoFrameCallback` where available, else the `playing` event — record which). PASS if p50 < 2000 ms.
- **T-PLY-02 TTFF uncached:** same with `nocache=1`. Evaluated against 2000 ms (FAIL is informative).
- **T-PLY-03 Seek:** with `nocache=1`, after playback starts, 10 seeks to random positions at least 60 s apart; latency = from setting `currentTime` until the next rendered frame after `seeked`. PASS if p50 < 1500 ms.
- **T-PLY-04 Compatibility:** in each browser, play 30 s, seek twice, with cache enabled (so segments 1–3 come via R2 redirect); record player engine (hls.js / native), errors (hls.js `ERROR` events, `video.error`), CORS errors. PASS when all 4 browsers report success.
- **T-PLY-05 Viewers (CLI):** `pnpm --filter api lab:viewers --share <shareId> --count 10 --nocache` then without `--nocache`. Each simulated viewer fetches the playlist, then segments in order, starting the playback clock after 2 segments are buffered; a segment is *late* if it arrives after its playback deadline; a *stall* = playback clock had to pause. Runs for the full 10-minute video. Submits per-viewer and aggregate results. PASS if 0 stalls and ≥ 99 % on time, for both runs.
- **T-PLY-06 Long video:** the Lab "Create 2-hour synthetic video" button generates a 2-hour test video **in the browser** by recording the Lab's own animated canvas source (no screen capture needed) at 1.0 Mbps with real-time encoding disabled if supported (otherwise it takes 2 hours — the owner can run it overnight). Then 10 seeks into 1:50:00–1:59:00 with `nocache=1`. PASS if p50 < 1500 ms.

**Infrastructure / security / other:**
- **T-INF-01, T-INF-02:** manual entries (MQ-01) shown as INFO.
- **T-INF-03 (CLI on laptop):** in the `unified-storage` repo: `LAB_TOKEN=… pnpm bench --suite tg --report https://<domain>/api/lab/results --test T-INF-03` runs T-TG-01…03 equivalents from the laptop (needs bot token locally via `.env` — never commit it). INFO; report shows laptop vs VM side by side.
- **T-INF-04 (SERVER):** 200 iterations of the segment-map query for a READY video directly against Postgres (bypassing Redis): p50/p95. Cold start: on every API boot, if the last DB query was ≥ 10 min ago (tracked in a local file timestamp), the first query latency is recorded automatically. PASS if warm p95 ≤ 100 ms; cold value INFO.
- **T-INF-05 (BROWSER):** fetch an R2-cached segment via its media URL with `fetch()` (follows 302); record success, CORS errors, and time; compare with the Telegram path time for the same segment (`nc=1`). PASS if success in all 4 browsers.
- **T-INF-06 (SERVER):** report `UsageCounter` values and `R2CacheEntry` total bytes. INFO (must be below limits — if not, FAIL).
- **T-INF-07 (SERVER):** bytes served by source and estimated MB per viewer-hour from T-PLY-05 runs. INFO.
- **T-INF-08 (SERVER):** list spool directories; for READY videos expect none. Record peak spool bytes (sampled every minute by the worker). PASS if no spool left for READY videos.
- **T-SEC-01/02, T-FAIR-01 (AUTOTEST):** `pnpm --filter api test:integration` runs supertest suites against a test database; a final reporter posts `{ passed, failed, cases[] }` to the Lab when `LAB_TOKEN` and `LAB_URL` are set. Access matrix = {PUBLIC, UNLISTED, PASSWORD (no unlock / wrong pwd / unlocked), PRIVATE (anon / other user / owner)} × {metadata, playlist, init, segment} with expected codes. Signed-URL cases: valid, expired, wrong sig, sig for another seq, sig for another video. Fair-use: each limit from §11.8 hit at threshold + 1.
- **T-TRN-01 (SERVER):** Lab picks a READY Lab video ≥ 10 min: decrypt/concatenate init + segments to a temp MP4, `ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 -f wav out.wav`, then run whisper.cpp with the `base` model and record wall time, audio duration, RTF = wall / audio, peak RSS, and the first 300 characters of the transcript. INFO (viable if RTF ≤ 1.0). Temp files deleted afterwards.

### 13.3 Execution protocol (owner, in this order)
1. **Setup done** (§4) and app deployed; log in on Chrome; connect storage → T-ONB-02 recorded.
2. Lab → Server tests: **T-TG-01 → 02 → 03 → 04 → 05 → 06 → 07 (run 1)**, T-ONB-04, T-INF-04. *(These run first because if Telegram throughput fails, everything else is reconsidered.)*
3. T-ONB-03 (coexistence window) and T-ONB-05.
4. In **each** browser (Chrome, Edge, Firefox, Safari): log in (T-ONB-01), T-REC-01, T-REC-02, T-REC-03, T-REC-05, T-REC-07, T-PLY-01…04, T-INF-05. Chrome/Edge also T-REC-08.
5. Chrome: T-REC-04 (60 min) and T-REC-06 (30 min). Repeat T-REC-04 in every other browser where T-REC-03 passed.
6. CLI: T-PLY-05 (both runs) from the laptop; T-INF-03 from the laptop.
7. T-PLY-06 (overnight if needed).
8. AUTOTEST suite → T-SEC-01, T-SEC-02, T-FAIR-01.
9. Next day: T-TG-07 (run 2), T-TRN-01, T-INF-06, T-INF-07, T-INF-08.
10. Quality comparison: record 2 minutes of code on screen at 1.0, 1.5 and 2.5 Mbps (Lab bitrate selector), watch each, answer MQ-05.
11. Answer all MQ-01…MQ-12; mark any test that could not run as BLOCKED with a note.
12. Export report (§13.5) and send it for Phase 2 doc generation.

### 13.4 What the Lab shows while running
Each test row: status chip, last value vs threshold (e.g., "median 1.4 MB/s (≥ 1.0) PASS"), run count, last run time, browser (for browser tests), "View raw" (metrics JSON), "Mark BLOCKED" (note required), "Add note".

### 13.5 Report format (`GET /api/lab/report.md` → file `PHASE1_RESULTS.md`)
Generated from the **latest run per (testId, browser)** plus all manual answers. Structure (identical to `docs/PHASE1_RESULTS_TEMPLATE.md`):
1. Header: app version (git commit), package version, generated at, domain, VM region/shape (from MQ-01), Neon region.
2. Summary counts: PASS / FAIL / BLOCKED / INFO / NOT_RUN.
3. One table per PRD §9 group: `ID | Test | Runner | Threshold | Result | Status | Browser | Runs | Notes`.
4. Browser matrix: rows = T-REC-01…05, T-PLY-01…04, T-ONB-01, T-INF-05; columns = Chrome, Edge, Firefox, Safari.
5. Manual answers MQ-01…MQ-12 verbatim.
6. Unknowns register status (§17): each U-xx with RESOLVED-YES / RESOLVED-NO / UNRESOLVED, derived from its tests.
7. Triggered decision options: for each FAIL, the matching rows from §14.
8. Appendix: raw metrics JSON of every latest run.
`report.json` contains the same data machine-readably.

---

## 14. Failure → Phase 2 decision options (used when generating Phase 2 docs)
| If this fails | Options to evaluate in Phase 2 (not built now) |
|---|---|
| T-TG-01/05 (upload slow / flood waits) | Larger packs (fewer messages); upload queue with global pacing; bot pool (assign creators to N bots); lower default bitrate |
| T-TG-02/03/04, T-PLY-02/03/05 (reads slow) | Cache all segments of public/unlisted videos in R2 while popular; prefetch next 3 segments into R2 on play; bot pool for reads; shorter first segments (1–2 s) for faster start; keep latest packs on VM disk longer |
| T-TG-07 (stale refs) | Already handled by refresh-on-read; if recovery fails → always refresh before read (no doc cache) |
| T-ONB-03 (event source) | Use the working source only; if neither works → manual linking: user posts a one-time code in the channel and the bot verifies it |
| T-ONB-04 (access hash) | Take the access hash from MTProto updates; or require one message from the user in the channel to obtain it |
| T-REC-01/02/03 on Firefox/Safari | MediaRecorder-based fallback with server-side **remux only** (`ffmpeg -c copy`, no transcode) into fMP4; or declare Chrome/Edge-only recording (viewing stays universal) |
| T-REC-04 (long recording) | Lower memory footprint (smaller OPFS writes, release frames promptly); split into multiple encoder sessions; reduce resolution to 720p for > 1 h |
| T-REC-05 (background tab) | Document Picture-in-Picture recorder window kept visible; Chrome extension (Phase 2 item) |
| T-REC-06 (upload lag) | Adaptive bitrate based on measured uplink; 720p default |
| T-PLY-04 (Safari native muxed fMP4) | Demuxed audio rendition (separate audio playlist); force hls.js/ManagedMediaSource on Safari |
| T-PLY-01 (cached start) | Inline init + first segment preload; smaller first segment; R2 custom domain via Cloudflare CDN |
| T-INF-01/02 (Oracle) | Retry strategy; Pay-As-You-Go upgrade (owner decision); alternative free hosts evaluated by capability |
| T-INF-04 (Neon latency) | Self-hosted Postgres on the VM with daily backups to R2; or longer Redis caching |
| T-INF-05 (R2 CORS/redirect) | Proxy R2 through the API (uses VM egress); fix CORS config |
| T-TRN-01 (whisper slow) | Smaller model (`tiny`), process only on request, or a free-tier speech API |

---

## 15. Phase 2 technical outline (PROVISIONAL — will be rewritten)
- Webcam bubble: worker compositing (approach validated by T-REC-08) or Document Picture-in-Picture.
- MP4 export: stream init + all segments (decrypted) as one fMP4 file download.
- Transcripts/chapters: whisper.cpp worker queue (if T-TRN-01 viable) storing VTT encrypted in the creator's channel; AI chapters via a free-tier LLM API (to be chosen).
- Comments/reactions/analytics: new tables, viewer sessions, heatmap aggregation.
- Sprite sheets: recorder captures a frame every 5 s → tile JPEG + WebVTT → R2.
- Bot pool + failover; index rebuild from captions (`#holocast:v1` + pack captions).
- `unified-storage` 1.0: S3, Google Drive, local adapters; streaming put/get; PocketVerse migration guide.
- Custom domain; optional Vercel for the web app with API on `api.<domain>`.

---

## 16. Implementation milestones (Phase 1)
Each milestone ends with its "Done when" checks passing. Order matters: Telegram risk is measured before the recorder is built.

| # | Milestone | Done when |
|---|---|---|
| M0 | Accounts & infra (§4) — owner, with Claude Code's scripts | `https://<domain>/api/health` returns ok for db, redis; Caddy has a valid certificate |
| M1 | `unified-storage`: types, crypto format, keyring, R2 adapter, Telegram bot mode, metrics, FLOOD_WAIT, range math; unit tests | All unit tests pass; integration script uploads/reads/deletes in a test channel |
| M2 | Holocast skeleton: monorepo, shared schemas, Prisma schema + migration, config, logging, health | `pnpm build` passes; migration applied on Neon |
| M3 | Auth (widget + sessions) + storage onboarding (both event sources, linking state machine, disconnect) | Owner logs in and connects storage on the deployed domain |
| M4 | **Lab core** + Telegram server tests (T-TG-01…07, T-ONB-03/04, T-INF-04) | Owner can run them and see PASS/FAIL — **owner reviews results before M5** |
| M5 | Recorder: probe, capture, Mediabunny fMP4, segmenter, OPFS queue, uploader, recovery, stats | 5-minute recording uploads all segments in Chrome |
| M6 | Ingest, spool, packer, finalize | Packs stored encrypted in the channel; spool empty after READY |
| M7 | Share pages, access rules, unlock, playlist, signed media, R2 cache + guards, videos list, rename/visibility/delete, creator page, rate limits | Full UJ-1…UJ-5 work in Chrome |
| M8 | Lab completion: browser tests, CLI viewers, AUTOTEST reporter, T-TRN-01, manual form, report export; `unified-storage` README + alpha publish | Report exports with every test listed |
| M9 | Owner runs the protocol (§13.3) and exports `PHASE1_RESULTS.md` | Report has no NOT_RUN entries |

---

## 17. Unknowns register (resolved by Phase 1)
| ID | Unknown | Resolved by |
|---|---|---|
| U-01 | Bot upload/download throughput and FLOOD_WAIT behavior from the VM | T-TG-01…05, T-INF-03 |
| U-02 | Cost/latency of file-reference refresh; real expiry behavior | T-TG-06, T-TG-07 |
| U-03 | Which bot event source delivers membership events with the actor, and whether both can run together | T-ONB-03 |
| U-04 | Bot can resolve channel access hash without a user session | T-ONB-04 |
| U-05 | Frame acquisition API available per browser (MediaStreamTrackProcessor / library source) | T-REC-01 |
| U-06 | Recording continues correctly in a background tab | T-REC-05 |
| U-07 | Mediabunny produces keyframe-aligned ~4 s fragments with the required control | T-REC-03 |
| U-08 | AAC vs Opus encode availability per browser, and playback of the chosen codec everywhere | T-REC-02, T-PLY-04 |
| U-09 | Safari native HLS with muxed audio+video fMP4 | T-PLY-04 |
| U-10 | Memory/stability of 1–2 hour recordings | T-REC-04, T-PLY-06 |
| U-11 | Oracle A1 availability, actual limits, idle reclaim | T-INF-01, T-INF-02 |
| U-12 | Neon latency and cold start from the VM region | T-INF-04 |
| U-13 | R2 presigned redirect + CORS with hls.js/native players | T-INF-05, T-PLY-04 |
| U-14 | whisper.cpp speed on the free VM | T-TRN-01 |
| U-15 | Creator uplink sufficiency at 1.5 Mbps | T-REC-06, MQ-03 |
