# Mobile 多链接连接管理改造计划

## Summary

目标是在 mobile 端把首页改为“连接管理页”，支持维护多个连接（当前仅 `claude` 类型），并在刷新时按“主机端 agent 在线即连接存在”判定状态；点击连接进入现有对话页时，先让主机端检测 Claude 是否运行，未运行则拉起后再进入会话交互。

已确认的产品决策：
- 刷新策略：进入页面自动触发 + 手动下拉刷新
- 离线展示：在线/离线分组展示
- 进入连接：直接进入现有对话页
- 类型策略：先内置枚举并预留扩展
- 去重策略：同主机同类型自动覆盖旧连接

## Current State Analysis

### 1) mobile 现状
- 路由入口在 `apps/mobile/lib/app/router.dart`，`/` 当前绑定 `HomeScreen`，`/terminal` 为现有对话页。
- `HomeScreen`（`apps/mobile/lib/screens/home_screen.dart`）是“扫码 + 重连上次会话”的单连接启动页。
- `ScannerScreen`（`apps/mobile/lib/screens/scanner_screen.dart`）扫码后会覆盖式保存一组会话凭据（`SessionService.save`），然后直接连到 `/terminal`。
- `SessionService`（`apps/mobile/lib/services/session_service.dart`）仅支持单连接字段：`serverUrl/token/sessionId`，不支持连接列表。
- 连接状态主要通过 socket 会话回流：`SocketService` + `connection_provider.dart` + `session_provider.dart`。

### 2) server / agent 现状
- server REST `GET /api/session/:token`（`apps/server/src/controller/session.controller.ts`）可返回 `agentConnected/mobileConnected/state`，可用于“连接是否存在”的刷新检查。
- server WS 中继（`apps/server/src/socket/relay.controller.ts`）已具备 mobile→agent、agent→mobile 的转发能力，但没有“确保 Claude 已启动”的专用事件。
- terminal agent（`apps/terminal/src/socket/socket-client.ts`）和 desktop agent（`apps/desktop/src/main/terminal-bridge.ts`）当前仅在 `session:pair` 时启动 Claude；已有进程存活判断能力（terminal 侧 `PtyManager.isAlive()`）。

## Proposed Changes

### A. 共享协议扩展（可扩展到多 CLI 类型）

1. 修改 `packages/shared/src/protocol.ts`
- 新增 `CliType`（先包含 `claude`）。
- 新增事件：
  - `runtime:ensure`（mobile 请求 agent 确保某类型 CLI 运行）
  - `runtime:status`（agent 回执是否已运行/已拉起/启动失败）
- 新增 payload 类型：
  - `RuntimeEnsurePayload`：`sessionId`、`cliType`
  - `RuntimeStatusPayload`：`sessionId`、`cliType`、`ready`、`started`、`message?`、`timestamp`

2. 修改 `packages/shared/src/index.ts`
- 导出新增类型与事件常量，确保 server/mobile/agent 三端一致复用。

### B. server 支持连接列表刷新信息与 runtime 事件中继

1. 修改 `apps/server/src/controller/session.controller.ts`
- 扩展 `GET /api/session/:token` 返回字段，增加 `agentHostname`（卡片主标题需要主机名）。

2. 修改 `apps/server/src/socket/relay.controller.ts`
- 新增 mobile 侧 `runtime:ensure` 事件处理：
  - 校验角色为 mobile；
  - 校验 session 与 agent 在线；
  - 转发给该 session 的 agent socket。
- 新增 agent 侧 `runtime:status` 事件处理：
  - 校验角色为 agent；
  - 转发回该 session 的 mobile socket。
- 失败路径统一通过 `session:error` 或 `runtime:status.ready=false` 返回可消费信息。

### C. terminal / desktop agent 支持“进入会话时确保 Claude 运行”

1. 修改 `apps/terminal/src/socket/socket-client.ts`
- 监听 `runtime:ensure`：
  - 当 `cliType=claude`：
    - 若 `pty.isAlive()` 为 true：回执 `ready=true, started=false`
    - 若未运行：调用 `pty.spawn(config)`，成功回执 `ready=true, started=true`，失败回执 `ready=false`
- 保持现有 `session:pair` 启动逻辑，确保首次配对和二次进入都可工作（幂等）。

2. 修改 `apps/desktop/src/main/terminal-bridge.ts`
- 同步监听 `runtime:ensure` 并按 `ptyProcess` 存活状态执行同等逻辑，保证 desktop host 与 terminal host 行为一致。

### D. mobile 连接模型与持久化重构（单连接 → 多连接）

