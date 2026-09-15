export { NeoBrain, _extractCredentialMatches, _extractCredentialMatchesDetailed } from "./client.js";
export { embedText } from "./gemini.js";
export { saveVerifiedMemory, verifiedMemoryId } from "./verified.js";
export { listOwnedTranscripts, planTranscriptMaintenance, relabelTranscript, archiveTranscript, listScopedHandoffs } from "./continuity.js";
export { S3StorageAdapter } from "./storage/s3.js";
export const NEO_SELF_ID = "00000000-0000-0000-0000-000000000001";

// Memory sources that are conversation capture, not knowledge (WhatsApp
// captures, Codex transcript chunks). Pass as `sourceExclude` to search() from
// any reader that wants curated results. Mirrors @naca/core NOISE_SOURCES —
// keep the two in sync. 'codex-neo-mbp' is temporary until the Codex
// continuity tool relabels its chunks to 'codex-transcript' (2026-09-15).
export const NOISE_SOURCES = Object.freeze([
  "wa-primary", "wa-primary-media", "nclaw_whatsapp_conversation",
  "siti-wa", "wa-chat-importer", "siti_group_summarizer", "twin-ingest",
  "codex-transcript", "codex-neo-mbp", "claude_code_transcript",
]);
