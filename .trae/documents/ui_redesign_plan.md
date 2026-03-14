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

### 3.2. Localization (Text Replacement)
Replace all hardcoded English strings with Chinese.

#### **Files to Update:**

1.  **`apps/mobile/lib/screens/home_screen.dart`**
    - "REMOTE CLAUDE" -> "远程终端"
    - "Mobile terminal controller" -> "移动端控制器"
    - "SCAN QR CODE" -> "扫描二维码"
    - "OPEN TERMINAL" -> "打开终端"
    - "RECONNECT LAST SESSION" -> "重连上次会话"
    - "Settings" -> "设置"
    - "Connecting..." -> "连接中..."
    - Error messages -> Translate to Chinese.

2.  **`apps/mobile/lib/screens/scanner_screen.dart`**
    - "Scan QR Code" -> "扫描二维码"
    - Permission requests -> "请授予相机权限以扫描二维码"

3.  **`apps/mobile/lib/screens/terminal_screen.dart`**
    - Connection status messages (e.g., "Connected", "Disconnected") -> "已连接", "已断开"
    - Banner text.

4.  **`apps/mobile/lib/screens/settings_screen.dart`**
    - "Settings" -> "设置"
    - "Connection Info" -> "连接信息"
    - "Font Size" -> "字体大小"
    - "Danger Zone" -> "危险区域"
    - "Reset Data" -> "重置数据"
    - Confirmation dialogs -> Translate to Chinese.

5.  **`apps/mobile/lib/widgets/`**
    - `input_toolbar.dart`: "Input command..." -> "输入命令..."
    - `connection_badge.dart`: Status text.

### 3.3. UI Simplification
- **Home Screen**:
  - Remove the thick green border around the logo. Use a simple black icon.
  - Increase whitespace (but avoid "large spacing" as requested - keep it balanced).
- **Global**:
  - Remove heavy 1px borders where they are purely decorative.
  - Ensure high contrast and readability.

## 4. Implementation Steps

1.  **Modify `apps/mobile/lib/main.dart`**:
    - Define the new `_buildMinimalistTheme()`.
    - Update `SystemChrome` settings.
2.  **Modify `apps/mobile/lib/screens/home_screen.dart`**:
    - Apply text changes.
    - Update layout and widget styling.
3.  **Modify `apps/mobile/lib/screens/scanner_screen.dart`**:
    - Apply text changes.
4.  **Modify `apps/mobile/lib/screens/terminal_screen.dart`**:
    - Apply text changes.
    - Adjust terminal colors if necessary (keep terminal background dark or allow it to be light? usually terminals are better dark, but the surrounding UI should be white. *Decision: Keep terminal view itself standard (dark bg) or match app theme. For "minimalist black/white", a black terminal on white page looks good.*)
5.  **Modify `apps/mobile/lib/screens/settings_screen.dart`**:
    - Apply text changes.
    - Update list styles.
6.  **Modify Widgets**:
    - Update `connection_badge.dart`, `input_toolbar.dart`, etc.

## 5. Verification
- Since I cannot run the app visually, I will:
  - Verify code compilation using `flutter analyze` (if available via `run_command` or just rely on static analysis).
  - Review the code changes to ensure all English strings are replaced.
  - Ensure theme constants match the design requirements.
