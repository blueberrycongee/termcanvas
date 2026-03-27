# Hydra 多智能体系统 — 全景流程图

## 1. 模式选择与入口

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef decision fill:#bd10e0,stroke:#8b0ca6,color:#fff,font-weight:bold
    classDef terminal fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff,font-style:italic
    classDef state fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold

    USER([用户: 任务请求]):::user
    USER --> BRAIN

    BRAIN[主脑:\n评估复杂度\n选择模式]:::brain
    BRAIN --> MODE

    MODE{模式\n选择}:::decision

    MODE -- "简单 / 本地 / 快速" --> DIRECT
    MODE -- "需要隔离\n+ 证据" --> SPAWN_OR_SINGLE
    MODE -- "模糊 / 高风险\n/ PRD 驱动" --> WORKFLOW
    MODE -- "需要用户\n审批计划" --> WORKFLOW_APPROVE

    %% ── 模式 0: 直接执行 ──
    DIRECT[在当前 agent\n中直接完成]:::brain
    DIRECT --> DONE_DIRECT([完成]):::user

    %% ── 模式 1: Spawn / 单步 ──
    SPAWN_OR_SINGLE{拆分方案\n已知?}:::decision
    SPAWN_OR_SINGLE -- "是, 单个 worker" --> SPAWN
    SPAWN_OR_SINGLE -- "需要 workflow\n控制" --> SINGLE

    SPAWN{{hydra spawn\n--task ... --repo .}}:::hydra
    SPAWN --> WORKER_SPAWN

    SINGLE{{hydra run\n--template single-step}}:::hydra
    SINGLE --> WORKER_SINGLE

    subgraph ISOLATED_WORKER ["隔离 Worker (新终端)"]
        WORKER_SPAWN[Worker agent\n读取任务, 执行]:::terminal
        WORKER_SINGLE[Worker agent\n读取任务, 执行]:::terminal
        WORKER_SPAWN --> CONTRACT_S[写 result.json + done]:::file
        WORKER_SINGLE --> CONTRACT_SS[写 result.json + done]:::file
    end

    CONTRACT_S --> DONE_SPAWN([收集结果]):::user
    CONTRACT_SS --> DONE_SS([通过 workflow tick 收集]):::user

    %% ── 模式 2: 完整三阶段工作流 ──
    WORKFLOW{{hydra run\n--task ... --repo .}}:::hydra
    WORKFLOW --> WF_ENGINE

    %% ── 模式 3: 需审批的工作流 ──
    WORKFLOW_APPROVE{{hydra run\n--task ... --approve-plan}}:::hydra
    WORKFLOW_APPROVE --> WF_ENGINE

    WF_ENGINE[进入工作流引擎\n见图 2]:::hydra
