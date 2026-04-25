# 🛡️ MONITORING ENFORCEMENT — Validate Every Signal Before Trusting It

**Origin: Phase 2 supervisor-agent dry-run, 2026-04-25.** Neo and I designed alert
rules around `agent_heartbeats.meta.wa_status`. After 49 dry-run "fires" overnight,
Neo correctly questioned whether Siti was actually broken — she wasn't. The field
reported raw `baileys` event types ("disconnected", "open", "connecting"), not real
health. Worse, twin-ingest and forex push monitors had been showing DOWN for days
because we built the monitors but never wired the agents to push. **75% of the red
lights on the dashboard were false alarms.**

This document exists so future agents (Claude Code, dev-agent, supervisor, planner,
etc.) don't repeat that mistake.

---

## 🛑 THE LAW

**A monitor that exists is not the same as a monitor that works.**

Before declaring a monitor / alert / heartbeat field as a trustworthy signal:

1. ✅ Read the source code that *produces* the signal
2. ✅ Verify the signal correlates with real user-facing function (synthetic test)
3. ✅ Confirm both edges trigger correctly (works→broken AND broken→works)
4. ✅ Run it for ≥1 full day in a non-acting / dry-run mode and audit fires

**NEVER:**
- ❌ Set up an alert/rule on a field without reading its producer
- ❌ Declare a monitoring milestone "shipped" because the dashboard exists
- ❌ Trust a heartbeat field because its name sounds right (`wa_status`, `is_healthy`, `connected`)
- ❌ Build push monitors without immediately wiring the agent that pushes (or delete the monitor)
- ❌ Aggregate alerts from unvalidated signals — false-positive rate compounds

---

## 📋 PRE-FLIGHT CHECKLIST (use before adding/configuring any monitor)

Every time an agent or CC session is asked to "add a monitor", "watch X", "alert on Y":

```
[ ] What is the EXACT signal we're consuming?
    - File path / line that writes it (cite it in commit message)
    - Possible values it can take
    - When does each value get emitted?

[ ] Synthetic end-to-end test:
    - Force the bad state → does the signal flip?
    - Force the good state → does it flip back?
    - Both transitions verified within < 2 cycles?

[ ] If push monitor: is the agent already configured to push?
    - If NO: either wire it now, or do not create the monitor
    - "We'll wire it later" = dead monitor that pollutes the dashboard

[ ] If health endpoint: does the endpoint use the SAME state the user
    experiences? (e.g. Siti's /api/status checks `state.status === "connected"`,
    which is the same gate as her send path — that's a true signal.
    But heartbeat.meta.wa_status is the raw field, not gated — false signal.)

[ ] Dry-run for ≥ 24h before any auto-action:
    - Log every "would-fire" decision to a queryable table
    - Compute fire/hour rates per (agent, symptom) pair
    - Cross-reference fires against KNOWN-GOOD periods (did the system
      actually fail when this fired? Or was it noise?)
```

---

## 🧪 ANTI-PATTERN EXAMPLES (real, from this project)

### Bad: heartbeat field interpreted at face value
```js
// ❌ Don't do this:
if (hb.meta.wa_status === 'disconnected') alertNeo();

// What's actually happening: wa_status takes whatever string baileys's
// connection.update event emits — including 'connecting', 'open',
// transient values. It is a debugging field, not a binary health flag.
// Siti could be sending messages successfully while reporting 'disconnected'.
```

### Good: signal gated on the same logic the user-facing path uses
```js
// ✅ Use the same condition the send path uses:
const ready = await fetch(`${SITI}/api/status`, { headers: PIN }).then(r => r.json());
if (!ready.ok) alertNeo();
// /api/status returns ok:true ONLY when state.status==="connected", which is
// also the gate her send code uses. False-positive impossible by construction.
```

### Bad: push monitor without a pusher
```yaml
# ❌ Created in Uptime Kuma:
- name: twin-ingest · heartbeat
  type: push
  token: <generated>
  interval: 120s

# But twin-ingest's source was never modified to POST that URL every 120s.
# Result: monitor shows DOWN forever. Dashboard noise. Loss of trust.
```

### Good: push monitor wired up the same PR
```js
// ✅ In the agent that owns the push:
setInterval(async () => {
  await fetch(KUMA_PUSH_URL); // wired in same change as monitor creation
}, 120 * 1000);
```

---

## 🧹 DECOMMISSION RULE

If a monitor is showing a DOWN/red state and you discover the cause is **the monitor
itself, not the underlying system**, you MUST do ONE of:

1. **Fix the monitor in the same session** (wire the push, replace the field, etc.)
2. **Disable / delete the monitor** so it stops adding noise

You may NOT leave a known-broken monitor live "for later". Stale red lights teach
the operator to ignore the dashboard, which makes every future real alert worthless.

---

## 🔁 WHEN INHERITED CODE TRIGGERS MONITORS

If you (any future agent) are asked to "investigate why X is down" and the alert
came from an unvalidated signal, your first move is **NOT** to "fix" X. It is:

1. Verify X is actually broken from a USER perspective (synthetic test, recent activity log, end-user smoke test)
2. If X is fine but the alert fires → **the monitor is broken, not X**
3. Fix the monitor (or escalate to Neo). DO NOT silence it without root-cause.

---

## 📚 Related

- See `CTK_ENFORCEMENT.md` for general CTK rules.
- See `~/.claude/projects/-Users-broneotodak/memory/feedback_monitor_validation.md` for the originating incident.
- Plan: `~/.claude/plans/spicy-roaming-lampson.md` (Agentic Ecosystem v3, Phase 2).

---
*This file complements CTK_ENFORCEMENT.md. Apply to every monitoring/alerting
change in the Neo Todak ecosystem.*
