const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Exam mode controls
  enterExamMode: () => ipcRenderer.invoke('enter-exam-mode'),
  exitExamMode: (adminToken) => ipcRenderer.invoke('exit-exam-mode', { adminToken }),

  // Device fingerprinting
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // Screenshot detection
  checkScreenshot: () => ipcRenderer.invoke('check-screenshot'),

  // Listen for security violations from main process
  onSecurityViolation: (callback) => {
    ipcRenderer.on('security-violation', (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('security-violation');
  },

  // Platform detection
  platform: process.platform,
  isElectron: true,
});
