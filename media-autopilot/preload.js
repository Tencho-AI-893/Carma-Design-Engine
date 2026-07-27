"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("state:get"),
  getLogs: () => ipcRenderer.invoke("logs:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  launchLogin: () => ipcRenderer.invoke("login:launch"),
  finishLogin: () => ipcRenderer.invoke("login:finish"),
  generateDrafts: () => ipcRenderer.invoke("drafts:generate"),
  sendDrafts: (ids) => ipcRenderer.invoke("drafts:send", ids),
  deleteDrafts: (ids) => ipcRenderer.invoke("drafts:delete", ids),
  addInterview: (payload) => ipcRenderer.invoke("interviews:add", payload),
  setInterviewStage: (id, stage) => ipcRenderer.invoke("interviews:stage", { id, stage }),
  onState: (cb) => ipcRenderer.on("state", (_e, state) => cb(state)),
  onLog: (cb) => ipcRenderer.on("log", (_e, line) => cb(line))
});
