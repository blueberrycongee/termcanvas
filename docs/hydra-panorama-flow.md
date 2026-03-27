# Hydra Multi-Agent System — Panoramic Flowchart

## 1. Mode Selection & Entry Points

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold
    classDef terminal fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff,font-style:italic
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold

    USER([User: task request]):::user
    USER --> BRAIN

    BRAIN[Main Brain:\nassess complexity\n+ choose mode]:::brain
    BRAIN --> MODE

    MODE{Mode\nselection}:::decision

    MODE -- "Simple / local / fast" --> DIRECT
    MODE -- "Need isolation\n+ evidence" --> SPAWN_OR_SINGLE
    MODE -- "Ambiguous / risky\n/ PRD-driven" --> WORKFLOW
    MODE -- "Need user approval\non plan" --> WORKFLOW_APPROVE

    %% ── Mode 0: Direct ──
    DIRECT[Do it directly\nin current agent]:::brain
    DIRECT --> DONE_DIRECT([Done]):::user

    %% ── Mode 1: Spawn / Single-Step ──
    SPAWN_OR_SINGLE{Split\nknown?}:::decision
    SPAWN_OR_SINGLE -- "Yes, one worker" --> SPAWN
    SPAWN_OR_SINGLE -- "Want workflow\ncontrol" --> SINGLE

    SPAWN{{hydra spawn\n--task ... --repo .}}:::hydra
    SPAWN --> WORKER_SPAWN

    SINGLE{{hydra run\n--template single-step}}:::hydra
    SINGLE --> WORKER_SINGLE

    subgraph ISOLATED_WORKER ["Isolated Worker (new terminal)"]
        WORKER_SPAWN[Worker agent\n reads task, executes]:::terminal
        WORKER_SINGLE[Worker agent\nreads task, executes]:::terminal
        WORKER_SPAWN --> CONTRACT_S[Write result.json + done]:::file
        WORKER_SINGLE --> CONTRACT_SS[Write result.json + done]:::file
    end

    CONTRACT_S --> DONE_SPAWN([Collect result]):::user
    CONTRACT_SS --> DONE_SS([Collect via workflow tick]):::user

    %% ── Mode 2: Full 3-Stage Workflow ──
    WORKFLOW{{hydra run\n--task ... --repo .}}:::hydra
    WORKFLOW --> WF_ENGINE

    %% ── Mode 3: Approve-Plan Workflow ──
    WORKFLOW_APPROVE{{hydra run\n--task ... --approve-plan}}:::hydra
    WORKFLOW_APPROVE --> WF_ENGINE

    WF_ENGINE[Enter Workflow Engine\n▸ see Diagram 2]:::hydra
