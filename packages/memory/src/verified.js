import { createHash } from 'node:crypto';
import { embedText, toPgVectorString } from './gemini.js';

// A stable primary key makes retries safe even if the INSERT succeeded and its
// HTTP response was lost. No schema migration or change to legacy save() callers.
export function verifiedMemoryId(agent, key) {
  if (!agent || !key) throw new Error('verified save requires agent and key');
  const h = createHash('sha256').update(JSON.stringify(['ctk-memory-v1', agent, key])).digest('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32);
}

function validVector(value) {
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(v) && v.length === 768 && v.every(Number.isFinite) && v.some(x => x !== 0);
  } catch { return false; }
}

// Public SDK helper. Errors deliberately contain no content, URLs or credentials.
export async function saveVerifiedMemory(brain, content, opts = {}) {
  const { key, category, type = 'event', importance = 4, sourceRef = {}, metadata = {}, source = brain.agent } = opts;
  if (!content?.trim() || !category) throw new Error('invalid verified memory');
  if (typeof source !== 'string' || !source.trim()) throw new Error('invalid memory source');
  const id = verifiedMemoryId(brain.agent, key);
  const read = async () => {
    const { data, error } = await brain.sb.from('memories')
      .select('id,content,embedding,visibility,source,created_at').eq('id', id).maybeSingle();
    if (error) throw new Error('memory readback unavailable');
    return data;
  };
  let row = await read();
  if (!row) {
    const vector = await embedText(content, { apiKey: brain.geminiApiKey, timeoutMs: 8000 });
    if (!validVector(vector)) throw new Error('memory embedding unavailable');
    const { error } = await brain.sb.from('memories').insert({
      id, content, embedding: toPgVectorString(vector), category, memory_type: type,
      importance, visibility: 'private', subject_id: '00000000-0000-0000-0000-000000000001',
      source, source_ref: sourceRef, metadata,
    });
    if (error && error.code !== '23505') throw new Error('memory insert unavailable');
    row = await read();
  }
  if (!row || row.content !== content || row.source !== source || row.visibility !== 'private' || !validVector(row.embedding)) {
    throw new Error('memory readback failed verification');
  }
  // Repair a missing audit entry after an interrupted write. Memory itself is
  // exactly-once by primary key; concurrent writers can add redundant audit rows.
  const { data: logs, error: readError } = await brain.sb.from('memory_writes_log')
    .select('memory_id').eq('memory_id', id).eq('action', 'insert').eq('written_by', brain.agent).limit(1);
  if (readError) throw new Error('memory audit readback unavailable');
  if (!logs?.length) {
    const { error } = await brain.sb.from('memory_writes_log').insert({
      memory_id: id, action: 'insert', written_by: brain.agent, payload_preview: content.slice(0, 180),
    });
    if (error) throw new Error('memory audit write unavailable');
    const { data, error: checkError } = await brain.sb.from('memory_writes_log')
      .select('memory_id').eq('memory_id', id).eq('action', 'insert').eq('written_by', brain.agent).limit(1);
    if (checkError || !data?.length) throw new Error('memory audit failed verification');
  }
  return { id, created_at: row.created_at, embedded: true, verified: true };
}
