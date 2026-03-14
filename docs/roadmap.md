# 后期需求计划（Roadmap）

## 近期（v1.1）— 稳定性与体验

### 1. 生产部署支持

- [ ] Docker Compose 配置（server + nginx）
- [ ] PM2 ecosystem 配置（server 进程守护）
- [ ] HTTPS 支持（nginx 反向代理 + Let's Encrypt）
- [ ] 服务端环境变量完整文档
- [ ] 健康检查接口 `GET /health`

### 2. 断线重连优化

- [ ] 服务端重启后 agent 自动重注册（token 持久化到本地文件）
- [ ] 手机端断线 Banner 展示剩余重连倒计时
- [ ] 环形缓冲区 flush 时的序列号对齐（避免手机端重复内容）
- [ ] 会话恢复：`--restore-token <token>` 参数支持

### 3. 手机端体验完善

- [ ] 终端字体大小持久化（设置页 → shared_preferences）
- [ ] 横屏模式适配（更宽的终端列数）
- [ ] 终端内容搜索（Ctrl+F 风格）
- [ ] 历史命令记录（上滑查看）
- [ ] 震动反馈（Claude 提示词检测到时）

### 4. Claude 提示词检测优化

- [ ] 跟踪 Claude CLI 版本变更，更新正则模式
- [ ] 支持 Claude Code 的 `[>]` 连续问答模式检测
- [ ] 多行输入模式的专属 UI（展开型文本编辑器）
- [ ] 检测 Claude 思考中状态（spinning indicator）

---

## 中期（v1.5）— 多 CLI 支持

### 5. CLI 抽象层

当前硬编码 Claude CLI，需要抽象为插件化架构：

```typescript
interface CliAdapter {
  name: string;
  spawnArgs: (config: AgentConfig) => { cmd: string; args: string[] };
  promptPatterns: PromptPattern[];
  quickActions: QuickAction[];
}
```

- [ ] 设计 `CliAdapter` 接口
- [ ] Claude CLI adapter（当前实现迁移）
- [ ] Bash/Zsh adapter（通用 shell）
- [ ] Gemini CLI adapter
- [ ] OpenAI Codex CLI adapter

### 6. 多会话支持

- [ ] 一个 agent 支持多个并发会话（多窗口）
- [ ] 手机端会话列表页（切换不同主机/会话）
- [ ] 会话命名（给会话起名便于区分）

### 7. 推送通知

- [ ] Claude 提示词检测时推送手机通知（App 在后台时）
- [ ] 集成 FCM（Android）+ APNs（iOS）
- [ ] 通知点击直达对应会话

---

## 远期（v2.0）— 安全与协作

### 8. 端到端加密

参考 Happy Coder 的加密方案：

- [ ] 客户端生成非对称密钥对（本地存储私钥）
- [ ] 公钥认证替代 token 认证
- [ ] 会话密钥协商（ECDH）
- [ ] AES-256-GCM 加密 terminal:output 和 terminal:input Payload
- [ ] 服务端零知识（看不到任何终端内容）

### 9. Web 端支持

- [ ] 浏览器端替代手机 App（xterm.js + WebSocket）
- [ ] 响应式设计（桌面 + 移动浏览器）
- [ ] 会话分享（只读 URL）

### 10. 多人协作

- [ ] 一个会话允许多个 viewer（手机/浏览器）
- [ ] 输入权限控制（owner 控制谁能输入）
- [ ] 实时光标位置同步（谁在看哪里）

### 11. 录制与回放

- [ ] 会话录制（asciinema 格式）
- [ ] 本地保存 + 云端上传
- [ ] 回放播放器（Web + App）
- [ ] 分享录制内容

### 12. 主机侧增强

- [ ] 多主机管理（一个 App 管理多台机器）
- [ ] 主机状态监控（CPU、内存、磁盘）
- [ ] 文件浏览器（查看主机文件）
- [ ] 拖拽传文件（手机 → 主机）

---

## 技术债务（随时处理）

- [ ] 服务端 `relay.controller.ts` 补充单元测试（Socket.IO mock）
- [ ] `prompt-detector.ts` 正则模式测试用例
- [ ] TypeORM 迁移文件（当前 `synchronize: true` 仅适合开发）
- [ ] 服务端接入 Prometheus 指标监控（活跃会话数、消息吞吐量）
- [ ] Flutter 补充 Widget 测试（ScannerScreen、TerminalScreen）
- [ ] 错误上报（Sentry 或自建）

---

## 版本规划

| 版本 | 目标时间 | 核心目标 |
|------|---------|---------|
| v1.0 | 当前 | MVP：Claude CLI 远程控制，QR 配对，手机交互 |
| v1.1 | +1个月 | 生产部署 + 稳定性 + 体验优化 |
| v1.5 | +3个月 | 多 CLI 支持 + 多会话 + 推送通知 |
| v2.0 | +6个月 | E2E 加密 + Web 端 + 多人协作 |
