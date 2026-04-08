# Hydra 工作流全景图

## 1. 模式选择

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold

    USER([用户请求]):::user --> BRAIN["主脑<br/>决定走哪条路径"]:::brain
    BRAIN --> MODE{选择路径}:::decision
    MODE -- "简单 / 本地 / 快速" --> DIRECT["直接在当前 agent 中完成"]:::brain
    MODE -- "需要隔离 + 文件证据" --> SINGLE["hydra run --template single-step"]:::hydra
    MODE -- "模糊 / 高风险 / 长任务" --> WF["hydra run"]:::hydra
    MODE -- "拆分已知，只要一个隔离 worker" --> SPAWN["hydra spawn"]:::hydra
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

    START([工作流已创建]):::state --> RESEARCH

    RESEARCH["assignment: researcher<br/>执行 task.md"]:::agent --> RR["发布 result.json<br/>+ artifacts/brief.md"]:::file
    RR --> APPROVAL{是否需要审批?}:::decision
    APPROVAL -- "需要" --> WAIT_APPROVAL([waiting_for_approval]):::state
    WAIT_APPROVAL --> RESEARCH
    APPROVAL -- "不需要" --> IMPLEMENT

    IMPLEMENT["assignment: implementer<br/>执行 task.md"]:::agent --> IR["发布 result.json<br/>+ artifacts/brief.md"]:::file
    IR --> VERIFY

    VERIFY["assignment: tester<br/>执行 task.md"]:::agent --> VR["发布 result.json<br/>+ artifacts/brief.md"]:::file
    VR --> VERIFY_DECIDE{next_action}:::decision

    VERIFY_DECIDE -- "转回 implementer" --> IMPLEMENT
    VERIFY_DECIDE -- "转回 researcher" --> INTENT
    VERIFY_DECIDE -- "无效 / 超限" --> FAILED([failed]):::fail

    INTENT["assignment: researcher<br/>做 intent confirmation"]:::agent --> CR["发布 result.json"]:::file
    CR --> INTENT_DECIDE{next_action}:::decision
    INTENT_DECIDE -- "complete" --> DONE([completed]):::state
    INTENT_DECIDE -- "转回 implementer" --> IMPLEMENT
    INTENT_DECIDE -- "转回 researcher 且 replan" --> RESEARCH
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

    subgraph WF[".hydra/workflows/<workflowId>"]
        WJ["workflow.json<br/>workflow 元数据"]:::state
        INPUT["inputs/user-request.md<br/>workflow 级请求"]:::file
        AJ["assignments/<assignmentId>/assignment.json<br/>assignment 元数据"]:::state
        TASK["assignments/<assignmentId>/runs/<runId>/task.md<br/>薄任务单"]:::file
        ART["assignments/<assignmentId>/runs/<runId>/artifacts/*.md<br/>人类可读交付物"]:::file
        RESULT["assignments/<assignmentId>/runs/<runId>/result.json<br/>机器完成门"]:::file
    end

    WJ --> AJ
    AJ --> TASK
    INPUT --> TASK
    TASK --> AGENT["Claude / Codex 终端"]:::agent
    AGENT --> ART
    AGENT --> RESULT
```

## 5. 设计规则

- Hydra 不靠解析 Markdown 正文决定下一步。
- `task.md` 给当前 agent 和人读。
- `artifacts/*.md` 是给下游和人看的正式产物。
- `result.json` 是唯一机器完成门。
- retry = 新终端 + 新 run id + 新输出目录。
