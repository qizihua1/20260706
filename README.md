# 运单全流程管理系统 V3

> 录单（V2）→ 扫描品控（V3）→ 异常上报（V3）→ 分级审批（V3）→ 执行联动（V3）—— 运单全生命周期管理

Next.js 14 App Router + Prisma 6 + PostgreSQL + TailwindCSS，**独立部署、独立数据库**，通过 HTTP 接口与 V2（code20200605）系统互通。

UI 风格与 V2「鲸天系统」保持一致：主色 `#0fc6c2`（青绿色）、圆角卡片、清爽布局。

---

## 在线访问

- **V3 系统（本项目）**：部署到 Vercel 后可在线访问（部署步骤见第 10 节）
- **V2 系统（依赖方）**：<https://code20200605.vercel.app> — V3 通过 HTTP API 从这里获取真实运单数据

---

## 交付物检查清单（按题目要求）

| # | 要求 | 交付物 | 状态 |
|---|---|---|---|
| 1 | Vercel 部署（独立于 V2） | Vercel 项目 + 可访问 URL | 需按第 10 节操作部署 |
| 2 | 真实调用 V2 接口校验运单（而非直接连 V2 DB） | `lib/v2-api-client.ts` + 所有上报/扫描接口的实时校验 | ✅ 已实现 |
| 3 | 扫描品控链路 + 品控规则引擎 + 批次状态机 | `app/scan/page.tsx` + `lib/rules/qc-rule-engine.ts` + `lib/services/scan-batch-machine.ts` | ✅ 已实现 |
| 4 | 异常工单上报 + 分级审批状态机（含并发冲突、超时流转、权限边界） | `app/tickets/*` + `lib/services/ticket-state-machine.ts` + 18 种 `TransitionEventKind` | ✅ 已实现 |
| 5 | 执行联动（赔付/库存）与审批的一致性（事务 + 幂等） | `app/api/tickets/[id]/execute/route.ts` + `lib/services/consistency-engine.ts` | ✅ 已实现 |
| 6 | 两套状态机分离设计（工单表 vs 扫描记录表，通过 ticket_id 关联） | `prisma/schema.prisma`（11 张表 + 18 个枚举） | ✅ 已实现 |
| 7 | 接口同步日志 + 监控页面（Request ID 全链路追踪） | `sync_logs` 表 + `app/sync-monitoring/page.tsx` | ✅ 已实现 |
| 8 | 分级规则 + 品控规则可配置（不硬编码，后台可调整） | `approval_thresholds` 表 + `qc_rules` 表 + 两个设置页面 | ✅ 已实现 |
| 9 | 赔付方向字段二分法（品控=向供应商追偿，物流=赔付客户） | `compensation_records.direction` = `RECOVER_FROM_SUPPLIER` / `PAY_TO_CUSTOMER` | ✅ 已实现 |
| 10 | 规模化测试数据（至少 200+ 工单） | `prisma/seed.ts`（生成 200+ 工单、扫描记录、赔付、库存数据） | ✅ 已实现 |
| 11 | 《系统间接口契约文档》 | `docs/系统间接口契约.md` | ✅ 已完成 |
| 12 | 《需求理解与假设说明》（9 项留白+依据） | `docs/需求理解与假设说明.md` | ✅ 已完成 |
| 13 | 反思题回答（6 道） | `docs/REFLECTION.md` | ✅ 已完成 |
| 14 | 源码仓库（独立 GitHub 仓库） | `qizihua1/20260706` 仓库，main 分支 | ✅ 第 11 节操作 |

---

## 一、项目架构

### 1.1 整体架构图

```
┌───────────────────────────────────────────────────────────────────┐
│                        Vercel (独立部署)                           │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     V3 系统（本项目）                         │  │
│  │                                                             │  │
│  │  ┌──────────┐  ┌───────────┐  ┌───────────────┐            │  │
│  │  │  UI 层   │  │ API 路由层│  │  业务服务层    │            │  │
│  │  │ (Pages)  │  │ (Route)   │  │               │            │  │
│  │  │          │  │           │  │  Ticket FSM   │◄───状态机   │  │
│  │  │ 扫描品控 │  │ /api/scan │  │  Scan FSM     │◄───状态机   │  │
│  │  │ 工单列表 │  │/api/tickets│  │  QCEngine     │◄──规则引擎  │  │
│  │  │ 审批详情 │  │ /api/sync  │  │  ApprovalRE   │◄──规则引擎  │  │
│  │  │ 设置管理 │  │/api/settings││  Consistency  │◄─一致性引擎 │  │
│  │  │ 监控页面 │  │/api/webhook│  │  DataSync Svc │◄─V2互通服务 │  │
│  │  └────┬─────┘  └─────┬─────┘  └───────┬───────┘            │  │
│  │       │              │                │                     │  │
│  │       └──────────────┼────────────────┘                     │  │
│  │                      │                                      │  │
│  │              ┌───────▼────────┐                             │  │
│  │              │  Prisma Client │                             │  │
│  │              └───────┬────────┘                             │  │
│  │                      │                                      │  │
│  └──────────────────────┼──────────────────────────────────────┘  │
│                         │                                         │
│                ┌────────▼─────────┐      ┌──────────────────┐    │
│                │  Vercel Postgres │      │   V2 API Client  │    │
│                │  (独立数据库)     │◄────►│  lib/v2-api-client│   │
│                │  11 张表          │      │  超时/重试/日志   │    │
│                └──────────────────┘      └────────┬─────────┘    │
└──────────────────────────────────────────────────┼────────────────┘
                                                   │
                                            HTTPS API
                                                   ▼
                                    ┌─────────────────────────┐
                                    │ V2 系统 code20200605     │
                                    │ (独立部署，数据库独立)    │
                                    └─────────────────────────┘
```

