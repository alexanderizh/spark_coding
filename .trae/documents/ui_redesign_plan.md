# Mobile UI Redesign & Localization Plan

## 1. Summary
This plan outlines the steps to redesign the mobile application's UI to a minimalist black-and-white theme and localize all application text to Chinese. The goal is to create a clean, modern interface while maintaining the functionality of the remote terminal controller.

## 2. Current State Analysis
- **Theme**: Dark "Hacker/Terminal" aesthetic with black background (`#0D0D0D`) and matrix green accents (`#00FF41`).
- **Typography**: Monospace font used globally.
- **Localization**: English text is hardcoded throughout the application.
- **UI Components**: Buttons and containers have thick borders and specific "terminal-like" styling.

## 3. Proposed Changes

### 3.1. Theme Overhaul (`apps/mobile/lib/main.dart`)
- **Color Palette**:
  - Background: White (`#FFFFFF`)
  - Surface: White or Very Light Gray (`#FAFAFA`)
  - Primary: Black (`#000000`)
  - Secondary: Gray (`#808080`)
  - Divider: Light Gray (`#EEEEEE`)
- **Typography**:
  - Remove global `monospace` font family. Use system default sans-serif for UI elements.
  - Keep `monospace` ONLY for the `TerminalView` and specific code-related displays.
- **System UI**:
  - Update `SystemChrome` to use dark icons (for white status bar).
- **Component Styles**:
  - **Buttons**:
    - `ElevatedButton`: Black background, white text, no border radius (or very small, e.g., 4px), no elevation (flat).
    - `OutlinedButton`: Black border (1px), black text, minimal radius.
  - **Inputs**: Minimalist borders, black cursor.
  - **Cards**: Remove heavy borders, use subtle borders or elevation.

### 3.2. Text Replacement (Chinese Only)
Directly replace all English text with Chinese in the source code. No multi-language support (i.e., no `intl` package or `.arb` files) will be implemented.

#### **Files to Update:**

1.  **`apps/mobile/lib/screens/home_screen.dart`**
    - "REMOTE CLAUDE" -> "远程终端"
    - "Mobile terminal controller" -> "移动端控制器"
    - "SCAN QR CODE" -> "扫描二维码"
    - "OPEN TERMINAL" -> "打开终端"
    - "RECONNECT LAST SESSION" -> "重连上次会话"
    - "Settings" -> "设置"
    - "Connecting..." -> "连接中..."
    - "No saved session found. Please scan a QR code." -> "未找到保存的会话，请扫描二维码。"
    - All other status/error messages -> Translate to Chinese.

2.  **`apps/mobile/lib/screens/scanner_screen.dart`**
    - "Scan QR Code" -> "扫描二维码"
    - Permission requests -> "请授予相机权限以扫描二维码"
    - Error handling messages -> Translate to Chinese.

3.  **`apps/mobile/lib/screens/terminal_screen.dart`**
    - Connection status messages:
        - "Connected" -> "已连接"
        - "Disconnected" -> "已断开"
        - "Reconnecting..." -> "重连中..."
    - Banner text and actions.

4.  **`apps/mobile/lib/screens/settings_screen.dart`**
    - "Settings" -> "设置"
    - "Connection Info" -> "连接信息"
    - "Font Size" -> "字体大小"
    - "Danger Zone" -> "危险区域"
    - "Reset Data" -> "重置数据"
    - Confirmation dialogs:
        - "Are you sure you want to reset all data?" -> "确定要重置所有数据吗？"
        - "Cancel" -> "取消"
        - "Confirm" -> "确认"

5.  **`apps/mobile/lib/widgets/`**
    - `input_toolbar.dart`: "Input command..." -> "输入命令..."
    - `connection_badge.dart`: Status text.

### 3.3. Chat UI Optimization (Hybrid Approach)
Transform the interaction model to resemble a chat interface while maintaining the terminal core.

- **User Input (Right Side)**:
  - Redesign `InputToolbar` to look like a modern chat input field.
  - When the user types/sends a command, visual feedback should mimic a "sent message" (even if it just goes to the terminal).
  - Align input controls to the right where appropriate.

- **Claude Prompts (Left Side)**:
  - Redesign `PromptOverlay` to appear as a **Chat Bubble** on the left side of the screen, rather than a bottom sheet.
  - Distinct styling for "Claude" (the remote agent) vs "User".
  - Use the white/gray theme: Claude's bubbles in Gray (`#F0F0F0`) with Black text; User's input in Black (`#000000`) with White text.

- **Terminal View**:
  - Remains the central "history" view.
  - Reduce visual dominance of the terminal (e.g., remove heavy borders) so it feels more like a "log" or "context" background for the active chat bubbles.

## 4. Implementation Steps

1.  **Modify `apps/mobile/lib/main.dart`**:
    - Define the new `_buildMinimalistTheme()`.
    - Update `SystemChrome` settings.

2.  **Modify `apps/mobile/lib/screens/home_screen.dart`**:
    - Apply text changes.
    - Update layout and widget styling (remove green borders, use simple icons).

3.  **Modify `apps/mobile/lib/screens/scanner_screen.dart`**:
    - Apply text changes.
    - Update overlay UI.

4.  **Modify `apps/mobile/lib/screens/terminal_screen.dart`**:
    - Apply text changes.
    - **Layout Change**: Adjust `Stack` to position `PromptOverlay` as a chat bubble (top-left or bottom-left of the active area) instead of a bottom sheet.

5.  **Modify `apps/mobile/lib/widgets/prompt_overlay.dart`**:
    - **Redesign**: Change from a full-width bottom sheet to a constrained width "bubble" on the left.
    - **Styling**: Light gray background, rounded corners (e.g., top-left, top-right, bottom-right rounded; bottom-left sharp for "speech bubble" effect).
    - **Content**: Simplified header, clear action buttons inside the bubble.

6.  **Modify `apps/mobile/lib/widgets/input_toolbar.dart`**:
    - **Redesign**: Floating capsule style or rounded rectangle.
    - **Styling**: High contrast (Black background for active state, or White with strong border).

7.  **Modify `apps/mobile/lib/screens/settings_screen.dart`**:
    - Apply text changes.
    - Update list styles.

8.  **Modify `apps/mobile/lib/widgets/connection_badge.dart`**:
    - Update status text and colors.

## 5. Verification
- Since I cannot run the app visually, I will:
  - Verify code compilation using `flutter analyze` (if available via `run_command` or just rely on static analysis).
  - Review the code changes to ensure all English strings are replaced.
  - Ensure theme constants match the design requirements.
