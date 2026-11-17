# Rebuilds the live twin's example-reply pool (EdgeXpert 1: ~/Projects/bandung-train/data/anchors-clean.jsonl) from Neo's short replies in 1:1 chats he still keeps.
# Excludes: every never-keep chat (nio_excluded_chats), its paired id, any chat with the same name, fleet numbers; groups; replies with numbers, links, @, passwords, accounts.
# Run on the Mac (owner SQL via ~/bin/neo-brain-sql.mjs); writes straight to edge as anchors-clean.jsonl.new. Then: mv it to anchors-clean.jsonl and
# `sudo systemctl restart neo-twin-server` (the gateway reads the pool only at startup). Prints counts only; never prints or stores message text on the Mac.
# Built 17 Nov 2026 (Neo: "do the pool swap").
import json, subprocess, re, random, sys
BASE = """
with ex0 as (select split_part(chat_jid,'@',1) u from nio_excluded_chats),
ex_pairs as (
  select split_part(d.chat_jid,'@',1) u from nio_chat_directory d where d.pn in (select u from ex0)
  union select d.pn from nio_chat_directory d where split_part(d.chat_jid,'@',1) in (select u from ex0) and d.pn is not null),
ex_names as (
  select split_part(l.chat_jid,'@',1) u from nio_chat_list_v2(null, 800, false) l
  where l.name is not null and l.name in (select name from nio_chat_list_v2(null, 800, true) where name is not null)),
deny as (select unnest(array['60126714634','217566215704729','6281111150379','230279553749146']) u),
bad as (select u from ex0 union select u from ex_pairs union select u from ex_names union select u from deny),
cand as (
  select distinct on (m.content) m.content
  from wa_messages m
  where m.source = 'wa-primary' and m.is_from_self and not m.is_group
    and m.chat_jid not like '%@g.us' and m.chat_jid not like '%@broadcast' and m.chat_jid not like '%@newsletter'
    and length(m.content) between 8 and 140
    and m.content !~* '(\\d{7,}|@|https?://|www\\.)' and m.content not like '%REDACTED%'
    and split_part(m.chat_jid,'@',1) not in (select u from bad)
  order by m.content)
"""
def q(sql):
    out = subprocess.run(["node","/Users/broneotodak/bin/neo-brain-sql.mjs",sql],capture_output=True,text=True,timeout=180).stdout
    return json.loads(out)
stats = q(BASE + "select (select count(*) from cand) cands, (select count(*) from bad) excluded_ids, (select count(*) from ex0) listed_chats")[0]
rows, off, page = [], 0, 500
while True:
    got = q(BASE + f"select content from cand order by content limit {page} offset {off}")
    rows += [r["content"] for r in got]
    if len(got) < page: break
    off += page
risky = re.compile(r"(?i)pass(word|wd)?|kata laluan|token|api[_ -]?key|\botp\b|\bpin\b|kod (sah|keselamatan)|akaun|account|bank|ic no|no\.? ?kad|\b\d{4,}\b")
keep = sorted({" ".join(c.split()) for c in rows if not risky.search(c)})
random.seed(); random.shuffle(keep)
keep = keep[:4000]
payload = "".join(json.dumps({"messages":[{"role":"assistant","content":c}]}, ensure_ascii=False) + "\n" for c in keep)
r = subprocess.run(["ssh","-o","BatchMode=yes","edge","umask 077; cat > /home/neo/Projects/bandung-train/data/anchors-clean.jsonl.new; wc -l < /home/neo/Projects/bandung-train/data/anchors-clean.jsonl.new"],input=payload,capture_output=True,text=True,timeout=120)
print(f"never-kept chats on the list: {stats['listed_chats']} | ids excluded (incl. paired ids, same-name chats, fleet numbers): {stats['excluded_ids']}")
print(f"candidate replies from kept 1:1 chats: {stats['cands']} | after the extra filter (passwords, numbers, accounts): {len(keep)+max(0,len({' '.join(c.split()) for c in rows if not risky.search(c)})-len(keep))}")
print(f"written to EdgeXpert 1 as anchors-clean.jsonl.new: {r.stdout.strip()} lines | ssh status {r.returncode}")