### 1.2 两套独立状态机 + 关联规则

核心设计亮点（考点 3 + 考点 7）：**工单状态机** 与 **扫描批次状态机** 完全分离，通过 `scan_records.ticket_id` 做 1:N 关联。

| 状态机 | 归属表 | 状态枚举 | 驱动方式 |
|---|---|---|---|
| 工单审批状态机 | `exception_tickets` | `PENDING_REVIEW / L1_APPROVING / L2_APPROVING / EXECUTING / REJECTED_RESUBMIT / COMPLETED / CLOSED_AUTO_DISMISSED / ESCALATED_AUTO`（8 态） | 审批人操作 + 后台超时任务 + 扫描触发 |
| 品控批次状态机 | `scan_records` | `FREE / LOCKED / RELEASED / RETURNED_SUPPLIER / DOWNGRADED / SCRAPPED`（6 态） | 品控规则引擎命中 + 审批执行动作 |

**关联规则（已落地代码）：**
- 扫描批次锁定期间，工单未关闭 → 批次不得解锁
- 同批次同 SKU 有未关闭 QC 工单 → 重复扫描只追加 scan_records 行，不新建工单（幂等）
- QC 工单审批执行（放行/退供/降级）→ 批次解锁在**同一数据库事务**内完成，无中间态

### 1.3 数据模型总览（11 张核心表）

| 表名 | 中文名 | 作用 | 关键外键 |
|---|---|---|---|
| `users` | 用户表 | 5 种角色 + 权限 + 禁用兜底 | — |
| `waybill_snapshots` | 运单本地快照表 | **V3 自有，只读缓存**，通过接口从 V2 拉取，非 V2 原始表 | — |
| `sync_logs` | 接口同步日志表 | 每次 V2 API 调用的完整追踪（Request ID + 耗时 + 错误分类） | `callerUserId` → users |
| `exception_tickets` | 异常工单表 | 工单主表，含状态机、审批层级、乐观锁 version | `waybillSnapshotId`、`reportedByUserId`、`l1AssigneeId`、`l2AssigneeId` |
| `approval_records` | 审批记录表 | 每一次审批动作留痕 + 幂等键 | `ticketId`、`approverUserId` |
| `compensation_records` | 赔付记录表 | **含赔付方向（追偿/理赔二选一）**，不可混用 | `ticketId`、`approvalRecordId` |
| `inventory_records` | 库存变动记录 | 每次库存变动的可追溯链路 | `ticketId`、`approvalRecordId` |
| `scan_records` | 扫描记录表 | 扫描品控链路主表，与工单 1:N 关联 | `waybillSnapshotId`、`ticketId`、`qcRuleHitId` |
| `qc_rules` | 品控规则配置表 | **可配置**，不硬编码品控阈值 | — |
| `approval_thresholds` | 审批阈值配置表 | **可配置**，分级审批金额/超时动态生效 | — |
| `roles_permissions` | 角色权限表 | RBAC 权限定义 | — |

完整 schema：`prisma/schema.prisma`（含 18 个枚举类型）。

---

## 二、目录结构

