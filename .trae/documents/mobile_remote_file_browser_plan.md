# 移动端 Claude CLI 工作目录切换功能计划

## 1. 概述
本计划旨在为 Spark Coding 移动端 App 新增切换 Desktop 端 Claude CLI 工作目录的功能。通过在 App 端提供可视化的文件浏览器，用户可以浏览 Desktop 端的文件系统，并选择新的工作目录。Desktop 端收到指令后，将重启 Claude CLI 进程以应用新的工作目录。

## 2. 现有架构分析
- **通信机制**：Desktop 和 Mobile 通过 Socket.IO 中继服务器进行通信，定义了 `Events` 常量和 Payload 类型。
- **Desktop 端**：`TerminalBridge` 类负责管理 Claude CLI 进程 (`node-pty`) 和 Socket 事件。目前仅在启动时通过配置设置 `cwd`。
- **Mobile 端**：`TerminalScreen` 负责展示终端界面，`SocketService` 负责 Socket 通信。`InputToolbar` 提供快捷命令入口。
- **共享库**：`packages/shared` 定义了前后端通用的协议和类型。

## 3. 变更方案

### 3.1 共享协议 (`packages/shared`)
在 `src/protocol.ts` 中新增以下事件定义和类型：
- **事件名**：
  - `FS_LIST`: `'fs:list'` (Mobile -> Desktop)
  - `FS_LIST_RESULT`: `'fs:list:result'` (Desktop -> Mobile)
  - `TERMINAL_CHDIR`: `'terminal:chdir'` (Mobile -> Desktop)
- **Payload 类型**：
  - `FsListPayload`: `{ path: string }`
  - `FsListResultPayload`: `{ path: string, entries: { name: string, isDirectory: boolean }[], error?: string }`
  - `TerminalChdirPayload`: `{ path: string }`

### 3.2 Desktop 端 (`apps/desktop`)
修改 `src/main/terminal-bridge.ts`：
1.  **引入 `fs/promises`**：用于异步读取目录。
2.  **新增事件监听**：
    - 监听 `FS_LIST`：调用 `handleFsList`。
    - 监听 `TERMINAL_CHDIR`：调用 `handleChdir`。
3.  **实现 `handleFsList(payload)`**：
    - 读取指定路径（或当前 `cwd`）下的文件和目录。
    - 过滤出目录项（可选，或全部返回但在前端过滤）。
    - 发送 `FS_LIST_RESULT` 事件返回结果。
    - 处理权限错误或路径不存在错误。
4.  **实现 `handleChdir(payload)`**：
    - 验证路径是否存在。
    - 更新 `this.config.cwd`。
    - 调用 `this.restartClaude()` 重启进程。
    - 发送状态更新或通知（可选，复用现有的 `runtime:status` 或 `terminal:output`）。

### 3.3 Mobile 端 (`apps/mobile`)
1.  **更新 `SocketService` (`lib/services/socket_service.dart`)**：
    - 新增 `sendFsList(String path)` 方法。
    - 新增 `sendChdir(String path)` 方法。
    - 新增 `fsListResults` Stream 用于接收目录列表结果。
2.  **新增 `FileBrowser` 组件 (`lib/widgets/file_browser.dart`)**：
    - 这是一个 `StatefulWidget`，用于展示文件列表。
    - 状态包括：当前路径、文件列表、加载状态、错误信息。
    - UI 元素：
        - 顶部显示当前路径，支持点击返回上级。
        - 列表展示文件夹，点击进入下级。
        - 底部 "选择此目录" 按钮。
    - 逻辑：初始化时请求当前目录（或根目录），监听 `fsListResults` 更新 UI。
3.  **修改 `InputToolbar` (`lib/widgets/input_toolbar.dart`)**：
    - 在 `_commands` 列表中添加 `(command: '/cd', title: '切换目录', desc: '浏览并切换工作目录')`。
4.  **修改 `TerminalScreen` (`lib/screens/terminal_screen.dart`)**：
    - 在 `_sendMessage` 中拦截 `/cd` 命令。
    - 拦截后调用 `_showFileBrowser` 方法，弹出 `ModalBottomSheet` 展示 `FileBrowser` 组件。
    - `FileBrowser` 选择目录后，回调调用 `socketService.sendChdir` 并关闭弹窗。

## 4. 实施步骤

### 阶段一：协议定义与 Desktop 端实现
1.  修改 `packages/shared/src/protocol.ts`，添加事件和类型定义。
2.  修改 `apps/desktop/src/main/terminal-bridge.ts`，实现文件系统操作和事件处理。

### 阶段二：Mobile 端服务与组件开发
3.  修改 `apps/mobile/lib/services/socket_service.dart`，添加发送和接收方法。
4.  创建 `apps/mobile/lib/widgets/file_browser.dart`，实现文件浏览器 UI。

### 阶段三：Mobile 端集成与测试
5.  修改 `apps/mobile/lib/widgets/input_toolbar.dart`，添加 `/cd` 命令。
6.  修改 `apps/mobile/lib/screens/terminal_screen.dart`，集成 `/cd` 命令响应逻辑。
7.  验证功能：
    - 打开 App，连接 Desktop。
    - 输入或选择 `/cd` 命令。
    - 浏览目录结构是否正确。
    - 选择新目录，确认 Desktop 端 Claude CLI 是否重启并在新目录下运行（可通过 `pwd` 命令验证）。

## 5. 验证计划
- **单元测试**：针对 `TerminalBridge` 的文件操作逻辑进行测试（如果环境允许）。
- **集成测试**：
    - 启动 Desktop 和 Server。
    - 启动 Mobile 模拟器。
    - 连接后执行 `/cd`，检查文件列表加载速度和准确性。
    - 切换目录后，在终端输入 `ls` 或 `pwd` 确认生效。
