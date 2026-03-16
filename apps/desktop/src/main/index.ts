import { app } from 'electron'
import { config as loadEnv } from 'dotenv'
import { resolve, join } from 'path'
import { execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import os from 'os'

// ── Fix PATH for packaged app on macOS/Linux ───────────────────────────────────
// When launched from Dock/Finder, Electron does NOT inherit the user's shell
// PATH. The `claude` CLI uses shebang `#!/usr/bin/env node`; without node in
// PATH we get "env: node: No such file or directory" (exit 127).
// - Use interactive shell (-i) so .zshrc/.bashrc (where nvm is usually set) is loaded.
// - Also prepend nvm node bin dirs so node is findable even if shell init is minimal.
if (process.platform === 'darwin' || process.platform === 'linux') {
  try {
    const home = os.homedir()

    // 1) Get PATH from interactive shell (loads .zshrc / .bashrc where nvm lives)
    let pathFromShell = ''
    try {
      const shell = process.env.SHELL || '/bin/zsh'
      const output = execFileSync(shell, ['-i', '-c', 'echo $PATH'], {
        encoding: 'utf8',
        timeout:  5000,
        env: {
          HOME:    home,
          USER:    process.env.USER    || os.userInfo().username,
          LOGNAME: process.env.LOGNAME || os.userInfo().username,
          TERM:    'dumb',
        },
      })
      const line = output.split('\n').filter((l: string) => l.includes('/')).at(-1)?.trim()
      if (line) pathFromShell = line
    } catch { /* ignore */ }

    // 2) Prepend nvm node bin dirs so `node` is always findable for claude shebang
    const nvmDir = process.env.NVM_DIR || join(home, '.nvm')
    const versionsDir = join(nvmDir, 'versions', 'node')
    const nvmBinPaths: string[] = []
    if (existsSync(versionsDir)) {
      try {
        const vers = readdirSync(versionsDir).sort().reverse()
        for (const v of vers) {
          const binDir = join(versionsDir, v, 'bin')
          if (existsSync(binDir)) nvmBinPaths.push(binDir)
        }
      } catch { /* ignore */ }
    }

    const basePath = pathFromShell || process.env.PATH || ''
    const prefix  = nvmBinPaths.length ? nvmBinPaths.join(':') + ':' : ''
    if (prefix || pathFromShell) {
      process.env.PATH = prefix + basePath
    }
  } catch { /* keep existing PATH on error */ }
}

// 加载 .env：优先 apps/desktop/.env，其次项目根目录 .env
loadEnv({ path: resolve(process.cwd(), '.env') })
loadEnv({ path: resolve(process.cwd(), 'apps/desktop/.env') })
// 生产构建：加载打包进去的 .prod.env（build-desktop.sh 使用该文件构建）
if (app.isPackaged) {
  loadEnv({ path: join(app.getAppPath(), '.prod.env') })
}
import { createMainWindow, showMainWindow, setQuitting } from './window-manager'
import { createTray } from './tray'
import { setupIpc, maybeAutoStart } from './ipc'
import { getMainWindow } from './window-manager'

// Single instance lock — prevent multiple app instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

// 开发模式下修改应用名称
const appName = app.isPackaged ? 'Spark Coder' : 'Spark Coder Dev'
if (!app.isPackaged) {
  app.setName(appName)
}

app.whenReady().then(async () => {
  const win = createMainWindow(appName)

  createTray(appName)
  setupIpc(() => getMainWindow())

  // Auto-start session once renderer has loaded
  win.webContents.once('did-finish-load', async () => {
    await maybeAutoStart(() => getMainWindow())
  })

  app.on('activate', () => {
    // macOS: re-show window when dock icon is clicked
    showMainWindow()
  })
})

// Keep process alive when all windows are closed (tray mode)
app.on('window-all-closed', () => {
  // Do NOT quit — app stays in system tray
})

app.on('before-quit', () => {
  setQuitting(true)
})