```
v3-system/
├── app/                              # Next.js App Router
│   ├── api/                          # 14 组 API 路由（见第四节）
│   │   ├── auth/current-user/
│   │   ├── scan/
│   │   │   ├── create/
│   │   │   └── [scanRecordId]/quick-release/
│   │   ├── settings/
│   │   │   ├── approval-thresholds/
│   │   │   └── qc-rules/
│   │   ├── stats/dashboard/
│   │   ├── sync/
│   │   │   ├── status/
│   │   │   ├── trigger/
│   │   │   └── waybill/
│   │   ├── tickets/
│   │   │   ├── route.ts
│   │   │   ├── report/
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       ├── approve/
│   │   │       ├── execute/
│   │   │       └── resubmit/
│   │   └── webhook/v2-waybill-updates/
│   ├── scan/page.tsx                 # 扫描录入品控页面
│   ├── tickets/page.tsx              # 工单列表（支持分页/筛选/超时高亮）
│   ├── tickets/[id]/page.tsx         # 工单详情 + 审批流时间线
│   ├── report/page.tsx               # 报表统计页
│   ├── sync-monitoring/page.tsx      # V2 接口同步监控
│   ├── approval-thresholds/page.tsx  # 审批阈值配置
│   ├── qc-rules/page.tsx             # 品控规则配置
│   ├── layout.tsx                    # 全局 Layout (AppLayout + 字体)
│   ├── page.tsx                      # 首页 Dashboard
│   └── globals.css                   # Tailwind + 自定义工具类
├── components/ui/                    # 可复用 UI 组件
│   ├── AppLayout.tsx                 # 全局布局（Header + Sidebar + Main）
│   ├── AppRoleSwitcher.tsx           # 角色切换器（本地调试多角色用）
│   ├── Sidebar.tsx                   # 侧边栏导航（主色 #0fc6c2）
│   ├── PageHeader.tsx                # 页面标题栏
│   ├── DataTable.tsx                 # 通用数据表格（分页/排序/筛选）
│   ├── StatCard.tsx                  # 首页统计卡片
│   ├── StatusBadge.tsx               # 工单状态角标
│   ├── SeverityBadge.tsx             # 严重度角标
│   ├── TicketTimeline.tsx            # 工单审批流时间线
│   ├── ConfirmDialog.tsx             # 二次确认弹窗
│   ├── EmptyState.tsx                # 空状态占位
│   └── PermissionGate.tsx            # 权限门控（前端隐藏 + 后端校验）
├── lib/                              # 工具层 & 业务服务
│   ├── prisma.ts                     # Prisma Client 单例
│   ├── utils.ts                      # cn / formatMoney / formatDate / ticketNo / sha256 / requestId
│   ├── v2-api-client.ts              # ★ V2 API 客户端（4 个接口 + 超时 + 重试 + 降级）
│   ├── auth/
│   │   ├── user-context.ts           # 当前用户解析
│   │   └── permission-checks.ts      # 权限校验（自批自核禁止、越权拦截）
│   ├── rules/
│   │   ├── approval-rule-engine.ts   # ★ 分级审批规则引擎（读配置表，不硬编码）
│   │   └── qc-rule-engine.ts         # ★ 品控规则引擎（读配置表，命中可追溯）
│   └── services/
│       ├── ticket-state-machine.ts   # ★ 工单状态机（13 种事件 + 乐观锁 + 幂等键）
│       ├── scan-batch-machine.ts     # ★ 扫描批次状态机
│       ├── consistency-engine.ts     # ★ 一致性引擎（审批-赔付-库存链路校验）
│       ├── data-sync-service.ts      # V2 数据同步服务（实时+兜底）
│       └── background-jobs.ts        # 后台任务：超时自动流转 + 补偿重试
├── prisma/
│   ├── schema.prisma                 # 完整数据模型（11 表 + 18 枚举 + 索引）
│   └── seed.ts                       # 规模化测试数据（200+ 工单，覆盖全状态/全类型）
├── types/
│   └── index.ts                      # 共享 TypeScript 类型定义
├── docs/                             # 强制交付文档
│   ├── 需求理解与假设说明.md         # ★ 9 项留白设定 + 依据 + 待澄清问题清单
│   ├── 系统间接口契约.md             # ★ V2↔V3 接口列表 + 鉴权 + 超时重试 + 降级方案
│   └── REFLECTION.md                 # ★ 6 道反思题（资深工程师深度回答）
├── package.json
├── tsconfig.json                     # Strict: true + @/* 路径别名
├── next.config.js
├── tailwind.config.js                # 主色 #0fc6c2，8 级圆角，鲸天风格
├── postcss.config.mjs
├── vercel.json                       # 部署配置：hkg1 区域 + standalone + API 安全 headers
├── vitest.config.ts
├── .env.example                      # 环境变量模板
└── .gitignore
```

---

## 三、功能模块详解（对应题目 4 大模块）

### 模块零：扫描操作与品控检测

**入口页面**：`/scan` — 扫码或手输运单号、SKU、批次号。

**代码链路**：
1. `app/scan/page.tsx` → 用户提交 → `POST /api/scan/create`
2. `app/api/scan/create/route.ts`：
   - **真实性校验**：实时调用 `v2Client.verifySkuBelongs(shipmentId, skuCode)` — **必须过 V2 接口，不是本地快照查**
   - **幂等性判断**：`SELECT 1 FROM scan_records WHERE batchNo=? AND skuCode=? AND qcBatchStatus=LOCKED`，有未关闭 QC 工单 → 提示"该批次已存在未关闭品控工单"，只追加扫描记录，不新建工单
   - **品控规则引擎**：`qcRuleEngine.evaluate({ scanForm })` → 逐条匹配 qc_rules 配置表，记录命中的 ruleCode、判定依据、严重度
   - **异常 → 批次锁定 + 自动建工单**：命中规则后，scan_records.qcBatchStatus=LOCKED，事务内同步创建 `exception_tickets`（source=SCAN_TRIGGER，category=QC，直接进 L2_APPROVING，符合需求"QC 直接 L2"假设），写回 scan_records.ticket_id
   - **通过 → 批次 FREE**：未命中规则直接放行，q cBatchStatus = RELEASED
3. **误判快速放行**：`POST /api/scan/[scanRecordId]/quick-release`
   - 后端接口强制校验角色：`caller.roles.includes(QC_SUPERVISOR)`，非 QC 主管 403
   - 放行必须传 `releaseNote`（复核原因），留痕：`scan_records.qcSupervisorReleaseNote` + `qcSupervisorReleaseByUserId`
   - 工单状态从 L2_APPROVING 直接置 COMPLETED（绕过审批链），qcBatchStatus=RELEASED，**事务内同时生效**

### 模块一：异常工单上报

**入口**：工单列表页「新建上报」按钮（`app/tickets/page.tsx` 内 Dialog）。

