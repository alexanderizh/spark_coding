# 返回列表后重进会话无法连接：联合排查计划

## Summary
- 目标：定位 mobile 从会话详情返回列表后再次进入详情时，界面长期停留“主机名获取中 / 连接中”的根因。
- 范围：仅做联合排查（mobile + server + desktop），先不改代码；输出可复现的时序证据与根因结论。
- 成功标准：给出明确“卡住点”所在层（mobile / server / desktop / 跨端时序），并给出最小修复方案候选（不实施）。

## Current State Analysis
- 当前 mobile 端存在“返回列表触发全局重建”的逻辑：
  - [home_screen.dart didPopNext](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/screens/home_screen.dart#L52-L57)
  - [main.dart RestartableProviderScope](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/main.dart#L30)
  - [app_restart.dart](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/app/app_restart.dart#L1-L44)
- mobile 会话详情“连接中”判定依赖 `session.agentConnected` 与 `session.state`：
  - [_connectOnEnter / _getEffectiveStatus](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/screens/terminal_screen.dart#L154-L245)
  - [SessionNotifier onSessionState](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/providers/session_provider.dart#L41-L68)
  - [SocketService onConnect -> mobile:join](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/mobile/lib/services/socket_service.dart#L232-L243)
- server 端关键时序点：
  - [onMobileJoin](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/server/src/socket/relay.controller.ts#L426-L510)
  - [onDisconnect](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/server/src/socket/relay.controller.ts#L204-L254)
  - [broadcastState](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/server/src/socket/relay.controller.ts#L621-L637)
  - [updateDeviceStatus / updateAllSessionsDeviceStatus](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/server/src/service/session.service.ts#L124-L149)
- desktop 端“返回列表”仅页面切换，不会上报离开事件：
  - [App.tsx page 切换](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/desktop/src/renderer/App.tsx#L17-L49)
  - [Session.tsx unmount 仅本地清理](file:///Users/zhangyang/spark_ai_project/spark_coding/apps/desktop/src/renderer/pages/Session.tsx#L121-L128)

## Proposed Changes (Plan Only, No Code Edit)
- `apps/mobile/**`（排查）
  - 做一次严格复现实验：终端页进入 -> 返回列表 -> 再次进入终端页。
  - 抓取关键日志序列：`_openLink`、`_connectOnEnter`、`mobile:join`、`session:state`、`session:pair`、`_getEffectiveStatus`。
  - 目标：确认 mobile 是否已发出 join、是否收到包含 `agentConnected=true` 的 state。

- `apps/server/**`（排查）
  - 对同一时段日志做时序对齐：`onDisconnect` / `onMobileJoin` / `broadcastState`。
  - 重点验证两个高风险竞态：
    - 旧 socket 的 disconnect 是否把新 `mobileSocketId` 置空。
    - `updateAllSessionsDeviceStatus` 后是否存在未广播导致 mobile 看见陈旧状态。
  - 目标：确认服务端是否把会话状态错误广播为 waiting/disconnected。

- `apps/desktop/**`（排查）
  - 核对详情返回列表时是否存在应同步未同步动作（目前无离开上报）。
  - 核对 desktop 连接状态日志与 server 接收时序是否一致（是否存在“agent 端在线但 session state 未更新”）。

- 工作区现状核查（排查）
  - 记录当前未提交变更（含 mobile restart 相关改动）对复现结果的影响，避免把“诊断改动副作用”误判为根因。
  - 在不改代码前提下，先基于现状给出根因结论；代码回滚动作不在本阶段执行。

## Assumptions & Decisions
- 决策1：当前阶段严格执行“先检查不改代码”，仅做读操作与日志/代码证据分析。
- 决策2：将“撤回代码”纳入下一阶段动作，待根因定位完成后再执行，避免排查过程中丢失可用线索。
- 假设1：问题主要是跨端状态时序不一致，而非单一 UI 展示缺陷。
- 假设2：复现路径固定为“terminal -> home -> terminal（同一已配对连接）”。

## Verification Steps
- 复现一致性：至少 2 轮复现得到同样症状与相同时序特征。
- 时序闭环：mobile 发起事件、server 收到与广播、mobile/desktop 接收三侧时间线可对齐。
- 根因判定：给出单一主因或主因+次因，并附对应源码与日志证据。
- 输出物：
  - 根因报告（含时间线、证据点、影响范围）
  - 修复候选清单（最小改动优先，暂不实施）

