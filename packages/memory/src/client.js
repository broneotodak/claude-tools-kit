import { createClient } from "@supabase/supabase-js";
import { embedText, toPgVectorString } from "./gemini.js";

const NEO_SELF_ID = "00000000-0000-0000-0000-000000000001";

// Credential-shape patterns. Used by redactMemory's safety check to extract
// matches from old vs new content. Keep in sync with:
//   tools/redact-memory.js
//   tools/memory-hygiene-check.js
//   tools/backfill-missing-embeddings.js (EVENT_CATEGORIES, separate concern)
//   the pre-INSERT trigger on memories (Layer 4, planned)
const _CREDENTIAL_PATTERNS = [
  /sk-ant-api03-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-admin01-[A-Za-z0-9_-]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{30,}/g,
  /(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /xox[bpars]-[A-Za-z0-9-]{10,}/g,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /NRAK-[A-Z0-9]{20,}/g,
  /-----BEGIN[^-]+-----/g,
];

/**
 * Extract every credential-shape substring in `text` as a Set of literals.
 * Internal — exported (prefixed `_`) for testing only.
 */
export function _extractCredentialMatches(text) {
  const out = new Set();
  if (typeof text !== "string" || !text.length) return out;
  for (const p of _CREDENTIAL_PATTERNS) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(text)) !== null) {
      out.add(m[0]);
    }
  }
  return out;
}

/**
 * NeoBrain — unified memory SDK client.
 *
 * Usage:
 *   const brain = new NeoBrain({ url, serviceRoleKey, agent: "nclaw-hetzner", storage });
 *   await brain.save("Neo is in Hong Kong for client meeting", { category:"travel", type:"event", importance:6, visibility:"private" });
 *   const results = await brain.search("what did I do in Hong Kong");
 *   await brain.saveMedia({ kind:"audio", buffer, mimeType:"audio/mp3", transcript:"..." });
 */
export class NeoBrain {
  constructor({
    url = process.env.NEO_BRAIN_URL,
    serviceRoleKey = process.env.NEO_BRAIN_SERVICE_ROLE_KEY,
    anonKey = process.env.NEO_BRAIN_ANON_KEY,
    agent,
    storage = null,
    geminiApiKey = process.env.GEMINI_API_KEY,
  } = {}) {
    if (!url) throw new Error("NeoBrain: url required (env NEO_BRAIN_URL)");
    if (!serviceRoleKey && !anonKey) throw new Error("NeoBrain: serviceRoleKey or anonKey required");
    if (!agent) throw new Error("NeoBrain: agent name required (e.g. 'nclaw-hetzner', 'claude-desktop', 'claude-code-vps')");
    this.sb = createClient(url, serviceRoleKey || anonKey, { auth: { persistSession: false } });
    this.agent = agent;
    this.storage = storage;
    this.geminiApiKey = geminiApiKey;
  }

  // ---------- MEMORIES ----------

  /**
   * Semantic search of memories.
   * @param {string} query
   * @param {{k?:number, visibility?:string[], subjectId?:string|null, source?:string[], minSimilarity?:number}} [opts]
   */
  async search(query, opts = {}) {
    const {
      k = 5,
      visibility = ["public", "internal", "private"],
      subjectId = null,
      source = null,
      minSimilarity = 0.35,
    } = opts;
    const embedding = await embedText(query, { apiKey: this.geminiApiKey });
    if (!embedding) return [];
    const { data, error } = await this.sb.rpc("match_memories", {
      query_embedding: embedding,
      match_count: k,
      min_similarity: minSimilarity,
      visibility_filter: visibility,
      p_subject_id: subjectId,
      source_filter: source,
    });
    if (error) throw new Error(`match_memories: ${error.message}`);
    return data || [];
  }

