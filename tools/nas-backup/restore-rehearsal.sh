#!/bin/sh
# restore-rehearsal.sh — load one night's neo-brain backup into a throwaway Postgres on the NAS
# and prove it answers: every table's row count equals the manifest, vector search works,
# known rows come back. Nothing touches the live database.
#
#   sh restore-rehearsal.sh 2026-10-06            # run, write rehearsal-2026-10-06.md, tear down
#   sh restore-rehearsal.sh 2026-10-06 --keep     # leave the container up for a look (docker exec … psql)
#
# Runs on the NAS host (user Neo, docker). Uses the neo-brain-backup container for node (it has
# the backups mounted and the API env) and pgvector/pgvector:pg17 for Postgres.
set -u
DATE="${1:?usage: restore-rehearsal.sh <YYYY-MM-DD> [--keep]}"
KEEP="${2:-}"
BK_HOST="/volume1/docker/backups/neo-brain/$DATE"
BK="/backups/$DATE"                               # same dir, as the backup container sees it
APP="/app/nas-backup"                             # scripts, as the backup container sees them
C="restore-rehearsal"
PW="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 24)"
NODE="docker exec neo-brain-backup node"
PSQL="docker exec -i $C psql -q -v ON_ERROR_STOP=1 -U postgres -d restore"
REPORT="/volume1/docker/backups/neo-brain/rehearsal-$DATE.md"
T0=$(date +%s)
WORK="$BK_HOST/.rehearsal"

fail() { echo "REHEARSAL-RESULT: FAILED $DATE — $*"; [ -n "$KEEP" ] || docker rm -f "$C" >/dev/null 2>&1; exit 1; }
[ -f "$BK_HOST/manifest.json" ] || fail "no manifest in $BK_HOST"
mkdir -p "$WORK" || fail "cannot create $WORK"

echo "== postgres =="
docker rm -f "$C" >/dev/null 2>&1
docker run -d --name "$C" -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=restore --shm-size=1g pgvector/pgvector:pg17 \
  -c shared_buffers=1GB -c maintenance_work_mem=512MB -c max_wal_size=4GB -c fsync=off -c synchronous_commit=off >/dev/null || fail "docker run"
i=0; until docker exec "$C" pg_isready -U postgres -d restore >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 60 ] && fail "postgres did not come up"; sleep 1; done
echo "postgres ready"

echo "== schema =="
if [ -f "$BK_HOST/schema.openapi.json" ]; then SRC="--from $BK/schema.openapi.json"; else SRC="--live"; echo "(no schema.openapi.json in the backup — using the live column definitions)"; fi
$NODE $APP/schema-from-openapi.mjs $SRC --sql "$BK/.rehearsal/schema.sql" --tables "$BK/.rehearsal/tables.json" || fail "schema generation"
$PSQL < "$WORK/schema.sql" || fail "schema apply"
echo "schema applied"

echo "== load =="
$NODE -e "const m=require('$BK/manifest.json'); for (const t of m.tables) if (t.rows>0 && !t.error) console.log(t.table+' '+t.rows)" > "$WORK/expected.txt" || fail "manifest read"
: > "$WORK/counts.txt"
while read -r T EXPECTED; do
  [ -f "$BK_HOST/$T.ndjson.gz" ] || { echo "$T MISSING-FILE 0 $EXPECTED" >> "$WORK/counts.txt"; continue; }
  COLS="$($NODE -e "const t=require('$BK/.rehearsal/tables.json')['$T']; console.log(t.map(c=>c.name).join(','))")"
  QCOLS="$(echo "$COLS" | sed 's/,/","/g; s/^/"/; s/$/"/')"
  TS=$(date +%s)
  if $NODE $APP/ndjson-to-copy.mjs "$BK/$T.ndjson.gz" "$BK/.rehearsal/tables.json" "$T" 2>/dev/null | $PSQL -c "\\copy public.\"$T\"($QCOLS) FROM STDIN" 2>"$WORK/err-$T.txt"; then
    GOT="$(docker exec "$C" psql -tA -U postgres -d restore -c "select count(*) from public.\"$T\"")"
    [ "$GOT" = "$EXPECTED" ] && S="ok" || S="MISMATCH"
  else
    GOT="$(docker exec "$C" psql -tA -U postgres -d restore -c "select count(*) from public.\"$T\"" 2>/dev/null || echo 0)"; S="LOAD-ERROR"
  fi
  echo "$T $S $GOT $EXPECTED $(( $(date +%s) - TS ))s" >> "$WORK/counts.txt"
  echo "  $S $T $GOT/$EXPECTED"
done < "$WORK/expected.txt"

echo "== checks =="
VEC="$(docker exec "$C" psql -tA -U postgres -d restore -c "select count(*) from (select id from public.memories where embedding is not null order by embedding <=> (select embedding from public.memories where embedding is not null limit 1) limit 5) s" 2>&1 | tail -n1)"
SAMPLE="$(docker exec "$C" psql -tA -U postgres -d restore -c "select count(*) from public.memories where id in (select id from public.memories order by created_at desc limit 3) and content is not null" 2>&1 | tail -n1)"
WAMSG="$(docker exec "$C" psql -tA -U postgres -d restore -c "select count(*) from public.wa_messages where created_at > now() - interval '30 days'" 2>&1 | tail -n1)"
TOTAL_OK=$(grep -c " ok " "$WORK/counts.txt"); TOTAL=$(wc -l < "$WORK/counts.txt"); BAD=$(grep -vc " ok " "$WORK/counts.txt")
DUR=$(( $(date +%s) - T0 ))

{
  echo "# Restore rehearsal — backup $DATE"
  echo ""
  echo "Ran $(date -u +%Y-%m-%dT%H:%MZ) on the NAS into a throwaway pgvector/pg17 container. Live database untouched."
  echo ""
  echo "- Tables loaded: $TOTAL_OK of $TOTAL match the manifest row for row$( [ "$BAD" -gt 0 ] && echo "; $BAD did NOT (see below)" )"
  echo "- Vector search on memories (nearest 5 to one embedding): returned $VEC rows"
  echo "- Newest 3 memories readable with content: $SAMPLE"
  echo "- WhatsApp messages from the last 30 days present: $WAMSG"
  echo "- Duration: ${DUR}s"
  echo ""
  echo "| table | status | loaded | manifest | time |"; echo "|---|---|---|---|---|"
  sort "$WORK/counts.txt" | awk '{printf "| %s | %s | %s | %s | %s |\n",$1,$2,$3,$4,$5}'
  echo ""
  echo "Not covered by a logical export: foreign keys, indexes, RLS policies, triggers and functions (match_memories_hybrid_v2, get_credential…). Credential VALUES are not in the backup by design (Supabase Vault)."
} > "$REPORT"

if [ "$BAD" -eq 0 ] && [ "$VEC" = "5" ]; then echo "REHEARSAL-RESULT: OK $DATE tables=$TOTAL_OK/$TOTAL vector=ok duration=${DUR}s report=$REPORT"; RC=0
else echo "REHEARSAL-RESULT: FAILED $DATE tables_ok=$TOTAL_OK/$TOTAL vector=$VEC report=$REPORT"; RC=1; fi
[ -n "$KEEP" ] || docker rm -f "$C" >/dev/null 2>&1
exit $RC
