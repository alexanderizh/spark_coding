# spark_coder

> 用手机远程控制主机上的 Claude CLI —— 扫码配对，实时交互。

---

## 是什么

spark_coder 是一个三端协同系统，让你在手机上实时查看并控制运行在主机上的 Claude CLI（以及未来更多 CLI 工具）。灵感来源于开源项目 [Happy Coder](https://github.com/slopus/happy)。

```
主机终端 (terminal)  ←──WebSocket──→  中继服务器 (server)  ←──WebSocket──→  手机 App (mobile)
  node-pty                              MidwayJS                              Flutter
  Claude CLI                            SQLite                                xterm 渲染
  二维码展示                             会话管理                               QR 扫码
```

---

## 核心特性

- **QR 扫码配对** — 主机终端显示二维码，手机扫码即绑定，无需手动输入地址
- **实时终端流** — PTY 伪终端，完整 ANSI 色彩渲染，支持 Claude 交互模式
- **Claude 提示词识别** — 自动检测权限请求、yes/no 确认等，手机弹出智能按钮
- **断线续联** — 网络抖动时 PTY 进程不中断，重连后自动同步缓冲内容
- **快捷键工具栏** — y/n、Ctrl+C、Tab、方向键、/clear、/help、/compact 等
- **纯中继架构** — 服务端不存储任何终端内容，仅转发

---

## 项目结构

```
spark_coder/
├── docs/                    # 文档（本目录）
├── packages/
│   └── shared/              # TypeScript 共享协议类型
├── apps/
│   ├── server/              # MidwayJS 中继服务端
│   ├── terminal/            # Node.js 主机终端代理
│   └── mobile/              # Flutter 手机端
├── package.json             # Yarn Workspaces 根配置
└── tsconfig.base.json       # 共享 TS 配置
```

---

## 快速开始

见 [startup.md](./startup.md)。

## 技术栈

| 端 | 技术 |
|---|---|
| 服务端 | MidwayJS · Socket.IO · TypeORM · SQLite · Node.js |
| 主机代理 | Node.js · node-pty · Socket.IO Client · Commander |
| 手机 App | Flutter · Riverpod · xterm · socket_io_client · mobile_scanner |
| 共享协议 | TypeScript · Yarn Workspaces |
