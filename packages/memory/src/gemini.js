const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_DIMS = 768;
const MAX_CHARS = 2048;

export async function embedText(text, {
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_EMBED_MODEL || DEFAULT_MODEL,
  dims = DEFAULT_DIMS,
  timeoutMs = 15000,
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  if (!text?.trim()) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  const body = {
    content: { parts: [{ text: text.slice(0, MAX_CHARS) }] },
    outputDimensionality: dims,
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`gemini embed ${r.status}: ${errText.slice(0, 200)}`);
    }
    const data = await r.json();
    return data?.embedding?.values || null;
  } finally {
    clearTimeout(t);
  }
}

export function toPgVectorString(values) {
  if (!values || !Array.isArray(values)) return null;
  return `[${values.join(",")}]`;
}