```

## 2. 工作流引擎 — 规划者 → 执行者 → 评估者

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

    START([工作流已创建\n状态: pending]):::state
    START --> DISPATCH_P

    %% ══════════════════════════════════
    %% 规划者阶段
    %% ══════════════════════════════════
    subgraph PLANNER_STAGE ["阶段 0 — 规划者 (Planner)"]
        DISPATCH_P[分发 handoff-0\n到规划者终端]:::hydra
        DISPATCH_P --> P_WORK

        P_WORK[规划者 agent:\n- 调查代码库\n- 列出问题\n- 定义约束\n- 编写实施计划]:::agent

        P_WORK --> P_CONTRACT[写 result.json + done]:::file
    end

    P_CONTRACT --> P_COLLECT

    P_COLLECT[收集器:\n验证 result.json\n+ done 标记]:::hydra
    P_COLLECT --> P_VALID

    P_VALID{合同\n有效?}:::decision
    P_VALID -- "无效" --> P_RETRY_OR_FAIL
    P_VALID -- "有效" --> P_APPROVE_CHECK

    P_RETRY_OR_FAIL{还有\n重试次数?}:::decision
    P_RETRY_OR_FAIL -- "有" --> DISPATCH_P
    P_RETRY_OR_FAIL -- "没有" --> FAILED

    P_APPROVE_CHECK{--approve-plan\n标志?}:::decision
    P_APPROVE_CHECK -- "否 (自动推进)" --> DISPATCH_I
    P_APPROVE_CHECK -- "是" --> WAIT_APPROVAL

    %% ══════════════════════════════════
    %% 计划审批循环 (模式 C)
    %% ══════════════════════════════════
    subgraph APPROVAL_LOOP ["计划审批循环"]
        WAIT_APPROVAL([工作流状态:\nwaiting_for_approval]):::state
        WAIT_APPROVAL --> BRAIN_UP

        BRAIN_UP[主脑:\n读取规划者 result.json\n翻译为用户可理解的摘要]:::brain
        BRAIN_UP --> USER_REVIEW

        USER_REVIEW([用户审阅计划]):::user
        USER_REVIEW --> APPROVE_DECIDE

        APPROVE_DECIDE{用户\n满意?}:::decision
        APPROVE_DECIDE -- "满意" --> APPROVE_CMD
        APPROVE_DECIDE -- "不满意" --> REVISE_LOOP

        REVISE_LOOP[主脑 + 用户对话\n结构化反馈]:::brain
        REVISE_LOOP --> REVISE_CMD

        REVISE_CMD{{hydra revise\n--feedback '...'}}:::hydra
        REVISE_CMD --> REVISE_WRITE

        REVISE_WRITE[写 revision.md\n到规划者包目录\n重置规划者 handoff 为 pending]:::hydra
        REVISE_WRITE --> DISPATCH_P_REVISED

        DISPATCH_P_REVISED[重新分发规划者\n上下文: 上版 result.json\n+ revision.md]:::hydra
        DISPATCH_P_REVISED --> P_WORK_B

        P_WORK_B[新规划者终端:\n读取上版计划 + 反馈\n修订计划]:::agent
        P_WORK_B --> P_CONTRACT_B[写修订后的 result.json + done]:::file
        P_CONTRACT_B --> BRAIN_UP

        APPROVE_CMD{{hydra approve\n--workflow id}}:::hydra
    end

    APPROVE_CMD --> DISPATCH_I

    %% ══════════════════════════════════
    %% 执行者阶段
    %% ══════════════════════════════════
    subgraph IMPLEMENTER_STAGE ["阶段 1 — 执行者 (Implementer)"]
        DISPATCH_I[分发 handoff-1\n到执行者终端]:::hydra
        DISPATCH_I --> I_WORK

        I_WORK[执行者 agent:\n- 读取规划者的计划\n- 实现变更\n- 运行测试\n- 留下证据]:::agent

        I_WORK --> I_CONTRACT[写 result.json + done]:::file
    end

    I_CONTRACT --> I_COLLECT

    I_COLLECT[收集器:\n验证 result.json\n+ done 标记]:::hydra
    I_COLLECT --> I_VALID

    I_VALID{合同\n有效?}:::decision
    I_VALID -- "无效" --> I_RETRY_OR_FAIL
    I_VALID -- "有效" --> DISPATCH_E

    I_RETRY_OR_FAIL{还有\n重试次数?}:::decision
    I_RETRY_OR_FAIL -- "有" --> DISPATCH_I
    I_RETRY_OR_FAIL -- "没有" --> FAILED

    %% ══════════════════════════════════
    %% 评估者阶段
    %% ══════════════════════════════════
    subgraph EVALUATOR_STAGE ["阶段 2 — 评估者 (Evaluator)"]
        DISPATCH_E[分发 handoff-2\n到评估者终端]:::hydra
        DISPATCH_E --> E_WORK

        E_WORK[评估者 agent:\n- 读取计划 + 实现\n- 运行测试套件 + 构建\n- 验证约束\n- 检查回归\n- 标记反模式]:::agent

        E_WORK --> E_CONTRACT[写 result.json + done]:::file
    end

    E_CONTRACT --> E_COLLECT

    E_COLLECT[收集器:\n验证 result.json\n+ done 标记]:::hydra
    E_COLLECT --> E_VALID

    E_VALID{合同\n有效?}:::decision
    E_VALID -- "无效" --> E_RETRY_OR_FAIL
    E_VALID -- "有效" --> E_DECIDE

    E_RETRY_OR_FAIL{还有\n重试次数?}:::decision
    E_RETRY_OR_FAIL -- "有" --> DISPATCH_E
    E_RETRY_OR_FAIL -- "没有" --> FAILED

    %% ══════════════════════════════════
    %% 评估者决策 (回环或完成)
    %% ══════════════════════════════════
    E_DECIDE{评估者\nresult.success?}:::decision
    E_DECIDE -- "true" --> COMPLETED
    E_DECIDE -- "false +\nnext_action:\n交回执行者" --> LOOPBACK
    E_DECIDE -- "false +\n无回环" --> FAILED

    LOOPBACK[重新排队 执行者\n+ 评估者 handoff\n上下文: 评估者反馈\n注入执行者文件]:::hydra
    LOOPBACK --> DISPATCH_I

    %% ══════════════════════════════════
    %% 终态
    %% ══════════════════════════════════
    COMPLETED([工作流: 完成]):::state
    FAILED([工作流: 失败]):::fail
```

## 3. Handoff 生命周期 — 状态机