  /**
   * Save a memory. Auto-embeds content.
   * @param {string} content
   * @param {{category:string,type:string,importance?:number,visibility?:'public'|'internal'|'private',subjectId?:string,relatedPeople?:string[],source?:string,sourceRef?:object,mediaId?:string,metadata?:object}} opts
   */
  async save(content, opts = {}) {
    const {
      category,
      type,
      importance = 6,
      visibility = "private",
      subjectId = NEO_SELF_ID,
      relatedPeople = [],
      source = this.agent,
      sourceRef = {},
      mediaId = null,
      metadata = {},
    } = opts;
    if (!category || !type) throw new Error("save: category and type required");

    const embedding = await embedText(content, { apiKey: this.geminiApiKey });
    const embStr = toPgVectorString(embedding);

    const { data, error } = await this.sb
      .from("memories")
      .insert({
        content,
        embedding: embStr,
        category,
        memory_type: type,
        importance,
        visibility,
        subject_id: subjectId,
        related_people: relatedPeople,
        source,
        source_ref: sourceRef,
        media_id: mediaId,
        metadata,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(`save memory: ${error.message}`);

    await this.sb.from("memory_writes_log").insert({
      memory_id: data.id,
      action: "insert",
      written_by: this.agent,
      payload_preview: content.slice(0, 180),
    });

    return { id: data.id, created_at: data.created_at };
  }

  async archive(memoryId) {
    const { error } = await this.sb.from("memories").update({ archived: true }).eq("id", memoryId);
    if (error) throw new Error(error.message);
    await this.sb.from("memory_writes_log").insert({
      memory_id: memoryId, action: "archive", written_by: this.agent,
    });
  }

  /**
   * Safely replace a memory's content in place. Designed for credential
   * redactions: the safety check refuses to write if any credential-shape
   * string in the OLD content is still present verbatim in the NEW content.
   *
   * Allowed: newContent may contain credential-shape strings (vault pointer
   * references, regex docs, examples) — they just must not be the SAME
   * secrets we were trying to redact.
   *
   * Auto re-embeds the new content. Writes a memory_writes_log row with
   * action='redact' for traceability.
   *
   * @param {string} memoryId
   * @param {{newContent:string, newImportance?:number, newVisibility?:'public'|'internal'|'private', reason:string}} opts
   * @returns updated memory row
   */
  async redactMemory(memoryId, { newContent, newImportance, newVisibility, reason } = {}) {
    if (!memoryId) throw new Error("redactMemory: memoryId required");
    if (typeof newContent !== "string" || !newContent.length) throw new Error("redactMemory: newContent required");
    if (!reason || typeof reason !== "string") throw new Error("redactMemory: reason required");

    // 1. Fetch current row
    const { data: cur, error: fetchErr } = await this.sb
      .from("memories")
      .select("id, content")
      .eq("id", memoryId)
      .maybeSingle();
    if (fetchErr) throw new Error(`redactMemory fetch: ${fetchErr.message}`);
    if (!cur) throw new Error(`redactMemory: memory ${memoryId} not found`);

    // 2. Safety check — extract credential-pattern matches from BOTH old and
    //    new content. Refuse if any OLD secret is still present verbatim in
    //    NEW content. New content is allowed to contain credential-shape
    //    strings as long as they aren't the SAME ones we're redacting.
    const oldSecrets = _extractCredentialMatches(cur.content || "");
    for (const s of oldSecrets) {
      if (newContent.includes(s)) {
        throw new Error(
          `redactMemory SAFETY: redaction would leave old secret in place: ` +
          `"${s.slice(0, 16)}…" still present verbatim in newContent`
        );
      }
    }

    // 3. Re-embed new content
    const embedding = await embedText(newContent, { apiKey: this.geminiApiKey });
    if (!embedding) throw new Error("redactMemory: embedText returned null");
    const embStr = toPgVectorString(embedding);

    // 4. Build patch
    const patch = { content: newContent, embedding: embStr };
    if (typeof newImportance === "number") patch.importance = newImportance;
    if (newVisibility) patch.visibility = newVisibility;

    // 5. Update
    const { data: updated, error: updErr } = await this.sb
      .from("memories")
      .update(patch)
      .eq("id", memoryId)
      .select("*")
      .single();
    if (updErr) throw new Error(`redactMemory update: ${updErr.message}`);

    // 6. Log (capture errors — unlike save/archive which swallow them
    //    historically, redact wants the audit trail to be loud)
    const { error: logErr } = await this.sb.from("memory_writes_log").insert({
      memory_id: memoryId,
      action: "redact",
      written_by: this.agent,
      payload_preview: `[${reason}] ${newContent.slice(0, 160)}`,
    });
    if (logErr) throw new Error(`redactMemory: update succeeded but log write failed: ${logErr.message}`);

    return updated;
  }

  /**
   * List memories chronologically (newest first). No embedding required.
   * Use this for "what's recent" / activity scans / session-start briefs.
   * For semantic lookup use search() instead.
   * @param {{limit?:number, sinceHours?:number, source?:string, memoryType?:string, category?:string, minImportance?:number, visibility?:string[], subjectId?:string, includeArchived?:boolean}} [opts]
   */
  async listMemories({
    limit = 20,
    sinceHours = null,
    source = null,
    memoryType = null,
    category = null,
    minImportance = null,
    visibility = ["public", "internal", "private"],
    subjectId = null,
    includeArchived = false,
  } = {}) {
    let q = this.sb.from("memories").select("*");
    if (!includeArchived) q = q.eq("archived", false);
    if (sinceHours != null) q = q.gte("created_at", new Date(Date.now() - sinceHours * 3600_000).toISOString());
    if (source) q = q.eq("source", source);
    if (memoryType) q = q.eq("memory_type", memoryType);
    if (category) q = q.eq("category", category);
    if (minImportance != null) q = q.gte("importance", minImportance);
    if (subjectId) q = q.eq("subject_id", subjectId);
    if (visibility) q = q.in("visibility", visibility);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`listMemories: ${error.message}`);
    return data || [];
  }

  // ---------- MEDIA ----------

  /**
   * Save a media blob to storage + create a media row with embedding of caption/transcript.
   * @param {{kind:'image'|'audio'|'video', buffer:Buffer, mimeType:string, transcript?:string, caption?:string, source?:string, sourceRef?:object, subjectId?:string}} opts
   */
  async saveMedia(opts) {
    const { kind, buffer, mimeType, transcript = null, caption = null, source = this.agent, sourceRef = {}, subjectId = NEO_SELF_ID } = opts;
    if (!this.storage) throw new Error("saveMedia: no storage adapter configured");
    if (!kind || !buffer || !mimeType) throw new Error("saveMedia: kind, buffer, mimeType required");

    const ext = mimeType.split("/")[1] || "bin";
    const key = `${kind}/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
    const uploaded = await this.storage.put(key, buffer, { contentType: mimeType });

    const embedSource = transcript || caption || "";
    const embedding = embedSource ? await embedText(embedSource, { apiKey: this.geminiApiKey }) : null;

    const { data, error } = await this.sb
      .from("media")
      .insert({
        kind,
        storage_url: uploaded.url,
        storage_provider: "s3",
        mime_type: mimeType,
        bytes: uploaded.bytes,
        transcript,
        caption,
        embedding: toPgVectorString(embedding),
        source,
        source_ref: sourceRef,
        subject_id: subjectId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`save media row: ${error.message}`);
    return { id: data.id, storage_key: key, storage_url: uploaded.url };
  }

  async searchMedia(query, { kind = null, k = 5, minSimilarity = 0.35 } = {}) {
    const embedding = await embedText(query, { apiKey: this.geminiApiKey });
    if (!embedding) return [];
    const { data, error } = await this.sb.rpc("match_media", {
      query_embedding: embedding,
      match_count: k,
      min_similarity: minSimilarity,
      kind_filter: kind,
    });
    if (error) throw new Error(`match_media: ${error.message}`);
    return data || [];
  }

  // ---------- PEOPLE ----------

  async resolvePerson(type, value) {
    const { data, error } = await this.sb.rpc("resolve_person", { p_type: type, p_value: value });
    if (error) throw new Error(`resolve_person: ${error.message}`);
    return data || null;
  }

  async upsertPerson({ displayName, kind = "user", identifiers = [], notes = null, metadata = {} }) {
    if (!displayName) throw new Error("displayName required");
    const { data, error } = await this.sb
      .from("people")
      .insert({ display_name: displayName, kind, identifiers, notes, metadata })
      .select()
      .single();
    if (error) throw new Error(`upsertPerson: ${error.message}`);
    return data;
  }

  // ---------- FACTS ----------

  async getFacts({ subjectId = NEO_SELF_ID, category = null, limit = 100 } = {}) {
    let q = this.sb.from("facts").select("*").eq("subject_id", subjectId);
    if (category) q = q.eq("category", category);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  }

  async upsertFact(fact, { subjectId = NEO_SELF_ID, category, confidence = 0.8, sourceMemoryIds = [] } = {}) {
    if (!category) throw new Error("upsertFact: category required");
    const { data, error } = await this.sb
      .from("facts")
      .insert({ subject_id: subjectId, fact, category, confidence, source_memory_ids: sourceMemoryIds })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------- PERSONALITY ----------

  async getPersonality(subjectId = NEO_SELF_ID) {
    const { data, error } = await this.sb
      .from("personality")
      .select("*")
      .eq("subject_id", subjectId)
      .order("value", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------- CREDENTIALS (Vault-encrypted) ----------

  /**
   * Fetch a decrypted credential value. Requires service_role key.
   * @param {string} service — e.g. 'openai', 'netlify', 'supabase_thr'
   * @param {{type?:string, environment?:string, ownerId?:string}} [opts]
   * @returns {Promise<{id,service,credential_type,credential_value,description,environment,expires_at,metadata}|null>}
   */
  async getCredential(service, { type = null, environment = "production", ownerId = NEO_SELF_ID } = {}) {
    if (!service) throw new Error("getCredential: service required");
    const { data, error } = await this.sb.rpc("get_credential", {
      p_owner_id: ownerId,
      p_service: service,
      p_credential_type: type,
      p_environment: environment,
    });
    if (error) throw new Error(`get_credential: ${error.message}`);
    return (data && data[0]) || null;
  }

  /**
   * Fetch a credential's raw value (convenience — returns just the string).
   * Throws if not found.
   */
  async getCredentialValue(service, opts = {}) {
    const row = await this.getCredential(service, opts);
    if (!row) throw new Error(`credential not found: ${service}${opts.type ? "/" + opts.type : ""}`);
    return row.credential_value;
  }

  /**
   * List credentials metadata (no values). Safe to log / return to UIs.
   */
  async listCredentials({ ownerId = null, service = null, activeOnly = true } = {}) {
    const { data, error } = await this.sb.rpc("list_credentials", {
      p_owner_id: ownerId,
      p_service: service,
      p_active_only: activeOnly,
    });
    if (error) throw new Error(`list_credentials: ${error.message}`);
    return data || [];
  }

  /**
   * Create or rotate a credential. Value is encrypted via Supabase Vault.
   */
  async upsertCredential({ service, type, value, description = null, environment = "production", expiresAt = null, ownerId = NEO_SELF_ID, metadata = {} }) {
    if (!service || !type || !value) throw new Error("upsertCredential: service, type, value required");
    const { data, error } = await this.sb.rpc("upsert_credential", {
      p_owner_id: ownerId,
      p_service: service,
      p_credential_type: type,
      p_value: value,
      p_description: description,
      p_environment: environment,
      p_expires_at: expiresAt,
      p_metadata: metadata,
    });
    if (error) throw new Error(`upsert_credential: ${error.message}`);
    return { id: data };
  }

  // ---------- SESSIONS ----------

  async startSession({ taskSummary = null, metadata = {} } = {}) {
    const { data, error } = await this.sb
      .from("agent_sessions")
      .insert({ agent: this.agent, task_summary: taskSummary, metadata })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async endSession(sessionId, { transcriptUrl = null, memoryIds = [] } = {}) {
    const { error } = await this.sb
      .from("agent_sessions")
      .update({ ended_at: new Date().toISOString(), transcript_url: transcriptUrl, memory_ids: memoryIds })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  }
}