**核心规则（后端强制校验，不是仅前端隐藏）**：
1. **真实性校验前置**：上报前实时调用 `v2Client.getShipment({ id/externalCode })`，V2 返回 exists=false → 拒绝上报（返回 404 + "运单不存在，请确认运单号是否正确"）。**不是查本地 waybill_snapshots**。
2. **归属校验（单租户假设 + 留档）**：当前为单租户部署，若未来支持多商户：users 表加 `warehouseCodes[]`，查询时 `AND waybill.warehouseCode IN (caller.warehouseCodes)`，详见《需求理解与假设说明》第⑤节。
3. **同类型未关闭工单幂等**：上报时 `SELECT id FROM exception_tickets WHERE relatedWaybillId=? AND category=? AND subType=? AND currentStatus NOT IN (COMPLETED, CLOSED_AUTO_DISMISSED)`，命中则 409 返回"该运单已有同类型未关闭工单 #T-xxxx"。
4. **AI 辅助分类（可选加分项，占位实现）**：若配置 `OPENAI_API_KEY`，`POST /api/tickets/report` 接口会附带 `aiSuggestedCategory / aiSuggestedSubType / aiSuggestedSeverity`，前端用「AI 建议，需人工确认」角标展示，用户可修改后再提交。AI 服务超时 3 秒内未返回 → 自动跳过，不阻塞主流程。

### 模块二：分级审批流程引擎（核心考点 3）

**状态转移图（完整 13 种转移事件）**：

```
                    ┌───────────────PENDING_TIMEOUT────────────────┐
                    ▼                                               │
 [PENDING_REVIEW] ──L1_ASSIGN──► [L1_APPROVING] ──L2_ASSIGN──► [L2_APPROVING]
       │  │              │  │                  │ │  ▲                │  │
       │  │              │  │ L1_APPROVE       │ │  │ QC_FORCE_L2    │  │ L2_APPROVE
       │  │              │  └────────►         │ │  │                │  └───────────────┐
       │  │              │            │        │ │  │ L2_TIMEOUT     │                  ▼
       │  │L1_TIMEOUT    │      [EXECUTING]    │ │  └────────►[CLOSED_AUTO_DISMISSED]  │
       │  └────────►     │            │        │ ▼                                [COMPLETED]
       │   [ESCALATED_AUTO]          │        └──L2_REJECT──►[PENDING_REVIEW]            ▲
       │         │                   │EXECUTE_DONE              ▲                          │
       │         └──L2_ASSIGN───────►└──────────────────────────┘                          │
       │                               L1_REJECT ────► [REJECTED_RESUBMIT] ──RESUBMIT────┘
       │                                                         │
       └──DISMISS_MAX_RESUBMIT──────────────────────────────────┘
```

**8 种异常分支的落地机制**：

| 异常分支 | 落地机制 | 代码位置 |
|---|---|---|
| **并发冲突处理** | 乐观锁 version 字段 + `P2025` 捕获 → 409 "该工单已被处理，请刷新" | `ticket-state-machine.ts:245-260` |
| **审批人禁用兜底** | 后台任务每次扫描：`users.disabledAt IS NOT NULL AND users.id IN (l1AssigneeId, l2AssigneeId)` 的工单 → 重新 assign 给 ADMIN 或随机同角色可用用户 | `background-jobs.ts` assignDisabledApprover() |
| **超时自动流转** | 同样后台任务 5 分钟跑一次：`deadlineAt < NOW()` → 按状态发 L1_TIMEOUT / L2_TIMEOUT / PENDING_TIMEOUT 事件 | `background-jobs.ts` processScheduledTimeouts() |
| **权限边界** | 5 角色 RBAC + 上报人≠审批人（`cannotApproveOwnTicket` 函数 403 拦截）+ 非本层级审批人接口级 403 | `permission-checks.ts` + `approve/route.ts:57-101` |
| **幂等性** | `approval_records.idempotencyKey` 唯一索引（`ticketId:event:actor:ts`）+ 赔付/库存关联审批记录 ID（重复写 P2002 去重） | `ticket-state-machine.ts:211-218, 293-317` |
| **金额阈值可配置** | `resolveApprovalLevel()` 查 `approval_thresholds` 表（GLOBAL / BY_CATEGORY / BY_SEVERITY 三层叠加），不是写死 `if > 500` | `approval-rule-engine.ts` |
| **QC 快速放行** | PermissionGate 角色限定 QC_SUPERVISOR + releaseNote 必填 + 操作写入 qcSupervisorReleaseByUserId | `quick-release/route.ts` |
| **重提次数上限** | resubmitCount 字段 + 环境变量 `MAX_RESUBMIT`（默认 3），超 3 次 DISMISS_MAX_RESUBMIT → 自动关闭 | `ticket-state-machine.ts:262-276` |

### 模块三：执行联动 —— 赔付 + 库存一致性（核心考点 4）

`POST /api/tickets/[id]/execute` 接口，**单事务包裹以下 4 件事**：

1. **工单状态** EXECUTING → COMPLETED（version 乐观锁 +1）
2. **审批记录**：创建 level=0 的执行记录，`action=APPROVED`，beforeStatus=EXECUTING，afterStatus=COMPLETED
3. **赔付记录**（按异常类型）：
   - **QC 类**：`direction = RECOVER_FROM_SUPPLIER`（向供应商追偿），按审批金额生成
   - **物流类（丢件/破损）**：`direction = PAY_TO_CUSTOMER`（赔付客户）
   - **物流类（地址错误/拒收）**：不赔付或 0 元赔付（内部责任）
4. **库存变动**（按异常子类型）：
   - 丢件 → `changeQty = -1`，`reason = LOGISTICS_LOST_RESHIP`
   - 退货入库 → `changeQty = +1`，`reason = LOGISTICS_RETURN_STOCK`
   - 重新发货 → `changeQty = -1`，`reason = LOGISTICS_RESHIP_NEW`
   - QC 放行 → `reason = QC_RELEASE`，批次同步解锁
   - QC 退供应商 → `reason = QC_REJECT_RETURN_SUPPLIER`，批次 → RETURNED_SUPPLIER
   - QC 降级处理 → `reason = QC_DOWNGRADE_SALE`，批次 → DOWNGRADED

