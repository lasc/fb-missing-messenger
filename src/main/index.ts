import { app, shell, BrowserWindow, ipcMain, nativeImage, session, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    icon: icon,
    title: 'FB Missing Messenger',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  
  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  let lastTotalUnreadCount = 0
  let lastBounceTime = 0

  ipcMain.on('show-notification', (_event, { title, body }) => {
    const notification = new Notification({
      title,
      body,
      silent: false
    })
    notification.show()
    notification.on('click', () => {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })

    if (!mainWindow.isFocused() && process.platform === 'darwin') {
      app.dock?.bounce('informational')
    }
  })

  ipcMain.on('unread-count', (_event, count: number) => {
    if (process.platform === 'darwin') {
      app.setBadgeCount(count)
      
      const now = Date.now()
      const isIncrease = count > lastTotalUnreadCount
      const timeSinceLastBounce = now - lastBounceTime
      
      if (isIncrease && !mainWindow.isFocused() && timeSinceLastBounce > 2000) {
          app.dock?.bounce('informational')
          lastBounceTime = now
      }
    }
    lastTotalUnreadCount = count
  })

  ipcMain.handle('get-webview-preload-path', () => {
    return join(__dirname, '../preload/webview-preload.js')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Performance optimization flags (keeping only safe ones that don't affect session storage)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')
app.commandLine.appendSwitch('renderer-process-limit', '4')
app.commandLine.appendSwitch('disable-extensions')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.evame.fbmissingmessenger')
  app.setName('FB Missing Messenger')
  app.setAboutPanelOptions({
    applicationName: 'FB Missing Messenger',
    applicationVersion: '1.1.0',
    credits: 'A native wrapper for Messenger and Marketplace with power features',
    copyright: '© 2026 Eugeny Perepelyatnikov peugeny@gmail.com'
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
      return
    }
    callback(false)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