```

## 2. Workflow Engine — Planner → Implementer → Evaluator

```mermaid
flowchart TD
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff,font-style:italic
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef fail fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold

    START([Workflow created\nstatus: pending]):::state
    START --> DISPATCH_P

    %% ══════════════════════════════════
    %% PLANNER STAGE
    %% ══════════════════════════════════
    subgraph PLANNER_STAGE ["Stage 0 — Planner"]
        DISPATCH_P[Dispatch handoff-0\nto Planner terminal]:::hydra
        DISPATCH_P --> P_WORK

        P_WORK[Planner agent:\n• investigate codebase\n• list problems\n• define constraints\n• write implementation plan]:::agent

        P_WORK --> P_CONTRACT[Write result.json + done]:::file
    end

    P_CONTRACT --> P_COLLECT

    P_COLLECT[Collector:\nvalidate result.json\n+ done marker]:::hydra
    P_COLLECT --> P_VALID

    P_VALID{Contract\nvalid?}:::decision
    P_VALID -- "Invalid" --> P_RETRY_OR_FAIL
    P_VALID -- "Valid" --> P_APPROVE_CHECK

    P_RETRY_OR_FAIL{Retries\nleft?}:::decision
    P_RETRY_OR_FAIL -- "Yes" --> DISPATCH_P
    P_RETRY_OR_FAIL -- "No" --> FAILED

    P_APPROVE_CHECK{--approve-plan\nflag?}:::decision
    P_APPROVE_CHECK -- "No (auto)" --> DISPATCH_I
    P_APPROVE_CHECK -- "Yes" --> WAIT_APPROVAL

    %% ══════════════════════════════════
    %% PLAN APPROVAL LOOP (Mode C)
    %% ══════════════════════════════════
    subgraph APPROVAL_LOOP ["Plan Approval Loop"]
        WAIT_APPROVAL([Workflow status:\nwaiting_for_approval]):::state
        WAIT_APPROVAL --> BRAIN_UP

        BRAIN_UP[Main Brain:\nread planner result.json\ntranslate → user summary]:::brain
        BRAIN_UP --> USER_REVIEW

        USER_REVIEW([User reviews plan]):::user
        USER_REVIEW --> APPROVE_DECIDE

        APPROVE_DECIDE{User\nsatisfied?}:::decision
        APPROVE_DECIDE -- "Yes" --> APPROVE_CMD
        APPROVE_DECIDE -- "No" --> REVISE_LOOP

        REVISE_LOOP[Main Brain ↔ User dialogue\nstructure feedback]:::brain
        REVISE_LOOP --> REVISE_CMD

        REVISE_CMD{{hydra revise\n--feedback '...'}}:::hydra
        REVISE_CMD --> REVISE_WRITE

        REVISE_WRITE[Write revision.md\nto planner package\nreset planner handoff → pending]:::hydra
        REVISE_WRITE --> DISPATCH_P_REVISED

        DISPATCH_P_REVISED[Re-dispatch Planner\ncontext: prev result.json\n+ revision.md]:::hydra
        DISPATCH_P_REVISED --> P_WORK_B

        P_WORK_B[New Planner terminal:\nread prev plan + feedback\nrevise plan]:::agent
        P_WORK_B --> P_CONTRACT_B[Write revised result.json + done]:::file
        P_CONTRACT_B --> BRAIN_UP

        APPROVE_CMD{{hydra approve\n--workflow id}}:::hydra
    end

    APPROVE_CMD --> DISPATCH_I

    %% ══════════════════════════════════
    %% IMPLEMENTER STAGE
    %% ══════════════════════════════════
    subgraph IMPLEMENTER_STAGE ["Stage 1 — Implementer"]
        DISPATCH_I[Dispatch handoff-1\nto Implementer terminal]:::hydra
        DISPATCH_I --> I_WORK

        I_WORK[Implementer agent:\n• read planner's plan\n• implement changes\n• run tests\n• leave evidence]:::agent

        I_WORK --> I_CONTRACT[Write result.json + done]:::file
    end

    I_CONTRACT --> I_COLLECT

    I_COLLECT[Collector:\nvalidate result.json\n+ done marker]:::hydra
    I_COLLECT --> I_VALID

    I_VALID{Contract\nvalid?}:::decision
    I_VALID -- "Invalid" --> I_RETRY_OR_FAIL
    I_VALID -- "Valid" --> DISPATCH_E

    I_RETRY_OR_FAIL{Retries\nleft?}:::decision
    I_RETRY_OR_FAIL -- "Yes" --> DISPATCH_I
    I_RETRY_OR_FAIL -- "No" --> FAILED

    %% ══════════════════════════════════
    %% EVALUATOR STAGE
    %% ══════════════════════════════════
    subgraph EVALUATOR_STAGE ["Stage 2 — Evaluator"]
        DISPATCH_E[Dispatch handoff-2\nto Evaluator terminal]:::hydra
        DISPATCH_E --> E_WORK

        E_WORK[Evaluator agent:\n• read plan + implementation\n• run test suite + build\n• verify constraints\n• check for regressions\n• flag anti-patterns]:::agent

        E_WORK --> E_CONTRACT[Write result.json + done]:::file
    end

    E_CONTRACT --> E_COLLECT

    E_COLLECT[Collector:\nvalidate result.json\n+ done marker]:::hydra
    E_COLLECT --> E_VALID

    E_VALID{Contract\nvalid?}:::decision
    E_VALID -- "Invalid" --> E_RETRY_OR_FAIL
    E_VALID -- "Valid" --> E_DECIDE

    E_RETRY_OR_FAIL{Retries\nleft?}:::decision
    E_RETRY_OR_FAIL -- "Yes" --> DISPATCH_E
    E_RETRY_OR_FAIL -- "No" --> FAILED

    %% ══════════════════════════════════
    %% EVALUATOR DECISION (Loop or Complete)
    %% ══════════════════════════════════
    E_DECIDE{Evaluator\nresult.success?}:::decision
    E_DECIDE -- "true" --> COMPLETED
    E_DECIDE -- "false +\nnext_action:\nhandoff to\nimplementer" --> LOOPBACK
    E_DECIDE -- "false +\nno loopback" --> FAILED

    LOOPBACK[Requeue implementer\n+ evaluator handoffs\nContext: evaluator feedback\nadded to implementer files]:::hydra
    LOOPBACK --> DISPATCH_I

    %% ══════════════════════════════════
    %% TERMINAL STATES
    %% ══════════════════════════════════
    COMPLETED([Workflow: completed ✓]):::state
    FAILED([Workflow: failed ✗]):::fail
```

## 3. Handoff Lifecycle — State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: Handoff created

    pending --> claimed: claimPending()\n— tick acquires file lock

    claimed --> in_progress: markInProgress()\n— terminal dispatched

    in_progress --> completed: markCompleted()\n— result.json + done valid
    in_progress --> timed_out: markTimedOut()\n— timeout or PTY death
    in_progress --> failed: markFailed()\n— validation error

    timed_out --> pending: scheduleRetry()\n— retries remaining
    timed_out --> failed: scheduleRetry()\n— retries exhausted

    completed --> [*]: Advance to next stage\nor workflow complete
    failed --> [*]: Workflow fails

    note right of in_progress
        Telemetry Truth Layer observes:
        • session events
        • process tree
        • contract activity
        • git/worktree changes
        → derived_status:
          progressing | awaiting_contract
          | stall_candidate | exited
    end note

    note right of completed
        Collector validates:
        • done marker exists
        • result.json exists
        • schema match (hydra/v2)
        • handoff_id / workflow_id match
        • required fields present
    end note
```

## 4. File Contract — The Only Source of Truth

```mermaid
flowchart LR
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef valid fill:#7ed321,stroke:#5a9e18,color:#fff
    classDef invalid fill:#d0021b,stroke:#a00116,color:#fff

    subgraph PACKAGE [".hydra/workflows/{wfId}/{handoffId}/"]
        direction TB
        HF[handoff.json\n— full contract\n— from/to/task/context/artifacts]:::file
        TM[task.md\n— markdown for agent\n— human-readable task]:::file
        RJ[result.json\n— agent output\n— success/summary/outputs/evidence]:::file
        DM[done\n— completion marker\n— version/handoff_id/workflow_id/result_file]:::file
    end

    HF -- "Agent reads" --> AGENT((Agent\nTerminal))
    TM -- "Agent reads" --> AGENT
    AGENT -- "Agent writes" --> RJ
    AGENT -- "Agent writes\n(after result.json)" --> DM

    DM --> COLLECTOR{Collector\nvalidation gate}
    RJ --> COLLECTOR

    COLLECTOR -- "Both valid\n+ schema match" --> PASS[✓ Completed]:::valid
    COLLECTOR -- "Missing / malformed\n/ schema mismatch" --> REJECT[✗ Failed]:::invalid
```

## 5. Telemetry Truth Layer — Runtime Observation

```mermaid
flowchart TB
    classDef l0 fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold
    classDef l1 fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef l2 fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef l3 fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef source fill:#9b9b9b,stroke:#6b6b6b,color:#fff

    subgraph SOURCES ["Raw Signal Sources"]
        S1[Session Events\nClaude: assistant/tool_use/toolUseResult\nCodex: task_started/function_call/token_count]:::source
        S2[PTY Runtime\ninput / output / exit]:::source
        S3[Process Tree\ndescendant PIDs\nforeground tool]:::source
        S4[Git / Worktree\nindex changes\nHEAD changes]:::source
        S5[Contract Files\nhandoff.json / result.json / done]:::source
    end

    subgraph LAYER0 ["Layer 0 — Authoritative Contract"]
        L0[result.json + done\n= only completion gate\nHydra rejects everything else]:::l0
    end

    subgraph LAYER1 ["Layer 1 — Runtime Telemetry Events"]
        L1[Unified TelemetryEvent envelope\nsource / kind / terminal_id / data\nper-provider adapters:\nClaudeTelemetryAdapter\nCodexTelemetryAdapter]:::l1
    end

    subgraph LAYER2 ["Layer 2 — Derived Snapshot"]
        L2[TerminalTelemetrySnapshot\n• session_attached\n• turn_state\n• last_meaningful_progress_at\n• foreground_tool\n• done_exists / result_valid\n• derived_status]:::l2
    end

    subgraph LAYER3 ["Layer 3 — Consumer Decisions"]
        L3_UI[UI: badge + fact panel\nProgressing / Awaiting contract\nStall candidate / Exited]:::l3
        L3_HYDRA[Hydra: advisory rules\ncontinue wait / stall_candidate\nawaiting_contract]:::l3
        L3_AGENT[Agent CLI: skill guidance\nquery before wait/retry/takeover]:::l3
    end

    S1 & S2 & S3 & S4 --> L1
    S5 --> L0
    S5 --> L1
    L1 --> L2
    L0 --> L3_HYDRA
    L2 --> L3_UI
    L2 --> L3_HYDRA
    L2 --> L3_AGENT
```

## 6. Complete System — All Pieces Together

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef tc fill:#9013fe,stroke:#6d0ec0,color:#fff,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef telem fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold

    USER([User]):::user
    USER <--> BRAIN

    BRAIN[Main Brain\n— mode selection\n— up/down translation\n— approval mediation]:::brain

    BRAIN <--> HYDRA_CLI

    subgraph HYDRA ["Hydra Control Plane"]
        HYDRA_CLI[CLI: run / tick / watch\nstatus / retry / approve\nrevise / spawn / cleanup]:::hydra
        WF_ENGINE[Workflow Engine\n— state machine\n— template advance\n— evaluator loopback]:::hydra
        COLLECTOR[Collector\n— contract validation\n— schema gate]:::hydra
        RETRY[Retry Logic\n— timeout detection\n— process death\n— retry budget]:::hydra

        HYDRA_CLI --> WF_ENGINE
        WF_ENGINE --> COLLECTOR
        COLLECTOR --> WF_ENGINE
        WF_ENGINE --> RETRY
        RETRY --> WF_ENGINE
    end

    WF_ENGINE <--> DISPATCHER

    DISPATCHER[Dispatcher\n— build prompt\n— call termcanvas\n  terminal create]:::hydra

    DISPATCHER --> TC

    subgraph TC ["TermCanvas Runtime"]
        TC_API[API Server\nterminal create/destroy]:::tc
        TC_PTY[PTY Manager\nspawn / lifecycle]:::tc
        TC_TELEM[Telemetry Service\nsession adapter\nprocess detector\ncontract probe]:::tc

        TC_API --> TC_PTY
        TC_PTY --> TC_TELEM
    end

    TC_PTY --> AGENT_TERMINAL

    subgraph AGENT_TERMINAL ["Agent Terminal (isolated)"]
        AGENT[Claude / Codex CLI\n— read task.md\n— execute task\n— write result.json + done]:::agent
    end

    AGENT_TERMINAL --> FS

    subgraph FS [".hydra/ File System"]
        HF[handoff.json]:::file
        TM[task.md]:::file
        RJ[result.json]:::file
        DM[done]:::file
        WJ[workflow.json]:::file
        REV[revision.md]:::file
    end

    FS --> COLLECTOR
    TC_TELEM --> TELEM_OUT

    TELEM_OUT[Telemetry Snapshot\n— last_meaningful_progress_at\n— derived_status\n— turn_state]:::telem

    TELEM_OUT --> WF_ENGINE
    TELEM_OUT --> BRAIN
    TELEM_OUT --> TC
```

## Legend

| Color | Component |
|-------|-----------|
| 🔵 Blue | User |
| 🟠 Orange | Main Brain (current agent) |
| 🟢 Green (teal) | Hydra Control Plane |
| 🟣 Purple | TermCanvas Runtime |
| 🟢 Green | Agent Terminal (Claude/Codex) |
| ⬛ Gray | File Contract (.hydra/) |
| 🟡 Yellow | Telemetry Truth Layer |
| 🔴 Red | Failure states |

## Workflow Mode Summary

| Mode | Command | When to use |
|------|---------|-------------|
| **Direct** | *(no hydra)* | Simple, local, fast |
| **Spawn** | `hydra spawn` | Known split, one isolated worker, no workflow |
| **Single-Step** | `hydra run --template single-step` | One implementer + isolation + retry control |
| **Full Workflow** | `hydra run` | Ambiguous / risky / PRD-driven |
| **Approve-Plan** | `hydra run --approve-plan` | User wants to review/revise plan before execution |

## State Summary

| Layer | States | Transition Trigger |
|-------|--------|--------------------|
| **Handoff** | pending → claimed → in_progress → completed / timed_out / failed | File lock + collector validation |
| **Workflow** | pending → running → waiting_for_approval → completed / failed | Template advance logic |
| **Telemetry** | starting → progressing → awaiting_contract → stall_candidate → exited | Derived from runtime signals |
