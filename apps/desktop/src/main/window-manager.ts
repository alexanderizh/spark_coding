import { BrowserWindow, shell, nativeImage } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

const iconPath = join(__dirname, '../../resources/icon.png')

function getWindowIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) return img
  // 固定 32x32，避免任务栏/标题栏显示为一大块
  return img.resize({ width: 32, height: 32 })
}

export function setQuitting(v: boolean): void {
  isQuitting = v
}

export function createMainWindow(appName: string): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    title: appName,
    icon: getWindowIcon(),
    backgroundColor: '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Open external links in OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
