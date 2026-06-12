const { contextBridge, ipcRenderer } = require("electron");

function subscribeTasks(listener) {
  if (typeof listener !== "function") return () => {};
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on("taskbar:tasksUpdated", handler);
  return () => ipcRenderer.removeListener("taskbar:tasksUpdated", handler);
}

function subscribePins(listener) {
  if (typeof listener !== "function") return () => {};
  const handler = (_event, pinned) => listener(pinned);
  ipcRenderer.on("taskbar:pinsUpdated", handler);
  return () => ipcRenderer.removeListener("taskbar:pinsUpdated", handler);
}

contextBridge.exposeInMainWorld("taskbar", {
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  subscribeTasks,
  pokeTasks: () => ipcRenderer.send("tasks:poke"),
  activateTask: (task) => ipcRenderer.invoke("tasks:activate", task),
  minimizeTask: (task) => ipcRenderer.invoke("window:minimize", task),
  closeTask: (task) => ipcRenderer.invoke("window:close", task),
  contextMenuTask: (task) => ipcRenderer.send("window:contextmenu", task),
  listInstalledApps: () => ipcRenderer.invoke("apps:list"),
  getAppIconByPath: (appPath) => ipcRenderer.invoke("apps:icon", appPath),
  openAppPath: (appPath) => ipcRenderer.invoke("apps:openPath", appPath),
  getPins: () => ipcRenderer.invoke("pins:list"),
  togglePin: (appName) => ipcRenderer.invoke("pins:toggle", appName),
  getDrawerView: () => ipcRenderer.invoke("drawer:getView"),
  setDrawerView: (view) => ipcRenderer.invoke("drawer:setView", view),
  subscribePins,
  contextMenuPin: (appName) => ipcRenderer.send("pins:contextmenu", appName),
  getAppIcon: (appName) => ipcRenderer.invoke("icon:get", appName),
  openApp: (appName) => ipcRenderer.invoke("app:open", appName),
  openPath: (target) => ipcRenderer.invoke("path:open", target),
  openSpecialPath: (key) => ipcRenderer.invoke("path:special", key),
  toggleMute: () => ipcRenderer.invoke("audio:toggleMute"),
  getVolume: () => ipcRenderer.invoke("audio:getVolume"),
  changeVolume: (delta) => ipcRenderer.invoke("audio:changeVolume", delta),
  setVolume: (level) => ipcRenderer.invoke("audio:setVolume", level),
  getBattery: () => ipcRenderer.invoke("battery:get"),
  openBatterySettings: () => ipcRenderer.invoke("sys:batterySettings"),
  setMouseIgnore: (ignore) => ipcRenderer.send("panel:setMouseIgnore", ignore),
  onBlur: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = () => listener();
    ipcRenderer.on("taskbar:blurred", handler);
    return () => ipcRenderer.removeListener("taskbar:blurred", handler);
  },
  getClipboardHistory: () => ipcRenderer.invoke("clipboard:history"),
  copyClipboardItem: (text) => ipcRenderer.invoke("clipboard:copy", text),
  openAboutMac: () => ipcRenderer.invoke("sys:aboutMac"),
  openNotificationSettings: () => ipcRenderer.invoke("sys:notificationSettings"),
  openSystemSettings: () => ipcRenderer.invoke("sys:settings"),
});
