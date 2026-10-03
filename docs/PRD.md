# Holocast — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Product | **Holocast** (web app) + **`@shivam-dhyani/unified-storage`** (npm package) |
| Owner | Shivam Dhyani |
| Document version | 1.0 |
| Date | 2026-10-03 |
| Status | **Phase 1: APPROVED FOR DEVELOPMENT** · **Phase 2: PROVISIONAL (will be rewritten after Phase 1 results)** |
| Companion docs | `docs/TDD.md` (technical design), `CLAUDE.md` (rules for Claude Code), `docs/PHASE1_RESULTS_TEMPLATE.md` |

---

## 0. How to read this document

1. **Only Phase 1 is built now.** Every requirement in this document carries a phase tag: `[P1]` = build now, `[P2]` = do **not** build now.
2. **Phase 2 is provisional.** Phase 2 sections describe the current intent only. After Phase 1, the owner exports `PHASE1_RESULTS.md` from the in-app **Phase 1 Lab** (see §9). A new PRD/TDD version for Phase 2 is then written from those results. Phase 2 scope, design and order **will change** based on what Phase 1 proves or disproves.
3. **Phase 1 has two goals of equal weight:**
   - (a) Ship a **minimal usable app**: record screen → instant link → anyone can watch.
   - (b) **Measure every unknown** in the architecture (Telegram bot limits, Oracle VM, Cloudflare R2, browser recording support, Neon latency, transcription speed) and produce a results report.
4. Requirement keywords: **MUST** = mandatory, **SHOULD** = expected unless a documented reason exists, **MAY** = optional.

---

## 1. Product summary

### 1.1 One-line pitch
**Holocast lets anyone record their screen and share it instantly with a link — free, unlimited, and stored in their own Telegram.**

### 1.2 The name and its story
In science fiction, people send **holographic messages**: a recorded, glowing projection that plays for whoever receives it, wherever they are. *Cast* is the word users already know from *screencast* and *broadcast*. A Holocast is a recording of your screen, sent like a hologram message — anyone with your link can play it. It passes the "verb test": *"Send me a Holocast."*

### 1.3 Problem
- Recording a screen is free everywhere (e.g., the Screenity extension records and downloads for free). **Sharing is what costs money**: Loom's free plan is capped at 25 videos and 5-minute recordings; Screenity's link sharing requires its paid Pro plan.
- A downloaded file (often hundreds of MB for long recordings) must then be uploaded somewhere else before anyone can watch it.

### 1.4 Solution
- Recording, encoding and segmenting happen **in the browser**.
- Video is stored, **encrypted**, in a private channel inside the **creator's own Telegram account**, written and read by a **platform-owned bot** that is an admin of that channel only.
- The share link exists **from the moment recording starts**; when the creator presses Stop, the link already works.
- The whole stack runs on **free tiers** (Oracle Cloud Always Free VM, Neon free Postgres, Cloudflare R2 free tier, Telegram).

### 1.5 The reusable package: `@shivam-dhyani/unified-storage`
A public, MIT-licensed TypeScript library that gives any Node.js app **one storage API over many storage backends**, with **built-in encryption**. Phase 1 adapters: **Telegram** (bot mode and user-session mode) and **Cloudflare R2**. It will later be used by PocketVerse, Holocast and future projects. Holocast is its first consumer.

### 1.6 Target users
| Persona | Need |
|---|---|
| Developers | Bug reports, PR walkthroughs |
| Mentors / tutors | Async explanations to students |
| Freelancers | Progress updates to clients |
| Support teams | "How do I…?" answers |

### 1.7 Phase 1 success definition
Phase 1 is successful when **(a)** the minimal app works end-to-end in production on the free stack, and **(b)** every test in §9 has a recorded result (PASS / FAIL / BLOCKED), exported as `PHASE1_RESULTS.md`. **A FAIL is an acceptable Phase 1 outcome** — the purpose is to learn before Phase 2. A test that was never run is **not** acceptable.

---

## 2. Decision log (all confirmed by the owner)

