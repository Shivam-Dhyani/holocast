# Holocast — Phase 1 Results (PHASE1_RESULTS.md)

> **How to use this file.** Normally the Lab generates this file automatically (`/lab` → Report → Export). Fill it by hand **only if the Lab cannot export**. Replace every `…`. Status must be one of: **PASS · FAIL · BLOCKED · INFO · NOT_RUN** (NOT_RUN is not allowed at Phase 1 exit). Thresholds come from PRD §9; procedures from TDD §13.2.
>
> **When done:** give this file (and `phase1-results.json` if generated) to Claude with: *"Generate the Phase 2 PRD and TDD (v2.0) for Holocast from these Phase 1 results."*

## 1. Header
| Field | Value |
|---|---|
| App version (git commit) | … |
| `unified-storage` version | … |
| Generated at (UTC) | … |
| Domain | … |
| VM region / shape / OCPU / RAM | … |
| Neon region | … |
| Active bot event source | botapi / mtproto |

## 2. Summary
| PASS | FAIL | BLOCKED | INFO | NOT_RUN |
|---|---|---|---|---|
| … | … | … | … | … |

## 3. Results

### 3.1 Telegram storage (run on the VM)
| ID | Test | Threshold | Result | Status | Runs | Notes |
|---|---|---|---|---|---|---|
| T-TG-01 | Upload throughput (10 × 12 MB) | median ≥ 1.0 MB/s | median … MB/s | … | … | … |
| T-TG-02 | Sequential download | median ≥ 2.0 MB/s | median … MB/s | … | … | … |
| T-TG-03 | Random 1 MB range reads (50) | p50 ≤ 800 ms, p95 ≤ 1500 ms | p50 … / p95 … ms | … | … | … |
| T-TG-04 | 10 concurrent readers, 60 s | ≥ 2.5 MB/s, p95 ≤ 2000 ms | … MB/s, p95 … ms | … | … | … |
| T-TG-05 | Burst 30 uploads | max wait ≤ 10 s, total ≤ 30 s | max … s, total … s | … | … | … |
| T-TG-06 | File-ref refresh cost | p95 ≤ 300 ms | p95 … ms | … | … | … |
| T-TG-07 | Stale ref after 24 h | INFO; recovery must succeed | expired? yes/no; recovered? yes/no | … | … | … |

### 3.2 Onboarding & connection
| ID | Test | Threshold | Result | Status | Notes |
|---|---|---|---|---|---|
| T-ONB-01 | Login widget, 4 browsers | all 4 succeed | browsers OK: … | … | … |
| T-ONB-02 | Deep link adds bot with rights | post + delete rights | rights: … | … | … |
| T-ONB-03 | Event source(s) deliver actor ≤ 10 s | ≥ 1 source OK | botapi: … / mtproto: … / both together: … | … | … |
| T-ONB-04 | Channel access without user session | resolved | method used: … | … | … |
| T-ONB-05 | Remove → detect; re-add → old link plays | ≤ 60 s, fetch OK | detected in … s; fetch … | … | … |

### 3.3 Recording — browser matrix (write the measured value and status in each cell)
| ID | Test | Threshold | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|---|---|
| T-REC-01 | Capability probe | INFO | … | … | … | … |
| T-REC-02 | Supported H.264 + audio config | recordable | … | … | … | … |
| T-REC-03 | 5-min E2E | plays to end; seg 3.5–4.5 s | … | … | … | … |
| T-REC-04 | 60-min recording | no crash; ±2 % duration; queue < 60 | … | … | … | … |
| T-REC-05 | Background tab 5 min | ±2 %; no frozen frame > 2 s | … | … | … | … |
| T-REC-06 | Upload keep-up 30 min @1.5 Mbps | max lag ≤ 8 s; final ack ≤ 10 s | … | … | … | … |
| T-REC-07 | Crash recovery (reload) | all pre-reload segments; playable | … | … | … | … |
| T-REC-08 | Webcam composite experiment | INFO (Chrome/Edge) | … | … | n/a | n/a |

### 3.4 Playback — browser matrix
| ID | Test | Threshold | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|---|---|
| T-PLY-01 | TTFF cached (p50) | < 2000 ms | … | … | … | … |
| T-PLY-02 | TTFF uncached (p50) | < 2000 ms | … | … | … | … |
| T-PLY-03 | Seek uncached (p50) | < 1500 ms | … | … | … | … |
| T-PLY-04 | Plays + seeks (engine used) | works | … | … | … | … |
| T-PLY-06 | Seek near end of 2-h video (p50) | < 1500 ms | … | … | … | … |

