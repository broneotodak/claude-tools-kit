// Opt-in writer maintenance. Shared search defaults belong to the reader PR.
export const TRANSCRIPT_SOURCE = 'codex-transcript';
export const TRANSCRIPT_CATEGORY = 'reference_codex_transcript';
export const TRANSCRIPT_DAYS = 14;
export const SESSION_CHUNK_LIMIT = 32;
export const MESSAGE_CHUNK_LIMIT = 4;
const fields = 'id,source,category,visibility,archived,created_at,source_ref,metadata';
const day = 86400000;

function owner(brain) {
  if (!/^codex-[a-zA-Z0-9_-]+$/.test(brain.agent || '') || brain.agent === TRANSCRIPT_SOURCE) {
    throw new Error('continuity requires a Codex writer identity');
  }
  return brain.agent;
}
function owned(row, agent) {
  return row && row.category === TRANSCRIPT_CATEGORY && row.visibility === 'private'
    && row.metadata?.tool === 'codex-memory' && row.metadata?.kind === 'conversation'
    && /^[a-zA-Z0-9_-]{1,128}$/.test(row.source_ref?.session_id || '')
    && (row.source === agent || (row.source === TRANSCRIPT_SOURCE && row.metadata?.writer_agent === agent));
}
export function transcriptTime(row) {
  const created = Date.parse(row.created_at), occurred = Date.parse(row.source_ref?.occurred_at);
  return Number.isFinite(occurred) ? Math.min(occurred, Number.isFinite(created) ? created : occurred) : created;
}
async function read(brain, id) {
  const { data, error } = await brain.sb.from('memories').select(fields).eq('id', id).maybeSingle();
  if (error) throw new Error('continuity row read unavailable');
  return data;
}
async function audit(brain, id, action, marker) {
  const lookup = () => brain.sb.from('memory_writes_log').select('memory_id')
    .eq('memory_id', id).eq('written_by', brain.agent).eq('action', action).eq('payload_preview', marker).limit(1);
  let result = await lookup();
  if (result.error) throw new Error('continuity audit read unavailable');
  if (!result.data?.length) {
    const { error } = await brain.sb.from('memory_writes_log').insert({
      memory_id: id, written_by: brain.agent, action, payload_preview: marker,
    });
    if (error) throw new Error('continuity audit write unavailable');
    result = await lookup();
    if (result.error || !result.data?.length) throw new Error('continuity audit verification failed');
  }
}

// Metadata only: never fetch transcript bodies or vectors for bulk planning.
export async function listOwnedTranscripts(brain) {
  const agent = owner(brain), rows = [];
  for (const source of [agent, TRANSCRIPT_SOURCE]) {
    let complete = false;
    for (let offset = 0; offset < 100000; offset += 200) {
      let query = brain.sb.from('memories').select(fields).eq('category', TRANSCRIPT_CATEGORY).eq('source', source);
      if (source === TRANSCRIPT_SOURCE) query = query.eq('metadata->>writer_agent', agent);
      const { data, error } = await query.order('id').range(offset, offset + 199);
      if (error) throw new Error('transcript inventory unavailable');
      if ((data || []).some(row => !owned(row, agent))) throw new Error('transcript inventory has unexpected provenance; review required');
      rows.push(...(data || []));
      if ((data || []).length < 200) { complete = true; break; }
    }
    if (!complete) throw new Error('transcript inventory exceeds bounded scan; review required');
  }
  return rows;
}

export function planTranscriptMaintenance(rows, now = Date.now()) {
  const active = rows.filter(row => !row.archived), archive = new Set(), sessions = new Map();
  for (const row of active) {
    if (!Number.isFinite(transcriptTime(row))) throw new Error('transcript has invalid retention timestamp');
    if (transcriptTime(row) < now - TRANSCRIPT_DAYS * day) archive.add(row.id);
    else {
      const sid = row.source_ref.session_id;
      if (!sessions.has(sid)) sessions.set(sid, []);
      sessions.get(sid).push(row);
    }
  }
  for (const group of sessions.values()) {
    group.sort((a, b) => transcriptTime(b) - transcriptTime(a) || b.id.localeCompare(a.id));
    for (const row of group.slice(SESSION_CHUNK_LIMIT)) archive.add(row.id);
  }
  return { total: rows.length, relabel: rows.filter(row => row.source !== TRANSCRIPT_SOURCE).map(row => row.id),
    archive: [...archive], activeAfter: active.length - archive.size };
}

// Deliberately narrow: cannot relabel handoffs, another writer, or arbitrary rows.
// Source and metadata only; content, vectors, timestamps and IDs stay intact.
export async function relabelTranscript(brain, id) {
  const agent = owner(brain), before = await read(brain, id);
  if (!owned(before, agent)) throw new Error('refusing to relabel a non-owned transcript');
  const metadata = { ...before.metadata, writer_agent: agent, retention_days: TRANSCRIPT_DAYS };
  if (before.source !== TRANSCRIPT_SOURCE) {
    const { error } = await brain.sb.from('memories').update({ source: TRANSCRIPT_SOURCE, metadata })
      .eq('id', id).eq('source', agent).eq('category', TRANSCRIPT_CATEGORY).eq('visibility', 'private');
    if (error) throw new Error('transcript relabel unavailable');
  }
  const after = await read(brain, id);
  if (!owned(after, agent) || after.source !== TRANSCRIPT_SOURCE || after.metadata.retention_days !== TRANSCRIPT_DAYS) {
    throw new Error('transcript relabel verification failed');
  }
  await audit(brain, id, 'update', 'codex transcript source separation v2');
  return { id, verified: true, changed: before.source !== after.source };
}

export async function archiveTranscript(brain, id) {
  const before = await read(brain, id);
  if (!owned(before, owner(brain)) || before.source !== TRANSCRIPT_SOURCE) throw new Error('relabel transcript before archival');
  if (!before.archived) await brain.archive(id);
  const after = await read(brain, id);
  if (!owned(after, brain.agent) || after.archived !== true) throw new Error('transcript archive verification failed');
  await audit(brain, id, 'archive', 'codex transcript retention v2');
  return { id, verified: true, changed: !before.archived };
}

// Curated handoffs are read directly, independently of temporary source exclusions
// in general semantic search. The strongest available scope wins.
export async function listScopedHandoffs(brain, { repo, worktree, session } = {}) {
  if (!repo) return [];
  const scopes = [
    ...(worktree ? [['metadata->>worktree', worktree]] : []),
    ...(session ? [['source_ref->>session_id', session]] : []),
    [null, null],
  ];
  for (const [key, value] of scopes) {
    let query = brain.sb.from('memories').select('id,content,source,category,created_at,source_ref,metadata')
      .eq('category', 'session_handoff').eq('metadata->>repo', repo).eq('archived', false);
    if (key) query = query.eq(key, value);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(64);
    if (error) throw new Error('project handoff read unavailable');
    if (data?.length) return data;
  }
  return [];
}
