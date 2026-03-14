# 项目说明文档

## 背景与目标

### 问题场景

开发者在使用 Claude CLI 进行 AI 辅助编程时，往往需要守在电脑前等待响应、处理权限确认。当需要离开工位时，整个工作流被中断。

### 解决方案

remote-claude 将主机上运行的 Claude CLI 的输入输出通过加密 WebSocket 通道同步到手机，让开发者能在任何地方：
- 查看 Claude 的实时输出
- 发送指令、回答提示
- 处理权限请求（y/n 按钮一键响应）

---

## 架构详解

### 三端职责

```
┌─────────────────────────────────────────────────────────────────────┐
│                           主机 (terminal)                            │
│                                                                     │
│   remote-claude start                                               │
│         │                                                           │
│   创建会话 → 获取 token → 显示二维码                                   │
│         │                                                           │
│   Socket.IO 连接服务器 (role: agent)                                 │
│         │                                                           │
│   ┌─────▼──────┐   PTY I/O   ┌──────────────┐                      │
│   │  node-pty  │ ◄──────────► │  Claude CLI  │                      │
│   └─────┬──────┘             └──────────────┘                      │
│         │ 输出流(ANSI)                                               │
│         ▼                                                           │
│   PromptDetector (检测 Claude 交互提示)                               │
│         │                                                           │
│   Socket emit: terminal:output / claude:prompt                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────────────┐
│                        服务端 (server)                               │
│                                                                     │
│   MidwayJS HTTP:  POST /api/session  GET /api/session/:token        │
│   MidwayJS WS:    Socket.IO 房间中继                                 │
│                                                                     │
│   会话房间 (session room):                                           │
│     agent socket  ←──→  relay  ←──→  mobile socket                 │
│                                                                     │
│   SQLite sessions 表: token · state · socketIds · 过期时间           │
│   不存储任何终端内容                                                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────────────┐
│                        手机端 (mobile)                               │
│                                                                     │
│   扫描二维码 → 解析 remoteclaude://pair?token=T&server=S             │
│         │                                                           │
│   Socket.IO 连接 (role: mobile) → emit mobile:join                  │
│         │                                                           │
│   terminal:output → xterm.write(data) → 终端渲染                    │
│   claude:prompt   → PromptOverlay 弹出                              │
│                                                                     │
│   用户输入 → emit terminal:input → 主机 PTY.write()                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Socket.IO 事件协议

| 方向 | 事件 | 说明 |
|------|------|------|
| Agent → Server | `agent:register` | Agent 认证并加入会话房间 |
| Agent → Server | `terminal:output` | PTY 输出块（含 ANSI），转发到手机 |
| Agent → Server | `claude:prompt` | 检测到 Claude 交互提示类型 |
| Mobile → Server | `mobile:join` | 手机认证并加入会话房间 |
| Mobile → Server | `terminal:input` | 键盘输入，转发到 Agent PTY |
| Mobile → Server | `terminal:resize` | 终端尺寸变化，转发到 Agent |
| Either → Server | `session:ping` | 心跳保活 |
| Server → Both | `session:state` | 会话状态变更通知 |
| Server → Both | `session:pair` | 配对成功通知 |
| Server → Either | `session:error` | 错误通知（含错误码） |

### 会话状态机

```
                    ┌──────────────────┐
                    │ waiting_for_agent │  (创建后初始状态)
                    └────────┬─────────┘
                             │ agent:register
                    ┌────────▼──────────┐
                    │ waiting_for_mobile │
                    └────────┬──────────┘
                             │ mobile:join
                    ┌────────▼──────────┐
              ┌────►│      paired        │◄────┐
              │     └────────┬──────────┘     │
              │              │                 │
    mobile重连 │    ┌─────────┴──────────┐      │ agent重连
              │    │                    │      │
     ┌────────┴─────────┐    ┌──────────┴──────────┐
     │ mobile_disconnected│   │  agent_disconnected  │
     └──────────────────┘    └─────────────────────┘
                                        │ 超时无重连
                               ┌────────▼────────┐
                               │     expired      │
                               └─────────────────┘
```

### PTY 关键设计

**为什么必须用 node-pty**：Claude CLI 通过检测 `process.stdout.isTTY` 决定是否启用交互模式。普通的 `child_process.spawn()` 的 stdout 是 Pipe（isTTY = false），Claude 会降级为非交互管道模式，所有提示词消失。node-pty 创建真实的伪终端设备，isTTY = true。

**PTY 关键环境变量**：
```typescript
env: {
  TERM: 'xterm-256color',   // 必须 — Claude 检测终端类型
  COLORTERM: 'truecolor',   // 启用真彩色
  LANG: 'en_US.UTF-8',
  // 绝不设置: CI=1, NO_COLOR, FORCE_COLOR=0 — 会关闭交互提示
}
```

**输出批处理**：PTY onData 事件频率极高，16ms 批次窗口聚合后再 emit，避免 socket 帧洪泛，同时匹配约 60fps 的终端刷新率。

**断线缓冲**：手机断线期间，PTY 输出继续写入 1MB 环形缓冲区。重连后立即 flush，手机端不会丢失任何输出。

### Claude 提示词检测

`PromptDetector` 维护一个 2KB 滚动缓冲区，对每次 PTY 输出进行正则匹配（100ms 防抖避免 ANSI 序列分片误判）：

| 检测目标 | 正则 | 触发类型 |
|---------|------|---------|
| 权限请求 | `Do you want to allow.{0,200}?\[y\/n\]/is` | `permission_request` |
| 工具批准 | `(run\|execute\|...).{0,80}\[y\/n\]/i` | `tool_use_approval` |
| 通用确认 | `\[Y\/n\]\|\[y\/N\]\|\[y\/n\]` | `yes_no_confirm` |
| 多行输入 | `^\.\.\.\s*$/m` | `multiline_input` |
| Slash命令 | `^>\s*\/\w*/m` | `slash_command_hint` |

---

## 数据库设计

### sessions 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID PK | 内部 ID |
| token | VARCHAR(64) UNIQUE | QR 码中的密钥 |
| state | VARCHAR(32) | SessionState 枚举值 |
| agent_socket_id | VARCHAR(128) NULL | 当前连接的 Agent socket.id |
| mobile_socket_id | VARCHAR(128) NULL | 当前连接的 Mobile socket.id |
| agent_platform | VARCHAR(32) NULL | linux/darwin/win32 |
| mobile_device_id | VARCHAR(128) NULL | 手机端稳定 UUID |
| paired_at | DATETIME NULL | 首次配对时间 |
| last_activity_at | DATETIME | 最后活跃时间 |
| expires_at | DATETIME | 过期时间（创建后 24h） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

> 终端内容（输入/输出）**从不持久化**，服务端是纯中继。

---

## 安全设计

- **Token 认证**：WebSocket 握手时验证 token，未认证连接立即断开
- **角色权限**：agent 只能发 output 类事件，mobile 只能发 input 类事件，服务端强制校验
- **速率限制**：每个 socket 每秒最多 100 个事件
- **Payload 限制**：单帧 terminal:output 最大 64KB
- **会话 TTL**：24h 过期，定时清理过期记录