```mermaid
stateDiagram-v2
    [*] --> pending: 创建

    pending --> claimed: claim 锁定
    claimed --> in_progress: dispatch 分发

    in_progress --> completed: 合同有效
    in_progress --> timed_out: 超时
    in_progress --> failed: 验证失败

    timed_out --> pending: 重试
    timed_out --> failed: 耗尽

    completed --> [*]: 推进
    failed --> [*]: 终止
```

| 转换 | 触发条件 | 说明 |
|------|----------|------|
| `pending → claimed` | `claimPending()` | tick 获取文件锁，防止竞争 |
| `claimed → in_progress` | `markInProgress()` | 终端已分发，agent 开始工作 |
| `in_progress → completed` | `markCompleted()` | result.json + done 验证通过 |
| `in_progress → timed_out` | `markTimedOut()` | 超时或 PTY 进程死亡 |
| `in_progress → failed` | `markFailed()` | 合同验证错误 |
| `timed_out → pending` | `scheduleRetry()` | 还有重试次数，重新排队 |
| `timed_out → failed` | `scheduleRetry()` | 重试次数耗尽 |

**遥测真相层**观测 `in_progress` 状态的 handoff:
- 会话事件、进程树、合同文件活动、git/worktree 变更
- 派生状态: `progressing` | `awaiting_contract` | `stall_candidate` | `exited`

**收集器**在标记 `completed` 前验证:
- `done` 标记存在、`result.json` 存在
- Schema 匹配 (`hydra/v2`)、`handoff_id` / `workflow_id` 匹配、必填字段齐全

## 4. 文件合同 — 唯一真相来源

```mermaid
flowchart LR
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef valid fill:#7ed321,stroke:#5a9e18,color:#fff
    classDef invalid fill:#d0021b,stroke:#a00116,color:#fff

    subgraph PACKAGE [".hydra/workflows/{wfId}/{handoffId}/"]
        direction TB
        HF[handoff.json\n— 完整合同\n— from/to/task/context/artifacts]:::file
        TM[task.md\n— 给 agent 的 Markdown\n— 人类可读的任务描述]:::file
        RJ[result.json\n— agent 输出\n— success/summary/outputs/evidence]:::file
        DM[done\n— 完成标记\n— version/handoff_id/workflow_id/result_file]:::file
    end

    HF -- "Agent 读取" --> AGENT((Agent\n终端))
    TM -- "Agent 读取" --> AGENT
    AGENT -- "Agent 写入" --> RJ
    AGENT -- "Agent 写入\n(在 result.json 之后)" --> DM

    DM --> COLLECTOR{收集器\n验证门}
    RJ --> COLLECTOR

    COLLECTOR -- "均有效\n+ schema 匹配" --> PASS[完成]:::valid
    COLLECTOR -- "缺失 / 格式错误\n/ schema 不匹配" --> REJECT[失败]:::invalid
```

## 5. 遥测真相层 — 运行时观测

