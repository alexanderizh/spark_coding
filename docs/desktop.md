# 桌面端 (Desktop) 使用与打包指南

`apps/desktop` 是面向普通用户的 Electron 桌面客户端。用户只需下载安装包，无需安装 Node.js 或单独配置 terminal CLI，即可通过手机 App 配对并远程控制 Claude CLI。

---

## 与 terminal CLI 的区别

| 对比项 | `apps/terminal`（CLI） | `apps/desktop`（桌面端） |
|--------|----------------------|------------------------|
| 目标用户 | 开发者 | 所有用户 |
| 安装方式 | `npm install -g` | 下载安装包双击安装 |
| 前提条件 | 需要 Node.js + npm | 无（Electron 自带运行时） |
| 配置方式 | `.env` 文件 / CLI 参数 | 图形界面设置页 |
| 操作系统 | Linux / macOS / Windows | macOS / Windows |
| 界面 | 终端二维码 | 图形窗口 + 系统托盘 |

两者的核心逻辑完全相同，desktop 将 terminal 的逻辑内嵌到 Electron 主进程中运行。

---

## 用户使用流程

### 前提

主机上已安装 Claude CLI：

```bash
npm install -g @anthropic-ai/claude-code
# 验证安装
claude --version
```

### 1. 安装桌面应用

从发布页下载对应平台的安装包：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS（Apple Silicon） | `Spark.Coder-x.x.x-arm64.dmg` | M1/M2/M3 芯片 |
| macOS（Intel） | `Spark.Coder-x.x.x-x64.dmg` | Intel 芯片 |
| Windows | `Spark.Coder.Setup.x.x.x.exe` | 安装版 |
| Windows（便携） | `Spark.Coder-x.x.x-portable.exe` | 免安装版 |

**macOS 安装**：打开 `.dmg` → 拖入 Applications 文件夹 → 首次打开右键选「打开」（绕过 Gatekeeper）

**Windows 安装**：运行 `.exe` 安装程序，按提示完成安装

### 2. 首次配置

打开应用后进入「⚙️ 设置」页：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| **Relay 服务器地址** | 中继服务器的公网地址（必填） | `https://relay.example.com` |
| **Claude CLI 路径** | 留空或点「自动检测」，无法检测时手动填写 | `/usr/local/bin/claude` |
| **工作目录** | Claude CLI 启动时的工作目录 | `/Users/name/projects` |
| **启动时自动连接** | 开启后每次打开应用自动建立配对连接 | ✅ 推荐开启 |

填写完成后点「保存设置」。

### 3. 配对手机

1. 切换到「📡 配对」页面
2. 点击「开始配对」按钮（若开启了自动连接则已自动触发）
3. 等待二维码出现

```
┌─────────────────────────────────┐
│  📡 配对手机                     │
│                                 │
│  ┌─────────────────────────┐    │
│  │  ██████████████████████ │    │
│  │  ██ ▄▄▄▄▄ █▄▀▄ █▄▄ ██ │    │
│  │  ██ █   █ ██▀▀▄▀  ██  │    │
│  │  ██ █▄▄▄█ █ ▄▀▀▄▀  ██ │    │
│  │  ██▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ ██ │    │
│  └─────────────────────────┘    │
│                                 │
│  ● 等待手机扫码配对               │
│                                 │
│  Token: a1b2c3d4…e5f6g7h8      │
│                                 │
│  [断开连接]                      │
└─────────────────────────────────┘
```

4. 打开手机 Spark Coder App → 点击「扫码配对」→ 扫描二维码
5. 配对成功后状态变为「✅ 已配对，Claude 运行中」
6. 即可在手机上远程控制 Claude

### 4. 会话查看

切换到「💬 会话」页可查看：
- 当前连接状态与配对时长
- 会话 ID
- Claude CLI 运行状态
- 实时终端输出预览（最近 200 行）

### 5. 系统托盘

关闭主窗口后应用**不退出**，继续在系统托盘运行：

- **macOS**：菜单栏右侧出现图标
- **Windows**：任务栏右下角出现图标

右键托盘图标：
- 「Open Spark Coder」— 重新打开主窗口
- 「Quit」— 完全退出应用

