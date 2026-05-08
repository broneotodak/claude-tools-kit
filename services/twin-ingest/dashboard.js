import http from "http";
import { createClient } from "@supabase/supabase-js";

const brain = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export const dashState = {
  stats: { total: 0, skipped: 0, classified: 0, processed: 0, errors: 0, startedAt: Date.now() },
  recentMessages: [],
  connected: false,
  phone: "",
  qr: null,             // raw QR string when Baileys requests pairing
  qrCapturedAt: null,   // timestamp of last QR
};

export function addRecentMessage(msg) {
  dashState.recentMessages.unshift(msg);
  if (dashState.recentMessages.length > 100) dashState.recentMessages.pop();
}

// ── neo-twin v2: send endpoint shares Baileys sock via setter (set from index.js) ──
let _sock = null;
export function setSock(sock) { _sock = sock; }


const DASH_PORT = 3900;

export function startDashboard() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");

    // ── /api/send (neo-twin v2) ──
    // POST {to_jid, text, draft_id?}  Bearer auth via TWIN_INGEST_SEND_TOKEN.
    // Reuses existing Baileys sock (set via setSock from index.js).
    if (req.url === "/api/send" && req.method === "POST") {
      const expected = process.env.TWIN_INGEST_SEND_TOKEN;
      const token = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
      if (!expected || token !== expected) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      if (!_sock) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "WhatsApp socket not ready" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 65536) req.destroy(); });
      req.on("end", async () => {
        try {
          const { to_jid, text, draft_id } = JSON.parse(body || "{}");
          if (!to_jid || !text) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing to_jid or text" }));
            return;
          }
          if (typeof to_jid !== "string" || typeof text !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "to_jid and text must be strings" }));
            return;
          }
          const result = await _sock.sendMessage(to_jid, { text });
          console.log(`[twin-send] -> ${to_jid} | ${text.slice(0, 80)} | draft_id=${draft_id || "-"}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message_id: result?.key?.id || null, to_jid, draft_id: draft_id || null }));
        } catch (e) {
          console.error("[twin-send] error:", e.message?.slice(0, 200));
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.url === "/api/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ...dashState.stats,
        connected: dashState.connected,
        phone: dashState.phone,
        uptime_sec: Math.round((Date.now() - dashState.stats.startedAt) / 1000),
        recent_count: dashState.recentMessages.length,
      }));
      return;
    }

    if (req.url === "/api/recent") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(dashState.recentMessages.slice(0, 50)));
      return;
    }

    if (req.url === "/qr") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(qrHTML());
      return;
    }

    if (req.url === "/api/qr-state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        connected: !!dashState.connected,
        has_qr: !!dashState.qr,
        qr: dashState.qr || null,
        captured_at: dashState.qrCapturedAt,
        age_seconds: dashState.qrCapturedAt ? Math.round((Date.now() - dashState.qrCapturedAt) / 1000) : null,
      }));
      return;
    }

    if (req.url === "/api/insights") {
      try {
        const since1h = new Date(Date.now() - 3600 * 1000).toISOString();
        const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const [memories, people, facts, last1h, last24h] = await Promise.all([
          brain.from("memories").select("content,category,importance,metadata,source,source_ref,created_at").in("source", ["wa-primary","wa-chat-importer"]).is("metadata->archived_chat", null).order("created_at", { ascending: false }).limit(30),
          brain.from("people").select("id,display_name,kind,notes,metadata,bio,traits,facts,relationship,languages,full_name,push_name,nicknames,message_count,last_profile_extraction").is("metadata->merged_into", null).is("metadata->no_dm_history", null).neq("kind", "self").order("updated_at", { ascending: false }).limit(100),
          brain.from("facts").select("subject_id,fact,category,confidence,created_at").order("created_at", { ascending: false }).limit(30),
          brain.from("memories").select("id", { count: "exact", head: true }).in("source", ["wa-primary","wa-chat-importer"]).is("metadata->archived_chat", null).gte("created_at", since1h),
          brain.from("memories").select("id", { count: "exact", head: true }).in("source", ["wa-primary","wa-chat-importer"]).is("metadata->archived_chat", null).gte("created_at", since24h),
        ]);
        const { data: catCounts } = await brain.from("memories").select("category").in("source", ["wa-primary","wa-chat-importer"]).is("metadata->archived_chat", null);
        const categories = {};
        (catCounts || []).forEach(m => { categories[m.category] = (categories[m.category] || 0) + 1; });
        const { count: totalIngested } = await brain.from("memories").select("id", { count: "exact", head: true }).in("source", ["wa-primary","wa-chat-importer"]).is("metadata->archived_chat", null);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          total_ingested: totalIngested || 0,
          last_1h: last1h.count || 0,
          last_24h: last24h.count || 0,
          categories,
          recent_memories: (memories.data || []).map(m => ({
            content: scrubNoise(m.content?.slice(0, 400)),
            category: m.category,
            importance: m.importance,
            source: m.source,
            chat_name: m.source_ref?.chat_name,
            chat_type: m.metadata?.chat_type || m.source_ref?.chat_type,
            sender: m.metadata?.sender_name || m.metadata?.sender_phone,
            is_owner: m.metadata?.is_from_owner,
            time: m.created_at,
          })),
          people: await mergePeople(people.data || [], { lastFact: await lastFactByPerson() }),
          recent_facts: await resolveFactSubjects(facts.data || []),
        }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === Same-name dedup: list clusters of duplicate display_names ===
    if (req.url === "/api/dupe-clusters") {
      try {
        const clusters = await loadDupeClusters();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ clusters }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === Same-name dedup: execute a merge ===
    if (req.url === "/api/merge" && req.method === "POST") {
      try {
        const body = await readJson(req);
        if (!body?.canonical_id || !Array.isArray(body?.dupe_ids) || body.dupe_ids.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "canonical_id and dupe_ids[] required" }));
          return;
        }
        const result = await runMerge(body.canonical_id, body.dupe_ids);
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === Person update (inline edit from profile overlay) ===
    const personUpdateMatch = req.url?.match(/^\/api\/person\/(.+)$/);
    if (personUpdateMatch && req.method === "POST") {
      try {
        const personId = decodeURIComponent(personUpdateMatch[1]);
        const body = await readJson(req);
        const result = await updatePerson(personId, body || {});
        res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === People search (autocomplete picker for cross-person merge) ===
    if (req.url?.startsWith("/api/people/search")) {
      try {
        const u = new URL(req.url, "http://x");
        const q = (u.searchParams.get("q") || "").trim();
        const exclude = u.searchParams.get("exclude") || null;
        if (q.length < 2) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ results: [] }));
          return;
        }
        let qb = brain.from("people")
          .select("id,display_name,full_name,push_name,kind,relationship,nicknames,phone,bio,traits")
          .is("metadata->merged_into", null)
          .or(`display_name.ilike.%${q}%,full_name.ilike.%${q}%,push_name.ilike.%${q}%,phone.ilike.%${q}%`)
          .order("display_name")
          .limit(200);
        if (exclude) qb = qb.neq("id", exclude);
        const { data, error } = await qb;
        if (error) throw error;
        // Enrich with fact count per row so the UI can show signal
        const ids = (data || []).map(r => r.id);
        const factCounts = await countFactsByIds(ids);
        const results = (data || []).map(r => ({ ...r, fact_count: factCounts[r.id] || 0 }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // === GET person profile (deep) ===
    const personMatch = req.url?.match(/^\/api\/person\/(.+)$/);
    if (personMatch) {
      try {
        const personId = decodeURIComponent(personMatch[1]);
        const profile = await getPersonProfile(personId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(profile));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(dashHTML());
  });
  server.listen(DASH_PORT, "0.0.0.0", () => {
    console.log("[twin] dashboard on :" + DASH_PORT);
  });
}


// Drop placeholder fact strings that twin-ingest's older Gemini extractor
// emitted (now filtered at extraction, but already-saved memories still have
// these baked into metadata.person_facts and content).
const RENDER_NOISE = [
  /(?:^|\s|;)(?:neo|[A-Za-z0-9_🧚🏻🤖✨🌸🦋]+):\s*(?:Is|Was|Acts as)\s*(?:the\s+)?[Ss]ender(?:\s+of\s+the\s+message)?\.?(?=;|$|\s*\|)/g,
  /\bSender of the message\.?\b/g,
  /\bIs the sender of the message\.?\b/g,
  /\bIs the sender\.?\b/g,
  /\bRefers to a quote attributed to[^.;]*\.?/gi,
];
function scrubNoise(s) {
  if (!s) return s;
  let out = s;
  for (const rx of RENDER_NOISE) out = out.replace(rx, "");
  // Tidy up trailing separators left over from removals
  out = out.replace(/;\s*;/g, ";").replace(/\n\s*Person facts:\s*\n?$/g, "").replace(/\s+\.\s*$/g, ".");
  return out.trim();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 256 * 1024) { req.destroy(); reject(new Error("payload too large")); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function loadDupeClusters() {
  // Page through all live (non-merged, non-self) people
  const all = [];
  let off = 0;
  while (true) {
    const { data, error } = await brain.from("people")
      .select("id,display_name,kind,push_name,phone,lid,identifiers,bio,traits,relationship,last_profile_extraction,created_at")
      .is("metadata->merged_into", null)
      .neq("kind", "self")
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    off += 1000;
  }
  // Group by lowercased display_name
  const byName = {};
  for (const p of all) {
    if (!p.display_name) continue;
    const key = p.display_name.toLowerCase().trim();
    if (!key) continue;
    if (!byName[key]) byName[key] = [];
    byName[key].push(p);
  }
  const clusters = Object.entries(byName).filter(([, rows]) => rows.length > 1);

  // Enrich with fact counts (paginate facts subject_id once, count per id)
  const allIds = clusters.flatMap(([, rows]) => rows.map(r => r.id));
  const factCounts = await countFactsByIds(allIds);

  const out = clusters.map(([name, rows]) => ({
    name,
    count: rows.length,
    rows: rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      kind: r.kind,
      push_name: r.push_name,
      phone: r.phone,
      lid: r.lid,
      identifiers_count: (r.identifiers || []).length,
      fact_count: factCounts[r.id] || 0,
      has_bio: !!r.bio,
      has_traits: (r.traits || []).length > 0,
      relationship: r.relationship,
      last_extracted: r.last_profile_extraction,
      created_at: r.created_at,
    })).sort((a, b) => b.fact_count - a.fact_count),
  }));

  // Sort clusters: largest by total fact count first
  out.sort((a, b) => {
    const ta = a.rows.reduce((s, r) => s + r.fact_count, 0);
    const tb = b.rows.reduce((s, r) => s + r.fact_count, 0);
    return tb - ta;
  });

  return out;
}

// Build a map of subject_id → most recent facts.created_at.
// Scans up to 3000 most-recent facts globally (covers thousands of recent
// active people). People without any recent fact get null and sort to bottom.
async function lastFactByPerson() {
  const map = {};
  let off = 0;
  while (off < 3000) {
    const { data, error } = await brain.from("facts").select("subject_id,created_at").order("created_at",{ascending:false}).range(off, off+999);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.subject_id && !map[f.subject_id]) map[f.subject_id] = f.created_at;
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  return map;
}

async function countFactsByIds(ids) {
  if (ids.length === 0) return {};
  const counts = {};
  // Batch in groups of 80 to stay under PostgREST URL limits
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    let off = 0;
    while (true) {
      const { data, error } = await brain.from("facts").select("subject_id").in("subject_id", batch).range(off, off + 999);
      if (error) break;
      if (!data || data.length === 0) break;
      for (const f of data) if (f.subject_id) counts[f.subject_id] = (counts[f.subject_id] || 0) + 1;
      if (data.length < 1000) break;
      off += 1000;
    }
  }
  return counts;
}

async function runMerge(canonicalId, dupeIds) {
  // Validate
  if (dupeIds.includes(canonicalId)) return { ok: false, error: "canonical cannot be in dupe_ids" };
  if (dupeIds.length > 50) return { ok: false, error: "max 50 dupes per merge" };

  const { data: canonical, error: cerr } = await brain.from("people")
    .select("id,display_name,kind,identifiers,nicknames,metadata")
    .eq("id", canonicalId).maybeSingle();
  if (cerr || !canonical) return { ok: false, error: "canonical not found" };
  if (canonical.metadata?.merged_into) return { ok: false, error: "canonical is itself merged" };

  const { data: dupes, error: derr } = await brain.from("people")
    .select("id,display_name,kind,push_name,phone,lid,identifiers,nicknames,metadata")
    .in("id", dupeIds);
  if (derr) return { ok: false, error: derr.message };
  if (!dupes || dupes.length !== dupeIds.length) return { ok: false, error: "some dupe_ids not found" };
  for (const d of dupes) {
    if (d.kind === "self") return { ok: false, error: `cannot merge kind=self row ${d.id}` };
    if (d.metadata?.merged_into) return { ok: false, error: `${d.display_name} (${d.id.slice(0,8)}) already merged` };
  }

  // Migrate facts in batches
  const BATCH = 80;
  const batches = [];
  for (let i = 0; i < dupeIds.length; i += BATCH) batches.push(dupeIds.slice(i, i + BATCH));

  let factCount = 0;
  let memCount = 0;
  for (const batch of batches) {
    const { count: fc } = await brain.from("facts").select("id", { count: "exact", head: true }).in("subject_id", batch);
    factCount += fc || 0;
    const { count: mc } = await brain.from("memories").select("id", { count: "exact", head: true }).in("subject_id", batch);
    memCount += mc || 0;
  }
  for (const batch of batches) {
    if (factCount > 0) await brain.from("facts").update({ subject_id: canonicalId }).in("subject_id", batch);
    if (memCount > 0) await brain.from("memories").update({ subject_id: canonicalId }).in("subject_id", batch);
  }

  // Identifier + nickname union
  const seenId = new Set((canonical.identifiers || []).map(i => `${i.type}:${(i.value || "").toString().toLowerCase()}`));
  const newIds = [...(canonical.identifiers || [])];
  const pushId = (id) => { const k = `${id.type}:${(id.value || "").toString().toLowerCase()}`; if (!seenId.has(k)) { seenId.add(k); newIds.push(id); } };
  const seenNick = new Set((canonical.nicknames || []).map(n => n.toLowerCase()));
  const newNicks = [...(canonical.nicknames || [])];
  const pushNick = (n) => { if (!n) return; const k = String(n).toLowerCase(); if (!seenNick.has(k)) { seenNick.add(k); newNicks.push(n); } };

  for (const d of dupes) {
    if (d.phone) pushId({ type: "phone", value: d.phone });
    if (d.lid) pushId({ type: "lid", value: d.lid });
    if (d.push_name) pushId({ type: "push_name", value: d.push_name });
    for (const i of d.identifiers || []) if (i?.type && i?.value) pushId(i);
    if (d.push_name) pushNick(d.push_name);
    for (const n of d.nicknames || []) pushNick(n);
  }
  const idsAdded = newIds.length - (canonical.identifiers || []).length;
  const nicksAdded = newNicks.length - (canonical.nicknames || []).length;
  if (idsAdded > 0 || nicksAdded > 0) {
    const patch = { updated_at: new Date().toISOString() };
    if (idsAdded > 0) patch.identifiers = newIds;
    if (nicksAdded > 0) patch.nicknames = newNicks;
    await brain.from("people").update(patch).eq("id", canonicalId);
  }

  // Soft-mark dupes via metadata.merged_into
  const mergedAt = new Date().toISOString();
  let marked = 0;
  for (const d of dupes) {
    const meta = { ...(d.metadata || {}), merged_into: canonicalId, merged_at: mergedAt, merge_source: "dashboard-ui" };
    const { error } = await brain.from("people").update({ metadata: meta, updated_at: mergedAt }).eq("id", d.id);
    if (!error) marked++;
  }

  return {
    ok: true,
    canonical_id: canonicalId,
    canonical_name: canonical.display_name,
    dupes_marked: marked,
    facts_migrated: factCount,
    memories_migrated: memCount,
    identifiers_added: idsAdded,
    nicknames_added: nicksAdded,
  };
}

async function updatePerson(personId, body) {
  // Whitelist editable fields. Don't expose schema-sensitive ones (kind,
  // identifiers, metadata, embeddings).
  const ALLOWED = ["display_name", "full_name", "relationship", "bio"];
  const ARRAY_FIELDS = { nicknames: true, languages: true };

  // Load existing
  const { data: current, error: ge } = await brain.from("people").select("*").eq("id", personId).maybeSingle();
  if (ge || !current) return { ok: false, error: "person not found" };
  if (current.metadata?.merged_into) return { ok: false, error: "row is merged; edit the canonical instead" };

  const patch = { updated_at: new Date().toISOString() };
  const touched = []; // fields the user explicitly sent — these become "curated"

  for (const k of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      const v = body[k];
      if (v === null || v === "") patch[k] = null;
      else if (typeof v === "string") patch[k] = v.slice(0, k === "bio" ? 2000 : 200);
      touched.push(k);
    }
  }

  for (const k of Object.keys(ARRAY_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      const arr = Array.isArray(body[k]) ? body[k] : String(body[k] || "").split(",").map(s => s.trim()).filter(Boolean);
      const seen = new Set();
      patch[k] = arr.filter(x => { const lk = String(x).toLowerCase(); if (seen.has(lk)) return false; seen.add(lk); return true; }).slice(0, 30);
      touched.push(k);
    }
  }

  if (Object.keys(patch).length === 1) return { ok: false, error: "no editable fields in body" };

  // Mark all touched fields as user-curated so wa-fact-enricher's daily cron
  // doesn't overwrite them. Existing curated set is preserved (additive).
  if (touched.length > 0) {
    const existingMeta = current.metadata || {};
    const curatedSet = new Set(existingMeta.curated_fields || []);
    for (const f of touched) curatedSet.add(f);
    patch.metadata = {
      ...existingMeta,
      curated_fields: [...curatedSet],
      curated_at: new Date().toISOString(),
      curated_by: "dashboard-ui",
    };
  }

  const { error } = await brain.from("people").update(patch).eq("id", personId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, person_id: personId, updated_fields: touched, curated_fields: patch.metadata?.curated_fields || [] };
}

async function resolveFactSubjects(factRows) {
  const NOISE = /^(sender of the message\.?|is the sender\.?|is the sender of the message\.?|refers to .{0,40} attributed to)/i;
  const clean = factRows.filter(f => f.fact && !NOISE.test(f.fact.trim()));
  const ids = [...new Set(clean.map(f => f.subject_id).filter(Boolean))];
  const nameById = {};
  if (ids.length > 0) {
    const { data } = await brain.from("people").select("id,display_name").in("id", ids);
    for (const p of data || []) nameById[p.id] = p.display_name;
  }
  return clean.map(f => ({
    subject_id: f.subject_id,
    subject_name: nameById[f.subject_id] || null,
    fact: f.fact,
    category: f.category,
    confidence: f.confidence,
    time: f.created_at,
  }));
}

async function mergePeople(peopleRows, opts = {}) {
  const lastFact = opts.lastFact || {};
  // Read from direct columns (post-2026-05-06 schema). Fall back to legacy
  // metadata.* fields if columns are empty (rows enriched only by the old
  // wa-chat-importer, never by wa-fact-enricher).
  const fromTable = peopleRows.filter(p => p.kind !== "self" && !p.metadata?.merged_into).map(p => {
    const eng = p.metadata?.engagement || {};
    const dm_in = eng.dm_in || 0;
    const dm_out = eng.dm_out || 0;
    const total_dm = eng.total_dm || 0;
    // Mutual = the part that's actual two-way conversation. Pure inbound
    // broadcasts (944↓ 0↑ from Islamic-dhikr forwarders, mass-blast senders)
    // get mutual=0 even with high total. Better signal of "Neo is close to X".
    const mutual_dm = Math.min(dm_in, dm_out);
    return {
      id: p.id,
      name: p.display_name,
      kind: p.kind,
      notes: (p.bio || p.notes || "").slice(0, 200),
      bio: p.bio,
      full_name: p.full_name,
      // Prefer real DM engagement count over message_count (which is a per-enricher
      // sample-size artifact capped at 300 — see backfill memory).
      msg_count: total_dm || p.message_count || p.metadata?.wa_message_count || 0,
      dm_in,
      dm_out,
      total_dm,
      mutual_dm,
      last_dm_at: eng.last_dm_at || null,
      no_dm_history: !!p.metadata?.no_dm_history,
      relationship: p.relationship || p.metadata?.relationship_to_neo,
      traits: (p.traits && p.traits.length > 0) ? p.traits : (p.metadata?.wa_traits || []),
      languages: (p.languages && p.languages.length > 0) ? p.languages : (p.metadata?.languages || []),
      facts: p.facts || [],
      nicknames: p.nicknames || [],
      last_extracted: p.last_profile_extraction,
      last_fact_at: lastFact[p.id] || null,
      source: "people_table",
    };
  });

  // Get person profiles from wa-chat-importer
  const { data: profileMems } = await brain.from("memories")
    .select("metadata,source_ref")
    .eq("memory_type", "person_profile")
    .eq("source", "wa-chat-importer")
    .limit(100);

  // Get person_profiles from chat profile memories
  const { data: chatProfiles } = await brain.from("memories")
    .select("metadata,source_ref")
    .eq("memory_type", "profile")
    .eq("source", "wa-chat-importer")
    .not("metadata->person_profiles", "is", null)
    .limit(200);

  // Also get unique chat names to show as contacts
  const { data: chatMems } = await brain.from("memories")
    .select("source_ref")
    .eq("source", "wa-chat-importer")
    .eq("memory_type", "profile")
    .limit(200);

  // Build map of all known people
  const peopleMap = {};
  fromTable.forEach(p => { peopleMap[p.name.toLowerCase()] = p; });

  // Add from person_profile memories
  (profileMems || []).forEach(m => {
    const name = m.metadata?.person_name;
    if (!name) return;
    const key = name.toLowerCase();
    if (!peopleMap[key]) {
      peopleMap[key] = {
        id: key, name, kind: "contact", source: "wa_import",
        relationship: m.metadata?.relationship || "",
        traits: m.metadata?.traits || [],
        notes: (m.metadata?.role || "") + " (from " + (m.source_ref?.chat_name || "chat") + ")",
        languages: [], msg_count: 0,
      };
    } else {
      // Merge traits
      const existing = peopleMap[key];
      (m.metadata?.traits || []).forEach(t => {
        if (!existing.traits.includes(t)) existing.traits.push(t);
      });
      if (m.metadata?.relationship && !existing.relationship) {
        existing.relationship = m.metadata.relationship;
      }
    }
  });

  // Add from chat profile person_profiles arrays
  (chatProfiles || []).forEach(m => {
    const profiles = m.metadata?.person_profiles || [];
    const chat = m.source_ref?.chat_name || "";
    profiles.forEach(pp => {
      if (!pp.name) return;
      const key = pp.name.toLowerCase();
      if (!peopleMap[key]) {
        peopleMap[key] = {
          id: key, name: pp.name, kind: "contact", source: "wa_import",
          relationship: pp.relationship || "",
          traits: pp.key_traits || [],
          notes: (pp.role || "") + " (from " + chat + ")",
          languages: [], msg_count: 0,
        };
      } else {
        const existing = peopleMap[key];
        (pp.key_traits || []).forEach(t => {
          if (!existing.traits.includes(t)) existing.traits.push(t);
        });
        if (pp.relationship && !existing.relationship) {
          existing.relationship = pp.relationship;
        }
      }
    });
  });

  // Add chat contacts (people Neo has DM chats with)
  const chatNames = new Set();
  (chatMems || []).forEach(m => {
    const chatType = m.source_ref?.chat_type;
    const chatName = m.source_ref?.chat_name;
    if (chatType === "dm" && chatName) chatNames.add(chatName);
  });
  chatNames.forEach(name => {
    const key = name.toLowerCase();
    if (!peopleMap[key]) {
      peopleMap[key] = {
        id: key, name, kind: "wa_contact", source: "wa_import",
        relationship: "", traits: [], notes: "WhatsApp DM contact",
        languages: [], msg_count: 0,
      };
    }
  });

  // Sort: mutual_dm DESC (real two-way conversation), then total_dm DESC, then
  // most-recent DM DESC. Pure broadcast senders (high total_dm but mutual=0)
  // sink below real friends.
  return Object.values(peopleMap).sort((a, b) => {
    const ma = a.mutual_dm || 0;
    const mb = b.mutual_dm || 0;
    if (mb !== ma) return mb - ma;
    const ea = a.total_dm || 0;
    const eb = b.total_dm || 0;
    if (eb !== ea) return eb - ea;
    const la = a.last_dm_at ? new Date(a.last_dm_at).getTime() : 0;
    const lb = b.last_dm_at ? new Date(b.last_dm_at).getTime() : 0;
    if (lb !== la) return lb - la;
    const fa = a.last_fact_at ? new Date(a.last_fact_at).getTime() : 0;
    const fb = b.last_fact_at ? new Date(b.last_fact_at).getTime() : 0;
    if (fb !== fa) return fb - fa;
    const scoreA = (a.traits?.length || 0) + (a.relationship ? 5 : 0) + (a.source === "people_table" ? 10 : 0);
    const scoreB = (b.traits?.length || 0) + (b.relationship ? 5 : 0) + (b.source === "people_table" ? 10 : 0);
    return scoreB - scoreA;
  });
}

async function getPersonProfile(personId) {
  // Try by ID first, then by name
  let person;
  const isUUID = /^[0-9a-f]{8}-/.test(personId);

  if (isUUID) {
    const { data } = await brain.from("people").select("*").eq("id", personId).single();
    person = data;
  }
  if (!person) {
    // Try name match in people table
    const { data } = await brain.from("people").select("*").ilike("display_name", `%${personId}%`).limit(1);
    person = data?.[0] || null;
  }

  if (!person) {
    // Check wa-chat-importer person_profile memories by name
    const { data: profileMems } = await brain.from("memories")
      .select("content,metadata,source_ref,created_at")
      .eq("memory_type", "person_profile")
      .ilike("metadata->>person_name", `%${personId}%`)
      .order("created_at", { ascending: false }).limit(10);

    // Check wa-chat-importer profile memories that mention this person
    const { data: chatProfiles } = await brain.from("memories")
      .select("content,metadata,source_ref,created_at")
      .eq("memory_type", "profile")
      .eq("source", "wa-chat-importer")
      .order("created_at", { ascending: false }).limit(50);

    const relevant = (chatProfiles || []).filter(m => {
      const profiles = m.metadata?.person_profiles || [];
      return profiles.some(p => p.name?.toLowerCase().includes(personId.toLowerCase()));
    });

    return {
      found: false,
      name: personId,
      person_profiles_from_chats: (profileMems || []).map(m => ({
        name: m.metadata?.person_name,
        relationship: m.metadata?.relationship,
        traits: m.metadata?.traits,
        role: m.metadata?.role,
        chat: m.source_ref?.chat_name,
      })),
      from_chat_profiles: relevant.map(m => {
        const pp = (m.metadata?.person_profiles || []).find(p => p.name?.toLowerCase().includes(personId.toLowerCase()));
        return {
          chat: m.source_ref?.chat_name,
          relationship: pp?.relationship,
          traits: pp?.key_traits,
          role: pp?.role,
          neo_insights: m.metadata?.neo_insights,
          patterns: m.metadata?.notable_patterns,
        };
      }),
    };
  }

  // Person found in people table — fetch all related data
  // Also search by chat_name for DM conversations (wa-chat-importer stores DMs under chat_name = person display_name)
  const [factsRes, memoriesRes, memoriesByChatName, profileMems, chatProfiles, personalityRes] = await Promise.all([
    brain.from("facts").select("fact,category,confidence,created_at").eq("subject_id", person.id).order("created_at", { ascending: false }).limit(50),
    brain.from("memories").select("content,category,memory_type,importance,metadata,source_ref,source,created_at")
      .or(`subject_id.eq.${person.id},related_people.cs.{${person.id}}`)
      .order("created_at", { ascending: false }).limit(30),
    brain.from("memories").select("content,category,memory_type,importance,metadata,source_ref,source,created_at")
      .eq("source", "wa-chat-importer")
      .eq("source_ref->>chat_name", person.display_name)
      .order("created_at", { ascending: false }).limit(30),
    brain.from("memories").select("content,metadata,source_ref,created_at")
      .eq("memory_type", "person_profile")
      .ilike("metadata->>person_name", `%${person.display_name}%`)
      .order("created_at", { ascending: false }).limit(10),
    brain.from("memories").select("content,metadata,source_ref,created_at")
      .eq("memory_type", "profile").eq("source", "wa-chat-importer")
      .order("created_at", { ascending: false }).limit(100),
    brain.from("personality").select("*").limit(20),
  ]);

  // Merge memories from ID-based and chat-name-based queries (dedup by content prefix)
  const allMemories = [...(memoriesRes.data || [])];
  const seen = new Set(allMemories.map(m => m.content?.slice(0, 80)));
  for (const m of (memoriesByChatName.data || [])) {
    if (!seen.has(m.content?.slice(0, 80))) { allMemories.push(m); seen.add(m.content?.slice(0, 80)); }
  }

  // Find chat profiles that mention this person
  const relevantChatProfiles = (chatProfiles.data || []).filter(m => {
    const profiles = m.metadata?.person_profiles || [];
    return profiles.some(p => p.name?.toLowerCase().includes(person.display_name?.toLowerCase()));
  });

  // Aggregate person facts from wa-chat-importer conversation memories
  const personFactsFromConvos = [];
  (memoriesRes.data || []).forEach(m => {
    const pf = m.metadata?.person_facts;
    if (Array.isArray(pf)) {
      pf.forEach(entry => {
        if (entry.person?.toLowerCase().includes(person.display_name?.toLowerCase())) {
          (entry.facts || []).forEach(f => personFactsFromConvos.push(f));
        }
      });
    }
  });

  // Group facts by category
  const factsByCategory = {};
  (factsRes.data || []).forEach(f => {
    const cat = f.category || "general";
    if (!factsByCategory[cat]) factsByCategory[cat] = [];
    factsByCategory[cat].push(f);
  });

  return {
    found: true,
    person: {
      id: person.id,
      name: person.display_name,
      full_name: person.full_name,
      kind: person.kind,
      notes: person.notes,
      bio: person.bio,
      nicknames: person.nicknames || [],
      push_name: person.push_name,
      phone: person.phone,
      relationship: person.relationship || person.metadata?.relationship_to_neo,
      traits: (person.traits && person.traits.length > 0) ? person.traits : (person.metadata?.wa_traits || []),
      languages: (person.languages && person.languages.length > 0) ? person.languages : (person.metadata?.languages || []),
      msg_count: person.message_count || person.metadata?.wa_message_count,
      last_sync: person.metadata?.last_wa_sync,
      curated_fields: person.metadata?.curated_fields || [],
      curated_at: person.metadata?.curated_at,
    },
    facts: {
      total: (factsRes.data || []).length,
      by_category: factsByCategory,
    },
    conversation_facts: [...new Set(personFactsFromConvos)].slice(0, 30),
    memories: allMemories.slice(0, 30).map(m => ({
      content: m.content?.slice(0, 300),
      category: m.category,
      type: m.memory_type,
      importance: m.importance,
      source: m.source,
      chat: m.source_ref?.chat_name,
      time: m.created_at,
    })),
    profiles_from_chats: (profileMems.data || []).map(m => ({
      name: m.metadata?.person_name,
      relationship: m.metadata?.relationship,
      traits: m.metadata?.traits,
      role: m.metadata?.role,
      chat: m.source_ref?.chat_name,
    })),
    chat_appearances: relevantChatProfiles.map(m => {
      const pp = (m.metadata?.person_profiles || []).find(p => p.name?.toLowerCase().includes(person.display_name?.toLowerCase()));
      return {
        chat: m.source_ref?.chat_name,
        relationship: pp?.relationship,
        traits: pp?.key_traits,
        role: pp?.role,
        neo_insights: m.metadata?.neo_insights,
        patterns: m.metadata?.notable_patterns,
      };
    }),
  };
}

function qrHTML() {
  return `<!DOCTYPE html><html><head>
<title>twin-ingest QR</title>
<meta charset="utf-8">
<style>
body{margin:0;background:#0d1117;color:#00ff41;font-family:'Courier New',monospace;display:flex;flex-direction:column;align-items:center;padding:30px;min-height:100vh;box-sizing:border-box}
h1{font-size:14px;margin:0 0 18px}
.box{background:#fff;padding:20px;border-radius:8px}
.status{margin-top:16px;font-size:12px;color:#7d8590}
.connected{color:#00ff41}
.waiting{color:#ffb700}
.empty{color:#3a5f3a;text-align:center;margin-top:60px}
button{background:transparent;border:1px solid #00ff41;color:#00ff41;padding:6px 14px;font-family:inherit;font-size:11px;cursor:pointer;margin-top:14px}
button:hover{background:#00ff41;color:#000}
small{color:#3a5f3a;font-size:10px;margin-top:8px}
</style></head><body>
<h1>NEO://twin-ingest QR PAIRING</h1>
<div id="qr-container"><div class="empty">Loading...</div></div>
<div class="status" id="status"></div>
<small>Auto-refresh every 5s. WhatsApp → Settings → Linked Devices → Link a Device</small>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
<script>
async function refresh() {
  try {
    const r = await fetch('/api/qr-state').then(r => r.json());
    const status = document.getElementById('status');
    const container = document.getElementById('qr-container');
    if (r.connected) {
      container.innerHTML = '<div class="empty connected">✓ CONNECTED — no QR pending</div>';
      status.innerHTML = '<span class="connected">WhatsApp socket open. No re-pair needed.</span>';
      return;
    }
    if (!r.qr) {
      container.innerHTML = '<div class="empty waiting">Waiting for Baileys to emit a QR...</div>';
      status.innerHTML = '<span class="waiting">Process is online but not in pairing mode. Restart twin-ingest if you need to re-pair.</span>';
      return;
    }
    container.innerHTML = '<div class="box"><canvas id="qrcanvas"></canvas></div>';
    QRCode.toCanvas(document.getElementById('qrcanvas'), r.qr, { width: 320, margin: 2, errorCorrectionLevel: 'L' });
    status.innerHTML = '<span class="waiting">QR pending · captured ' + (r.age_seconds || '?') + 's ago. Scan now — Baileys rotates QRs frequently.</span>';
  } catch (e) {
    document.getElementById('qr-container').innerHTML = '<div class="empty" style="color:#ff003c">ERROR: ' + e.message + '</div>';
  }
}
refresh();
setInterval(refresh, 5000);
</script>
</body></html>`;
}

function dashHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEO TWIN INGEST</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050505;color:#00ff41;font-family:'Courier New',monospace;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;background:repeating-linear-gradient(0deg,rgba(0,255,65,.03) 0,rgba(0,255,65,.03) 1px,transparent 1px,transparent 3px);pointer-events:none;z-index:1}
.header{padding:16px;border-bottom:1px solid #0a3d10;display:flex;align-items:center;gap:12px}
.header h1{font-size:16px;text-shadow:0 0 8px rgba(0,255,65,.5)}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.dot.on{background:#00ff41;box-shadow:0 0 8px #00ff41}
.dot.off{background:#ff003c;box-shadow:0 0 8px #ff003c}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;padding:12px}
.stat{background:#000;border:1px solid #0a3d10;padding:10px;text-align:center}
.stat .val{font-size:20px;font-weight:bold;text-shadow:0 0 6px rgba(0,255,65,.4)}
.stat .label{font-size:8px;color:#3a5f3a;margin-top:4px}
.stat.amber .val{color:#ffb700}
.stat.red .val{color:#ff003c}
.stat.cyan .val{color:#00d4ff}
.tabs{display:flex;border-bottom:1px solid #0a3d10;padding:0 12px;overflow-x:auto}
.tab{padding:8px 16px;cursor:pointer;font-size:10px;color:#3a5f3a;border-bottom:2px solid transparent;white-space:nowrap}
.tab.active{color:#00ff41;border-bottom-color:#00ff41}
.panel{padding:12px;display:none;max-height:calc(100vh - 220px);overflow-y:auto}
.panel.active{display:block}
.section{color:#3a5f3a;font-size:10px;padding:6px 0;border-bottom:1px solid #0a3d10;margin-bottom:8px}
.card{background:#000;border-left:2px solid #0a3d10;padding:8px 10px;margin-bottom:4px;font-size:11px}
.card.dm{border-color:#00ff41}
.card.group{border-color:#00d4ff}
.card.fact{border-color:#ffb700}
.card.person{border-color:#ff003c}
.card .meta{color:#3a5f3a;font-size:9px;margin-bottom:2px}
.card .text{color:#e6edf3;font-size:10px}
.card .fact-text{color:#ffb700;font-size:10px}
.badge{display:inline-block;padding:1px 4px;border:1px solid;font-size:7px;margin-right:4px}
.cat-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px}
.cat-chip{padding:3px 8px;font-size:9px;border:1px solid #0a3d10;background:#000}

/* Person cards - clickable */
.person-card{background:#000;border:1px solid #0a3d10;padding:10px;margin-bottom:6px;cursor:pointer;transition:border-color .2s,background .2s}
.person-card:hover{border-color:#00ff41;background:#0a1f0a}
.person-card .name{font-size:12px;color:#00ff41}
.person-card .info{font-size:9px;color:#7d8590;margin-top:2px}
.person-card .traits-row{display:flex;gap:3px;flex-wrap:wrap;margin-top:4px}
.person-card .trait{padding:1px 5px;border:1px solid #1a3d1a;font-size:7px;color:#3a8f3a}

/* Dupe clusters */
.dupe-cluster{background:#000;border:1px solid #1a3d5f;margin-bottom:14px;padding:10px}
.dupe-cluster.merging{opacity:.4;pointer-events:none}
.dupe-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #1a3d5f;padding-bottom:6px}
.dupe-name{color:#00d4ff;font-size:13px}
.dupe-summary{color:#7d8590;font-size:9px}
.dupe-row{display:grid;grid-template-columns:24px 1fr 70px 70px 80px 110px;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px dotted #0a3d3d;font-size:10px;cursor:pointer}
.dupe-row:hover{background:#001a1f}
.dupe-row.canon{background:#001f0a;border-left:2px solid #00ff41}
.dupe-row.dupe{background:#1f0a00;border-left:2px solid #ff8800}
.dupe-row .pick{font-size:11px;text-align:center}
.dupe-row .meta{color:#7d8590;font-size:9px}
.dupe-row .id{font-family:monospace;color:#3a5f3a;font-size:8px}
.dupe-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.btn-merge{background:#1f0a00;border:1px solid #ff8800;color:#ff8800;padding:4px 14px;font-family:inherit;font-size:10px;cursor:pointer}
.btn-merge:hover{background:#ff8800;color:#000}
.btn-merge:disabled{opacity:.4;cursor:not-allowed}
.btn-skip{background:transparent;border:1px solid #3a5f3a;color:#7d8590;padding:4px 10px;font-family:inherit;font-size:10px;cursor:pointer}
.merge-result{font-size:10px;padding:6px 8px;margin-top:6px;border:1px solid #0a3d10;background:#0a1f0a;color:#00ff41}
.merge-result.err{border-color:#ff003c;background:#1f0a0a;color:#ff003c}

/* Profile edit form + cross-person merge picker */
.btn-edit{background:transparent;border:1px solid #00d4ff;color:#00d4ff;padding:4px 12px;font-family:inherit;font-size:9px;cursor:pointer}
.btn-edit:hover{background:#00d4ff;color:#000}
.btn-merge-person{background:transparent;border:1px solid #ff8800;color:#ff8800;padding:4px 12px;font-family:inherit;font-size:9px;cursor:pointer}
.btn-merge-person:hover{background:#ff8800;color:#000}
.edit-form{background:#001a1f;border:1px solid #00d4ff;padding:14px;margin-top:14px;font-size:11px}
.edit-form .row{margin-bottom:10px}
.edit-form label{display:block;color:#00d4ff;font-size:9px;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px}
.edit-form input,.edit-form textarea,.edit-form select{width:100%;background:#000;border:1px solid #1a3d5f;color:#e6edf3;padding:6px 8px;font-family:inherit;font-size:11px;box-sizing:border-box}
.edit-form input:focus,.edit-form textarea:focus,.edit-form select:focus{outline:none;border-color:#00d4ff}
.edit-form textarea{min-height:64px;resize:vertical}
.edit-form .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
.edit-form .hint{color:#7d8590;font-size:9px;margin-top:2px}
.merge-picker{background:#1f0a00;border:1px solid #ff8800;padding:14px;margin-top:14px;font-size:11px}
.merge-picker .search-wrap{position:relative}
.merge-picker .results{max-height:200px;overflow-y:auto;background:#000;border:1px solid #3a3a3a;margin-top:6px}
.merge-picker .result-row{padding:5px 10px;border-bottom:1px dotted #2a2a2a;cursor:pointer;font-size:10px;display:flex;align-items:center;flex-wrap:wrap}
.merge-picker .result-row:hover{background:#1f0a00}
.merge-picker .result-row.checked{background:#1f0a00;border-left:2px solid #ff8800}
.merge-picker .result-row .meta{color:#7d8590;font-size:9px}
.merge-picker .selected{background:#1f0a00;border:1px solid #ff8800;padding:8px;margin-top:8px}
.merge-picker .direction{margin-top:8px;display:flex;gap:8px;align-items:center;color:#7d8590;font-size:10px}
.merge-picker label.dir{cursor:pointer;padding:4px 8px;border:1px solid #3a3a3a}
.merge-picker label.dir.active{border-color:#ff8800;background:#1f0a00;color:#ff8800}
.merge-picker label.dir input{display:none}

/* Custom confirm modal — replaces browser confirm() which can be suppressed */
.confirm-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;align-items:center;justify-content:center}
.confirm-overlay.active{display:flex}
.confirm-box{background:#0d1117;border:1px solid #ff8800;padding:24px;max-width:520px;font-family:'Courier New',monospace}
.confirm-box .cb-msg{color:#e6edf3;font-size:12px;line-height:1.5;white-space:pre-wrap;margin-bottom:16px}
.confirm-box .cb-actions{display:flex;gap:10px;justify-content:flex-end}
.confirm-box button{font-family:inherit;font-size:11px;padding:6px 18px;cursor:pointer}
.confirm-box .cb-cancel{background:transparent;border:1px solid #3a5f3a;color:#7d8590}
.confirm-box .cb-ok{background:#1f0a00;border:1px solid #ff8800;color:#ff8800}
.confirm-box .cb-ok:hover{background:#ff8800;color:#000}

/* Profile overlay */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100;overflow-y:auto}
.overlay.active{display:block}
.overlay-inner{max-width:700px;margin:0 auto;padding:16px}
.overlay .close{position:fixed;top:12px;right:16px;color:#ff003c;font-size:20px;cursor:pointer;z-index:101}
.profile-header{border-bottom:1px solid #0a3d10;padding-bottom:12px;margin-bottom:12px}
.profile-header .pname{font-size:22px;color:#00ff41;text-shadow:0 0 12px rgba(0,255,65,.4)}
.profile-header .pkind{font-size:10px;color:#3a5f3a;margin-top:2px}
.profile-header .prel{font-size:11px;color:#00d4ff;margin-top:4px}
.profile-header .pnotes{font-size:10px;color:#7d8590;margin-top:6px;line-height:1.4}
.profile-section{margin-bottom:16px}
.profile-section .title{font-size:10px;color:#3a5f3a;border-bottom:1px solid #0a3d10;padding-bottom:4px;margin-bottom:8px}
.trait-grid{display:flex;gap:4px;flex-wrap:wrap}
.trait-tag{padding:3px 8px;border:1px solid #1a5f1a;font-size:9px;color:#00ff41;background:#0a1a0a}
.lang-tag{padding:3px 8px;border:1px solid #1a3d5f;font-size:9px;color:#00d4ff;background:#0a1a2a}
.fact-card{background:#0a0a00;border-left:2px solid #ffb700;padding:6px 10px;margin-bottom:3px}
.fact-card .fact-t{font-size:10px;color:#e6edf3}
.fact-card .fact-m{font-size:8px;color:#3a5f3a;margin-top:2px}
.conf-bar{display:inline-block;width:40px;height:4px;background:#1a1a00;margin-left:6px;vertical-align:middle}
.conf-fill{height:100%;background:#ffb700}
.memory-card{background:#000;border-left:2px solid #0a3d10;padding:6px 10px;margin-bottom:4px}
.memory-card .mc-meta{font-size:8px;color:#3a5f3a;margin-bottom:2px}
.memory-card .mc-text{font-size:10px;color:#c0c0c0;line-height:1.3}
.appear-card{background:#000;border:1px solid #0a3d10;padding:8px;margin-bottom:6px}
.appear-card .ac-chat{font-size:11px;color:#00d4ff}
.appear-card .ac-role{font-size:9px;color:#ffb700;margin-top:2px}
.appear-card .ac-traits{margin-top:4px}
.appear-card .ac-insight{font-size:9px;color:#7d8590;margin-top:4px;padding-left:8px;border-left:1px solid #1a3d1a}
.siti-box{background:#0a0a1a;border:1px solid #1a1a5f;padding:10px;margin-top:12px;font-size:10px;color:#8080ff}
.siti-box .siti-title{font-size:11px;color:#00d4ff;margin-bottom:6px}
#auto{color:#3a5f3a;font-size:8px;padding:4px 12px;text-align:right}
canvas{display:block}
.graph-tooltip{position:fixed;background:#000;border:1px solid #00ff41;padding:6px 10px;font-size:10px;color:#00ff41;pointer-events:none;z-index:50;display:none;max-width:250px}
.graph-tooltip .gt-name{font-size:12px;font-weight:bold}
.graph-tooltip .gt-rel{color:#00d4ff;font-size:9px}
.graph-tooltip .gt-bio{color:#7d8590;font-size:8px;margin-top:3px}
.loading{color:#3a5f3a;text-align:center;padding:40px;font-size:12px}
</style></head><body>
<div class="header">
  <div class="dot" id="dot"></div>
  <h1>NEO://twin-ingest</h1>
  <span id="phone" style="color:#7d8590;font-size:11px"></span>
  <span style="flex:1"></span>
  <span id="uptime" style="color:#3a5f3a;font-size:9px"></span>
</div>
<div class="stats" id="stats-grid"></div>
<div class="tabs">
  <div class="tab active" onclick="switchTab(0)">INTELLIGENCE</div>
  <div class="tab" onclick="switchTab(1)">PEOPLE</div>
  <div class="tab" onclick="switchTab(2)">FACTS</div>
  <div class="tab" onclick="switchTab(3)">LIVE FEED</div>
  <div class="tab" onclick="switchTab(4)">GRAPH</div>
  <div class="tab" onclick="switchTab(5)">DUPES</div>
</div>
<div id="auto">auto-refresh: 10s</div>

<div class="panel active" id="p0">
  <div class="section">// CATEGORY BREAKDOWN</div>
  <div class="cat-bar" id="cat-bar"></div>
  <div class="section">// RECENT PROCESSED MEMORIES</div>
  <div id="memories"></div>
</div>

<div class="panel" id="p1">
  <div class="section">// KNOWN PEOPLE — sorted by most recent activity. Click any card for deep profile.</div>
  <div style="margin:8px 0 12px;display:flex;gap:8px;align-items:center">
    <input id="people-search" placeholder="Search by name / nickname / phone (min 2 chars)…" oninput="onPeopleSearchInput(this.value)" style="flex:1;background:#000;border:1px solid #1a3d1a;color:#e6edf3;padding:6px 10px;font-family:inherit;font-size:11px">
    <span id="people-search-meta" style="color:#7d8590;font-size:9px;min-width:90px;text-align:right"></span>
  </div>
  <div id="people"></div>
</div>

<div class="panel" id="p2">
  <div class="section">// EXTRACTED FACTS</div>
  <div id="facts"></div>
</div>

<div class="panel" id="p3">
  <div class="section">// LIVE MESSAGE FEED (last 50)</div>
  <div id="live"></div>
</div>

<div class="panel" id="p4">
  <div style="margin:8px 0 10px;display:flex;gap:8px;align-items:center">
    <input id="graph-search" placeholder="Highlight nodes by name / full name / nickname / relationship (min 2 chars)…" oninput="onGraphSearchInput(this.value)" style="flex:1;background:#000;border:1px solid #1a3d1a;color:#e6edf3;padding:6px 10px;font-family:inherit;font-size:11px">
    <span id="graph-search-meta" style="color:#7d8590;font-size:9px;min-width:90px;text-align:right"></span>
  </div>
  <canvas id="graphCanvas" style="width:100%;height:calc(100vh - 260px);background:#050505;cursor:grab"></canvas>
</div>

<div class="panel" id="p5">
  <div class="section">// DUPLICATE PEOPLE — same display_name, multiple rows. Pick canonical, check dupes, click MERGE.</div>
  <div style="margin:8px 0 14px;color:#7d8590;font-size:10px">Largest fact-count is auto-selected as canonical (○). Toggle others as dupes (✓). Each merge is permanent (soft-mark via metadata.merged_into).</div>
  <div id="dupes"></div>
</div>

<div class="graph-tooltip" id="graph-tooltip"><div class="gt-name"></div><div class="gt-rel"></div><div class="gt-bio"></div></div>

<!-- Custom confirm modal -->
<div class="confirm-overlay" id="confirm-overlay">
  <div class="confirm-box">
    <div class="cb-msg" id="cb-msg"></div>
    <div class="cb-actions">
      <button class="cb-cancel" onclick="confirmResolve(false)">CANCEL</button>
      <button class="cb-ok" onclick="confirmResolve(true)">CONFIRM</button>
    </div>
  </div>
</div>

<!-- Profile overlay -->
<div class="overlay" id="profile-overlay">
  <div class="close" onclick="closeProfile()">X CLOSE</div>
  <div class="overlay-inner" id="profile-content">
    <div class="loading">LOADING PROFILE...</div>
  </div>
</div>

<script>
let activeTab = 0;
function switchTab(i) {
  activeTab = i;
  document.querySelectorAll('.tab').forEach((t,j) => t.classList.toggle('active', j===i));
  document.querySelectorAll('.panel').forEach((p,j) => p.classList.toggle('active', j===i));
  if (i === 5) loadDupes(); // lazy-load when tab opened
}

function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function ago(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return Math.round(d) + 's';
  if (d < 3600) return Math.round(d/60) + 'm';
  if (d < 86400) return Math.round(d/3600) + 'h';
  return Math.round(d/86400) + 'd';
}

// === PERSON PROFILE ===
async function openProfile(personId) {
  const overlay = document.getElementById('profile-overlay');
  const content = document.getElementById('profile-content');
  overlay.classList.add('active');
  content.innerHTML = '<div class="loading">ACCESSING PROFILE DATA...</div>';

  try {
    const resp = await fetch('/api/person/' + encodeURIComponent(personId));
    const data = await resp.json();
    currentProfile = data;
    content.innerHTML = renderProfile(data);
  } catch(e) {
    content.innerHTML = '<div class="loading" style="color:#ff003c">ERROR: ' + esc(e.message) + '</div>';
  }
}

function closeProfile() {
  document.getElementById('profile-overlay').classList.remove('active');
}

function renderProfile(data) {
  if (!data.found && !data.person_profiles_from_chats?.length && !data.from_chat_profiles?.length) {
    return '<div class="loading">NO PROFILE DATA FOUND FOR "' + esc(data.name) + '"</div>';
  }

  // If person not in people table but has wa-chat-importer data
  if (!data.found) {
    let html = '<div class="profile-header"><div class="pname">' + esc(data.name) + '</div>';
    html += '<div class="pkind">// NOT IN PEOPLE TABLE — data from chat imports only</div></div>';

    if (data.person_profiles_from_chats?.length) {
      html += '<div class="profile-section"><div class="title">// PROFILES FROM CHAT IMPORTS</div>';
      data.person_profiles_from_chats.forEach(p => {
        html += '<div class="appear-card"><div class="ac-chat">' + esc(p.chat) + '</div>';
        html += '<div class="ac-role">' + esc(p.relationship) + (p.role ? ' | ' + esc(p.role) : '') + '</div>';
        if (p.traits?.length) {
          html += '<div class="ac-traits trait-grid">';
          p.traits.forEach(t => html += '<span class="trait-tag">' + esc(t) + '</span>');
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    if (data.from_chat_profiles?.length) {
      html += '<div class="profile-section"><div class="title">// APPEARANCES IN CHAT PROFILES</div>';
      data.from_chat_profiles.forEach(a => {
        html += renderAppearance(a);
      });
      html += '</div>';
    }

    html += renderSitiBox(data);
    return html;
  }

  // Full person profile
  const p = data.person;
  let html = '<div class="profile-header">';
  html += '<div style="float:right;display:flex;gap:6px"><button class="btn-edit" onclick="enterEditMode()">EDIT</button><button class="btn-merge-person" onclick="enterMergeMode()">MERGE WITH...</button></div>';
  html += '<div class="pname">' + esc(p.name) + '</div>';
  html += '<div class="pkind">' + esc(p.kind) + (p.msg_count ? ' | ' + p.msg_count + ' messages tracked' : '') + '</div>';
  if (p.full_name && p.full_name !== p.name) html += '<div class="pkind">REAL NAME: ' + esc(p.full_name) + '</div>';
  if (p.nicknames?.length) html += '<div class="pkind">ALSO KNOWN AS: ' + p.nicknames.map(esc).join(', ') + '</div>';
  if (p.relationship) html += '<div class="prel">RELATIONSHIP: ' + esc(p.relationship) + (p.curated_fields?.includes('relationship') ? ' <span style="color:#ffb700;font-size:9px">🔒 curated</span>' : '') + '</div>';
  if (p.curated_fields?.length > 0) html += '<div style="font-size:9px;color:#ffb700;margin-top:4px">🔒 USER-CURATED FIELDS (protected from cron overwrites): ' + p.curated_fields.map(esc).join(', ') + '</div>';
  if (p.bio) html += '<div class="pnotes">' + esc(p.bio) + '</div>';
  else if (p.notes) html += '<div class="pnotes">' + esc(p.notes) + '</div>';
  html += '<div id="edit-form-mount"></div>';
  html += '</div>';

  // Traits
  if (p.traits?.length) {
    html += '<div class="profile-section"><div class="title">// PERSONALITY TRAITS</div>';
    html += '<div class="trait-grid">';
    p.traits.forEach(t => html += '<span class="trait-tag">' + esc(t) + '</span>');
    html += '</div></div>';
  }

  // Languages
  if (p.languages?.length) {
    html += '<div class="profile-section"><div class="title">// LANGUAGES</div>';
    html += '<div class="trait-grid">';
    const langNames = {ms:'Malay',en:'English',id:'Indonesian',zh:'Chinese',ar:'Arabic',ja:'Japanese'};
    p.languages.forEach(l => html += '<span class="lang-tag">' + esc(langNames[l]||l) + '</span>');
    html += '</div></div>';
  }

  // Facts by category
  if (data.facts?.total > 0) {
    html += '<div class="profile-section"><div class="title">// KNOWN FACTS (' + data.facts.total + ')</div>';
    Object.entries(data.facts.by_category).forEach(([cat, facts]) => {
      html += '<div style="margin-bottom:8px"><span class="badge" style="border-color:#ffb700;color:#ffb700">' + esc(cat.toUpperCase()) + '</span>';
      html += '<span style="color:#3a5f3a;font-size:8px">' + facts.length + ' facts</span></div>';
      facts.slice(0, 8).forEach(f => {
        const confPct = Math.round((f.confidence || 0) * 100);
        html += '<div class="fact-card"><div class="fact-t">' + esc(f.fact) + '<div class="conf-bar"><div class="conf-fill" style="width:' + confPct + '%"></div></div> ' + confPct + '%</div></div>';
      });
      if (facts.length > 8) html += '<div style="color:#3a5f3a;font-size:8px;padding:4px 10px">... and ' + (facts.length - 8) + ' more</div>';
    });
    html += '</div>';
  }

  // Conversation-extracted facts
  if (data.conversation_facts?.length) {
    html += '<div class="profile-section"><div class="title">// FACTS FROM CONVERSATIONS</div>';
    data.conversation_facts.forEach(f => {
      html += '<div class="fact-card"><div class="fact-t">' + esc(f) + '</div></div>';
    });
    html += '</div>';
  }

  // Chat appearances
  if (data.chat_appearances?.length) {
    html += '<div class="profile-section"><div class="title">// CHAT APPEARANCES (' + data.chat_appearances.length + ' chats)</div>';
    data.chat_appearances.forEach(a => {
      html += renderAppearance(a);
    });
    html += '</div>';
  }

  // Direct profile entries from importer
  if (data.profiles_from_chats?.length) {
    html += '<div class="profile-section"><div class="title">// IMPORTED PROFILES</div>';
    data.profiles_from_chats.forEach(p => {
      html += '<div class="appear-card"><div class="ac-chat">' + esc(p.chat) + '</div>';
      html += '<div class="ac-role">' + esc(p.relationship || '') + (p.role ? ' | ' + esc(p.role) : '') + '</div>';
      if (p.traits?.length) {
        html += '<div class="ac-traits trait-grid">';
        p.traits.forEach(t => html += '<span class="trait-tag">' + esc(t) + '</span>');
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Recent memories
  if (data.memories?.length) {
    html += '<div class="profile-section"><div class="title">// RELATED MEMORIES (' + data.memories.length + ')</div>';
    data.memories.slice(0, 15).forEach(m => {
      html += '<div class="memory-card"><div class="mc-meta">';
      html += '<span class="badge" style="border-color:#0a5f3a;color:#0a5f3a">' + esc(m.category || '') + '</span>';
      html += '<span class="badge" style="border-color:#3a3a5f;color:#3a3a5f">' + esc(m.type || '') + '</span>';
      html += 'imp:' + (m.importance||0) + ' | ' + esc(m.source||'') + (m.chat ? ' | ' + esc(m.chat) : '') + ' | ' + ago(m.time);
      html += '</div><div class="mc-text">' + esc(m.content) + '</div></div>';
    });
    html += '</div>';
  }

  // Siti interaction guide
  html += renderSitiBox(data);

  return html;
}

function renderAppearance(a) {
  let html = '<div class="appear-card"><div class="ac-chat">' + esc(a.chat) + '</div>';
  html += '<div class="ac-role">' + esc(a.relationship || 'unknown') + (a.role ? ' | ' + esc(a.role) : '') + '</div>';
  if (a.traits?.length) {
    html += '<div class="ac-traits trait-grid">';
    a.traits.forEach(t => html += '<span class="trait-tag">' + esc(t) + '</span>');
    html += '</div>';
  }
  if (a.neo_insights?.length) {
    html += '<div style="margin-top:6px"><div style="font-size:8px;color:#3a5f3a">NEO INSIGHTS FROM THIS CHAT:</div>';
    a.neo_insights.slice(0, 3).forEach(i => {
      html += '<div class="ac-insight">' + esc(i) + '</div>';
    });
    html += '</div>';
  }
  if (a.patterns?.length) {
    html += '<div style="margin-top:4px"><div style="font-size:8px;color:#3a5f3a">PATTERNS:</div>';
    a.patterns.slice(0, 3).forEach(pt => {
      html += '<div class="ac-insight" style="border-color:#5f5f1a">' + esc(pt) + '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderSitiBox(data) {
  const p = data.person || {};
  const traits = p.traits || [];
  const rel = p.relationship || data.person_profiles_from_chats?.[0]?.relationship || data.from_chat_profiles?.[0]?.relationship || 'contact';
  const langs = p.languages || [];
  const name = p.name || data.name || 'Unknown';

  let guide = '';
  if (rel === 'friend' || rel?.includes('friend')) {
    guide = 'Use casual, friendly tone. Reference shared experiences. Banter is OK.';
  } else if (rel === 'employee' || rel?.includes('employee') || rel?.includes('staff')) {
    guide = 'Professional but warm. Be helpful and supportive. Respect hierarchy.';
  } else if (rel === 'family' || rel?.includes('family') || rel?.includes('wife') || rel?.includes('ex')) {
    guide = 'Be warm and respectful. Sensitive topics possible. Keep it supportive.';
  } else if (rel?.includes('business') || rel?.includes('partner') || rel?.includes('CEO')) {
    guide = 'Professional tone. Focus on outcomes and decisions. Be concise.';
  } else {
    guide = 'Neutral, polite tone. Gather more context before adjusting.';
  }

  if (langs.includes('id')) guide += ' Can communicate in Bahasa Indonesia.';
  if (langs.includes('ms')) guide += ' Comfortable with Bahasa Melayu/Manglish.';
  if (traits.includes('humorous') || traits.includes('playful')) guide += ' Responds well to humor.';
  if (traits.includes('analytical') || traits.includes('tech-savvy')) guide += ' Prefers detailed, technical responses.';

  let html = '<div class="siti-box">';
  html += '<div class="siti-title">SITI INTERACTION GUIDE</div>';
  html += '<div>Person: <strong>' + esc(name) + '</strong></div>';
  html += '<div>Relationship: <strong>' + esc(rel) + '</strong></div>';
  html += '<div style="margin-top:6px">' + esc(guide) + '</div>';
  html += '</div>';
  return html;
}

// === MAIN REFRESH ===
async function refresh() {
  try {
    const [stats, insights, recent] = await Promise.all([
      fetch('/api/stats').then(r=>r.json()),
      fetch('/api/insights').then(r=>r.json()),
      fetch('/api/recent').then(r=>r.json()),
    ]);

    document.getElementById('dot').className = 'dot ' + (stats.connected ? 'on' : 'off');
    document.getElementById('phone').textContent = stats.connected ? '+' + stats.phone : 'DISCONNECTED';
    const h=Math.floor(stats.uptime_sec/3600), m=Math.floor((stats.uptime_sec%3600)/60);
    document.getElementById('uptime').textContent = 'UP ' + h + 'h ' + m + 'm';

    document.getElementById('stats-grid').innerHTML = [
      {val:insights.total_ingested||0, label:'TOTAL MEMORIES', cls:'cyan'},
      {val:insights.last_1h||0, label:'LAST 1H', cls:''},
      {val:insights.last_24h||0, label:'LAST 24H', cls:''},
      {val:(insights.people||[]).length, label:'PEOPLE', cls:'red'},
      {val:(insights.recent_facts||[]).length, label:'RECENT FACTS', cls:'amber'},
      {val:stats.errors, label:'ERRORS', cls:stats.errors>0?'red':''},
    ].map(s=>'<div class="stat '+s.cls+'"><div class="val">'+s.val+'</div><div class="label">'+s.label+'</div></div>').join('');

    // Categories
    const cats = insights.categories || {};
    const catColors = {general:'#7d8590',work:'#00d4ff',personal:'#00ff41',social:'#ffb700',identity:'#00ff41',opinion:'#ffb700',preference:'#00d4ff',plan:'#ff003c',finance:'#ff003c',family:'#00ff41',technical:'#00d4ff',business:'#00d4ff',conversation:'#3a5f3a',relationship:'#ff003c',gaming:'#ffb700',health:'#00ff41',tech:'#00d4ff'};
    document.getElementById('cat-bar').innerHTML = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<div class="cat-chip" style="border-color:'+(catColors[k]||'#3a5f3a')+';color:'+(catColors[k]||'#3a5f3a')+'">'+k.toUpperCase()+': '+v+'</div>').join('');

    // Memories
    document.getElementById('memories').innerHTML = (insights.recent_memories||[]).map(m=>{
      const cls = m.chat_type==='group'?'group':'dm';
      const src = m.is_owner ? 'YOU' : (m.sender||'');
      const chat = m.chat_name ? ' ['+esc(m.chat_name)+']' : '';
      const source = m.source === 'wa-chat-importer' ? 'IMPORT' : 'LIVE';
      return '<div class="card '+cls+'"><div class="meta"><span class="badge" style="border-color:#3a5f3a;color:#3a5f3a">'+source+'</span>'+src+chat+' <span style="float:right;color:#7d8590">'+ago(m.time)+' | imp:'+m.importance+' | '+m.category+'</span></div><div class="text">'+esc(m.content||'')+'</div></div>';
    }).join('') || '<div style="color:#3a5f3a;text-align:center;padding:30px">No memories yet</div>';

    // Cache the live "all known people" list for offline filtering when search is empty
    cachedPeopleList = (insights.people||[]).filter(p=>p.kind!=='self');
    if (!peopleSearchActive) renderPeopleList(cachedPeopleList);

    // Facts (now includes subject_name)
    document.getElementById('facts').innerHTML = (insights.recent_facts||[]).map(f => {
      const who = f.subject_name ? '<span style="color:#00ff41;margin-right:6px">'+esc(f.subject_name)+'</span>→' : '';
      return '<div class="card fact"><div class="meta">'+who+'<span class="badge" style="border-color:#ffb700;color:#ffb700;margin-left:6px">'+esc(f.category||'general')+'</span> conf:'+((f.confidence*100)||0).toFixed(0)+'% <span style="float:right;color:#7d8590">'+ago(f.time)+'</span></div><div class="fact-text">'+esc(f.fact)+'</div></div>';
    }).join('') || '<div style="color:#3a5f3a;text-align:center;padding:30px">No facts extracted yet</div>';

    // Live feed
    document.getElementById('live').innerHTML = (recent||[]).map(m=>{
      const cls = m.isGroup?'group':'dm';
      const src = m.isFromMe ? 'YOU' : (m.pushName||m.senderPhone);
      const grp = m.isGroup ? ' ['+esc(m.groupName||'group')+']' : '';
      return '<div class="card '+cls+'"><div class="meta">'+src+grp+' <span style="float:right;color:#7d8590">score:'+(m.score||'?')+' | '+esc(m.category||'?')+'</span></div><div class="text">'+esc((m.text||'').slice(0,200))+'</div>'+(m.fact?'<div class="fact-text" style="margin-top:3px">'+esc(m.fact)+'</div>':'')+'</div>';
    }).join('') || '<div style="color:#3a5f3a;text-align:center;padding:30px">Waiting for new messages...</div>';

  } catch(e) { document.getElementById('dot').className='dot off'; }
}
refresh();
document.getElementById('people').addEventListener('click',function(e){var c=e.target.closest('.person-card');if(c&&c.dataset.pid)openProfile(c.dataset.pid);});
setInterval(refresh, 10000);

// === DUPE CLUSTERS UI ===
let dupeState = {}; // clusterIdx → { canonId, dupeIds: Set }
let dupeClusters = [];
async function loadDupes() {
  const el = document.getElementById('dupes');
  el.innerHTML = '<div class="loading">SCANNING FOR DUPLICATES...</div>';
  try {
    const r = await fetch('/api/dupe-clusters').then(r=>r.json());
    dupeClusters = r.clusters || [];
    dupeState = {};
    if (dupeClusters.length === 0) {
      el.innerHTML = '<div style="color:#00ff41;text-align:center;padding:30px">✓ No duplicate clusters found.</div>';
      return;
    }
    // Default selection: highest-fact-count = canonical, others = dupes
    dupeClusters.forEach((c, idx) => {
      const sorted = c.rows.slice().sort((a,b) => b.fact_count - a.fact_count);
      dupeState[idx] = {
        canonId: sorted[0].id,
        dupeIds: new Set(sorted.slice(1).map(r => r.id)),
      };
    });
    renderDupes();
  } catch (e) {
    el.innerHTML = '<div class="loading" style="color:#ff003c">ERROR: ' + esc(e.message) + '</div>';
  }
}

function renderDupes() {
  const el = document.getElementById('dupes');
  el.innerHTML = '<div style="color:#7d8590;font-size:10px;margin-bottom:10px">Found <span style="color:#00d4ff">' + dupeClusters.length + '</span> clusters with multiple rows. Total dupes: <span style="color:#ff8800">' + dupeClusters.reduce((s,c)=>s+c.count-1,0) + '</span></div>';

  dupeClusters.forEach((cluster, idx) => {
    const state = dupeState[idx];
    if (!state) return;
    const totalFacts = cluster.rows.reduce((s,r)=>s+r.fact_count, 0);
    const lines = cluster.rows.map(row => {
      const isCanon = state.canonId === row.id;
      const isDupe = state.dupeIds.has(row.id);
      const cls = isCanon ? 'canon' : (isDupe ? 'dupe' : '');
      const pickIcon = isCanon ? '<span style="color:#00ff41">○</span>' : (isDupe ? '<span style="color:#ff8800">✓</span>' : '<span style="color:#3a5f3a">·</span>');
      const tags = [];
      if (row.has_bio) tags.push('<span style="color:#00d4ff">bio</span>');
      if (row.has_traits) tags.push('<span style="color:#00d4ff">traits</span>');
      if (row.relationship) tags.push('<span style="color:#ffb700">' + esc(row.relationship.slice(0,18)) + '</span>');
      if (row.last_extracted) tags.push('<span style="color:#3a8f3a">enriched</span>');
      const meta = (row.push_name && row.push_name !== row.display_name) ? ('push: ' + esc(row.push_name)) : ('id: ' + row.id.slice(0,8));
      return '<div class="dupe-row ' + cls + '" data-cluster="' + idx + '" data-id="' + esc(row.id) + '">'
        + '<div class="pick">' + pickIcon + '</div>'
        + '<div><div>' + esc(row.display_name) + '</div><div class="id">' + meta + '</div></div>'
        + '<div style="color:#ffb700">' + row.fact_count + ' f</div>'
        + '<div class="meta">' + row.identifiers_count + ' ids</div>'
        + '<div class="meta">' + (row.created_at ? row.created_at.slice(0,10) : '-') + '</div>'
        + '<div class="meta" style="display:flex;gap:4px;flex-wrap:wrap">' + tags.join('') + '</div>'
      + '</div>';
    }).join('');
    const dupeCount = state.dupeIds.size;
    el.innerHTML += '<div class="dupe-cluster" id="cluster-' + idx + '">'
      + '<div class="dupe-header">'
      +   '<div class="dupe-name">"' + esc(cluster.name) + '" × ' + cluster.count + '</div>'
      +   '<div class="dupe-summary">' + totalFacts + ' total facts | ' + dupeCount + ' selected as dupe</div>'
      + '</div>'
      + lines
      + '<div class="dupe-actions">'
      +   '<button class="btn-skip" onclick="skipCluster(' + idx + ')">SKIP</button>'
      +   '<button class="btn-merge" onclick="mergeCluster(' + idx + ')" ' + (dupeCount === 0 ? 'disabled' : '') + '>MERGE ' + dupeCount + ' INTO CANONICAL</button>'
      + '</div>'
      + '<div class="merge-result" id="result-' + idx + '" style="display:none"></div>'
    + '</div>';
  });

  // Attach row-click toggle
  el.querySelectorAll('.dupe-row').forEach(rowEl => {
    rowEl.addEventListener('click', () => toggleDupeRow(parseInt(rowEl.dataset.cluster), rowEl.dataset.id));
  });
}

function toggleDupeRow(idx, id) {
  const state = dupeState[idx];
  if (!state) return;
  if (state.canonId === id) {
    // Click on canonical → demote it to dupe (canonical becomes empty until another row is picked)
    state.dupeIds.add(id);
    state.canonId = null;
  } else if (state.dupeIds.has(id)) {
    // Click on dupe → unmark, promote to canonical (replacing existing if any)
    state.dupeIds.delete(id);
    if (state.canonId) state.dupeIds.add(state.canonId);
    state.canonId = id;
  } else {
    // Currently neither → mark as dupe
    state.dupeIds.add(id);
  }
  renderDupes();
}

function skipCluster(idx) {
  const node = document.getElementById('cluster-' + idx);
  if (node) node.style.display = 'none';
}

async function mergeCluster(idx) {
  const state = dupeState[idx];
  if (!state || !state.canonId || state.dupeIds.size === 0) return;
  const cluster = dupeClusters[idx];
  const ok = await customConfirm('Merge ' + state.dupeIds.size + ' "' + cluster.name + '" rows into the selected canonical?\\n\\nThis will:\\n- migrate all facts to the canonical row\\n- soft-mark the dupes\\n- union identifiers + nicknames\\n\\nNot trivially reversible.');
  if (!ok) return;

  const node = document.getElementById('cluster-' + idx);
  if (node) node.classList.add('merging');
  const resultEl = document.getElementById('result-' + idx);
  resultEl.style.display = 'block';
  resultEl.className = 'merge-result';
  resultEl.textContent = 'Merging...';

  try {
    const resp = await fetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonical_id: state.canonId, dupe_ids: [...state.dupeIds] }),
    });
    const data = await resp.json();
    if (!data.ok) {
      resultEl.className = 'merge-result err';
      resultEl.textContent = '✗ ' + (data.error || 'merge failed');
      if (node) node.classList.remove('merging');
      return;
    }
    resultEl.textContent = '✓ Merged ' + data.dupes_marked + ' rows into "' + data.canonical_name + '". '
      + data.facts_migrated + ' facts moved, ' + data.identifiers_added + ' identifiers + ' + data.nicknames_added + ' nicknames added.';
    // Hide the cluster after successful merge
    setTimeout(() => { if (node) node.style.display = 'none'; }, 4000);
  } catch (e) {
    resultEl.className = 'merge-result err';
    resultEl.textContent = '✗ ' + e.message;
    if (node) node.classList.remove('merging');
  }
}

// === People panel: render + search ===
let cachedPeopleList = [];
let peopleSearchActive = false;
let peopleSearchTimer = null;

function renderPeopleList(list, opts) {
  opts = opts || {};
  const el = document.getElementById('people');
  if (!list || list.length === 0) {
    el.innerHTML = '<div style="color:#3a5f3a;text-align:center;padding:30px">' + (opts.emptyMsg || 'No people tracked yet') + '</div>';
    return;
  }
  el.innerHTML = list.map(p => {
    const rel = p.relationship ? '<span style="color:#00d4ff"> | '+esc(p.relationship)+'</span>' : '';
    const dmStr = (p.total_dm > 0)
      ? ' | <span style="color:#ffb700">' + p.total_dm + ' DMs</span> ('+ (p.dm_in||0) +'↓ ' + (p.dm_out||0) +'↑)'
      : (p.msg_count ? ' | '+p.msg_count+' msgs' : '');
    const lastDm = p.last_dm_at ? '<span style="color:#3a8f3a"> | last DM '+ago(p.last_dm_at)+' ago</span>' : (p.last_fact_at ? '<span style="color:#3a8f3a"> | last activity '+ago(p.last_fact_at)+' ago</span>' : '');
    const fullName = (p.full_name && p.full_name !== p.name) ? '<span style="color:#7d8590"> ('+esc(p.full_name)+')</span>' : '';
    const traits = (p.traits||[]).slice(0,5).map(t=>'<span class="trait">'+esc(t)+'</span>').join('');
    const langs = (p.languages||[]).map(l=>'<span class="trait" style="border-color:#1a3d5f;color:#00d4ff">'+esc(l)+'</span>').join('');
    return '<div class="person-card" data-pid="'+esc(p.id)+'">'
      +'<div class="name">'+esc(p.name)+fullName+'</div>'
      +'<div class="info">'+p.kind+rel+dmStr+lastDm+'</div>'
      +(p.notes?'<div style="color:#7d8590;font-size:9px;margin-top:3px">'+esc(p.notes.slice(0,140))+'</div>':'')
      +(traits||langs?'<div class="traits-row">'+traits+langs+'</div>':'')
      +'</div>';
  }).join('');
}

function onPeopleSearchInput(q) {
  clearTimeout(peopleSearchTimer);
  peopleSearchTimer = setTimeout(() => doPeopleSearch(q), 250);
}

async function doPeopleSearch(q) {
  const meta = document.getElementById('people-search-meta');
  q = (q || '').trim();
  if (q.length < 2) {
    peopleSearchActive = false;
    meta.textContent = '';
    renderPeopleList(cachedPeopleList);
    return;
  }
  peopleSearchActive = true;
  meta.textContent = 'searching…';
  try {
    const r = await fetch('/api/people/search?q=' + encodeURIComponent(q)).then(r => r.json());
    const rows = r.results || [];
    meta.textContent = rows.length + ' match' + (rows.length === 1 ? '' : 'es');
    // Map raw search rows to the same shape renderPeopleList expects
    renderPeopleList(rows.map(p => ({
      id: p.id,
      name: p.display_name,
      full_name: p.full_name,
      kind: p.kind,
      relationship: p.relationship,
      msg_count: p.fact_count || 0,
      traits: p.traits || [],
      languages: [],
      notes: (p.bio || '').slice(0, 200),
      last_fact_at: null,
    })), { emptyMsg: 'No matches for "' + q + '"' });
  } catch (e) {
    meta.textContent = 'error';
    document.getElementById('people').innerHTML = '<div style="color:#ff003c;text-align:center;padding:30px">Search error: ' + esc(e.message) + '</div>';
  }
}

// === Custom confirm (in-page modal — survives browser dialog suppression) ===
let _confirmResolver = null;
function customConfirm(message) {
  return new Promise(resolve => {
    _confirmResolver = resolve;
    document.getElementById('cb-msg').textContent = message;
    document.getElementById('confirm-overlay').classList.add('active');
  });
}
function confirmResolve(answer) {
  document.getElementById('confirm-overlay').classList.remove('active');
  const r = _confirmResolver; _confirmResolver = null;
  if (r) r(!!answer);
}

// === PROFILE EDIT + CROSS-PERSON MERGE ===
let currentProfile = null; // last loaded profile data; openProfile sets this

function enterEditMode() {
  if (!currentProfile?.person) return;
  const p = currentProfile.person;
  const mount = document.getElementById('edit-form-mount');
  if (!mount) return;
  const rels = ['', 'best friend', 'friend', 'colleague', 'employee', 'family', 'business partner', 'acquaintance', 'client'];
  const relOpts = rels.map(r => '<option value="' + esc(r) + '"' + ((p.relationship||'') === r ? ' selected' : '') + '>' + (r || '— select —') + '</option>').join('');
  mount.innerHTML = '<div class="edit-form" id="edit-form">'
    + '<div class="row"><label>display name (what shows on the panel)</label><input id="ef-display" value="' + esc(p.name||'') + '"></div>'
    + '<div class="row"><label>real / full name</label><input id="ef-full" value="' + esc(p.full_name||'') + '"><div class="hint">Use this for the actual person name when display_name is a WhatsApp handle (e.g., "Fara" for "butterflykisses_fara🦋").</div></div>'
    + '<div class="row"><label>nicknames (comma-separated)</label><input id="ef-nicks" value="' + esc((p.nicknames||[]).join(", ")) + '"><div class="hint">Aliases people use. e.g., "kakak, fara, sis". Used by twin-ingest to recognize references.</div></div>'
    + '<div class="row"><label>relationship</label><select id="ef-rel">' + relOpts + '</select><input id="ef-rel-custom" placeholder="or type a custom relationship (e.g., elder sister)" value="' + (rels.includes(p.relationship||'') ? '' : esc(p.relationship||'')) + '" style="margin-top:4px"></div>'
    + '<div class="row"><label>bio</label><textarea id="ef-bio">' + esc(p.bio || p.notes || '') + '</textarea></div>'
    + '<div class="actions">'
    + '  <button class="btn-skip" onclick="cancelEdit()">CANCEL</button>'
    + '  <button class="btn-edit" onclick="saveEdit(\\'' + esc(p.id) + '\\')">SAVE</button>'
    + '</div>'
    + '<div class="merge-result" id="edit-result" style="display:none"></div>'
    + '</div>';
}

function cancelEdit() {
  const mount = document.getElementById('edit-form-mount');
  if (mount) mount.innerHTML = '';
}

async function saveEdit(personId) {
  const display = document.getElementById('ef-display').value.trim();
  const fullName = document.getElementById('ef-full').value.trim();
  const nicks = document.getElementById('ef-nicks').value.split(',').map(s => s.trim()).filter(Boolean);
  const relSel = document.getElementById('ef-rel').value;
  const relCustom = document.getElementById('ef-rel-custom').value.trim();
  const relationship = relCustom || relSel || null;
  const bio = document.getElementById('ef-bio').value.trim();
  const result = document.getElementById('edit-result');
  result.style.display = 'block';
  result.className = 'merge-result';
  result.textContent = 'Saving...';

  const body = { display_name: display || null, full_name: fullName || null, nicknames: nicks, relationship, bio: bio || null };

  try {
    const resp = await fetch('/api/person/' + encodeURIComponent(personId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) {
      result.className = 'merge-result err';
      result.textContent = '✗ ' + (data.error || 'save failed');
      return;
    }
    result.textContent = '✓ Saved: ' + (data.updated_fields || []).join(', ') + '. Reloading profile...';
    setTimeout(() => openProfile(personId), 800);
  } catch (e) {
    result.className = 'merge-result err';
    result.textContent = '✗ ' + e.message;
  }
}

let mergePickerResults = []; // last fetched results
let mergePickerSelectedIds = new Set(); // multi-select

function enterMergeMode() {
  if (!currentProfile?.person) return;
  const me = currentProfile.person;
  const mount = document.getElementById('edit-form-mount');
  if (!mount) return;
  mergePickerResults = [];
  mergePickerSelectedIds = new Set();
  mount.innerHTML = '<div class="merge-picker" id="merge-picker">'
    + '<div style="color:#ff8800;font-size:11px;margin-bottom:4px">Find rows to merge INTO "' + esc(me.name) + '". Same person may appear under many display_names (different LIDs / WA accounts).</div>'
    + '<div style="color:#7d8590;font-size:9px;margin-bottom:8px">All selected rows will be merged AS DUPES into "' + esc(me.name) + '" (kept as canonical). Their facts move, identifiers union, rows soft-marked.</div>'
    + '<div class="search-wrap">'
    + '  <input id="mp-search" placeholder="Type at least 2 chars of name / push / phone..." oninput="mergePickerSearch(this.value)">'
    + '  <div id="mp-toolbar" style="display:none;margin-top:6px;display:flex;gap:6px;font-size:10px;color:#7d8590">'
    + '    <button class="btn-skip" onclick="mpSelectAll()">SELECT ALL VISIBLE</button>'
    + '    <button class="btn-skip" onclick="mpSelectNone()">CLEAR</button>'
    + '    <span id="mp-count" style="margin-left:auto;align-self:center"></span>'
    + '  </div>'
    + '  <div class="results" id="mp-results"></div>'
    + '</div>'
    + '<div class="actions">'
    + '  <button class="btn-skip" onclick="cancelEdit()">CANCEL</button>'
    + '  <button class="btn-merge-person" id="mp-confirm" onclick="confirmBulkMerge(\\'' + esc(me.id) + '\\')" disabled>SELECT TARGETS FIRST</button>'
    + '</div>'
    + '<div class="merge-result" id="mp-result" style="display:none"></div>'
    + '</div>';
}

let mergePickerTimeout = null;
function mergePickerSearch(q) {
  clearTimeout(mergePickerTimeout);
  mergePickerTimeout = setTimeout(() => doMergePickerSearch(q), 250);
}

async function doMergePickerSearch(q) {
  const me = currentProfile?.person;
  if (!me) return;
  const resultsEl = document.getElementById('mp-results');
  const toolbar = document.getElementById('mp-toolbar');
  if (q.trim().length < 2) { resultsEl.innerHTML = ''; toolbar.style.display = 'none'; return; }
  resultsEl.innerHTML = '<div style="padding:6px 10px;color:#7d8590;font-size:10px">Searching...</div>';
  try {
    const r = await fetch('/api/people/search?q=' + encodeURIComponent(q) + '&exclude=' + encodeURIComponent(me.id)).then(r => r.json());
    mergePickerResults = r.results || [];
    if (mergePickerResults.length === 0) {
      resultsEl.innerHTML = '<div style="padding:6px 10px;color:#7d8590;font-size:10px">No matches.</div>';
      toolbar.style.display = 'none';
      return;
    }
    toolbar.style.display = 'flex';
    renderMergePickerResults();
  } catch (e) {
    resultsEl.innerHTML = '<div style="padding:6px 10px;color:#ff003c;font-size:10px">Error: ' + esc(e.message) + '</div>';
  }
}

function renderMergePickerResults() {
  const resultsEl = document.getElementById('mp-results');
  resultsEl.innerHTML = '<div style="padding:4px 10px;color:#7d8590;font-size:9px;border-bottom:1px solid #2a2a2a">' + mergePickerResults.length + ' results · click row to toggle</div>'
    + mergePickerResults.map(p => {
      const checked = mergePickerSelectedIds.has(p.id);
      const meta = [
        p.full_name,
        p.push_name && p.push_name !== p.display_name ? 'push: ' + p.push_name : null,
        p.phone,
        p.relationship,
        p.fact_count ? p.fact_count + ' facts' : null,
        p.bio ? 'has bio' : null,
      ].filter(Boolean).join(' · ');
      return '<div class="result-row' + (checked ? ' checked' : '') + '" data-pid="' + esc(p.id) + '">'
        + '<span style="margin-right:8px;color:' + (checked ? '#ff8800' : '#3a5f3a') + '">[' + (checked ? '✓' : ' ') + ']</span>'
        + '<span>' + esc(p.display_name) + '</span>'
        + '<div class="meta" style="margin-left:24px">' + esc(meta) + ' · ' + p.id.slice(0,8) + '</div>'
        + '</div>';
    }).join('');
  // attach click handlers
  resultsEl.querySelectorAll('.result-row[data-pid]').forEach(row => {
    row.addEventListener('click', () => mpToggle(row.dataset.pid));
  });
  updateMpCount();
}

function mpToggle(id) {
  if (mergePickerSelectedIds.has(id)) mergePickerSelectedIds.delete(id);
  else mergePickerSelectedIds.add(id);
  renderMergePickerResults();
}
function mpSelectAll() { for (const r of mergePickerResults) mergePickerSelectedIds.add(r.id); renderMergePickerResults(); }
function mpSelectNone() { mergePickerSelectedIds.clear(); renderMergePickerResults(); }

function updateMpCount() {
  const n = mergePickerSelectedIds.size;
  const countEl = document.getElementById('mp-count');
  if (countEl) countEl.textContent = n + ' selected';
  const btn = document.getElementById('mp-confirm');
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? 'SELECT TARGETS FIRST' : ('MERGE ' + n + ' INTO "' + (currentProfile?.person?.name || '') + '"');
  }
}

async function confirmBulkMerge(meId) {
  // Visible trace so we can see the click fired even if currentProfile is null
  const result = document.getElementById('mp-result');
  if (result) {
    result.style.display = 'block';
    result.className = 'merge-result';
    result.textContent = 'Click received. Validating...';
  }
  console.log('[merge] click received, meId=', meId, 'selected=', mergePickerSelectedIds.size, 'currentProfile?', !!currentProfile);

  if (mergePickerSelectedIds.size === 0) {
    if (result) { result.className = 'merge-result err'; result.textContent = '✗ no rows selected'; }
    return;
  }
  if (!currentProfile?.person) {
    if (result) { result.className = 'merge-result err'; result.textContent = '✗ profile state lost — close and reopen the profile'; }
    return;
  }
  const me = currentProfile.person;
  const ids = [...mergePickerSelectedIds];
  const ok = await customConfirm('Merge ' + ids.size + ' rows INTO "' + me.name + '"?\\n\\nAll their facts will move. Identifiers + push_names will union onto "' + me.name + '". Soft-mark via metadata.merged_into.\\n\\nNot trivially reversible.');
  if (!ok) {
    if (result) result.textContent = 'Cancelled.';
    return;
  }

  result.style.display = 'block';
  result.className = 'merge-result';
  result.textContent = 'Merging ' + ids.length + ' rows...';

  try {
    // /api/merge accepts up to 50 dupes per call. Chunk if needed.
    const CHUNK = 50;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    let totalFacts = 0, totalIds = 0, totalNicks = 0, marked = 0;
    for (let i = 0; i < chunks.length; i++) {
      result.textContent = 'Merging batch ' + (i+1) + '/' + chunks.length + '...';
      const resp = await fetch('/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_id: meId, dupe_ids: chunks[i] }),
      });
      const data = await resp.json();
      if (!data.ok) {
        result.className = 'merge-result err';
        result.textContent = '✗ Batch ' + (i+1) + ': ' + (data.error || 'merge failed');
        return;
      }
      totalFacts += data.facts_migrated || 0;
      totalIds += data.identifiers_added || 0;
      totalNicks += data.nicknames_added || 0;
      marked += data.dupes_marked || 0;
    }
    result.textContent = '✓ Merged ' + marked + ' rows. ' + totalFacts + ' facts moved, +' + totalIds + ' identifiers, +' + totalNicks + ' nicknames. Reloading...';
    setTimeout(() => openProfile(meId), 1500);
  } catch (e) {
    result.className = 'merge-result err';
    result.textContent = '✗ ' + e.message;
  }
}

// === RELATIONSHIP GRAPH ===
let graphData = null;
let graphAnimFrame = null;
let graphOffset = {x:0, y:0};
let graphFilter = ''; // lowercased search query — empty means show all

function graphNodeMatches(p) {
  if (!graphFilter) return true;
  const f = graphFilter;
  if (p.name && p.name.toLowerCase().indexOf(f) >= 0) return true;
  if (p.full_name && p.full_name.toLowerCase().indexOf(f) >= 0) return true;
  if (p.relationship && p.relationship.toLowerCase().indexOf(f) >= 0) return true;
  if (Array.isArray(p.nicknames)) {
    for (var ni = 0; ni < p.nicknames.length; ni++) {
      if (p.nicknames[ni] && String(p.nicknames[ni]).toLowerCase().indexOf(f) >= 0) return true;
    }
  }
  return false;
}

let graphSearchTimer = null;
function onGraphSearchInput(q) {
  clearTimeout(graphSearchTimer);
  graphSearchTimer = setTimeout(function() {
    graphFilter = (q || '').trim().toLowerCase();
    if (graphFilter.length === 1) graphFilter = ''; // single char too noisy
    const meta = document.getElementById('graph-search-meta');
    if (!graphFilter) { meta.textContent = ''; }
    else {
      let n = 0;
      for (const p of (graphData || [])) if (graphNodeMatches(p)) n++;
      meta.textContent = n + ' match' + (n === 1 ? '' : 'es');
    }
    drawGraph();
  }, 200);
}
let graphDrag = null;
let graphScale = 1;
let graphHover = null;

const REL_RINGS = {
  'self': 0, 'best friend': 1, 'family': 1, 'ex-wife': 1.5,
  'friend': 2, 'employee': 2.5, 'colleague': 3,
  'business partner': 3, 'client': 3.5, 'acquaintance': 4,
};

const REL_COLORS = {
  'self': '#00ff41', 'best friend': '#ff00ff', 'family': '#00ff41',
  'ex-wife': '#ff6b6b', 'friend': '#ffb700', 'employee': '#00d4ff',
  'colleague': '#00d4ff', 'business partner': '#00d4ff',
  'client': '#7d8590', 'acquaintance': '#3a5f3a',
};

// Free-text relationship → canonical ring/color key. Neo writes things like
// "Brother! non blood, but still!" or "Elder Sister!" — we match keywords so
// they still land in the correct ring. The tooltip shows the original string.
function normalizeRelationship(rel) {
  if (!rel || typeof rel !== 'string') return 'acquaintance';
  var r = rel.toLowerCase();
  if (/(brother|sister|mother|father|\bmom\b|\bdad\b|wife|husband|\bson\b|daughter|child|kid|aunty|aunt|uncle|cousin|kakak|abang|adik|family|mama|papa|sibling|in-law|stepchild|stepmom|stepdad)/.test(r)) return 'family';
  if (r.indexOf('ex-wife') >= 0 || r.indexOf('ex wife') >= 0 || r.indexOf('ex-husband') >= 0) return 'ex-wife';
  if (r.indexOf('best friend') >= 0 || r.indexOf('best fren') >= 0) return 'best friend';
  if (r.indexOf('employee') >= 0 || r.indexOf('staff') >= 0) return 'employee';
  if (r.indexOf('client') >= 0) return 'client';
  if (r.indexOf('business') >= 0 || r.indexOf('partner') >= 0 || r.indexOf('founder') >= 0 || r.indexOf('co-founder') >= 0) return 'business partner';
  if (r.indexOf('colleague') >= 0 || r.indexOf('coworker') >= 0 || r.indexOf('teammate') >= 0) return 'colleague';
  if (r.indexOf('friend') >= 0) return 'friend';
  return 'acquaintance';
}

async function loadGraph() {
  try {
    var resp = await fetch('/api/insights');
    var data = await resp.json();
    graphData = (data.people || []).filter(function(p) { return p.name && p.kind !== 'group'; });
    drawGraph();
  } catch(e) { console.error('graph load fail', e); }
}

function drawGraph() {
  var canvas = document.getElementById('graphCanvas');
  if (!canvas || !graphData) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  var W = rect.width, H = rect.height;
  var cx = W/2 + graphOffset.x, cy = H/2 + graphOffset.y;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(0,255,65,0.02)';
  for (var y = 0; y < H; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  var maxRing = 4;
  var ringSpacing = Math.min(W, H) * 0.1 * graphScale;

  for (var r = 1; r <= maxRing; r++) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * ringSpacing, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,65,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.font = '8px Courier New';
  ctx.fillStyle = 'rgba(0,255,65,0.15)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  var ringLabels = {1:'INNER CIRCLE', 2:'FRIENDS', 3:'WORK', 4:'OUTER'};
  for (var rl in ringLabels) { ctx.fillText(ringLabels[rl], cx + rl * ringSpacing + 4, cy - 4); }

  var ringGroups = {};
  for (var pi = 0; pi < graphData.length; pi++) {
    var p = graphData[pi];
    var relKey = normalizeRelationship(p.relationship);
    if (relKey === 'self') continue;
    p._relKey = relKey; // cache so the inner loop doesn't re-compute
    var ring = REL_RINGS[relKey] || 4;
    if (!ringGroups[ring]) ringGroups[ring] = [];
    ringGroups[ring].push(p);
  }

  var nodes = [];

  // NEO center
  var neoSize = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, neoSize, 0, Math.PI * 2);
  ctx.fillStyle = '#00ff41';
  ctx.shadowColor = '#00ff41';
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.font = 'bold 10px Courier New';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NEO', cx, cy);
  nodes.push({x: cx, y: cy, r: neoSize, person: {name:'Neo',id:'00000000-0000-0000-0000-000000000001'}});

  for (var ring in ringGroups) {
    var people = ringGroups[ring];
    var radius = parseFloat(ring) * ringSpacing;
    for (var i = 0; i < people.length; i++) {
      var pp = people[i];
      var angle = (i / people.length) * Math.PI * 2 - Math.PI / 2;
      var jitter = Math.sin(i * 7.3) * ringSpacing * 0.15;
      var x = cx + Math.cos(angle) * (radius + jitter);
      var y = cy + Math.sin(angle) * (radius + jitter);

      var prelKey = pp._relKey || normalizeRelationship(pp.relationship);
      var color = REL_COLORS[prelKey] || '#3a5f3a';
      // Node size weighted toward MUTUAL conversation. Pure inbound broadcasts
      // (944↓ 0↑ Islamic-dhikr forwarders) get mutual=0 → small node. Balanced
      // friends (208↓ 218↑) get a big mutual signal.
      var mutual = pp.mutual_dm || 0;
      var oneWay = (pp.total_dm || 0) - mutual;
      var engScore = mutual > 0
        ? Math.log10(1 + mutual) * 4 + Math.log10(1 + oneWay) * 0.5
        : (pp.total_dm > 0 ? Math.log10(1 + pp.total_dm) * 0.5 : (pp.msg_count || 0) / 200);
      var dataScore = (pp.traits ? pp.traits.length : 0) * 0.4 + engScore;
      var nodeSize = Math.max(4, Math.min(14, 4 + dataScore));

      // Search filter: matched nodes pop, unmatched dim to alpha 0.15
      var matched = graphNodeMatches(pp);
      var dimNonMatch = graphFilter && !matched;
      ctx.globalAlpha = dimNonMatch ? 0.15 : 1.0;

      var lr = parseInt(color.slice(1,3),16), lg = parseInt(color.slice(3,5),16), lb = parseInt(color.slice(5,7),16);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba('+lr+','+lg+','+lb+',0.1)';
      ctx.lineWidth = 0.5; ctx.stroke();

      var isHov = graphHover && graphHover.person.id === pp.id;
      var isSearchHit = graphFilter && matched;
      ctx.beginPath();
      ctx.arc(x, y, isHov || isSearchHit ? nodeSize + 3 : nodeSize, 0, Math.PI * 2);
      ctx.fillStyle = isHov ? '#fff' : color;
      if (isHov) { ctx.shadowColor = color; ctx.shadowBlur = 15; }
      else if (isSearchHit) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 22; }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Show label always when there's a search hit (so the matched name is readable even at low zoom)
      if (graphScale >= 0.8 || isHov || isSearchHit) {
        ctx.fillStyle = isHov || isSearchHit ? '#fff' : color;
        ctx.font = (isHov || isSearchHit ? 'bold ' : '') + (isSearchHit ? '10px' : '8px') + ' Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var label = (pp.name || '').length > 15 ? pp.name.slice(0,13) + '..' : pp.name;
        ctx.fillText(label, x, y + nodeSize + 2);
      }

      ctx.globalAlpha = 1.0; // restore for next node + non-loop draw ops
      nodes.push({x:x, y:y, r:nodeSize, person:pp});
    }
  }

  // Legend
  var legendX = 12, ly = H - 110;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(legendX - 4, ly - 4, 130, 105);
  ctx.font = '8px Courier New';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  var legendItems = [['best friend','#ff00ff'],['family','#00ff41'],['ex-wife','#ff6b6b'],['friend','#ffb700'],['employee','#00d4ff'],['colleague','#00d4ff'],['business partner','#00d4ff'],['acquaintance','#3a5f3a']];
  for (var li = 0; li < legendItems.length; li++) {
    ctx.fillStyle = legendItems[li][1];
    ctx.fillRect(legendX, ly + 1, 6, 6);
    ctx.fillStyle = '#7d8590';
    ctx.textBaseline = 'middle';
    ctx.fillText(legendItems[li][0].toUpperCase(), legendX + 10, ly + 4);
    ly += 11;
  }

  canvas._nodes = nodes;
}

function initGraphEvents() {
  var canvas = document.getElementById('graphCanvas');
  if (!canvas) return;
  var tooltip = document.getElementById('graph-tooltip');

  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (graphDrag) {
      graphOffset.x += e.clientX - graphDrag.x;
      graphOffset.y += e.clientY - graphDrag.y;
      graphDrag = {x: e.clientX, y: e.clientY};
      drawGraph(); return;
    }
    var hit = null;
    for (var ni = 0; ni < (canvas._nodes || []).length; ni++) {
      var node = canvas._nodes[ni];
      var dx = mx - node.x, dy = my - node.y;
      if (dx*dx + dy*dy < (node.r + 4) * (node.r + 4)) { hit = node; break; }
    }
    if (hit && hit.person) {
      graphHover = hit;
      canvas.style.cursor = 'pointer';
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
      var displayName = hit.person.full_name && hit.person.full_name !== hit.person.name
        ? hit.person.name + ' (' + hit.person.full_name + ')'
        : (hit.person.name || '?');
      tooltip.querySelector('.gt-name').textContent = displayName;
      var engStr = hit.person.total_dm > 0
        ? ' | ' + hit.person.total_dm + ' DMs (' + (hit.person.dm_in||0) + '↓ ' + (hit.person.dm_out||0) + '↑)'
        : (hit.person.msg_count ? ' | ' + hit.person.msg_count + ' msgs' : '');
      tooltip.querySelector('.gt-rel').textContent = (hit.person.relationship || 'unknown').toUpperCase() + engStr;
      tooltip.querySelector('.gt-bio').textContent = (hit.person.bio || hit.person.notes || '').slice(0, 200);
      drawGraph();
    } else {
      if (graphHover) { graphHover = null; drawGraph(); }
      canvas.style.cursor = graphDrag ? 'grabbing' : 'grab';
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mousedown', function(e) { graphDrag = {x: e.clientX, y: e.clientY}; canvas.style.cursor = 'grabbing'; });

  canvas.addEventListener('mouseup', function(e) {
    if (graphDrag) {
      var dx = e.clientX - graphDrag.x, dy = e.clientY - graphDrag.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        for (var ni = 0; ni < (canvas._nodes || []).length; ni++) {
          var node = canvas._nodes[ni];
          var ndx = mx - node.x, ndy = my - node.y;
          if (ndx*ndx + ndy*ndy < (node.r + 4) * (node.r + 4) && node.person.id) {
            openProfile(node.person.id); break;
          }
        }
      }
    }
    graphDrag = null; canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    graphScale = Math.max(0.3, Math.min(3, graphScale - e.deltaY * 0.001));
    drawGraph();
  }, {passive: false});

  var lastTouch = null;
  canvas.addEventListener('touchstart', function(e) { if (e.touches.length === 1) lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY}; });
  canvas.addEventListener('touchmove', function(e) { if (e.touches.length === 1 && lastTouch) { graphOffset.x += e.touches[0].clientX - lastTouch.x; graphOffset.y += e.touches[0].clientY - lastTouch.y; lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY}; drawGraph(); } });
  canvas.addEventListener('touchend', function() { lastTouch = null; });
  window.addEventListener('resize', function() { if (activeTab === 4) drawGraph(); });
}

var origSwitchTab = switchTab;
switchTab = function(i) { origSwitchTab(i); if (i === 4) { if (!graphData) loadGraph(); else setTimeout(drawGraph, 50); } };
initGraphEvents();

</script></body></html>`;
}
