# Hydra Workbench 全景图

## 1. 模式选择

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold

    USER([用户请求]):::user --> LEAD["Lead 终端<br/>读代码并做决策"]:::brain
    LEAD --> MODE{选哪条路径?}:::decision
    MODE -- "简单 / 本地 / 快速" --> DIRECT["直接在当前 agent 中完成"]:::brain
    MODE -- "只要一个隔离 worker" --> SPAWN["hydra spawn"]:::hydra
    MODE -- "模糊 / 高风险 / 可并行 / 多阶段" --> WF["hydra init -> dispatch -> watch"]:::hydra
```

## 2. 运行时主流程

```mermaid
flowchart TD
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff,font-style:italic
    classDef fail fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold

    START([workbench 已创建]):::state --> DISPATCH["Lead: hydra dispatch"]:::hydra
    DISPATCH --> WORKER["worker 终端<br/>执行 task.md"]:::agent
    WORKER --> FILES["写入 report.md<br/>+ result.json"]:::file
    FILES --> WATCH["Lead: hydra watch"]:::hydra
    WATCH --> DECIDE{DecisionPoint}:::decision

    DECIDE -- "dispatch_completed" --> ACTION{Lead 动作}:::decision
    DECIDE -- "dispatch_failed" --> FAIL_OR_RESET["hydra fail<br/>或 hydra reset"]:::fail
    DECIDE -- "stall_advisory" --> INSPECT["hydra status + telemetry"]:::hydra
    DECIDE -- "watch_timeout" --> INSPECT
    DECIDE -- "batch_completed" --> BATCH{还有后续吗?}:::decision

    ACTION -- "继续追问" --> ASK["hydra ask"]:::hydra
    ASK --> ACTION
    ACTION -- "批准产物" --> APPROVE["hydra approve"]:::hydra
    ACTION -- "返工" --> RESET["hydra reset"]:::hydra
    RESET --> REDISPATCH["hydra redispatch"]:::hydra
    REDISPATCH --> WORKER
    ACTION -- "分发后续 / 并行 dispatch" --> MORE["hydra dispatch"]:::hydra
    MORE --> WATCH
    ACTION -- "结束 workbench" --> COMPLETE["hydra complete"]:::state

    APPROVE --> AFTER_APPROVE{要继续分发吗?}:::decision
    AFTER_APPROVE -- "要" --> MORE
    AFTER_APPROVE -- "暂时不要" --> WATCH

    BATCH -- "分发 newly eligible dispatch" --> MORE
    BATCH -- "合并并行分支" --> MERGE["hydra merge"]:::hydra
    MERGE --> WATCH
    BATCH -- "workbench 已完成" --> COMPLETE

    INSPECT --> WATCH
    FAIL_OR_RESET --> WATCH
```

## 3. Assignment 状态机

```mermaid
stateDiagram-v2
    [*] --> pending: 创建

    pending --> claimed: 抢占锁
    claimed --> in_progress: 已分发

    in_progress --> completed: result.json 有效
    in_progress --> timed_out: 超时
    in_progress --> failed: result 无效或分发失败

    timed_out --> pending: 安排重试
    timed_out --> failed: 重试预算耗尽

    completed --> [*]
    failed --> [*]
```

## 4. 文件模型

```mermaid
flowchart LR
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold

    subgraph WB[".hydra/workbenches/&lt;workbenchId&gt;"]
        WJ["workbench.json<br/>workbench 元数据 + DAG"]:::state
        LEDGER["ledger.jsonl<br/>决策审计日志"]:::file
        INPUT["inputs/intent.md<br/>workbench intent"]:::file
        NODE["dispatches/&lt;dispatchId&gt;/intent.md<br/>dispatch intent"]:::file
        FEEDBACK["dispatches/&lt;dispatchId&gt;/feedback.md<br/>Lead 反馈"]:::file
        AJ["assignments/&lt;assignmentId&gt;/assignment.json<br/>assignment 状态"]:::state
        TASK["assignments/&lt;assignmentId&gt;/runs/&lt;runId&gt;/task.md<br/>本轮任务单"]:::file
        REPORT["assignments/&lt;assignmentId&gt;/runs/&lt;runId&gt;/report.md<br/>人类可读报告"]:::file
        RESULT["assignments/&lt;assignmentId&gt;/runs/&lt;runId&gt;/result.json<br/>机器路由门禁"]:::file
        OUT["outputs/summary.md<br/>workbench 总结"]:::file
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

## 5. 设计规则

- `hydra watch` 是 Lead 的决策循环。
- `report.md` 负责解释发生了什么；`result.json` 负责告诉 Hydra 怎么路由。
- Role 文件锁定 dispatch 的 CLI / model / reasoning 配置。
- `hydra ask` 是轻量追问；`hydra reset` 是明确返工。
- retry = 新 run id + 新输出目录。
- `stall_advisory` 不是失败——它是 liveness 探针在提示"worker 还活着但没推进"。Lead 自行决定：继续等 / reset / 人肉接手。
