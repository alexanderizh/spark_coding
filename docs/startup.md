# 启动文档

## 环境要求

| 工具 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | 18.x | 服务端 + 终端代理 |
| Yarn | 1.22.x | 包管理器（Workspaces） |
| Python | 3.x | node-pty 原生编译依赖 |
| Flutter | 3.19.x | 手机端 |
| Claude CLI | 最新版 | 主机上需已安装并配置 API Key |

### macOS 额外要求

node-pty 需要原生编译，macOS 上需要安装 Xcode Command Line Tools：

```bash
# 安装 Xcode Command Line Tools（首次会弹出安装对话框）
xcode-select --install
```

---

## 第一步：安装依赖

```bash
cd ~/apark_coding

# 安装所有 Node.js 依赖（server + terminal + shared）
yarn install

# 编译 shared 协议包（server 和 terminal 都依赖它）
yarn build:shared
```

---

## 第二步：启动服务端

```bash
# 开发模式（热重载）
yarn dev:server

# 或生产模式
yarn build:server
yarn start:server
```

服务端默认运行在 `http://localhost:7001`。

**验证服务端正常**：
```bash
curl -X POST http://localhost:7001/api/session
# 应返回: {"success":true,"data":{"sessionId":"...","token":"...","qrPayload":"sparkcoder://pair?..."}}
```

**配置项**（`apps/server/.env`）：
```env
PORT=7001          # 监听端口
NODE_ENV=local     # 环境标识
# DB_PATH=./data/spark_coder.db  # 数据库路径（可选）
```

---

## 第三步：启动主机终端代理

**新开一个终端窗口**，在目标项目目录下：

```bash
# 方式一：从源码运行（开发）
yarn dev:terminal

# 或指定参数（覆盖配置文件）
yarn dev:terminal -- --server-url http://localhost:7001 --cwd /path/to/your/project

# 生产模式（构建后）
yarn build:terminal
yarn start:terminal

# 方式二：通过 npm 安装后使用 spark 命令（发布后）
# npm install -g @spark_coder/terminal
# spark
```

**配置项**：
- 开发：`apps/terminal/.env`（复制 `.env.example`）
- 生产/打包：`apps/terminal/.prod.env`（复制 `.prod.env.example`）

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `REMOTE_CLAUDE_SERVER` | `http://localhost:7001` | 中继服务器地址 |
| `CLAUDE_PATH` | `claude` | Claude CLI 可执行文件路径 |

**CLI 参数**（可覆盖配置文件）：

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `--server-url` | 来自 `.env` 或 `http://localhost:7001` | 中继服务器地址 |
| `--claude-path` | 来自 `.env` 或 `claude` | Claude CLI 可执行文件路径 |
| `--cwd` | 当前目录 | Claude CLI 工作目录 |

启动后终端会显示二维码：

```
  spark  — scan to pair your phone

  ██████████████████████
  ██ ▄▄▄▄▄ █▄▀▄ █▄▄ ██
  ██ █   █ █ ▄▀▀▄▀  ██
  ...

  Server : http://localhost:7001
  Token  : a1b2c3d4…e5f6g7h8

  Waiting for mobile to connect…
```

---

## 第四步：运行手机 App

```bash
cd ~/apark_coding/apps/mobile

# 首次运行先获取依赖
flutter pub get

# 连接手机（USB 或无线调试）并运行
flutter run

# 指定设备
flutter run -d <device-id>

# 构建 APK（Android）
flutter build apk --release

# 构建 IPA（iOS，需 macOS + Xcode）
flutter build ios --release
```

**首次运行注意**：Flutter 会提示需要补全项目脚手架文件（如 Xcode project、GeneratedPluginRegistrant 等），执行以下命令补全但不覆盖已有文件：

```bash
cd ~/apark_coding/apps/mobile
flutter create . --project-name remote_claude_mobile
```

---

## 第五步：配对使用

1. 打开手机 App → 点击「扫码配对」
2. 扫描终端中显示的二维码
3. 配对成功后进入终端界面
4. 即可在手机上查看 Claude CLI 输出并发送指令

---

## 开发调试

### 仅开发服务端

```bash
yarn dev:server
```

### 仅开发终端代理（无需手机，可用 wscat 模拟）

```bash
# 安装 wscat
npm install -g wscat

# 启动终端代理
yarn dev:terminal

# 另一个终端：模拟手机端连接（将 TOKEN 替换为实际 token）
wscat -c "ws://localhost:7001" --header "Authorization: Bearer TOKEN"
```

### 查看 SQLite 数据库

```bash
# 使用 sqlite3 命令行（或 DB Browser for SQLite 图形工具）
sqlite3 ~/apark_coding/apps/server/data/spark_coder.db
.tables
SELECT id, token, state, paired_at FROM sessions;
```

### Flutter 热重载

Flutter 运行期间在终端按 `r` 热重载，`R` 热重启，`q` 退出。

---

## 常见问题

**Q: mobile 连接成功后报 `posix_spawnp failed`**

Claude CLI 可执行文件未找到或无法启动。终端代理会尝试通过 `which` 解析 `claude` 为绝对路径。若仍失败，请显式指定路径：
```bash
yarn dev:terminal -- --claude-path /Users/你的用户名/.local/bin/claude
# 或设置环境变量
CLAUDE_PATH=/path/to/claude yarn dev:terminal
```

**Q: `yarn dev:terminal` 提示 node-pty 编译失败**

macOS 需要 Xcode Command Line Tools：
```bash
xcode-select --install
# 安装完成后重新 yarn install
```

**Q: 服务端启动报 `EADDRINUSE: address already in use :::7001`**

端口被占用，修改 `apps/server/.env` 中的 `PORT`，同时修改 `apps/terminal/.env`（开发）或 `.prod.env`（生产）中的 `REMOTE_CLAUDE_SERVER`。

**Q: 手机扫码后显示「Agent is not yet connected」**

确保终端代理已启动并显示了二维码（agent 端先连接服务器，mobile 端后连接）。

**Q: Flutter 提示 `MissingPluginException`**

```bash
flutter clean
flutter pub get
flutter run
```

**Q: Claude CLI 提示词无法被检测（手机不弹出 overlay）**

- 确认 `TERM=xterm-256color` 环境变量已设置
- 确认没有 `CI=1` 或 `NO_COLOR` 环境变量
- 查看终端代理日志中是否有 `[pty]` 相关输出

**Q: 如何在局域网内使用（手机和电脑在同一 WiFi）**

将服务端部署在电脑上，在 `apps/terminal/.env`（开发）或 `.prod.env`（生产）中设置 `REMOTE_CLAUDE_SERVER=http://192.168.1.100:7001`（电脑的局域网 IP）。同时修改 `apps/server/.env` 确保服务端监听 `0.0.0.0`（MidwayJS 默认即是）。
