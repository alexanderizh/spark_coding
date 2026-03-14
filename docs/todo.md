# Todo List

## 当前版本（v1.0 MVP）

### 环境准备
- [ ] 确认 Node.js 18+ 已安装
- [ ] 确认 Yarn 已安装（`yarn --version`）
- [ ] 确认 Claude CLI 已安装并配置 API Key（`claude --version`）
- [ ] Windows 用户：安装 Visual Studio Build Tools（node-pty 编译需要）

### 安装与构建
- [ ] 执行 `yarn install`（根目录）
- [ ] 执行 `yarn build:shared`（编译共享协议包）
- [ ] 验证服务端能编译：`yarn build:server`
- [ ] 验证终端代理能编译：`yarn build:terminal`

### 服务端验证
- [ ] 启动服务端：`yarn dev:server`
- [ ] 验证 REST 接口：`curl -X POST http://localhost:7001/api/session`
- [ ] 验证 Socket.IO 连接（wscat 或 Postman WebSocket）
- [ ] 验证二维码图片：浏览器打开 `http://localhost:7001/api/session/<token>/qr.png`

### 终端代理验证
- [ ] 启动终端代理：`yarn dev:terminal`
- [ ] 确认终端显示 ASCII 二维码
- [ ] 确认终端代理成功连接服务端（无错误日志）

### 手机端验证
- [ ] 执行 `flutter pub get`（在 apps/mobile 目录）
- [ ] 执行 `flutter create . --project-name remote_claude_mobile`（补全脚手架）
- [ ] 执行 `flutter run` 启动 App
- [ ] 验证 QR 扫描功能（相机权限授予）
- [ ] 验证终端界面显示
- [ ] 验证输入工具栏快捷键

### 端到端联调
- [ ] 完整流程测试：启动服务端 → 启动终端代理 → 手机扫码 → 配对成功
- [ ] 在手机上输入 `echo hello` → 确认终端回显
- [ ] 触发 Claude 权限提示 → 确认手机弹出 Overlay
- [ ] 点击 YES/NO → 确认主机 Claude 收到输入
- [ ] 测试 Ctrl+C 中断（快捷键工具栏）
- [ ] 测试 /clear 命令（快捷键工具栏）

### 断线重连测试
- [ ] 手机断网 → 确认终端代理日志显示 mobile_disconnected
- [ ] 手机恢复网络 → 确认重连并恢复终端内容
- [ ] 终端代理断网 → 确认手机显示 agent_disconnected 状态
- [ ] 终端代理恢复 → 确认手机重连

---

## 近期待办（v1.1）

### 生产化
- [ ] 编写 Dockerfile（server）
- [ ] 编写 docker-compose.yml（server + 数据卷）
- [ ] 配置 nginx 反向代理 + WebSocket 升级
- [ ] 编写 PM2 ecosystem.config.js
- [ ] 测试 HTTPS 环境下 WebSocket 连接

### 体验优化
- [ ] 终端字体大小设置持久化
- [ ] 横屏模式终端尺寸自动适配
- [ ] Claude 检测模式更新（跟踪 Claude CLI 最新版本输出格式）
- [ ] 手机 App 图标设计

### 文档补充
- [ ] 补充 API 接口文档（OpenAPI / Swagger）
- [ ] 补充 Socket.IO 事件时序图
- [ ] 编写贡献指南

---

## 已完成 ✅

- [x] Monorepo 结构搭建（package.json + tsconfig.base.json）
- [x] packages/shared：协议类型、事件常量、会话枚举、Claude 提示词枚举
- [x] 服务端：Session 实体、SessionService、QrService
- [x] 服务端：REST 控制器（POST /api/session、GET /api/session/:token、GET qr.png）
- [x] 服务端：Socket.IO 中继控制器（角色认证、事件路由、状态机）
- [x] 服务端：MidwayJS 配置（configuration.ts、config.default.ts）
- [x] 终端代理：参数解析（Commander）
- [x] 终端代理：会话创建（POST /api/session）
- [x] 终端代理：ASCII 二维码显示
- [x] 终端代理：PTY 管理器（node-pty + 16ms 批处理 + 1MB 环形缓冲）
- [x] 终端代理：Claude 提示词检测器（正则 + 滚动缓冲 + 防抖）
- [x] 终端代理：Socket.IO 客户端（重连 + 心跳 + 事件路由）
- [x] 手机端：Flutter 项目配置（pubspec.yaml + 主题）
- [x] 手机端：路由（go_router）
- [x] 手机端：数据模型（SessionModel、ClaudePromptModel）
- [x] 手机端：Socket 服务（SocketService）
- [x] 手机端：会话持久化服务（SessionService + shared_preferences）
- [x] 手机端：Riverpod Providers（Connection、Terminal、Session、Prompt）
- [x] 手机端：四个页面（Home、Scanner、Terminal、Settings）
- [x] 手机端：核心 Widgets（TerminalView、InputToolbar、PromptOverlay、ConnectionBadge）
- [x] 手机端：Android 配置（AndroidManifest + network_security_config）
- [x] 手机端：iOS 配置（Info.plist + Podfile）
- [x] 文档：README、项目说明、启动文档、实现计划、后期 Roadmap、Todo
