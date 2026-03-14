# 实现计划文档

## 项目背景

参考开源项目 [Happy Coder](https://github.com/slopus/happy) 的核心思路，构建一套本地化、可自部署的远程 Claude CLI 控制系统。

Happy Coder 技术分析要点：
- TypeScript monorepo（Yarn Workspaces）
- Fastify + Socket.IO 服务端
- Expo（React Native）手机端
- 端到端加密（XSalsa20-Poly1305 / AES-256-GCM）
- 公钥认证（无密码）

本项目选型差异：
- 服务端：MidwayJS（IoC + 装饰器，更符合 Java 风格开发习惯，内置 Socket.IO 模块）
- 手机端：Flutter（单代码库覆盖 iOS/Android，性能更接近原生）
- 加密：暂不实现 E2E 加密，通过 token 认证 + HTTPS（生产）保障安全

---

## 技术选型决策

### 为什么用 node-pty 而非 child_process.spawn

Claude CLI 检测 `process.stdout.isTTY`：
- `spawn()` → Pipe → isTTY = false → 非交互模式（所有提示词消失）
- `node-pty` → PTY → isTTY = true → 完整交互模式

### 为什么输出要批处理（16ms）

PTY onData 事件可能每毫秒触发数次，若直接 emit 会导致：
- socket 帧过多，移动网络压力大
- 手机 xterm 频繁重绘，性能差

16ms 批次（~60fps）在流畅度和性能之间取得平衡。

### 为什么服务端用 SQLite 而非 PostgreSQL

开发阶段零配置，单文件数据库，足以支撑会话管理（无高并发需求）。生产部署可替换为 PostgreSQL（TypeORM 切换数据源配置即可）。

### 为什么 Flutter 用 Riverpod 而非 Provider/Bloc

- Riverpod 2.x 编译期类型安全，无运行时 context 依赖
- StateNotifierProvider 天然适配终端流式数据更新
- 比 Bloc 更轻量，适合此类实时数据流场景

---

## 实现阶段

### Phase 1：基础设施 ✅

- [x] Monorepo 根配置（package.json + tsconfig.base.json）
- [x] packages/shared：协议类型、事件常量、枚举
- [x] Server：session.entity.ts + TypeORM 配置
- [x] Server：session.service.ts（CRUD + 过期判断）
- [x] Server：session.controller.ts（REST 接口）
- [x] Server：relay.controller.ts（Socket.IO 核心中继）
- [x] Server：configuration.ts + config.default.ts

### Phase 2：终端代理 ✅

- [x] terminal/utils/config.ts（Commander 参数解析）
- [x] terminal/session/session-manager.ts（POST /api/session）
- [x] terminal/session/qr-display.ts（ASCII 二维码渲染）
- [x] terminal/pty/pty-manager.ts（node-pty + 批处理 + 环形缓冲）
- [x] terminal/pty/prompt-detector.ts（Claude 提示词正则检测）
- [x] terminal/socket/socket-client.ts（Socket.IO 客户端 + 重连）
- [x] terminal/src/index.ts（启动编排）

### Phase 3：Flutter 手机端 ✅

- [x] pubspec.yaml（依赖配置）
- [x] main.dart + router.dart（应用入口 + 路由）
- [x] models：SessionModel、ClaudePromptModel
- [x] services：SocketService、SessionService
- [x] providers：ConnectionProvider、TerminalProvider、SessionProvider、PromptProvider
- [x] screens：HomeScreen、ScannerScreen、TerminalScreen、SettingsScreen
- [x] widgets：TerminalView、InputToolbar、PromptOverlay、ConnectionBadge
- [x] Android：AndroidManifest.xml、network_security_config.xml
- [x] iOS：Info.plist（相机权限 + 本地网络权限）

### Phase 4：待完成（见 roadmap.md）

- [ ] 依赖安装 + 本地集成测试
- [ ] 断线重连场景验证
- [ ] 生产部署配置（HTTPS + PM2 / Docker）
- [ ] E2E 加密（可选）

---

## 关键文件优先级

实现顺序与依赖关系：

```
packages/shared/src/protocol.ts          ← 最先，所有端依赖它
    ↓
apps/server/src/entity/session.entity.ts
apps/server/src/service/session.service.ts
    ↓
apps/server/src/controller/session.controller.ts
apps/server/src/socket/relay.controller.ts  ← 核心，状态机在这里
    ↓
apps/terminal/src/pty/pty-manager.ts     ← PTY 环境变量决定 Claude 交互性
apps/terminal/src/pty/prompt-detector.ts ← 正则质量决定手机 UX 质量
apps/terminal/src/socket/socket-client.ts
    ↓
apps/mobile/lib/services/socket_service.dart  ← 所有 provider 依赖它
apps/mobile/lib/providers/terminal_provider.dart
apps/mobile/lib/widgets/terminal_view.dart
```

---

## 接口契约（冻结）

一旦 Phase 1-3 完成，以下接口不应随意修改（影响三端兼容性）：

1. Socket.IO 事件名（`Events` 常量）
2. 各事件 Payload 结构
3. QR 码 URL 格式：`sparkcoder://pair?token=TOKEN&server=SERVER_URL`
4. REST 接口路径与响应格式：`POST /api/session`、`GET /api/session/:token`
