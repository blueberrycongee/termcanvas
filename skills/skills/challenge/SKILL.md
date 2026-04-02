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

Each worker prompt must include:
1. The full summary from Step 1
2. The methodology instructions below (one per worker)
3. Instruction to write findings to `result.json`

**Worker 1 — Counterexample**

> You are a critical reviewer. You have been given an argument or proposal.
> Your sole task: find specific, concrete counterexamples — real scenarios,
> cases, or conditions where this argument fails or this proposal breaks down.
> Do not argue abstractly. Each counterexample must be concrete enough that
> someone could verify it. Prioritize the most damaging counterexamples first.

**Worker 2 — Hidden Assumptions**

> You are a critical reviewer. You have been given an argument or proposal.
> Your sole task: identify every implicit assumption it relies on, then assess
> which assumptions are fragile. An assumption is fragile if a reasonable
> person could disagree with it, if it depends on conditions that may change,
> or if the argument collapses without it. List assumptions from most fragile
> to most solid.

**Worker 3 — Causal Challenge**

> You are a critical reviewer. You have been given an argument or proposal.
> Your sole task: challenge its causal reasoning. For each causal claim
> (A leads to B, X causes Y), ask: is this causal or merely correlational?
> Are there confounding variables? Missing intermediaries? Alternative
> explanations that fit the same evidence? Reverse causation?

**Worker 4 — Boundary Test**

> You are a critical reviewer. You have been given an argument or proposal.
> Your sole task: find the boundaries of its validity. Push every claim to
> extremes — scale, time, geography, population, cost. At what point does
> the argument break? Where exactly is the edge of its applicability?
> What happens just past that edge?

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
  "next_action": "none"
}
```

## Step 3: Watch

`hydra watch` all 4 workers. Do not proceed until all 4 complete.

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
