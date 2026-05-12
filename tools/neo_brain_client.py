"""
neo_brain_client.py — Python shim matching the @todak/memory JS SDK API.

Keeps Python scripts in the Todak ecosystem on the same contract as Node agents.

Env:
  NEO_BRAIN_URL
  NEO_BRAIN_SERVICE_ROLE_KEY
  GEMINI_API_KEY

Usage:
  from neo_brain_client import NeoBrain
  brain = NeoBrain(agent='plaud-pipeline')
  brain.save('Meeting with Lan about VPS app', category='work', type='event', importance=7, visibility='internal')
  hits = brain.search('what did Neo and Lan discuss')
"""
import os
import json
import uuid
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

NEO_SELF_ID = "00000000-0000-0000-0000-000000000001"
GEMINI_EMBED_MODEL_DEFAULT = "gemini-embedding-001"
GEMINI_EMBED_DIMS = 768


def _http_json(method, url, *, headers=None, body=None, timeout=20):
    headers = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers.setdefault("content-type", "application/json")
    req = Request(url, method=method, headers=headers, data=data)
    try:
        with urlopen(req, timeout=timeout) as r:
            status = r.status
            text = r.read().decode("utf-8")
    except HTTPError as e:
        status = e.code
        text = e.read().decode("utf-8")
    if not text:
        return status, None
    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


def embed_text(text, *, api_key=None, model=None, dims=GEMINI_EMBED_DIMS, timeout=15):
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    model = model or os.environ.get("GEMINI_EMBED_MODEL", GEMINI_EMBED_MODEL_DEFAULT)
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    if not text or not text.strip():
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={api_key}"
    body = {
        "content": {"parts": [{"text": text[:2048]}]},
        "outputDimensionality": dims,
    }
    status, data = _http_json("POST", url, body=body, timeout=timeout)
    if status >= 400:
        raise RuntimeError(f"gemini embed {status}: {json.dumps(data)[:200]}")
    return (data or {}).get("embedding", {}).get("values")


def _pgvector(values):
    if not values:
        return None
    return "[" + ",".join(str(v) for v in values) + "]"


