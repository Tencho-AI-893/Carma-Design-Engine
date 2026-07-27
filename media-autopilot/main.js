"use strict";
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { Store } = require("./src/store");
const { Automation } = require("./src/automation");

let win = null;
let store = null;
let automation = null;
let bumpTimer = null;
let logBuffer = [];

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logBuffer.push(line);
  if (logBuffer.length > 2000) logBuffer = logBuffer.slice(-1000);
  const logsDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(
    path.join(logsDir, `app_${new Date().toISOString().slice(0, 10)}.log`),
    line + "\n"
  );
  if (win && !win.isDestroyed()) win.webContents.send("log", line);
}

function snapshot() {
  return {
    settings: store.getSettings(),
    drafts: store.listDrafts(),
    interviews: store.listInterviews(),
    stats: store.interviewStats(),
    sentToday: store.sentToday(),
    bumpRunning: bumpTimer !== null,
    loggedIn: automation.hasAuthState()
  };
}

function pushState() {
  if (win && !win.isDestroyed()) win.webContents.send("state", snapshot());
}

// === 定期更新(bump)スケジューラ ===
function startBump() {
  stopBump();
  const s = store.getSettings();
  if (!s.bumpEnabled) return;
  const ms = Math.max(1, s.bumpIntervalMin) * 60 * 1000;
  bumpTimer = setInterval(() => {
    automation.bumpOnce(store.getSettings()).catch((e) => logLine(`bumpエラー: ${e.message}`));
  }, ms);
  logLine(`定期更新(bump)を開始: ${s.bumpIntervalMin}分間隔`);
}

function stopBump() {
  if (bumpTimer) {
    clearInterval(bumpTimer);
    bumpTimer = null;
    logLine("定期更新(bump)を停止");
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 920,
    title: "Media AutoPilot - イチゴナビ（求人）自動化",
    backgroundColor: "#16181d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  const dataDir = app.getPath("userData");
  store = new Store(dataDir);
  automation = new Automation(dataDir, logLine);
  createWindow();
  if (store.getSettings().bumpEnabled) startBump();
  logLine("Media AutoPilot 起動");
});

app.on("window-all-closed", () => {
  stopBump();
  app.quit();
});

// === IPC ===
ipcMain.handle("state:get", () => snapshot());
ipcMain.handle("logs:get", () => logBuffer);

ipcMain.handle("settings:save", (_e, patch) => {
  store.updateSettings(patch);
  // bump設定が変わった場合はスケジューラを組み直す
  if (store.getSettings().bumpEnabled) startBump();
  else stopBump();
  logLine("設定を保存しました");
  return snapshot();
});

ipcMain.handle("login:launch", async () => {
  await automation.launchLogin(store.getSettings());
  return snapshot();
});

ipcMain.handle("login:finish", async () => {
  await automation.finishLogin();
  pushState();
  return snapshot();
});

ipcMain.handle("drafts:generate", async () => {
  const targets = await automation.collectTargets(store.getSettings());
  let created = 0;
  for (const t of targets) {
    if (store.addDraft(t)) created++;
  }
  logLine(`下書きを${created}件作成（重複除外: ${targets.length - created}件）`);
  pushState();
  return snapshot();
});

ipcMain.handle("drafts:send", async (_e, ids) => {
  const s = store.getSettings();
  const drafts = store.listDrafts().filter((d) => ids.includes(d.id) && d.status === "draft");
  if (drafts.length === 0) throw new Error("送信できる下書きが選択されていません");

  if (!s.dryRun) {
    const remaining = store.remainingToday();
    if (remaining <= 0) throw new Error(`本日の送信上限(${s.dailyCap}件)に到達しています`);
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["キャンセル", "送信する"],
      defaultId: 0,
      cancelId: 0,
      title: "送信確認",
      message: `${Math.min(drafts.length, remaining)}件を実送信します。よろしいですか？`,
      detail: `本日の残り送信可能数: ${remaining}件 / モード: 本番`
    });
    if (response !== 1) {
      logLine("送信をキャンセルしました");
      return snapshot();
    }
  }

  await automation.sendDrafts(drafts, s, {
    canSend: () => s.dryRun || store.remainingToday() > 0,
    onResult: (draft, result) => {
      store.setDraftStatus(draft.id, result.status, result.reason);
      if (result.status === "sent") store.incrementSent();
      pushState();
    }
  });
  pushState();
  return snapshot();
});

ipcMain.handle("drafts:delete", (_e, ids) => {
  store.deleteDrafts(ids);
  logLine(`下書きを${ids.length}件削除`);
  return snapshot();
});

ipcMain.handle("interviews:add", (_e, payload) => {
  if (!payload.member || !payload.scheduledAt) {
    throw new Error("会員名と面接日時は必須です");
  }
  store.addInterview(payload);
  logLine(`面接を登録: ${payload.member}`);
  return snapshot();
});

ipcMain.handle("interviews:stage", (_e, { id, stage }) => {
  store.setInterviewStage(id, stage);
  return snapshot();
});
