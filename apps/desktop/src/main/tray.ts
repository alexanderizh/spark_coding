import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { showMainWindow, setQuitting } from './window-manager'

let tray: Tray | null = null

export function createTray(): void {
  // Use a 16x16 blank image as placeholder; replace with real icon in production
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Spark Coder')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Spark Coder',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        setQuitting(true)
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)

  // Single-click on tray icon shows the window
  tray.on('click', () => showMainWindow())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
