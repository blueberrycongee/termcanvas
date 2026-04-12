# Hydra Workflow Panorama

## 1. Mode Selection

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold

    USER([User request]):::user --> LEAD["Lead terminal<br/>reads code and decides"]:::brain
    LEAD --> MODE{Which path?}:::decision
    MODE -- "Simple / local / fast" --> DIRECT["Work directly<br/>in current agent"]:::brain
    MODE -- "One isolated worker" --> SPAWN["hydra spawn"]:::hydra
    MODE -- "Ambiguous / risky / parallel / multi-step" --> WF["hydra init -> dispatch -> watch"]:::hydra
```

## 2. Runtime Control Flow

```mermaid
flowchart TD
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff,font-style:italic
    classDef fail fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold

    START([Workflow created]):::state --> DISPATCH["Lead: hydra dispatch"]:::hydra
    DISPATCH --> WORKER["Worker terminal<br/>runs task.md"]:::agent
    WORKER --> FILES["write report.md<br/>+ result.json"]:::file
    FILES --> WATCH["Lead: hydra watch"]:::hydra
    WATCH --> DECIDE{DecisionPoint}:::decision

    DECIDE -- "node_completed" --> ACTION{Lead action}:::decision
    DECIDE -- "node_failed" --> FAIL_OR_RESET["hydra fail<br/>or hydra reset"]:::fail
    DECIDE -- "watch_timeout" --> INSPECT["hydra status + telemetry"]:::hydra
    DECIDE -- "batch_completed" --> BATCH{More work?}:::decision

    ACTION -- "ask follow-up" --> ASK["hydra ask"]:::hydra
    ASK --> ACTION
    ACTION -- "approve" --> APPROVE["hydra approve"]:::hydra
    ACTION -- "rework" --> RESET["hydra reset"]:::hydra
    RESET --> REDISPATCH["hydra redispatch"]:::hydra
    REDISPATCH --> WORKER
    ACTION -- "dispatch next / parallel nodes" --> MORE["hydra dispatch"]:::hydra
    MORE --> WATCH
    ACTION -- "complete workflow" --> COMPLETE["hydra complete"]:::state

    APPROVE --> AFTER_APPROVE{Dispatch follow-on?}:::decision
    AFTER_APPROVE -- "yes" --> MORE
    AFTER_APPROVE -- "not yet" --> WATCH

    BATCH -- "dispatch newly eligible nodes" --> MORE
    BATCH -- "merge parallel branches" --> MERGE["hydra merge"]:::hydra
    MERGE --> WATCH
    BATCH -- "workflow done" --> COMPLETE

    INSPECT --> WATCH
    FAIL_OR_RESET --> WATCH
```

## 3. Assignment State Machine

```mermaid
stateDiagram-v2
    [*] --> pending: created

    pending --> claimed: claim lock
    claimed --> in_progress: dispatched

    in_progress --> completed: valid result.json
    in_progress --> timed_out: timeout
    in_progress --> failed: invalid result or dispatch failure

    timed_out --> pending: retry scheduled
    timed_out --> failed: retry budget exhausted

    completed --> [*]
    failed --> [*]
```

## 4. File Model

```mermaid
flowchart LR
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold

    subgraph WF[".hydra/workflows/<workflowId>"]
        WJ["workflow.json<br/>workflow metadata + DAG"]:::state
        LEDGER["ledger.jsonl<br/>decision audit log"]:::file
        INPUT["inputs/intent.md<br/>workflow intent"]:::file
        NODE["nodes/<nodeId>/intent.md<br/>node intent"]:::file
        FEEDBACK["nodes/<nodeId>/feedback.md<br/>Lead feedback"]:::file
        AJ["assignments/<assignmentId>/assignment.json<br/>assignment state"]:::state
        TASK["assignments/<assignmentId>/runs/<runId>/task.md<br/>run task sheet"]:::file
        REPORT["assignments/<assignmentId>/runs/<runId>/report.md<br/>human-readable report"]:::file
        RESULT["assignments/<assignmentId>/runs/<runId>/result.json<br/>machine routing gate"]:::file
        OUT["outputs/summary.md<br/>workflow summary"]:::file
    end

    WJ --> NODE
    WJ --> AJ
    INPUT --> TASK
    NODE --> TASK
    FEEDBACK --> TASK
    AJ --> TASK
    TASK --> AGENT["Claude / Codex worker"]:::agent
    AGENT --> REPORT
    AGENT --> RESULT
    WJ --> LEDGER
    WJ --> OUT
```

## 5. Design Rules

- `hydra watch` is the Lead's decision loop.
- `report.md` explains what happened; `result.json` tells Hydra how to route.
- Role files lock the CLI / model / reasoning profile for a node.
- `hydra ask` is lightweight follow-up; `hydra reset` is explicit rework.
- Retry means a new run id and a new output directory.