**一致性保障三保险**：
1. **本地事务**：4 步在 `prisma.$transaction()` 里，任何一步失败全部回滚
2. **跨系统回写补偿**：事务 commit 后再调 `v2Client.markWaybillException()`，失败 → 写 sync_logs error。`background-jobs.ts` 每 5 分钟扫"已通过但 V2 未标记"的工单重试（有幂等键，不会重复写 V2 历史）
3. **一致性引擎校验**：`consistency-engine.checkTicketConsistency(ticketId)` 跑闭环断言（"QC 类工单完成后 direction 必须是 RECOVER_FROM_SUPPLIER，批次必须非 LOCKED"等），不通过打 ERROR 日志 + 触发告警，保证长期数据不出断链

### 模块四：工单列表与追踪

**列表页 `/tickets`**：
- 筛选：状态（多选）、异常类型（多选）、运单号（模糊搜）、审批人（我处理的 / 我上报的 / 全部）、上报时间范围
- 分页：`DataTable` 组件默认 pageSize=20，翻页流畅（seed 数据 200+ 条时 100ms 内响应）
- 超时高亮：`deadlineAt < now()` 行背景浅红 `bg-red-50`，右上角「即将超时」徽标
- 规模化：`prisma/seed.ts` 生成 200+ 条工单 + 400+ 条扫描 + 500+ 条审批记录 + 300+ 条赔付/库存，可直接压测

**详情页 `/tickets/[id]`**：
- 完整时间线：`TicketTimeline` 组件串联上报 → 审批通过/拒绝（含意见）→ 执行 → 完成，谁在什么时候做了什么一目了然
- 运单数据来源明确标注：右上角「数据来源：实时获取自 V2 @ 14:32:01」或「⚠️ 使用本地缓存，同步于 2 小时前（V2 不可用）」
- 审批按钮二次确认：`ConfirmDialog` + loading 状态 + 冲突 409 toast 提示，不会静默失败

### 模块五：跨系统接口监控

**监控页 `/sync-monitoring`**：
- 顶部 4 个统计卡：最近同步时间（waybill_snapshots MAX(syncedAt)）、近 24h 调用次数、近 24h 成功率、累计错误数
- 最近 50 条 sync_logs：按时间倒序，红色=错误，灰=重试，绿=成功；每条展示 interfaceName、耗时 ms、errorCategory（NETWORK_TIMEOUT / AUTH / NOT_FOUND / BAD_PARAM / V2_SERVER_ERROR / UNKNOWN），可按 Request ID 精准定位单次调用链
- 手动触发同步按钮：`POST /api/sync/trigger`，立即跑一次增量同步（ADMIN 权限）

---

## 四、API 路由一览

所有 API 返回格式统一：
```json
{ "ok": true, "data": {}, "requestId": "req_a1b2c3d4e5f6" }
{ "ok": false, "error": "中文错误信息", "code": "BAD_PARAM / TICKET_NOT_FOUND / CONFLICT / PERMISSION_DENIED / ...", "requestId": "..." }
```

所有跨系统调用（V2 API）**必带 x-request-id**，写入 sync_logs 表。

| 方法 | 路由 | 鉴权 | 作用 |
|---|---|---|---|
| **扫描品控** | | | |
| POST | `/api/scan/create` | WAREHOUSE_OPERATOR / QC_SUPERVISOR | 扫描录入 + 品控判定 + 异常自动建工单 |
| POST | `/api/scan/[scanRecordId]/quick-release` | QC_SUPERVISOR（仅限） | 误判快速放行，留痕必填 |
| **工单管理** | | | |
| GET | `/api/tickets?status=&category=&keyword=&page=&pageSize=` | 登录用户（按权限过滤） | 工单列表 + 筛选 + 分页 |
| POST | `/api/tickets/report` | WAREHOUSE_OPERATOR / QC_SUPERVISOR | 手工上报异常（实时 V2 接口校验运单存在性） |
| GET | `/api/tickets/[id]` | 权限范围内用户 | 工单详情（含时间线 + 运单快照 + 来源标注） |
| POST | `/api/tickets/[id]/approve?level=1\|2` | APPROVER_L1 / APPROVER_L2 | 通过/拒绝/升级审批（乐观锁并发控制） |
| POST | `/api/tickets/[id]/resubmit` | 原上报人 | 拒绝后重新提交（≤MAX_RESUBMIT 次） |
| POST | `/api/tickets/[id]/execute` | APPROVER_L2 + 执行权限 | 执行联动（事务内：状态+赔付+库存+批次解锁） |
| **同步 & 监控** | | | |
| GET | `/api/sync/status` | ADMIN / 只读 | 最近同步时间 + 24h 调用统计 + 成功率 |
| POST | `/api/sync/trigger` | ADMIN | 手动触发 V2 运单增量同步 |
| POST | `/api/sync/waybill` | WAREHOUSE_OPERATOR+ | 实时拉取指定运单并更新快照 |
| POST | `/api/webhook/v2-waybill-updates` | V2_WEBHOOK_SECRET 校验 | V2 推式增量回调（运单变更时 V2 主动调） |
| **设置** | | | |
| GET/POST | `/api/settings/approval-thresholds` | ADMIN | 查询/新增/修改分级审批阈值配置 |
| GET/POST | `/api/settings/qc-rules` | ADMIN | 查询/新增/修改品控规则配置 |
| **鉴权 & 统计** | | | |
| GET | `/api/auth/current-user` | 登录用户 | 当前登录用户信息 + 角色（用于 UI 渲染按钮显隐） |
| GET | `/api/stats/dashboard` | 登录用户（按权限聚合） | 首页统计：今日新增工单 / 待我审批 / 本周完成率 / 异常类型分布 |

