# Hydra Workflow Panorama

## 1. Mode Selection

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold

    USER([User request]):::user --> BRAIN["Main brain<br/>route the task"]:::brain
    BRAIN --> MODE{Which path?}:::decision
    MODE -- "Simple / local / fast" --> DIRECT["Work directly<br/>in current agent"]:::brain
    MODE -- "Need isolation + file evidence" --> SINGLE["hydra run --template single-step"]:::hydra
    MODE -- "Ambiguous / risky / long-running" --> WF["hydra run"]:::hydra
    MODE -- "Known split, one isolated worker" --> SPAWN["hydra spawn"]:::hydra
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

    START([Workflow created]):::state --> RESEARCH

    RESEARCH["Assignment: researcher<br/>run task.md"]:::agent --> RR["publish result.json<br/>+ artifacts/brief.md"]:::file
    RR --> APPROVAL{Approval needed?}:::decision
    APPROVAL -- "Yes" --> WAIT_APPROVAL([waiting_for_approval]):::state
    WAIT_APPROVAL --> RESEARCH
    APPROVAL -- "No" --> IMPLEMENT

    IMPLEMENT["Assignment: implementer<br/>run task.md"]:::agent --> IR["publish result.json<br/>+ artifacts/brief.md"]:::file
    IR --> VERIFY

    VERIFY["Assignment: tester<br/>run task.md"]:::agent --> VR["publish result.json<br/>+ artifacts/brief.md"]:::file
    VR --> VERIFY_DECIDE{next_action}:::decision

    VERIFY_DECIDE -- "transition to implementer" --> IMPLEMENT
    VERIFY_DECIDE -- "transition to researcher" --> INTENT
    VERIFY_DECIDE -- "invalid / exhausted" --> FAILED([failed]):::fail

    INTENT["Assignment: researcher<br/>intent confirmation"]:::agent --> CR["publish result.json"]:::file
    CR --> INTENT_DECIDE{next_action}:::decision
    INTENT_DECIDE -- "complete" --> DONE([completed]):::state
    INTENT_DECIDE -- "transition to implementer" --> IMPLEMENT
    INTENT_DECIDE -- "transition to researcher + replan" --> RESEARCH
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
        WJ["workflow.json<br/>workflow metadata"]:::state
        INPUT["inputs/user-request.md<br/>workflow-level request"]:::file
        AJ["assignments/<assignmentId>/assignment.json<br/>assignment metadata"]:::state
        TASK["assignments/<assignmentId>/runs/<runId>/task.md<br/>thin task sheet"]:::file
        ART["assignments/<assignmentId>/runs/<runId>/artifacts/*.md<br/>human-readable deliverables"]:::file
        RESULT["assignments/<assignmentId>/runs/<runId>/result.json<br/>machine completion gate"]:::file
    end

    WJ --> AJ
    AJ --> TASK
    INPUT --> TASK
    TASK --> AGENT["Claude / Codex terminal"]:::agent
    AGENT --> ART
    AGENT --> RESULT
```

## 5. Design Rules

- Hydra does not read Markdown prose to decide the next step.
- `task.md` is for the current agent and humans.
- `artifacts/*.md` are downstream deliverables.
- `result.json` is the only machine completion gate.
- Retry means a new terminal, a new run id, and a new output directory.
