const { contextBridge, ipcRenderer } = require("electron");

function subscribeTasks(listener) {
  if (typeof listener !== "function") return () => {};
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on("taskbar:tasksUpdated", handler);
  return () => ipcRenderer.removeListener("taskbar:tasksUpdated", handler);
}

contextBridge.exposeInMainWorld("taskbar", {
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  subscribeTasks,
  pokeTasks: () => ipcRenderer.send("tasks:poke"),
  activateTask: (task) => ipcRenderer.invoke("tasks:activate", task),
  minimizeTask: (task) => ipcRenderer.invoke("window:minimize", task),
  closeTask: (task) => ipcRenderer.invoke("window:close", task),
  contextMenuTask: (task) => ipcRenderer.send("window:contextmenu", task),
  getAppIcon: (appName) => ipcRenderer.invoke("icon:get", appName),
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