---

## 五、技术栈 & 版本

| 组件 | 版本 | 用途 |
|---|---|---|
| Next.js | 14.2.5 | App Router + RSC，Server Actions 可扩展 |
| React | 18.3.1 | 客户端交互 |
| TypeScript | 5.5.4 | Strict: true，全链路强类型 |
| Prisma Client | 6.0.0 | ORM + 类型安全查询 |
| Prisma | 6.0.0 | Schema 管理 + 迁移 + db push |
| PostgreSQL | 15+ | V3 自有数据库（Neon / Supabase / Vercel Postgres 任选） |
| TailwindCSS | 3.4.14 | 样式 + 鲸天风格主题 |
| Zod | 3.23.8 | API 参数校验（前后端共用 schema） |
| Sonner | 1.7.0 | Toast 提示（成功/错误/警告） |
| Lucide React | 0.454.0 | 图标集 |
| Vitest | 2.1.3 | 单元测试（状态机 / 规则引擎可单独测） |
| class-variance-authority | 0.7.0 | UI 组件变体 |
| AI SDK + @ai-sdk/openai | 4.1.0 / 1.1.0 | 可选 AI 加分项：建议审批意见 + 异常分类（OPENAI_API_KEY 配置即启用） |

---

## 六、环境变量

文件：`.env.local`（复制 `.env.example` 修改）

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | V3 自有 Postgres 连接串（**不要用 V2 同一个库！**） | `postgresql://user:pwd@host:5432/v3_db?schema=public` |
| `V2_BASE_URL` | ✅ | V2 系统地址，用于接口调用 | `https://code20200605.vercel.app` |
| `V2_API_KEY` | ✅ | V2 对外接口的 32 位 API Key（V2 侧生成） | `v3sk_a1b2c3d4e5f678901234567890abcdef` |
| `NEXT_PUBLIC_V3_SYSTEM_NAME` | ❌ | 界面标题，默认「运单全流程管理 V3」 | `运单审批 V3 - 鲸天配套系统` |
| `OPENAI_API_KEY` | ❌ | 启用 AI 加分项（AI 建议分类/审批意见，失败自动降级不阻塞主流程） | `sk-...` |
| `MAX_RESUBMIT` | ❌ | 重提次数上限，默认 3（超过自动关闭） | `3` |
| `V3_WEBHOOK_SECRET` | ❌ | V2 推式 Webhook 的密钥（启用 V2→V3 回调时配置） | `whsec_xxx` |

**多租户 & 环境隔离提示**：V2 与 V3 必须是**两个独立 Vercel 项目**，`DATABASE_URL` 也必须指向两个完全不同的 Postgres 实例（即使同一个 Supabase 账号，也要建两个不同的 database）。

---

## 七、快速启动（本地开发）

### 前置条件

- Node.js ≥ 18.17（Next.js 14 要求）
- npm ≥ 9 或 pnpm ≥ 8
- 一个可用的 Postgres 15+ 数据库（本地 Docker 跑一个最快：`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine`）

### 一步步来

```bash
# 1. 进入项目
cd /Users/shaofan/Downloads/20260706/v3-system

# 2. 安装依赖（会自动执行 postinstall → prisma generate）
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local：
#   DATABASE_URL 指向你的 Postgres（新建一个叫 v3_db 的 database）
#   V2_API_KEY 填入 V2 给你生成的 key
#   V2_BASE_URL = https://code20200605.vercel.app（默认已配好）

# 4. 推送 schema 到数据库（原型阶段用 db push，更轻；生产阶段换成 db:migrate）
npm run db:push

# 5. 灌入规模化测试数据（200+ 工单 + 相关联记录）
npm run seed

# 6. 启动开发服务器
npm run dev
# 浏览器打开 http://localhost:3000
```

### 常用命令速查

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 http://localhost:3000 |
| `npm run build` | prisma generate + Next 生产构建（Vercel 部署会自动跑这个） |
| `npm run start` | 本地跑生产构建产物 |
| `npm run lint` | Next lint 检查 |
| `npm run seed` | 灌入规模化测试数据（可重复跑，会重置并重建） |
| `npm run db:push` | 推送 schema 变更到数据库（快速原型） |
| `npm run db:migrate --name xxx` | 创建 prisma 迁移文件（生产环境、CI/CD 用） |
| `npm run db:generate` | 手动重新生成 Prisma Client（一般 postinstall 自动跑） |
| `npm test` | 跑 Vitest 单元测试（状态机 / 规则引擎） |
| `npm run test:ui` | Vitest 浏览器 UI 模式，可视化看测试进度 |

---

## 八、文档索引（强制交付物位置）

阅卷检查时请按此清单查阅对应文档：