---

## 开发者指南

### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 18.x | 开发依赖 |
| Yarn | 1.22.x | 包管理 |
| Python | 3.x | `node-pty` 原生编译 |
| Xcode CLI Tools | 最新 | macOS 原生编译（仅 macOS） |

```bash
# macOS：安装 Xcode Command Line Tools（若未安装）
xcode-select --install
```

### 安装依赖

```bash
# 在项目根目录
yarn install

# 或单独安装 desktop 依赖（含 node-pty rebuild）
yarn workspace @spark_coder/desktop install
```

### 开发模式

```bash
# 推荐：在根目录使用 workspace 命令
yarn dev:desktop

# 或直接进入 desktop 目录
cd apps/desktop
yarn dev
```

开发模式启动后会同时开启：
- Electron 主进程（热重载）
- Vite 开发服务器（renderer 热更新）

### 构建

```bash
# 仅编译 TypeScript → out/
yarn build:desktop

# 或在 desktop 目录
cd apps/desktop && yarn build
```

构建产物：

```
apps/desktop/out/
├── main/
│   └── index.js        # Electron 主进程
├── preload/
│   └── index.js        # Preload 脚本
└── renderer/
    ├── index.html
    └── assets/
        ├── index.js    # React 应用
        └── index.css
```

---

## 打包发布

### macOS

```bash
# 生成 .dmg（通用，含 x64 + arm64）
yarn dist:desktop:mac
```

> **Apple Silicon（M 系列芯片）开发机**：默认只打 arm64，加 `--x64` 或 `--universal` 可打全架构。

产物位于 `apps/desktop/release/`：

```
release/
├── Spark Coder-1.0.0.dmg          # 安装包（拖入 Applications）
├── Spark Coder-1.0.0-arm64.dmg    # Apple Silicon 专用
├── Spark Coder-1.0.0-mac.zip      # 压缩包（自动更新用）
└── mac-arm64/
    └── Spark Coder.app             # 可直接双击运行的 .app
```

**macOS 代码签名**（发布时需要，开发时可跳过）：

```bash
# 在 electron-builder.yml 中补充
mac:
  identity: "Developer ID Application: Your Name (TEAM_ID)"
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
```

```bash
# 打包并公证（需要 Apple Developer 账号）
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # App-specific password
export APPLE_TEAM_ID="XXXXXXXXXX"
yarn dist:desktop:mac
```

### Windows

在 **Windows 机器**或 **GitHub Actions Windows runner** 上执行：

```bash
yarn dist:desktop:win
```

产物：

```
release/
├── Spark Coder Setup 1.0.0.exe   # NSIS 安装程序
├── Spark Coder 1.0.0.exe         # 便携版（免安装）
└── win-unpacked/
    └── Spark Coder.exe            # 未打包的可执行文件
```

**Windows 代码签名**（可选）：

```bash
# 在 electron-builder.yml 中补充
win:
  certificateFile: path/to/cert.p12
  certificatePassword: ${WINDOWS_CERT_PASSWORD}
```

### 跨平台打包（GitHub Actions 推荐方案）

在 `.github/workflows/release.yml` 中配置：

```yaml
jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: yarn install
      - run: yarn dist:desktop:mac
      - uses: actions/upload-artifact@v4
        with:
          name: mac-release
          path: apps/desktop/release/*.dmg

  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: yarn install
      - run: yarn dist:desktop:win
      - uses: actions/upload-artifact@v4
        with:
          name: win-release
          path: apps/desktop/release/*.exe
```

---

## 添加应用图标

目前使用系统默认图标，发布前需添加：

```
apps/desktop/resources/
├── icon.icns     # macOS（1024×1024 px，多分辨率 icns）
├── icon.ico      # Windows（256×256 px，多分辨率 ico）
└── tray-icon.png # 托盘图标（16×16 或 32×32 px）
```

