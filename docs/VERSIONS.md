# Holocast — exact dependency versions

Updated on every dependency change (CLAUDE.md). Covers both repos.

| Package | Version | Where |
|---|---|---|
| node | 22.22.0 | all |
| pnpm | 10.28.0 | monorepo |
| typescript | 5.9.3 | all (pinned; see IMPLEMENTATION_NOTES) |
| zod | 4.6.5 | shared, api |
| tsup | 8.5.1 | shared, api, pkg (build) |
| vitest | 5.0.3 | shared, api, pkg (test) |
| **apps/api** | | |
| express | 5.2.1 | api |
| helmet | 8.3.0 | api |
| cookie-parser | 1.4.7 | api |
| pino | 10.4.0 | api |
| pino-http | 11.0.0 | api |
| ioredis | 6.0.0 | api |
| bullmq | 6.3.11 | api (queues: pack-upload/finalize/r2-promote/delete-video) |
| @node-rs/argon2 | 2.2.1 | api (argon2id, prebuilt; PASSWORD links) |
| express-rate-limit | 8.7.0 | api (fair-use limits) |
| rate-limit-redis | 6.0.1 | api (shared limiter store) |
| nanoid | 6.0.1 | api (ids) |
| uuidv7 | 1.2.1 | api (ids) |
| prisma / @prisma/client | 6.19.3 | api (pinned; see IMPLEMENTATION_NOTES) |
| tsx | 4.23.15 | api, pkg (dev) |
| supertest | 7.3.1 | api (test) |
| **apps/web** | | |
| next | 16.3.8 | web |
| react / react-dom | 19.3.0 | web |
| hls.js | 1.7.3 | web (playback) |
| mediabunny | 1.61.0 | web (recorder: fMP4 encode, MediaStream track sources) |
| **@shivam-dhyani/unified-storage** (package) | | |
| @aws-sdk/client-s3 | 3.1146.0 | pkg (R2 adapter) |
| @aws-sdk/s3-request-presigner | 3.1146.0 | pkg (R2 presign) |
| telegram (GramJS) | 2.26.22 | pkg (Telegram adapter) |
| **linked** | | |
| @shivam-dhyani/unified-storage | 0.1.0-alpha.0 | api (link:../../../unified-storage) |

Last updated: 2026-10-04
