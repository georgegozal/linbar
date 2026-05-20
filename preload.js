const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("taskbar", {
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  activateTask: (appName) => ipcRenderer.invoke("tasks:activate", appName),
  openApp: (appName) => ipcRenderer.invoke("app:open", appName),
  openPath: (target) => ipcRenderer.invoke("path:open", target),
  openSpecialPath: (key) => ipcRenderer.invoke("path:special", key),
  toggleMute: () => ipcRenderer.invoke("audio:toggleMute"),
  getVolume: () => ipcRenderer.invoke("audio:getVolume"),
  getClipboardPreview: () => ipcRenderer.invoke("clipboard:preview"),
  openAboutMac: () => ipcRenderer.invoke("sys:aboutMac"),
  openNotificationSettings: () => ipcRenderer.invoke("sys:notificationSettings"),
  openSystemSettings: () => ipcRenderer.invoke("sys:settings"),
});
