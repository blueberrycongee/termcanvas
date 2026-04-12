---
name: challenge
description: >-
  Adversarial review skill. Use when the user wants to stress-test an idea,
  argument, proposal, or opinion from multiple independent angles. Spawns
  parallel Hydra workers with orthogonal analytical methodologies.
---

# Challenge

Multi-angle adversarial review via isolated Hydra workers. Each worker attacks
the same input using a different analytical method, with no visibility into
the others' reasoning.

## When to use

- User says "challenge this", "stress-test this", "poke holes in this",
  "what am I missing", "argue against this", or similar
- User has been discussing a topic and wants independent critical review
- Any argument, proposal, opinion, decision, or design that needs pressure-testing

## Step 1: Extract

Summarize the argument/proposal/opinion from the current conversation into a
neutral, complete brief. Include:

- The core claim or proposal
- Key supporting reasons the user or you have discussed
- Any constraints or context that are relevant

Do NOT editorialize or signal which parts you think are weak. The summary must
be fair — biased summaries defeat the purpose.

## Step 2: Spawn 4 workers

Use `hydra spawn` to launch 4 parallel workers. Each worker receives the
same summary but a different methodology prompt. Inherit the current
terminal's provider via `--worker-type`.

### Worker prompts

Each worker prompt must include, in this order:
1. The mandatory preamble below (verbatim)
2. The full summary from Step 1
3. The methodology instructions below (one per worker)
4. Instruction to write findings to `result.json` atomically

### Mandatory preamble (prepend to every worker prompt verbatim)

> **SCOPE RULE — strictly enforced.**
> Your analysis MUST extend beyond the immediate input. The input is your
> starting point, not your boundary. You are required to:
>
> 1. **Follow every chain.** When you find something, do not note it and
>    move on. Ask "what does this lead to?" and trace it at least 2-3
>    links further. Each link must be a concrete step, not a vague worry.
> 2. **Search outward.** For every finding, actively look for evidence
>    from outside the input's immediate context — other fields, other
>    systems, historical precedents, known failure cases, research, prior
>    art. If you cannot name a specific external reference, you have not
>    searched wide enough.
> 3. **Refuse shallow answers.** If a finding can be stated in one
>    sentence with no chain and no external reference, it is not finished.
>    Deepen it or discard it.
>
> A review that stays inside the input's own frame is a failure. You will
> be evaluated on depth of chains and breadth of external evidence.

**Worker 1 — Counterexample**

> Find concrete cases where this fails, backfires, or produces the
> opposite of what is intended. Each case must be specific enough to
> verify or reproduce — no abstract objections. Prioritize the most
> damaging cases first.

**Worker 2 — Hidden Assumptions**

> Surface everything this takes for granted — every unstated dependency,
> every "this just works" that is not actually guaranteed. Assumptions
> form chains; each one rests on deeper ones. Trace each chain until
> you hit bedrock. An assumption is fragile if reasonable people could
> disagree with it, if it depends on conditions that may change, or if
> the whole thing collapses without it. Rank from most fragile to most
> solid.

**Worker 3 — Mechanism & Second-Order Effects**

> Challenge the mechanism — the chain of steps by which this is supposed
> to achieve its goal. Map the full chain from action to intended outcome.
> For each link: is it proven or assumed? Could the same input produce a
> different output? Are there missing steps? Then keep going past the
> intended outcome — what second and third-order effects emerge? What
> feedback loops are created? What does this look like after the system
> evolves?

**Worker 4 — Boundary & Context Shift**

> Find where this stops being valid. Push along every dimension that
> matters until something breaks. Do not just find the breaking point —
> follow the chain past it: graceful degradation or catastrophic failure?
> When one boundary breaks, what else breaks with it? Then shift context
> entirely: would this still hold if the surrounding conditions, the
> actors, or the constraints were fundamentally different?

### Result contract

Each worker writes `result.json`:

```json
{
  "success": true,
  "summary": "<one-paragraph synthesis of the most critical findings>",
  "findings": [
    {
      "point": "<the specific challenge>",
      "severity": "critical | significant | minor",
      "reasoning": "<why this matters>"
    }
  ],
  "outputs": [],
  "evidence": [],
  "next_action": { "type": "complete", "reason": "Challenge review complete" }
}
```

Write to `result.json.tmp` first, then atomically rename it to `result.json`
only after the JSON is complete.

## Step 3: Watch

For each spawned worker, run `hydra watch --agent <agentId>`. This polls
the worker's assignment run result until it reaches a terminal state (completed,
failed, or terminal dead).

Run all 4 watches in parallel (background bash commands or concurrent
tool calls). Do not proceed until all 4 complete.

## Step 4: Synthesize

Collect all 4 result files. Present to the user:

1. **Critical challenges first** — anything rated "critical" from any worker,
   grouped by theme rather than by methodology
2. **Significant challenges** — grouped the same way
3. **Minor observations** — briefly listed

Do NOT defend the original argument while presenting challenges. Present them
neutrally. Let the user decide what to address.

## Step 5: Converge

After presenting, help the user:
- Decide which challenges are real threats vs acceptable risks
- Strengthen the original argument/proposal where needed
- Identify any challenges that change the conclusion entirely

This step is collaborative — you are no longer adversarial.
