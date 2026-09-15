export { NeoBrain, _extractCredentialMatches, _extractCredentialMatchesDetailed } from "./client.js";
export { embedText } from "./gemini.js";
export { saveVerifiedMemory, verifiedMemoryId } from "./verified.js";
export { listOwnedTranscripts, planTranscriptMaintenance, relabelTranscript, archiveTranscript, listScopedHandoffs } from "./continuity.js";
export { S3StorageAdapter } from "./storage/s3.js";
export const NEO_SELF_ID = "00000000-0000-0000-0000-000000000001";

// Memory sources that are conversation capture, not knowledge (WhatsApp
// captures, Codex transcript chunks). Pass as `sourceExclude` to search() from
// any reader that wants curated results. Mirrors @naca/core NOISE_SOURCES —
// keep the two in sync. Codex's curated writes (handoffs, change notes) live
// under 'codex-neo-mbp' and are deliberately NOT here; that source was only
// excluded temporarily on 2026-09-15 until the transcript relabel landed.
export const NOISE_SOURCES = Object.freeze([
  "wa-primary", "wa-primary-media", "nclaw_whatsapp_conversation",
  "siti-wa", "wa-chat-importer", "siti_group_summarizer", "twin-ingest",
  "codex-transcript", "claude_code_transcript",
]);
