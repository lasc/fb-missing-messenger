import { app, shell, BrowserWindow, ipcMain, Menu, nativeImage, session, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function createWindow(): void {
  // Create the browser window.
  // Resolve icon path: dev vs prod
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // Mac style
    icon: icon, // Window icon (Linux/Windows)
    title: 'FB Missing Messenger',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true // Enable webview tag
    }
  })

  // Set Dock Icon for macOS (Dev mode especially)
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
  
  // IPC for opening external URLs in default browser
  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  // IPC for Context Menu


  let lastTotalUnreadCount = 0
  let lastBounceTime = 0

  // IPC for showing native notifications
  ipcMain.on('show-notification', (_event, { title, body }) => {
    console.log('DYAD: Main process showing notification:', title, body)
    const notification = new Notification({
      title,
      body,
      silent: false
    })
    notification.show()
    notification.on('click', () => {
      console.log('DYAD: Notification clicked')
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })

    // Bounce dock if not focused
    if (!mainWindow.isFocused() && process.platform === 'darwin') {
      console.log('DYAD: Bouncing dock')
      app.dock?.bounce('informational')
    }
  })

  // IPC for unread count (Dock Badge)
  ipcMain.on('unread-count', (_event, count: number) => {
    // Only log if changed to reduce noise
    if (count !== lastTotalUnreadCount) {
        console.log('DYAD: Main process unread update:', count, 'Prev:', lastTotalUnreadCount)
    }

    if (process.platform === 'darwin') {
      app.setBadgeCount(count)
      
      // Bounce logic with cooldown and suppression
      const now = Date.now()
      const isIncrease = count > lastTotalUnreadCount
      const timeSinceLastBounce = now - lastBounceTime
      
      // Only bounce if:
      // 1. Count actually increased
      // 2. Window is not focused
      // 3. It's been at least 2 seconds since last bounce (prevent rapid flapping)
      if (isIncrease && !mainWindow.isFocused() && timeSinceLastBounce > 2000) {
          console.log('DYAD: Bouncing dock (throttled)')
          app.dock?.bounce('informational')
          lastBounceTime = now
      }
    }
    lastTotalUnreadCount = count
  })

  // IPC for getting webview preload path
  ipcMain.handle('get-webview-preload-path', () => {
    return join(__dirname, '../preload/webview-preload.js')
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.dyad.fbmissingmessenger')
  app.setName('FB Missing Messenger')
  app.setAboutPanelOptions({
    applicationName: 'FB Missing Messenger',
    applicationVersion: '1.0.0',
    credits: 'A native wrapper for Messenger and Marketplace with power features',
    copyright: '© 2026 Eugeny Perepelyatnikov peugeny@gmail.com'
  })

  // Handle permissions (Notifications)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
      return
    }
    callback(false)
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