生成工具：
- macOS：[`iconutil`](https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html) 或 Sketch / Figma 导出
- 跨平台：[`electron-icon-builder`](https://www.npmjs.com/package/electron-icon-builder)

```bash
# 从一张 1024×1024 png 生成全套图标
npx electron-icon-builder --input=icon-source.png --output=apps/desktop/resources/
```

生成后取消注释 `electron-builder.yml` 中的图标配置：

```yaml
mac:
  icon: resources/icon.icns   # 取消注释
win:
  icon: resources/icon.ico    # 取消注释
```

---

## 项目结构说明

```
apps/desktop/
├── src/
│   ├── main/                     # Electron 主进程（Node.js 环境）
│   │   ├── index.ts              # 应用入口，单实例锁，窗口初始化
│   │   ├── store.ts              # 设置持久化（userData/settings.json）
│   │   ├── tray.ts               # 系统托盘
│   │   ├── window-manager.ts     # 窗口生命周期管理
│   │   ├── claude-detector.ts    # Claude CLI 路径自动检测
│   │   ├── terminal-bridge.ts    # ★ 核心：内嵌 terminal 全部逻辑
│   │   └── ipc.ts                # IPC handlers + 事件桥接
│   │
│   ├── preload/
│   │   └── index.ts              # contextBridge 安全 API（window.api）
│   │
│   └── renderer/                 # React 前端（浏览器环境）
│       ├── App.tsx               # 根组件（侧边栏导航）
│       ├── styles.css            # 深色主题样式
│       ├── types.d.ts            # window.api 类型声明
│       └── pages/
│           ├── Pairing.tsx       # 配对页（QR 码）
│           ├── Session.tsx       # 会话详情 + 输出预览
│           └── Settings.tsx      # 设置页
│
├── resources/                    # 应用图标（需手动添加）
├── electron.vite.config.ts       # electron-vite 构建配置
├── electron-builder.yml          # 打包配置
├── package.json
└── tsconfig.json
```

### IPC 通信协议

**Renderer → Main（`ipcRenderer.invoke`）**：

| 事件 | 参数 | 返回 |
|------|------|------|
| `settings:get` | — | `AppSettings` |
| `settings:save` | `Partial<AppSettings>` | `void` |
| `claude:detect` | — | `string \| null` |
| `session:start` | — | `{ ok } \| { error }` |
| `session:stop` | — | `{ ok }` |
| `session:getStatus` | — | `{ status, qrInfo? }` |

**Main → Renderer（`webContents.send`）**：

| 事件 | Payload | 说明 |
|------|---------|------|
| `session:status` | `{ status, message? }` | 状态变更 |
| `session:qr` | `{ qrPayload, token, sessionId }` | QR 码数据 |
| `session:output` | `string` | Claude 终端输出（原始） |
| `session:claude-exit` | `number` | Claude 进程退出码 |

---

## 常见问题

**Q：打开应用后状态一直显示「等待手机扫码配对」，但扫码后没反应**

确认 Relay 服务器地址配置正确，且服务器可正常访问：
```bash
curl -X POST https://your-relay.com/api/session
# 应返回 {"success":true,"data":{...}}
```

**Q：自动检测 Claude CLI 失败**

Claude CLI 未安装或不在标准路径，手动安装：
```bash
npm install -g @anthropic-ai/claude-code
# 或者
brew install claude   # 若使用 Homebrew
```
安装后重新点击「自动检测」，或手动填写完整路径（如 `/opt/homebrew/bin/claude`）。

**Q：macOS 提示「无法验证开发者」**

开发版本未签名，右键点击应用 → 选「打开」→ 再次点「打开」即可。

**Q：Windows 杀毒软件报警**

未签名的 Electron 应用可能触发误报，添加白名单或使用带签名的正式发布版本。

**Q：关闭窗口后应用消失，找不到了**

应用最小化到系统托盘：macOS 看菜单栏右侧，Windows 看任务栏右下角（可能需要点「显示隐藏图标」）。

**Q：`node-pty` 编译错误（开发时）**

macOS 需要 Xcode Command Line Tools：
```bash
xcode-select --install
# 安装后重新执行
yarn install
```

**Q：如何查看应用日志**

桌面应用日志写入系统日志目录：
- macOS：`~/Library/Logs/Spark Coder/`
- Windows：`%APPDATA%\Spark Coder\logs\`

开发模式下日志直接输出到启动终端。