1. 新增/改造模型文件（建议新增 `apps/mobile/lib/models/connection_link_model.dart`）
- 定义连接实体：
  - `id`（本地唯一）
  - `serverUrl/token/sessionId`
  - `cliType`（枚举，当前 `claude`）
  - `hostName`（可空，刷新后补齐）
  - `status`（online/offline/unknown）
  - `lastCheckedAt`
- 定义去重键：`hostName + cliType`（有主机名时）；主机名未知阶段先按 `sessionId/token` 暂存，刷新后归并。

2. 修改 `apps/mobile/lib/services/session_service.dart`
- 新增连接列表存储（JSON 数组）；
- 保留现有 deviceId / 字体配置逻辑；
- 替换单连接 `save/clear/restore` 为多连接接口：
  - `saveOrUpdateLink(...)`
  - `getAllLinks()`
  - `setActiveLink(...)`
  - `getActiveLink()`
  - `removeLink(...)`
- 扫码保存时按“同主机同类型自动覆盖”归并。

### E. mobile 首页改为连接管理页

1. 新增 provider（建议 `apps/mobile/lib/providers/link_provider.dart`）
- 职责：
  - 读取本地连接列表；
  - 进入页面触发 refresh；
  - 对每个连接调用 `GET /api/session/:token` 检测 agent 在线；
  - 回填 `hostName` 与在线状态；
  - 产出 online/offline 分组数据。

2. 修改 `apps/mobile/lib/screens/home_screen.dart`
- UI 从“单连接动作页”改为“连接列表首页”：
  - 顶部：标题 + 扫码新增入口
  - 主体：在线分组、离线分组卡片列表（卡片主标题=主机名）
  - 状态：在线/离线可视化标记
  - 下拉刷新：触发状态检测
- 点击卡片：
  - 设置 active link；
  - 建立 socket 连接；
  - 发送 `runtime:ensure`（claude）；
  - 直接进入 `/terminal`。

3. 修改 `apps/mobile/lib/screens/scanner_screen.dart`
- 扫码成功后不再仅覆盖“唯一会话”，改为新增/更新到连接列表；
- 保存后返回首页列表（或直接进入新连接对话，保持当前交互一致性：建议继续直接进入）。

### F. mobile 会话页接入 runtime ready 流

1. 修改 `apps/mobile/lib/services/socket_service.dart`
- 新增 `runtime:status` 入站监听与 typed stream；
- 新增 `sendRuntimeEnsure(cliType)` 出站方法。

2. 修改 `apps/mobile/lib/screens/terminal_screen.dart`
- `initState` 或进入时机触发 `sendRuntimeEnsure('claude')`；
- 监听 `runtime:status`：
  - `ready=true`：正常交互；
  - `ready=false`：显示可重试提示，不中断页面结构。

3. 视情况调整 `apps/mobile/lib/providers/session_provider.dart` / `connection_provider.dart`
- 保持当前连接状态机兼容，避免把“agent 在线”和“claude 运行”混为同一状态字段。

### G. 路由与导航调整

1. 修改 `apps/mobile/lib/app/router.dart`
- 保持 `/` 作为首页，但语义从启动页变为连接管理页。
- `/terminal` 路由守卫改为依赖“active link 存在”+“连接态”组合，避免误跳。

## Assumptions & Decisions

- 连接“存在”定义：仅以主机端 agent 是否在线判断，不依赖 Claude 进程状态。
- Claude 启动保障时机：每次进入会话都发送一次 `runtime:ensure`，agent 侧幂等处理。
- 当前仅实现 `claude`，但协议与 mobile 数据结构按可扩展 CLI 类型设计。
- 同主机同类型冲突策略：自动覆盖旧连接（按用户确认）。
- 为保证 hostName 卡片标题可用，服务端 REST 状态接口扩展 `agentHostname` 字段。

## Verification Steps

1. 协议与编译验证
- `packages/shared` 类型导出无 TS 错误；
- server/terminal/desktop/mobile 对新增事件编译通过。

2. 连接管理页功能验证（mobile）
- 扫码新增多个不同主机连接可展示；
- 进入首页自动刷新一次；下拉刷新可再次检测；
- 在线/离线分组正确；
- 卡片标题显示主机名；
- 同主机同类型再次扫码会覆盖旧连接。

3. 会话进入与 Claude 保活验证
- 点击在线连接进入 `/terminal`，触发 `runtime:ensure`；
- Claude 未运行时可自动拉起并收到 `runtime:status.ready=true, started=true`；
- Claude 已运行时返回 `started=false`；
- 启动失败时 mobile 可见错误并支持重试。

4. 回归验证
- 现有终端输入输出、提示词检测、断线重连不回退；
- 路由重定向与返回键行为保持预期；
- 执行项目格式化/静态检查与移动端测试命令，确认无新增问题。