| # | Decision | Value |
|---|---|---|
| D-01 | App name | **Holocast** |
| D-02 | Package name | **`@shivam-dhyani/unified-storage`** — public GitHub repo, published to npm, MIT license |
| D-03 | Phase 1 deliverable | **Minimal usable app** + all architecture tests + in-app Phase 1 Lab |
| D-04 | Signup | **Open signup** (no invite codes), protected by fair-use limits (D-11) |
| D-05 | Login | Creators log in **with Telegram only** (official Login Widget, no OTP, no user session stored). Viewers never log in, except owners viewing their own private videos. |
| D-06 | Recording limits | **1080p, 30 fps, max 2 hours**, mic audio + tab audio |
| D-07 | Browsers | **Chrome, Edge, Firefox, Safari (desktop)** are all **targets**. Tab audio is technically possible only on Chrome/Edge; Firefox/Safari record mic only (see FR-REC-04). Phase 1 measures which browsers fully work. |
| D-08 | Link types | Chosen by the creator at creation time: **Public, Unlisted, Password-protected, Private** |
| D-09 | Encryption | All video data stored in Telegram **MUST** be encrypted (AES-256-GCM, via the package) |
| D-10 | Package scope (Phase 1) | Common interface + **Telegram adapter (bot mode + user-session mode)** + **R2 adapter** + encryption layer |
| D-11 | Usage limits | **Fair-use (abuse) rate limits only**; storage remains unlimited |
| D-12 | PocketVerse | Migrates to the package **after** Phase 1; the API is designed now to support PocketVerse's user-session mode |
| D-13 | Code structure | Holocast = **pnpm monorepo: Next.js (web) + Express (API)**; package = separate repo |
| D-14 | Domain | **Free subdomain** (DuckDNS) in Phase 1 |
| D-15 | Oracle Cloud | Owner has **no account yet** — setup steps are in TDD §4 |
| D-16 | Phase 1 pass targets | Video start **< 2 s**, seek **< 1.5 s**, upload keeps up at **1.5 Mbps**, **1-hour** recording completes without crash, **10** simultaneous viewers without stalls |
| D-17 | Docs | One PRD + one TDD covering Phase 1 (build) and Phase 2 (provisional), Markdown in `/docs`, plus `CLAUDE.md` |
| D-18 | Hosting change vs. earlier discussion | Web (Next.js) is hosted **on the same Oracle VM** as the API (not Vercel) so the app and API share one origin (cookies work on a free subdomain; video traffic never touches Vercel's bandwidth limits). Rationale in TDD §3.3. |

---

## 3. Scope

### 3.1 Phase 1 — IN scope `[P1]`
1. Telegram login (Login Widget) and user accounts.
2. Storage onboarding: the creator creates a private Telegram channel and adds the Holocast bot as admin via a deep link; the app detects it automatically.
3. Storage disconnect/reconnect handling (bot removed → links show "storage disconnected"; bot re-added → all links work again).
4. Browser recording: screen + mic (+ tab audio on Chrome/Edge), 1080p30, up to 2 hours, encoded in the browser into ~4-second fMP4 segments.
5. Crash-safe client upload queue (segments survive a tab reload).
6. Server ingest: segments → 1-minute packs → encrypted → uploaded to Telegram by the bot.
7. Instant share link with the 4 link types; password gate; private (owner-only) viewing.
8. Playback page (HLS) with seeking; R2 cache for fast start.
9. "My videos" list: copy link, change link type/password, rename, delete.
10. Fair-use rate limits.
11. **Phase 1 Lab** (admin-only page): runs automated tests, collects browser and CLI results, collects manual answers, exports `PHASE1_RESULTS.md` + `phase1-results.json`.
12. The `unified-storage` package (D-10), with unit tests and an integration test script.
13. Production deployment on the free stack.

### 3.2 Phase 1 — OUT of scope (do NOT build)
Webcam bubble in the product (a Lab-only experiment exists, T-REC-08), video editing/trimming, transcripts in the product (Lab benchmark only, T-TRN-01), AI chapters/titles, comments, reactions, viewer analytics, seek-preview thumbnails (sprite sheets), MP4 download/export, "regenerate link", Chrome extension, mobile recording, backup-bot failover automation, teams/workspaces, custom domain, PocketVerse migration, rebuilding the DB index from Telegram captions (captions are *written* in P1 so this is possible later).

### 3.3 Phase 2 — PROVISIONAL scope `[P2]` (will change after Phase 1)
Listed in priority order as currently understood; the owner re-ranks these in the Phase 1 manual questionnaire (MQ-12).
1. Fixes and architecture changes required by Phase 1 FAIL results (always first).
2. Webcam bubble (draggable circle) composited into the recording.
3. MP4 download/export (decrypt + concatenate init + segments).
4. Transcripts (whisper.cpp on VM, if T-TRN-01 shows it is viable) + AI chapters/titles.
5. Timestamped comments and emoji reactions.
6. Seek-preview sprite sheets (thumbnails on seek-bar hover).
7. Viewer analytics (views, watch-through, drop-off heatmap).
8. In-browser trim.
9. Backup bot + automatic failover; bot pool if throughput requires.
10. Regenerate link, link expiry dates.
11. Rebuild index from Telegram (self-describing storage).
12. Chrome extension.
13. Custom domain + public launch (LinkedIn).
14. PocketVerse migration to `unified-storage` (separate project plan).

---

## 4. User journeys `[P1]`

### UJ-1 First-time creator
1. Opens Holocast → clicks **"Log in with Telegram"** → confirms in Telegram → is logged in.
2. Sees **Connect storage** wizard:
   - Step 1: "Create a new private channel in Telegram named *Holocast Storage*" (short guide + screenshots/animation).
   - Step 2: Clicks **"Add Holocast bot to my channel"** (opens a `t.me` deep link). Telegram asks which channel to add the bot to and which admin rights to grant; the creator picks the new channel and confirms.
   - Step 3: The wizard detects the connection automatically (polling) and shows **"Storage connected ✅"**. The bot posts a confirmation message in the channel.
3. Lands on **Record**.

### UJ-2 Record and share
1. Chooses link type (Public / Unlisted / Password / Private) and optional title. If Password, enters a password.
2. Clicks **Start recording** → the browser's screen picker opens → chooses screen/window/tab (+ "share tab audio" on Chrome/Edge).
3. **The share link appears immediately** with a Copy button (instant link).
4. Recording runs (timer, stop button, upload status: "All caught up" / "Uploading… N s behind").
5. Clicks **Stop** → within a few seconds the status becomes **Ready**; the link plays the full video.

### UJ-3 Viewer
1. Opens the link → sees title, creator name, player.
2. If Password: sees a password form first. If Private and not the owner: sees "This video is private."
3. Presses play → video starts (target < 2 s); seeking works anywhere (target < 1.5 s).

### UJ-4 Manage videos
"My videos" list shows title, duration, date, link type, status. Actions: Copy link, Rename, Change link type (and password), Delete (with confirmation; deletes the stored files from Telegram).

### UJ-5 Disconnect / reconnect
- Creator clicks **Disconnect storage** (confirmation explains: "Your files stay in your Telegram channel, but all your links will stop working until you reconnect.") → bot leaves the channel.
- Or the creator removes the bot in Telegram directly → app detects it.
- Viewers of that creator's links see **"The creator's storage is disconnected."**
- Re-adding the bot to the **same** channel restores every link (message IDs never change).

### UJ-6 Admin runs Phase 1 Lab
Admin opens `/lab` → runs tests → follows the test protocol (TDD §13) → answers the manual questions → clicks **Export report** → sends `PHASE1_RESULTS.md` (and `.json`) to Claude to generate the Phase 2 documents.

---

## 5. Functional requirements

### 5.1 Authentication — FR-AUTH
| ID | Phase | Requirement |
|---|---|---|
| FR-AUTH-01 | P1 | The app MUST offer login only via the official **Telegram Login Widget** on the production domain. |
| FR-AUTH-02 | P1 | The server MUST verify the widget payload signature and reject payloads older than 24 hours (TDD §8.1). |
| FR-AUTH-03 | P1 | Users MUST be identified by their **Telegram user ID** (immutable). Name, username and photo are refreshed on each login. |
| FR-AUTH-04 | P1 | Sessions MUST use an httpOnly, Secure, SameSite=Lax cookie holding an opaque random token; only its SHA-256 hash is stored. Session lifetime 30 days, sliding. |
| FR-AUTH-05 | P1 | Logout MUST delete the session server-side. Logout MUST NOT affect storage or links. |
| FR-AUTH-06 | P1 | Admins are defined by `ADMIN_TELEGRAM_IDS` (env). Only admins can open `/lab`. |
| FR-AUTH-07 | P1 | The app MUST NOT ask for a phone number or OTP and MUST NOT store any Telegram user session. |

### 5.2 Storage onboarding & connection — FR-STO
| ID | Phase | Requirement |
|---|---|---|
| FR-STO-01 | P1 | After first login, users without connected storage MUST be routed to the Connect-storage wizard (UJ-1). |
| FR-STO-02 | P1 | The "Add bot" button MUST open `https://t.me/<BOT_USERNAME>?startchannel&admin=post_messages+edit_messages+delete_messages`. |
| FR-STO-03 | P1 | When the bot is added as admin to a channel, the system MUST identify **who** added it and link that channel to the matching Holocast user. |
| FR-STO-04 | P1 | If the bot is added by a Telegram user who has no Holocast account, or by a user who already has a CONNECTED channel, the bot MUST leave that channel, and the event MUST be logged. |
| FR-STO-05 | P1 | On successful connection the bot MUST post a confirmation message in the channel (TDD §8.3) and the wizard MUST show "Storage connected" within 10 s of the event. |
| FR-STO-06 | P1 | If the bot is removed/kicked/demoted (loses post rights), the channel MUST be marked DISCONNECTED within 60 s. |
| FR-STO-07 | P1 | If the bot is re-added to a previously connected channel (same channel ID) by its owner, the channel MUST return to CONNECTED and all existing links MUST work again without any data migration. |
| FR-STO-08 | P1 | "Disconnect storage" in the app MUST make the bot leave the channel after a confirmation dialog, mark the channel DISCONNECTED, and never delete Telegram data. |
| FR-STO-09 | P1 | One active (CONNECTED) storage channel per user in Phase 1. |
| FR-STO-10 | P2 | Backup bot as a second admin + automatic failover. |

### 5.3 Recording — FR-REC
| ID | Phase | Requirement |
|---|---|---|
| FR-REC-01 | P1 | Before recording, the app MUST run a **capability probe** (TDD §10.2) and show a clear message if the browser cannot record; the probe result MUST be sent to the Lab when the user is an admin. |
| FR-REC-02 | P1 | Video MUST be encoded in the browser to **H.264**, target 1920×1080 (downscale preserving aspect ratio if the source is larger; never upscale), 30 fps, default bitrate **1.5 Mbps** (Lab may select 1.0 / 1.5 / 2.5 Mbps). |
| FR-REC-03 | P1 | Output MUST be **fragmented MP4**: one init segment + media segments of **~4 s**, each starting with a keyframe. |
| FR-REC-04 | P1 | Audio: microphone on all browsers; **tab audio additionally on Chrome/Edge** when the user ticks "share tab audio". Mic and tab audio MUST be mixed into one audio track. On Firefox/Safari the UI MUST state "Tab audio isn't supported in this browser — your microphone will be recorded." |
| FR-REC-05 | P1 | Recording MUST auto-stop at **2 hours**, with a warning at 1 h 55 m. |
| FR-REC-06 | P1 | Each segment MUST be written to browser storage (OPFS) **before** upload, and removed only after the server acknowledges it. |
| FR-REC-07 | P1 | If the tab reloads or crashes, on next open the app MUST detect unfinished uploads and resume them, then finalize the video. |
| FR-REC-08 | P1 | The share link MUST be created and shown **before** the first segment is recorded (instant link). |
| FR-REC-09 | P1 | During recording, the UI MUST show elapsed time and upload status (seconds of video not yet acknowledged). |
| FR-REC-10 | P1 | Recording MUST continue correctly when the user switches to another tab/window (measured by T-REC-05). |
| FR-REC-11 | P2 | Webcam bubble overlay. |
| FR-REC-12 | P2 | Pause/resume, countdown, drawing/annotations. |

### 5.4 Sharing & link types — FR-SHR
| ID | Phase | Requirement |
|---|---|---|
| FR-SHR-01 | P1 | Every video has exactly one share URL: `https://<domain>/v/<shareId>`, where `shareId` is a 21-character random ID. |
| FR-SHR-02 | P1 | The creator MUST choose the link type **before** recording (default: Unlisted). |
| FR-SHR-03 | P1 | **Public:** anyone with the link can watch; the video is listed on the creator's public page `/c/<creatorPublicId>`; the page is indexable by search engines and has Open Graph tags. |
| FR-SHR-04 | P1 | **Unlisted:** anyone with the link can watch; not listed anywhere; page sends `noindex`. |
| FR-SHR-05 | P1 | **Password-protected:** viewers MUST enter the password before any playlist or media is served; the password is stored only as an argon2id hash; successful unlock lasts 24 h per browser; unlock attempts are rate-limited. Minimum password length: 6. |
| FR-SHR-06 | P1 | **Private:** only the logged-in owner can watch; everyone else sees "This video is private". |
| FR-SHR-07 | P1 | The creator MUST be able to change the link type (and set/change the password) after recording. The URL stays the same. |
| FR-SHR-08 | P1 | All media URLs MUST be signed and expire (TDD §11.4), for every link type. |
| FR-SHR-09 | P1 | The database MUST NOT store the raw `shareId`; it stores a SHA-256 hash for lookup and an encrypted copy for the owner's "Copy link" (TDD §9). |
| FR-SHR-10 | P2 | Regenerate link, expiry dates, email-restricted links. |

### 5.5 Playback — FR-PLY
| ID | Phase | Requirement |
|---|---|---|
| FR-PLY-01 | P1 | Playback MUST use HLS with fMP4 segments (hls.js where supported; native HLS otherwise). |
| FR-PLY-02 | P1 | The share link MUST work while the recording is still in progress (partial playback) and after finalization (full VOD). |
| FR-PLY-03 | P1 | Seeking to any position MUST download only the needed segments. |
| FR-PLY-04 | P1 | If the creator's storage is disconnected, the page MUST show "The creator's storage is disconnected" instead of a broken player. |
| FR-PLY-05 | P1 | Deleted videos MUST show "This video was deleted"; unknown IDs MUST show 404. |
| FR-PLY-06 | P2 | Seek-preview thumbnails, playback speed control, captions. |

### 5.6 Video management — FR-VID
| ID | Phase | Requirement |
|---|---|---|
| FR-VID-01 | P1 | "My videos" lists the user's videos (newest first) with title, duration, date, link type, status. |
| FR-VID-02 | P1 | Rename (max 120 characters). Default title: `Recording – <date time>`. |
| FR-VID-03 | P1 | Delete MUST remove the video's Telegram messages, R2 cache objects and spool files, and make the link show "deleted". |
| FR-VID-04 | P2 | Download as MP4. |

### 5.7 Fair-use limits — FR-FAIR
| ID | Phase | Requirement |
|---|---|---|
| FR-FAIR-01 | P1 | Max **1 active recording** per user at a time. |
| FR-FAIR-02 | P1 | Max **30 new videos per user per hour**. |
| FR-FAIR-03 | P1 | Segment uploads: max **10 requests/second** burst per user (normal is 1 every 4 s). |
| FR-FAIR-04 | P1 | Viewer media requests: max **300 per minute per IP**. |
| FR-FAIR-05 | P1 | Password unlock: max **10 attempts per 15 minutes per IP per video**. |
| FR-FAIR-06 | P1 | Limits MUST return HTTP 429 with a human-readable message; values MUST be configurable via env. |

### 5.8 Phase 1 Lab — FR-LAB
| ID | Phase | Requirement |
|---|---|---|
| FR-LAB-01 | P1 | Admin-only page `/lab` listing every test from §9 with: ID, name, runner type, pass threshold, latest result, status (PASS / FAIL / BLOCKED / NOT_RUN / INFO), run count, last run time. |
| FR-LAB-02 | P1 | **Server tests** run from a "Run" button (executed on the VM as background jobs; results stored). |
| FR-LAB-03 | P1 | **Browser tests** run inside the admin's browser from the Lab page and post results with environment info (browser, version, OS). |
| FR-LAB-04 | P1 | **CLI tests** show the exact command to run; the CLI posts results to the Lab API. |
| FR-LAB-05 | P1 | The recorder MUST automatically submit recording statistics (T-REC-03…07) to the Lab when the recording user is an admin. |
| FR-LAB-06 | P1 | **Manual questions** (§9.6) are answered in a form on the Lab page and saved. |
| FR-LAB-07 | P1 | **Export** produces `PHASE1_RESULTS.md` and `phase1-results.json` (format: TDD §13.5 and `docs/PHASE1_RESULTS_TEMPLATE.md`). |
| FR-LAB-08 | P1 | Lab test data (synthetic packs) MUST be clearly marked and removable with a "Clean up Lab data" button. |
| FR-LAB-09 | P1 | Status is computed from thresholds defined in a single config file that matches §9 of this PRD exactly. |

### 5.9 `unified-storage` package — FR-PKG
| ID | Phase | Requirement |
|---|---|---|
| FR-PKG-01 | P1 | One adapter interface for put / ranged get / delete / stat, used identically for all backends (TDD §6.2). |
| FR-PKG-02 | P1 | Telegram adapter, **bot mode**: attach to a channel the bot is admin of, upload documents, range-read, delete, refresh file references, handle FLOOD_WAIT and DC migration. |
| FR-PKG-03 | P1 | Telegram adapter, **user-session mode**: same operations using a user session, plus **find-or-create** a storage channel by marker (never creating a duplicate on reconnect — the PocketVerse bug). |
| FR-PKG-04 | P1 | R2 adapter (S3 API): put, ranged get, delete, stat, presigned GET URL. |
| FR-PKG-05 | P1 | Encryption layer usable over any adapter: AES-256-GCM, chunked format with **random-access range decryption**, envelope keys with key rotation (TDD §6.4). |
| FR-PKG-06 | P1 | Metrics hook (callback) reporting bytes, durations, retries and FLOOD_WAITs — used by the Lab. |
| FR-PKG-07 | P1 | TypeScript, ESM + CJS builds, type definitions, unit tests, README with the API and a security section. |
| FR-PKG-08 | P1 | Published to npm as `@shivam-dhyani/unified-storage` with an `alpha` pre-release version during Phase 1. |
| FR-PKG-09 | P2 | More adapters (S3, Google Drive, local disk), stable 1.0 release, PocketVerse migration. |

---

## 6. Non-functional requirements

| ID | Phase | Requirement |
|---|---|---|
| NFR-01 | P1 | **Cost:** ₹0/month. Every service used MUST be within a free tier. Usage guards MUST stop R2 writes before free-tier limits are reached (TDD §11.6). |
| NFR-02 | P1 | **Security:** no Telegram user sessions stored by Holocast; bot token and encryption keys only in server environment (never in DB, logs or client); video data in Telegram encrypted; share IDs stored hashed. |
| NFR-03 | P1 | **Privacy:** the bot can only access channels it was added to. Private/password videos are never written to the R2 cache. |
| NFR-04 | P1 | **Performance targets** are the Phase 1 pass thresholds in §9 (they are measured, not assumed). |
| NFR-05 | P1 | **Reliability:** a recording is never lost because of a tab reload, a network drop of up to 10 minutes, or an API restart (segments are retried; packs are re-uploadable from spool). |
| NFR-06 | P1 | **Observability:** structured JSON logs with secrets redacted; every Lab test stores raw metrics. |
| NFR-07 | P1 | **Accessibility basics:** keyboard-operable controls, visible focus, labels on form fields, color contrast ≥ 4.5:1 for text. |
| NFR-08 | P1 | **Browsers:** latest stable desktop Chrome, Edge, Firefox, Safari. |

---

## 7. Content & messaging (exact UI strings for key states) `[P1]`
| State | Text |
|---|---|
| Storage not connected | "Connect your storage — your videos are saved, encrypted, in your own Telegram channel." |
| Storage connected | "Storage connected ✅ Your recordings will be saved in **{channelTitle}**." |
| Disconnect confirm | "Disconnect storage? Your files stay in your Telegram channel, but all your links will stop working until you reconnect the same channel." |
| Viewer – disconnected | "The creator's storage is disconnected. Ask them to reconnect it." |
| Viewer – private | "This video is private." |
| Viewer – deleted | "This video was deleted." |
| Firefox/Safari audio | "Tab audio isn't supported in this browser — your microphone will be recorded." |
| Unsupported browser | "Recording isn't supported in this browser yet. Please use the latest Chrome or Edge." (shown only if the capability probe fails) |
| Upload status | "All caught up" / "Uploading… {n}s behind" |
| Rate limited | "You're doing that too often. Please wait a minute and try again." |

---

## 8. Risks (Phase 1 exists to measure these)
| ID | Risk | Measured by |
|---|---|---|
| R-01 | Telegram throttles bot downloads/uploads → slow start/seek or stalls | T-TG-01…07, T-PLY-02, T-PLY-03, T-PLY-05 |
| R-02 | Bot cannot reliably learn who added it / cannot access the channel | T-ONB-03, T-ONB-04 |
| R-03 | Firefox/Safari lack APIs for in-browser H.264 fMP4 recording | T-REC-01, T-REC-02, T-REC-03 |
| R-04 | Background-tab throttling breaks recording when the user switches tabs | T-REC-05 |
| R-05 | Oracle A1 instance unavailable, reduced, or reclaimed when idle | T-INF-01, T-INF-02 |
| R-06 | Neon latency/cold start too slow for the start-time target | T-INF-04 |
| R-07 | R2 redirect/CORS breaks playback in some browsers | T-INF-05, T-PLY-04 |
| R-08 | Muxed audio+video fMP4 HLS not playable natively in Safari | T-PLY-04 |
| R-09 | Creator uplink too slow for 1.5 Mbps | T-REC-06 |
| R-10 | Transcription too slow on free VM | T-TRN-01 |
| R-11 | Telegram Terms of Service / account limits for storage-heavy bots | Monitored (MQ-09); no automated test |

---

## 9. Phase 1 test catalog (what we test, how, and what "pass" means)

**Runner types:** `SERVER` = Run button in Lab, executes on the VM · `BROWSER` = runs in the admin's browser from the Lab or recorder · `CLI` = command run from a terminal, posts to the Lab · `MANUAL` = owner observes and answers in the Lab form · `AUTOTEST` = automated integration test suite (`pnpm test:integration`) whose summary is posted to the Lab.

**Status rules:** PASS = threshold met · FAIL = threshold not met · BLOCKED = could not run (reason required) · INFO = informational, no threshold · NOT_RUN = not executed (not allowed at Phase 1 exit).

Detailed procedures for every test are in **TDD §13**. Thresholds below are the single source of truth and MUST match `apps/api/src/lab/thresholds.ts`.

### 9.1 Telegram storage (bot) — run from the VM
| ID | Test | Runner | Pass threshold |
|---|---|---|---|
| T-TG-01 | Upload throughput: 10 synthetic 12 MB encrypted packs, sequential | SERVER | median ≥ **1.0 MB/s** |
| T-TG-02 | Sequential full-pack download throughput | SERVER | median ≥ **2.0 MB/s** |
| T-TG-03 | Random range-read latency: 50 reads of 1 MB at random offsets | SERVER | p50 ≤ **800 ms**, p95 ≤ **1500 ms** |
| T-TG-04 | 10 concurrent range-read streams for 60 s | SERVER | aggregate ≥ **2.5 MB/s** and p95 ≤ **2000 ms** |
| T-TG-05 | Burst: 30 packs uploaded back-to-back; count FLOOD_WAIT | SERVER | no single FLOOD_WAIT > **10 s**; total wait ≤ **30 s** |
| T-TG-06 | File-reference refresh cost (`getMessages` before read) | SERVER | p95 added latency ≤ **300 ms** |
| T-TG-07 | Download using a file reference cached ≥ 24 h earlier | SERVER (run twice, 24 h apart) | INFO (records whether expiry occurred and recovery worked; recovery MUST succeed) |

### 9.2 Onboarding & connection
| ID | Test | Runner | Pass threshold |
|---|---|---|---|
| T-ONB-01 | Telegram Login Widget works on the DuckDNS domain | MANUAL + auto log | login succeeds in all 4 browsers |
| T-ONB-02 | `startchannel` deep link adds the bot with the requested rights | MANUAL + auto check | bot is admin with post/edit/delete |
| T-ONB-03 | Bot learns the adding user for each event source (Bot API, MTProto) and whether both work at the same time | SERVER (event log) | ≥ 1 source delivers the event with the adder's user ID within **10 s**; coexistence result recorded |
| T-ONB-04 | Bot resolves channel access for MTProto file operations | SERVER | resolved without user session |
| T-ONB-05 | Remove bot → DISCONNECTED; re-add → links work again | MANUAL + auto check | detection ≤ **60 s**; old link plays after re-add |

### 9.3 Recording (run in each of Chrome, Edge, Firefox, Safari)
| ID | Test | Runner | Pass threshold |
|---|---|---|---|
| T-REC-01 | Capability probe | BROWSER | INFO per browser (lists every API's availability) |
| T-REC-02 | Codec selection (H.264 profile, AAC/Opus, hardware/software) | BROWSER | a supported H.264 + audio config found |
| T-REC-03 | 5-minute recording end-to-end | BROWSER | video finalizes and plays to the end; segment durations within 3.5–4.5 s (except last) |
| T-REC-04 | 60-minute recording | BROWSER | completes, no tab crash, recorded duration within **±2 %** of wall-clock time, max encoder queue < **60 frames** |
| T-REC-05 | Background tab: during recording, switch to another tab/window for 5 minutes | BROWSER | recorded duration within ±2 % of wall-clock; no frozen frames > **2 s** |
| T-REC-06 | Upload keep-up at the default bitrate (1.5 Mbps) during a 30-minute recording | BROWSER | max upload lag ≤ **8 s**; final ack ≤ **10 s** after Stop (with uplink ≥ 3 Mbps, MQ-03) |
| T-REC-07 | Crash recovery: reload the tab mid-recording | BROWSER + MANUAL | all segments recorded before reload are uploaded; video finalizes as playable |
| T-REC-08 | Experiment: webcam composited with screen (Chrome/Edge only) | BROWSER | INFO (measures frames dropped when tab is in background) |

### 9.4 Playback
| ID | Test | Runner | Pass threshold |
|---|---|---|---|
| T-PLY-01 | Time to first frame, cached start (R2) — 10 runs | BROWSER | p50 < **2000 ms** |
| T-PLY-02 | Time to first frame, uncached (forced Telegram path) — 10 runs | BROWSER | p50 < **2000 ms** (FAIL is informative, not blocking) |
| T-PLY-03 | Seek latency to random uncached positions — 10 seeks | BROWSER | p50 < **1500 ms** |
| T-PLY-04 | Playback works in Chrome, Edge, Firefox, Safari (hls.js and native) including R2 redirect | BROWSER | plays + seeks in all 4 browsers |
| T-PLY-05 | 10 simulated concurrent viewers on a 10-minute video, uncached and cached | CLI | **0 stalls**; ≥ **99 %** segments delivered before deadline |
| T-PLY-06 | 2-hour video: seek to 1:55:00 | BROWSER | p50 < **1500 ms** |

### 9.5 Infrastructure, security, other
| ID | Test | Runner | Pass threshold |
|---|---|---|---|
| T-INF-01 | Oracle A1 instance obtained (region, shape, attempts) | MANUAL | INFO |
| T-INF-02 | Oracle idle-reclaim notices during Phase 1 | MANUAL | INFO (any notice is recorded) |
| T-INF-03 | Telegram throughput from laptop vs VM (repeat T-TG-01…03 via CLI on laptop) | CLI | INFO |
| T-INF-04 | Neon: p50/p95 segment-lookup query latency; first query after ≥ 10 min idle | SERVER | p95 ≤ **100 ms** warm; cold-start recorded (INFO) |
| T-INF-05 | R2: presigned redirect fetch works without CORS errors; latency | BROWSER | works in all 4 browsers |
| T-INF-06 | R2 free-tier usage counters at Phase 1 end | SERVER | INFO (must be below free limits) |
| T-INF-07 | Bytes served per viewer-hour from VM | SERVER | INFO |
| T-INF-08 | Spool disk: peak usage and cleanup after packs are stored | SERVER | spool empty for READY videos |
| T-SEC-01 | Access-control matrix for all 4 link types | AUTOTEST | 100 % of matrix cases pass |
| T-SEC-02 | Signed media URLs: expired and tampered URLs rejected | AUTOTEST | 100 % rejected |
| T-FAIR-01 | Each fair-use limit returns 429 at its threshold | AUTOTEST | 100 % of cases pass |
| T-TRN-01 | whisper.cpp `base` model on a 10-minute recording | SERVER | INFO; viable if real-time factor ≤ **1.0** |

### 9.6 Manual questionnaire (answered in the Lab form)
| ID | Question |
|---|---|
| MQ-01 | Oracle: region chosen, shape obtained (OCPU/RAM), number of attempts/days to get it, any problems. |
| MQ-02 | Oracle/Cloudflare/Neon billing pages at Phase 1 end: any charge, warning or limit email? |
| MQ-03 | Your network: upload and download speed (from speedtest.net, Mbps), connection type. |
| MQ-04 | Devices used for each browser test (OS, CPU, RAM). Which Mac was used for Safari? |
| MQ-05 | Video quality at 1.0 / 1.5 / 2.5 Mbps: is small code text readable? Rate each 1–5. |
| MQ-06 | Any browser crash, freeze, or fan/CPU spike while recording? Which browser, when? |
| MQ-07 | Onboarding: how many minutes did connecting storage take; any confusing step? |
| MQ-08 | Playback feel: rate start and seek speed 1–5 in each browser. |
| MQ-09 | Did Telegram show any warning, limit, or restriction to the bot or your account? |
| MQ-10 | Anything that surprised you (good or bad). |
| MQ-11 | Recording UX: anything missing that blocks you from using Holocast daily? |
| MQ-12 | Re-rank the Phase 2 list in §3.3 (most important first) and add/remove items. |

---

## 10. Phase 1 exit procedure (what the owner does at the end)
1. Run every test in §9 following TDD §13 (order given there).
2. For every FAIL or BLOCKED, write a one-line note in the Lab (what happened).
3. Answer all manual questions MQ-01…MQ-12 in the Lab.
4. Click **Export report** → download `PHASE1_RESULTS.md` and `phase1-results.json`.
   - If the Lab itself is broken, fill `docs/PHASE1_RESULTS_TEMPLATE.md` by hand instead.
5. Give both files to Claude with the instruction: *"Generate the Phase 2 PRD and TDD (v2.0) for Holocast from these Phase 1 results."*
6. Phase 2 documents replace §3.3 and all `[P2]` items; Phase 2 development starts only after the owner approves them.

---

## 11. Phase 2 outline (PROVISIONAL — will be rewritten)
Phase 2 turns the Phase 1 app into a launch-ready product. Expected work streams (each subject to Phase 1 results):
- **Architecture corrections** from FAIL results (TDD §14 lists the predefined options per failure).
- **Recording features:** webcam bubble, pause/resume, countdown.
- **Sharing:** MP4 download, regenerate link, expiry.
- **Engagement:** comments, reactions, analytics.
- **Intelligence:** transcripts, AI titles/chapters (only if T-TRN-01 is viable; otherwise a free-tier API is evaluated).
- **Resilience:** backup bot failover, index rebuild from Telegram captions.
- **Launch:** custom domain, brand/UI polish, landing page, LinkedIn launch.
- **Package:** `unified-storage` 1.0, more adapters, PocketVerse migration.