```mermaid
flowchart TB
    classDef l0 fill:#d0021b,stroke:#a00116,color:#fff,font-weight:bold
    classDef l1 fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef l2 fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef l3 fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef source fill:#9b9b9b,stroke:#6b6b6b,color:#fff

    subgraph SOURCES ["原始信号源"]
        S1[会话事件\nClaude: assistant/tool_use/toolUseResult\nCodex: task_started/function_call/token_count]:::source
        S2[PTY 运行时\n输入 / 输出 / 退出]:::source
        S3[进程树\n后代 PID\n前台工具]:::source
        S4[Git / Worktree\n索引变更\nHEAD 变更]:::source
        S5[合同文件\nhandoff.json / result.json / done]:::source
    end

    subgraph LAYER0 ["第 0 层 — 权威合同"]
        L0[result.json + done\n= 唯一完成门\nHydra 拒绝其他一切]:::l0
    end

    subgraph LAYER1 ["第 1 层 — 运行时遥测事件"]
        L1[统一 TelemetryEvent 信封\nsource / kind / terminal_id / data\n按 provider 适配器:\nClaudeTelemetryAdapter\nCodexTelemetryAdapter]:::l1
    end

    subgraph LAYER2 ["第 2 层 — 派生快照"]
        L2[TerminalTelemetrySnapshot\nsession_attached 是否附着\nturn_state 轮次状态\nlast_meaningful_progress_at\nforeground_tool 前台工具\ndone_exists / result_valid\nderived_status 派生状态]:::l2
    end

    subgraph LAYER3 ["第 3 层 — 消费层决策"]
        L3_UI[UI: 徽章 + 事实面板\n推进中 / 等待合同\n疑似停滞 / 已退出]:::l3
        L3_HYDRA[Hydra: 咨询规则\n继续等待 / 疑似停滞\n等待合同]:::l3
        L3_AGENT[Agent CLI: skill 指引\n查询后再决定 等待/重试/接管]:::l3
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

## 6. 完整系统 — 所有组件拼合

```mermaid
flowchart TD
    classDef user fill:#4a90d9,stroke:#2c5f9e,color:#fff,font-weight:bold
    classDef brain fill:#f5a623,stroke:#c7841a,color:#fff,font-weight:bold
    classDef hydra fill:#50e3c2,stroke:#36b49f,color:#1a1a1a,font-weight:bold
    classDef tc fill:#9013fe,stroke:#6d0ec0,color:#fff,font-weight:bold
    classDef agent fill:#7ed321,stroke:#5a9e18,color:#fff,font-weight:bold
    classDef file fill:#6b6b6b,stroke:#4a4a4a,color:#fff
    classDef telem fill:#f8e71c,stroke:#c5b800,color:#1a1a1a,font-weight:bold

    USER([用户]):::user
    USER <--> BRAIN

    BRAIN[主脑\n模式选择\n上行/下行翻译\n审批中介]:::brain

    BRAIN <--> HYDRA_CLI

    subgraph HYDRA ["Hydra 控制面"]
        HYDRA_CLI[CLI: run / tick / watch\nstatus / retry / approve\nrevise / spawn / cleanup]:::hydra
        WF_ENGINE[工作流引擎\n状态机\n模板推进\n评估者回环]:::hydra
        COLLECTOR[收集器\n合同验证\nschema 门]:::hydra
        RETRY[重试逻辑\n超时检测\n进程死亡\n重试预算]:::hydra

        HYDRA_CLI --> WF_ENGINE
        WF_ENGINE --> COLLECTOR
        COLLECTOR --> WF_ENGINE
        WF_ENGINE --> RETRY
        RETRY --> WF_ENGINE
    end

    WF_ENGINE <--> DISPATCHER

    DISPATCHER[分发器\n构建 prompt\n调用 termcanvas terminal create]:::hydra

    DISPATCHER --> TC

    subgraph TC ["TermCanvas 运行时"]
        TC_API[API 服务\n终端创建/销毁]:::tc
        TC_PTY[PTY 管理器\n启动 / 生命周期]:::tc
        TC_TELEM[遥测服务\n会话适配器\n进程检测器\n合同探针]:::tc

        TC_API --> TC_PTY
        TC_PTY --> TC_TELEM
    end

    TC_PTY --> AGENT_TERMINAL

    subgraph AGENT_TERMINAL ["Agent 终端 (隔离)"]
        AGENT[Claude / Codex CLI\n读取 task.md\n执行任务\n写 result.json + done]:::agent
    end

    AGENT_TERMINAL --> FS

    subgraph FS [".hydra/ 文件系统"]
        HF[handoff.json]:::file
        TM[task.md]:::file
        RJ[result.json]:::file
        DM[done]:::file
        WJ[workflow.json]:::file
        REV[revision.md]:::file
    end

    FS --> COLLECTOR
    TC_TELEM --> TELEM_OUT

    TELEM_OUT[遥测快照\nlast_meaningful_progress_at\nderived_status\nturn_state]:::telem

    TELEM_OUT --> WF_ENGINE
    TELEM_OUT --> BRAIN
    TELEM_OUT --> TC
```

## 图例

| 颜色 | 组件 |
|------|------|
| 蓝色 | 用户 |
| 橙色 | 主脑 (当前 agent) |
| 青绿色 | Hydra 控制面 |
| 紫色 | TermCanvas 运行时 |
| 绿色 | Agent 终端 (Claude/Codex) |
| 灰色 | 文件合同 (.hydra/) |
| 黄色 | 遥测真相层 |
| 红色 | 失败状态 |

## 工作流模式总览

| 模式 | 命令 | 使用场景 |
|------|------|----------|
| **直接执行** | *(不用 hydra)* | 简单、本地、快速 |
| **Spawn** | `hydra spawn` | 拆分方案已知, 单个隔离 worker, 无需工作流 |
| **单步** | `hydra run --template single-step` | 单个执行者 + 隔离 + 重试控制 |
| **完整工作流** | `hydra run` | 模糊 / 高风险 / PRD 驱动 |
| **审批计划** | `hydra run --approve-plan` | 用户需要在执行前审阅/修订计划 |

## 状态总览

| 层级 | 状态 | 转换触发 |
|------|------|----------|
| **Handoff** | pending → claimed → in_progress → completed / timed_out / failed | 文件锁 + 收集器验证 |
| **Workflow** | pending → running → waiting_for_approval → completed / failed | 模板推进逻辑 |
| **遥测** | starting → progressing → awaiting_contract → stall_candidate → exited | 运行时信号派生 |
