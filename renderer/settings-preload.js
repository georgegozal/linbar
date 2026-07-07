const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("linbarSettings", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (partial) => ipcRenderer.invoke("config:set", partial),
  openAccessibilitySettings: () => ipcRenderer.invoke("sys:accessibilitySettings"),
});