| ID | Test | Threshold | Uncached run | Cached run | Status |
|---|---|---|---|---|---|
| T-PLY-05 | 10 simulated viewers, 10-min video | 0 stalls; ≥ 99 % on time | stalls … / on-time … % | stalls … / on-time … % | … |

### 3.5 Infrastructure, security, other
| ID | Test | Threshold | Result | Status | Notes |
|---|---|---|---|---|---|
| T-INF-01 | Oracle A1 obtained | INFO | … | … | … |
| T-INF-02 | Oracle idle-reclaim notices | INFO | … | … | … |
| T-INF-03 | Laptop vs VM Telegram throughput | INFO | laptop: … / VM: … | … | … |
| T-INF-04 | Neon query latency | warm p95 ≤ 100 ms; cold INFO | warm p50 … / p95 … ms; cold … ms | … | … |
| T-INF-05 | R2 redirect + CORS (4 browsers) | works in all 4 | … | … | … |
| T-INF-06 | R2 usage vs free tier | below limits | bytes … / Class A … / Class B … | … | … |
| T-INF-07 | Bytes per viewer-hour | INFO | … MB/viewer-hour | … | … |
| T-INF-08 | Spool cleanup | none left for READY | … | … | … |
| T-SEC-01 | Access-control matrix | 100 % | … / … cases | … | … |
| T-SEC-02 | Signed URL expiry/tamper | 100 % rejected | … / … cases | … | … |
| T-FAIR-01 | Fair-use limits return 429 | 100 % | … / … cases | … | … |
| T-TRN-01 | whisper.cpp base, 10-min audio | INFO; viable if RTF ≤ 1.0 | RTF …, peak RAM … MB | … | … |

## 4. Manual answers
| ID | Question | Answer |
|---|---|---|
| MQ-01 | Oracle region, shape (OCPU/RAM), attempts/days, problems | … |
| MQ-02 | Any charges, warnings or limit emails (Oracle / Cloudflare / Neon)? | … |
| MQ-03 | Upload / download speed (Mbps), connection type | … |
| MQ-04 | Devices per browser test (OS, CPU, RAM); Mac used for Safari | … |
| MQ-05 | Code-text readability at 1.0 / 1.5 / 2.5 Mbps (1–5 each) | … / … / … |
| MQ-06 | Crashes, freezes, CPU/fan spikes while recording | … |
| MQ-07 | Minutes to connect storage; confusing steps | … |
| MQ-08 | Start and seek feel (1–5) per browser | … |
| MQ-09 | Any Telegram warning/limit/restriction | … |
| MQ-10 | Surprises (good or bad) | … |
| MQ-11 | What blocks daily use? | … |
| MQ-12 | Phase 2 priorities (re-ranked list, additions/removals) | … |

## 5. Unknowns register (TDD §17)
| ID | Unknown | Outcome (RESOLVED-YES / RESOLVED-NO / UNRESOLVED) | Evidence (test IDs) |
|---|---|---|---|
| U-01 | Bot throughput / FLOOD_WAIT from VM | … | T-TG-01…05, T-INF-03 |
| U-02 | File-reference refresh cost and expiry | … | T-TG-06, T-TG-07 |
| U-03 | Bot event source with actor; coexistence | … | T-ONB-03 |
| U-04 | Channel access hash without user session | … | T-ONB-04 |
| U-05 | Frame acquisition API per browser | … | T-REC-01 |
| U-06 | Recording in background tab | … | T-REC-05 |
| U-07 | Mediabunny keyframe-aligned ~4 s fragments | … | T-REC-03 |
| U-08 | AAC/Opus encode + playback everywhere | … | T-REC-02, T-PLY-04 |
| U-09 | Safari native HLS with muxed fMP4 | … | T-PLY-04 |
| U-10 | 1–2 hour stability | … | T-REC-04, T-PLY-06 |
| U-11 | Oracle availability/limits/reclaim | … | T-INF-01, T-INF-02 |
| U-12 | Neon latency and cold start | … | T-INF-04 |
| U-13 | R2 redirect + CORS with players | … | T-INF-05, T-PLY-04 |
| U-14 | whisper.cpp speed on VM | … | T-TRN-01 |
| U-15 | Uplink sufficiency at 1.5 Mbps | … | T-REC-06, MQ-03 |

## 6. Failures and triggered decision options
For each FAIL or BLOCKED, copy the matching row from TDD §14 and add what you observed.
| Test ID | What happened | Options from TDD §14 | Owner's preference (optional) |
|---|---|---|---|
| … | … | … | … |

## 7. Appendix — raw metrics
(The Lab export puts the raw JSON of every latest run here. If filling by hand, paste any numbers or screenshots you collected.)
