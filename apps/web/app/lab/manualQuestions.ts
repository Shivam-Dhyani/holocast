/** Manual questionnaire (PRD §9.6, FR-LAB-06). IDs must match the report (MQ-01…MQ-12). */
export const MANUAL_QUESTIONS: Array<{ id: string; text: string }> = [
  { id: 'MQ-01', text: 'Oracle: region chosen, shape obtained (OCPU/RAM), number of attempts/days to get it, any problems.' },
  { id: 'MQ-02', text: 'Oracle/Cloudflare/Neon billing pages at Phase 1 end: any charge, warning or limit email?' },
  { id: 'MQ-03', text: 'Your network: upload and download speed (from speedtest.net, Mbps), connection type.' },
  { id: 'MQ-04', text: 'Devices used for each browser test (OS, CPU, RAM). Which Mac was used for Safari?' },
  { id: 'MQ-05', text: 'Video quality at 1.0 / 1.5 / 2.5 Mbps: is small code text readable? Rate each 1–5.' },
  { id: 'MQ-06', text: 'Any browser crash, freeze, or fan/CPU spike while recording? Which browser, when?' },
  { id: 'MQ-07', text: 'Onboarding: how many minutes did connecting storage take; any confusing step?' },
  { id: 'MQ-08', text: 'Playback feel: rate start and seek speed 1–5 in each browser.' },
  { id: 'MQ-09', text: 'Did Telegram show any warning, limit, or restriction to the bot or your account?' },
  { id: 'MQ-10', text: 'Anything that surprised you (good or bad).' },
  { id: 'MQ-11', text: 'Recording UX: anything missing that blocks you from using Holocast daily?' },
  { id: 'MQ-12', text: 'Re-rank the Phase 2 list in PRD §3.3 (most important first) and add/remove items.' },
];
