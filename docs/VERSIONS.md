# Holocast — exact dependency versions

Updated on every dependency change (CLAUDE.md).

| Package | Version | Where |
|---|---|---|
| node | 22.22.0 | all |
| pnpm | 10.28.0 | monorepo |
| typescript | 5.9.3 | all (pinned; see IMPLEMENTATION_NOTES) |
| zod | 4.6.5 | shared, api |
| tsup | 8.5.1 | shared, api (build) |
| vitest | 5.0.3 | shared, api (test) |
| **apps/api** | | |
| express | 5.2.1 | api |
| helmet | 8.3.0 | api |
| cookie-parser | 1.4.7 | api |
| pino | 10.4.0 | api |
| pino-http | 11.0.0 | api |
| ioredis | 6.0.0 | api |
| prisma / @prisma/client | 6.19.3 | api (pinned; see IMPLEMENTATION_NOTES) |
| tsx | 4.23.15 | api (dev) |
| supertest | (latest) | api (test) |
| **apps/web** | | |
| next | 16.3.8 | web |
| react / react-dom | 19.3.0 | web |
| **linked** | | |
| @shivam-dhyani/unified-storage | 0.1.0-alpha.0 | api (link:../../../unified-storage) |

Last updated: 2026-10-03
