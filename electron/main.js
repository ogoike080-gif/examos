const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

let mainWindow;
let isExamMode = false;

const VITE_DEV_SERVER = 'http://localhost:3000';
const PROD_URL = `file://${path.join(__dirname, '../client/dist/index.html')}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'ExamOS 2026',
    backgroundColor: '#0D0F12',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  mainWindow.loadURL(isDev ? VITE_DEV_SERVER : PROD_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Prevent navigation away from app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(isDev ? VITE_DEV_SERVER : 'file://')) {
      event.preventDefault();
    }
  });

  // Block new windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Block dev tools in exam mode
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isExamMode) {
      const blocked = [
        input.key === 'F12',
        input.control && input.shift && input.key === 'I',
        input.control && input.shift && input.key === 'J',
        input.control && input.key === 'u',
        input.key === 'F5',
        input.control && input.key === 'r',
        input.alt && input.key === 'F4',
        input.meta && input.key === 'q',
      ];
      if (blocked.some(Boolean)) {
        event.preventDefault();
        mainWindow.webContents.send('security-violation', {
          type: 'keyboard_block',
          key: `${input.control ? 'Ctrl+' : ''}${input.alt ? 'Alt+' : ''}${input.shift ? 'Shift+' : ''}${input.key}`,
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  mainWindow.on('close', (event) => {
    if (isExamMode) {
      event.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Exam In Progress',
        message: 'You cannot close the application during an active exam.',
        detail: 'This attempt has been logged. Contact your proctor if you have an emergency.',
        buttons: ['Return to Exam'],
      });
      mainWindow.webContents.send('security-violation', {
        type: 'close_attempt',
        timestamp: new Date().toISOString(),
      });
    }
  });
}

// IPC: Enter exam kiosk mode
ipcMain.handle('enter-exam-mode', async () => {
  isExamMode = true;
  mainWindow.setFullScreen(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setKiosk(true);
  Menu.setApplicationMenu(null);
  return { success: true };
});

// IPC: Exit exam mode (admin only)
ipcMain.handle('exit-exam-mode', async (event, { adminToken }) => {
  // Validate admin token before allowing exit
  if (adminToken === process.env.ADMIN_EXIT_TOKEN) {
    isExamMode = false;
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setKiosk(false);
    return { success: true };
  }
  return { success: false, error: 'Invalid admin token' };
});

// IPC: Get system info for device fingerprinting
ipcMain.handle('get-device-info', async () => {
  const os = require('os');
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
  };
});

// IPC: Screenshot detection (Windows)
ipcMain.handle('check-screenshot', async () => {
  return { detected: false };
});

app.whenReady().then(() => {
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