| 文档 | 路径 | 对应考点 |
|---|---|---|
| 《需求理解与假设说明》9 项留白 + 依据 | [docs/需求理解与假设说明.md](file:///Users/shaofan/Downloads/20260706/v3-system/docs/%E9%9C%80%E6%B1%82%E7%90%86%E8%A7%A3%E4%B8%8E%E5%81%87%E8%AE%BE%E8%AF%B4%E6%98%8E.md) | 考点 6（12 分） |
| 《系统间接口契约》接口列表 + 鉴权 + 降级 | [docs/系统间接口契约.md](file:///Users/shaofan/Downloads/20260706/v3-system/docs/%E7%B3%BB%E7%BB%9F%E9%97%B4%E6%8E%A5%E5%8F%A3%E5%A5%91%E7%BA%A6.md) | 考点 5（15 分） |
| 反思题回答 6 道 | [docs/REFLECTION.md](file:///Users/shaofan/Downloads/20260706/v3-system/docs/REFLECTION.md) | 考点 9（0 分，参考） |
| 数据模型定义 | [prisma/schema.prisma](file:///Users/shaofan/Downloads/20260706/v3-system/prisma/schema.prisma) | 考点 4（15 分） |
| 工单状态机 + 乐观锁 + 幂等 | [lib/services/ticket-state-machine.ts](file:///Users/shaofan/Downloads/20260706/v3-system/lib/services/ticket-state-machine.ts) | 考点 3（20 分） |
| V2 API 客户端 + 重试 + 降级 + 日志 | [lib/v2-api-client.ts](file:///Users/shaofan/Downloads/20260706/v3-system/lib/v2-api-client.ts) | 考点 5（15 分） |
| 一致性引擎（审批-赔付-库存闭环） | [lib/services/consistency-engine.ts](file:///Users/shaofan/Downloads/20260706/v3-system/lib/services/consistency-engine.ts) | 考点 4（15 分） |
| 品控规则引擎（可配置 + 可追溯） | [lib/rules/qc-rule-engine.ts](file:///Users/shaofan/Downloads/20260706/v3-system/lib/rules/qc-rule-engine.ts) | 考点 7（15 分） |
| 审批通过接口（并发/权限/状态机） | [app/api/tickets/[id]/approve/route.ts](file:///Users/shaofan/Downloads/20260706/v3-system/app/api/tickets/%5Bid%5D/approve/route.ts) | 考点 3 |
| 扫描录入接口（V2 真实性校验 + 幂等 + QC 批次锁） | [app/api/scan/create/route.ts](file:///Users/shaofan/Downloads/20260706/v3-system/app/api/scan/create/route.ts) | 考点 5 + 考点 7 |

---

## 九、测试建议（验证 7 大核心考点）

本地启动后建议按以下用例逐一验证（每一条对应一个评分要点）：

### 考点 1 & 5：真实对接 V2
1. 扫描页输入一个**真实存在于 V2 的运单号** + SKU → 应成功（V2 接口实时校验通过）
2. 扫描页输入一个**完全瞎编的运单号** → 应提示"运单不存在"（404，V2 接口校验失败），**不会**静默创建本地假数据

### 考点 2：UI 交互体验
3. 打开两张同一待审批工单 → 同时点「L1 通过」→ 第一张成功 200，第二张 409 "该工单已被处理，请刷新"，清晰 toast 提示
4. 用上报人账号登录 → 打开自己上报的工单详情 →「审批通过」按钮被禁用 + 悬停提示「不能审批自己上报的工单」（前端不隐藏只是禁用，后端接口也会 403 拦截双重保障）

### 考点 3 & 4：状态机 + 一致性
5. 创建一张金额 300 元的物流异常工单 → 进入 L1 审批 → 通过 → 生成赔付记录（方向=PAY_TO_CUSTOMER）+ 库存扣减，工单状态 COMPLETED
6. 创建一张金额 600 元的物流异常工单 → 直接进入 L2 审批（阈值 > 500 需 L2）→ 证明可配置分级生效
7. 创建一张 QC 类异常（扫描触发）→ 即使金额 50 元也直接进 L2 审批 → 通过后批次从 LOCKED → RELEASED，赔付方向=RECOVER_FROM_SUPPLIER，赔付方向二分式正确
8. 同一 QC 批次重复扫描 3 次 → 只生成 1 张工单，3 条 scan_records 行，ticket_id 全部指向同一张，前端提示"该批次已存在未关闭品控工单"

### 考点 6 & 7：配置驱动 & 品控规则
9. 登录 ADMIN → 打开「审批阈值」→ 把全局 L2 门槛 500 改成 2000 → 新建一张 600 元工单 → 这次只进 L1（阈值已生效），证明可配置、非硬编码
10. QC 主管角色登录 → 对一张 QC 暂扣批次点「误判快速放行」→ 必须填 releaseNote → 批次立即解锁 + 工单 COMPLETED + releaseNote+releaseByUserId 留痕（非静默）

### 规模化场景
11. `npm run seed` 后打开工单列表 → 至少 200 条数据展示流畅，翻页 / 按状态筛选 / 运单号模糊搜索全部可操作

---

## 十、Vercel 部署步骤（独立于 V2 的新项目）

### Step 1：创建 GitHub 仓库并 Push 代码

```bash
# 如果尚未初始化（部署脚本第 11 节会自动处理，也可以手动）
cd /Users/shaofan/Downloads/20260706/v3-system
git init -b main
git add -A && git commit -m "feat(v3): init v3 waybill approval system"
git remote add origin https://github.com/qizihua1/20260706.git
git push -u origin main
```

### Step 2：Vercel 控制台 Import Project

1. 打开 <https://vercel.com/new> 登录
2. **Import Git Repository** → 选 `qizihua1/20260706` 仓库
3. Framework Preset：会自动识别为 **Next.js**（不用改）
4. Root Directory：**必须改为 `v3-system/`**（仓库根目录有一层 v3-system 子目录，默认会读根目录 → 找不到 package.json 构建失败！）
5. Build Command / Output Directory / Install Command：保持默认即可（`vercel.json` 已覆盖配置）

### Step 3：配置 Environment Variables（Deploy 前必须先填好）

在 **Configure Project → Environment Variables** 部分添加：

| KEY | VALUE | Environment |
|---|---|---|
| `DATABASE_URL` | 推荐点击「Add Storage」→ 新建 Vercel Postgres（免费 Postgres Lite 额度足够），选择「Connect to Project」，DATABASE_URL 会自动注入，手动复制也行 | Production + Preview + Dev 全勾 |
| `V2_BASE_URL` | `https://code20200605.vercel.app` | 全勾 |
| `V2_API_KEY` | `v3sk_a1b2c3d4e5f678901234567890abcdef` ← **替换为 V2 实际给你的 key**（V2 系统管理员在 V2 后台 API Key 管理页生成） | 全勾，记得 Encrypt |
| `NEXT_PUBLIC_V3_SYSTEM_NAME` | `运单全流程管理 V3`（或自定义） | 全勾 |
| `OPENAI_API_KEY` | **可选**，配了就启用 AI 加分项（分类/审批建议） | 全勾，Encrypt |

### Step 4：Deploy

点击「Deploy」→ 等待构建（Vercel 会自动跑 `npm ci --include=dev` + `prisma generate` + `next build`）。
- 首次部署如果因为数据库没初始化 Build 失败 → 解决：进入 Project → **Settings → Git**，临时把 Build Command 改为 `prisma generate && prisma db push --accept-data-loss && next build` 触发部署一次（建表），构建成功后再改回默认 Build Command（因为后续代码变更不该再跑 db push，该换成 migrate）。
- 或者：本地先 `npm run db:push`（指向 Vercel Postgres 的 DATABASE_URL），把表结构建好，再部署。

### Step 5：初始化测试数据（可选）

部署成功后访问 `<Vercel URL>/api/auth/current-user` 应正常返回 JSON。
如需要灌测试数据：本地改 `.env.local` 的 DATABASE_URL 为 Vercel Postgres 连接串，然后 `npm run seed`（本地直接连远程库灌数据，也可用 Vercel CLI：`vercel env pull .env.local` + `vercel dev` 在本地用生产环境变量跑 seed）。

### Step 6：验证 Checklist

部署完成后按「第九节测试建议」过一遍，尤其是考点 1（真实 V2 对接）和考点 2（并发冲突/权限提示无静默失败）。

---

## 十一、代码提交 & GitHub 仓库（交付第 14 项）

仓库地址：`https://github.com/qizihua1/20260706`（独立仓库，非 V2 code20200605 子目录）

```bash
# 完整操作（已在当前目录执行）：
cd /Users/shaofan/Downloads/20260706/v3-system
git init -b main
git add -A
git commit -m "feat(v3): 初始化运单全流程管理 V3
- 独立部署 Next.js 14 + Prisma 6 + Postgres 架构
- 11 张核心表 + 18 个枚举 + 双状态机分离设计
- V2 API 客户端（4接口 + 10s超时 + 2次指数退避重试 + 全链路日志）
- 工单审批状态机（8态13事件 + 乐观锁version + 幂等键 + 并发409）
- 品控扫描状态机 + QC规则引擎 + 批次锁定幂等 + 快速放行留痕
- 一致性引擎（审批-赔付-库存三表事务 + 跨系统补偿重试）
- 可配置审批阈值 + 可配置品控规则（非硬编码）
- 赔付方向二分式（品控=向供应商追偿 / 物流=赔付客户）
- 规模化seed脚本：200+工单/400+扫描/500+审批记录
- 同步监控页 + RequestID 全链路追踪 + V2 降级提示
- docs：需求假设说明(9项留白+依据) / 接口契约 / REFLECTION(6道反思题)"
git remote add origin git@github.com:qizihua1/20260706.git  # 或 https
git push -u origin main
```

---

## 十二、与 V2 系统的关系说明

| 维度 | V2（code20200605） | V3（本仓库） |
|---|---|---|
| 部署 | 独立 Vercel 项目 | **独立 Vercel 项目**，非子路径 |
| 数据库 | 独立 Postgres | **独立 Postgres**，不同库、不同连接串 |
| 技术栈 | Next.js 14 + Prisma + Tailwind | 相同（保持技术一致性，V2 团队成员可直接上手 V3） |
| UI 风格 | 鲸天风格，主色 #0fc6c2 | 相同（Tailwind 主题一致） |
| 数据互通方式 | 暴露对外 API，提供运单查询/异常回写 | 纯调用方，**不直接连 V2 DB**，所有 V2 数据走 HTTP 接口 |
| 业务职责 | 运单录单解析 + 运单生命周期主数据管理 | 扫描品控 + 异常工单审批 + 赔付/库存执行联动 |
| 接口鉴权 | 校验 x-api-key = V3 提供的密钥 | 调用时带 x-api-key，webhook 带签名 |
| 上线优先级 | 已有，V3 依赖方 | 后上线，**上线不影响 V2 现有任何调用方**（接口新增、复用 URL 零） |

---

## License

项目代码：私有（内部交付物）。
文档（`docs/` 目录下所有 markdown）：与项目一同归档。