class NeoBrain:
    def __init__(
        self,
        *,
        url=None,
        service_role_key=None,
        anon_key=None,
        agent=None,
        gemini_api_key=None,
    ):
        self.url = (url or os.environ.get("NEO_BRAIN_URL", "")).rstrip("/")
        self.key = (
            service_role_key
            or os.environ.get("NEO_BRAIN_SERVICE_ROLE_KEY")
            or anon_key
            or os.environ.get("NEO_BRAIN_ANON_KEY")
        )
        self.agent = agent
        self.gemini_api_key = gemini_api_key or os.environ.get("GEMINI_API_KEY")
        if not self.url:
            raise RuntimeError("NeoBrain: url required")
        if not self.key:
            raise RuntimeError("NeoBrain: service_role_key or anon_key required")
        if not self.agent:
            raise RuntimeError("NeoBrain: agent required")

    def _headers(self):
        return {
            "apikey": self.key,
            "authorization": f"Bearer {self.key}",
        }

    def _rpc(self, name, params):
        status, data = _http_json(
            "POST",
            f"{self.url}/rest/v1/rpc/{name}",
            headers=self._headers(),
            body=params,
        )
        if status >= 400:
            raise RuntimeError(f"rpc {name} {status}: {json.dumps(data)[:200]}")
        return data

    def _insert(self, table, row, *, select=None):
        url = f"{self.url}/rest/v1/{table}"
        headers = self._headers()
        headers["content-type"] = "application/json"
        headers["prefer"] = "return=representation"
        if select:
            url += f"?select={select}"
        status, data = _http_json("POST", url, headers=headers, body=row)
        if status >= 400:
            raise RuntimeError(f"insert {table} {status}: {json.dumps(data)[:200]}")
        return (data or [None])[0]

    # ---------- MEMORIES ----------

    def search(
        self,
        query,
        *,
        k=5,
        visibility=("public", "internal", "private"),
        subject_id=None,
        source=None,
        min_similarity=0.35,
    ):
        emb = embed_text(query, api_key=self.gemini_api_key)
        if emb is None:
            return []
        # match_memories_curated excludes WA conversation sources at the RPC
        # level; the `source` parameter is preserved on this method for
        # backward compatibility but is now ignored (curated already filters).
        # If callers need WA-specific lookups, use match_wa_messages instead.
        # Spec: broneotodak/naca/docs/spec/memory-table-separation-v1.md
        if source:
            import warnings
            warnings.warn(
                "search(source=...) is deprecated; match_memories_curated "
                "filters WA sources automatically. Use a wa_messages query "
                "path for conversation history.",
                DeprecationWarning,
                stacklevel=2,
            )
        return self._rpc(
            "match_memories_curated",
            {
                "query_embedding": emb,
                "match_count": k,
                "min_similarity": min_similarity,
                "visibility_filter": list(visibility),
                "p_subject_id": subject_id,
            },
        ) or []

    def save(
        self,
        content,
        *,
        category,
        type,  # noqa: A002
        importance=6,
        visibility="private",
        subject_id=NEO_SELF_ID,
        related_people=None,
        source=None,
        source_ref=None,
        media_id=None,
        metadata=None,
    ):
        if not category or not type:
            raise RuntimeError("save: category and type required")
        emb = embed_text(content, api_key=self.gemini_api_key)
        row = self._insert(
            "memories",
            {
                "content": content,
                "embedding": _pgvector(emb),
                "category": category,
                "memory_type": type,
                "importance": importance,
                "visibility": visibility,
                "subject_id": subject_id,
                "related_people": related_people or [],
                "source": source or self.agent,
                "source_ref": source_ref or {},
                "media_id": media_id,
                "metadata": metadata or {},
            },
            select="id,created_at",
        )
        if row and row.get("id"):
            try:
                self._insert(
                    "memory_writes_log",
                    {
                        "memory_id": row["id"],
                        "action": "insert",
                        "written_by": self.agent,
                        "payload_preview": content[:180],
                    },
                )
            except Exception:
                pass
        return row

    # ---------- FACTS / PERSONALITY ----------

    def get_facts(self, *, subject_id=NEO_SELF_ID, category=None, limit=100):
        q = {"subject_id": f"eq.{subject_id}", "limit": str(limit)}
        if category:
            q["category"] = f"eq.{category}"
        url = f"{self.url}/rest/v1/facts?{urlencode(q)}"
        status, data = _http_json("GET", url, headers=self._headers())
        if status >= 400:
            raise RuntimeError(f"get_facts {status}")
        return data or []

    def get_personality(self, subject_id=NEO_SELF_ID):
        url = f"{self.url}/rest/v1/personality?subject_id=eq.{subject_id}&order=value.desc"
        status, data = _http_json("GET", url, headers=self._headers())
        if status >= 400:
            raise RuntimeError(f"get_personality {status}")
        return data or []

    # ---------- PEOPLE ----------

    def resolve_person(self, type, value):  # noqa: A002
        return self._rpc("resolve_person", {"p_type": type, "p_value": value})

    # ---------- CREDENTIALS (Vault-encrypted) ----------

    def get_credential(self, service, *, type=None, environment="production", owner_id=NEO_SELF_ID):  # noqa: A002
        if not service:
            raise RuntimeError("get_credential: service required")
        rows = self._rpc(
            "get_credential",
            {
                "p_owner_id": owner_id,
                "p_service": service,
                "p_credential_type": type,
                "p_environment": environment,
            },
        )
        return (rows or [None])[0]

    def get_credential_value(self, service, **opts):
        row = self.get_credential(service, **opts)
        if not row:
            raise RuntimeError(f"credential not found: {service}")
        return row.get("credential_value")

    def list_credentials(self, *, owner_id=None, service=None, active_only=True):
        return self._rpc(
            "list_credentials",
            {"p_owner_id": owner_id, "p_service": service, "p_active_only": active_only},
        ) or []

    def upsert_credential(
        self,
        *,
        service,
        type,  # noqa: A002
        value,
        description=None,
        environment="production",
        expires_at=None,
        owner_id=NEO_SELF_ID,
        metadata=None,
    ):
        if not service or not type or not value:
            raise RuntimeError("upsert_credential: service, type, value required")
        return self._rpc(
            "upsert_credential",
            {
                "p_owner_id": owner_id,
                "p_service": service,
                "p_credential_type": type,
                "p_value": value,
                "p_description": description,
                "p_environment": environment,
                "p_expires_at": expires_at,
                "p_metadata": metadata or {},
            },
        )
