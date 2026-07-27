"use strict";
// レンダラー: 状態表示とユーザー操作。ロジックはすべてメインプロセス側。

const $ = (sel) => document.querySelector(sel);
const STAGE_LABELS = {
  set: "設定済",
  reminded: "リマインド済",
  visited: "来店",
  noshow: "飛び",
  hired: "採用"
};
const STATUS_LABELS = { draft: "draft", sent: "sent", "dry-run": "dry-run", failed: "failed", skipped: "skipped" };

let state = null;
const selectedDrafts = new Set();
const selectedInterviews = new Set();

// === タブ切替 ===
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// === 描画 ===
function fmtDate(iso) {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}

function render() {
  if (!state) return;
  const s = state.settings;

  $("#card-mode").textContent = s.dryRun ? "dry-run" : "本番";
  $("#card-sent").textContent = `${state.sentToday} / ${s.dailyCap}`;
  $("#card-rate").textContent = `${state.stats.rate}%`;
  $("#card-bump").textContent = `${state.bumpRunning ? "ON" : "OFF"} / ${s.bumpIntervalMin}分`;
  $("#login-status").textContent = state.loggedIn ? "ログイン状態: 保存済み" : "ログイン状態: 未ログイン";

  // 下書きテーブル
  const dtbody = $("#drafts-table tbody");
  dtbody.innerHTML = "";
  for (const d of state.drafts) {
    const tr = document.createElement("tr");
    tr.dataset.id = d.id;
    if (selectedDrafts.has(d.id)) tr.classList.add("selected");
    tr.innerHTML = `
      <td><input type="checkbox" ${selectedDrafts.has(d.id) ? "checked" : ""}></td>
      <td>${d.id}</td>
      <td></td>
      <td></td>
      <td><span class="status-badge st-${d.status}">${STATUS_LABELS[d.status] || d.status}</span></td>
      <td>${fmtDate(d.createdAt)}</td>`;
    tr.children[2].textContent = d.member;
    tr.children[3].textContent = d.subject;
    tr.addEventListener("click", () => {
      if (selectedDrafts.has(d.id)) selectedDrafts.delete(d.id);
      else selectedDrafts.add(d.id);
      render();
    });
    dtbody.appendChild(tr);
  }

  // 面接統計
  const st = state.stats;
  $("#interview-stats").textContent =
    `設定済 ${st.set} / リマインド ${st.reminded} / 来店 ${st.visited} / 飛び ${st.noshow} / 採用 ${st.hired}` +
    ` — 設定→来店 歩留まり ${st.rate}%（母数 ${st.denominator}）`;

  // 面接テーブル
  const itbody = $("#interviews-table tbody");
  itbody.innerHTML = "";
  for (const iv of state.interviews) {
    const tr = document.createElement("tr");
    tr.dataset.id = iv.id;
    if (selectedInterviews.has(iv.id)) tr.classList.add("selected");
    tr.innerHTML = `
      <td><input type="checkbox" ${selectedInterviews.has(iv.id) ? "checked" : ""}></td>
      <td>${iv.id}</td>
      <td></td>
      <td></td>
      <td>${STAGE_LABELS[iv.stage] || iv.stage}</td>
      <td>${fmtDate(iv.scheduledAt)}</td>
      <td>${fmtDate(iv.resultAt)}</td>`;
    tr.children[2].textContent = iv.member + (iv.note ? `（${iv.note}）` : "");
    tr.children[3].textContent = iv.source;
    tr.addEventListener("click", () => {
      if (selectedInterviews.has(iv.id)) selectedInterviews.delete(iv.id);
      else selectedInterviews.add(iv.id);
      render();
    });
    itbody.appendChild(tr);
  }

  // 設定フォーム（フォーカス中は上書きしない）
  if (!document.activeElement || !document.activeElement.id.startsWith("set-")) {
    $("#set-loginUrl").value = s.loginUrl;
    $("#set-loginId").value = s.loginId;
    $("#set-loginPassword").value = s.loginPassword;
    $("#set-dryRun").checked = s.dryRun;
    $("#set-dailyCap").value = s.dailyCap;
    $("#set-listUrl").value = s.listUrl;
    $("#set-maxPages").value = s.maxPages;
    $("#set-subjectTemplate").value = s.subjectTemplate;
    $("#set-bodyTemplate").value = s.bodyTemplate;
    $("#set-bumpEnabled").checked = s.bumpEnabled;
    $("#set-bumpIntervalMin").value = s.bumpIntervalMin;
    $("#set-bumpUrl").value = s.bumpUrl;
    $("#set-bumpSelector").value = s.bumpSelector;
  }
}

async function call(fn, btn) {
  if (btn) btn.disabled = true;
  try {
    state = await fn();
    render();
  } catch (err) {
    alert(err.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
  } finally {
    if (btn) btn.disabled = false;
  }
}

// === ボタン ===
$("#btn-launch-login").addEventListener("click", (e) => call(() => window.api.launchLogin(), e.target));
$("#btn-finish-login").addEventListener("click", (e) => call(() => window.api.finishLogin(), e.target));
$("#btn-generate").addEventListener("click", (e) => call(() => window.api.generateDrafts(), e.target));

$("#btn-send").addEventListener("click", (e) => {
  const ids = [...selectedDrafts];
  if (ids.length === 0) return alert("送信する下書きを選択してください");
  call(async () => {
    const st = await window.api.sendDrafts(ids);
    selectedDrafts.clear();
    return st;
  }, e.target);
});

$("#btn-delete").addEventListener("click", (e) => {
  const ids = [...selectedDrafts];
  if (ids.length === 0) return alert("削除する下書きを選択してください");
  if (!confirm(`${ids.length}件の下書きを削除しますか？`)) return;
  call(async () => {
    const st = await window.api.deleteDrafts(ids);
    selectedDrafts.clear();
    return st;
  }, e.target);
});

$("#btn-add-interview").addEventListener("click", (e) => {
  call(async () => {
    const st = await window.api.addInterview({
      member: $("#iv-member").value.trim(),
      scheduledAt: $("#iv-datetime").value,
      source: $("#iv-source").value.trim() || "scout",
      note: $("#iv-note").value.trim()
    });
    $("#iv-member").value = "";
    $("#iv-note").value = "";
    return st;
  }, e.target);
});

document.querySelectorAll(".stage-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ids = [...selectedInterviews];
    if (ids.length === 0) return alert("対象の面接を選択してください");
    call(async () => {
      let st;
      for (const id of ids) st = await window.api.setInterviewStage(id, btn.dataset.stage);
      selectedInterviews.clear();
      return st;
    }, btn);
  });
});

$("#btn-save-settings").addEventListener("click", (e) => {
  call(async () => {
    const st = await window.api.saveSettings({
      loginUrl: $("#set-loginUrl").value.trim(),
      loginId: $("#set-loginId").value.trim(),
      loginPassword: $("#set-loginPassword").value,
      dryRun: $("#set-dryRun").checked,
      dailyCap: parseInt($("#set-dailyCap").value) || 30,
      listUrl: $("#set-listUrl").value.trim(),
      maxPages: parseInt($("#set-maxPages").value) || 2,
      subjectTemplate: $("#set-subjectTemplate").value,
      bodyTemplate: $("#set-bodyTemplate").value,
      bumpEnabled: $("#set-bumpEnabled").checked,
      bumpIntervalMin: parseInt($("#set-bumpIntervalMin").value) || 30,
      bumpUrl: $("#set-bumpUrl").value.trim(),
      bumpSelector: $("#set-bumpSelector").value.trim()
    });
    $("#settings-status").textContent = "保存しました";
    setTimeout(() => ($("#settings-status").textContent = ""), 3000);
    return st;
  }, e.target);
});

// === ログ ===
function appendLog(line) {
  const view = $("#log-view");
  view.textContent += line + "\n";
  view.scrollTop = view.scrollHeight;
}

// === 初期化 ===
(async () => {
  // 面接日時の初期値を現在時刻に
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("#iv-datetime").value = now.toISOString().slice(0, 16);

  window.api.onState((s) => { state = s; render(); });
  window.api.onLog(appendLog);
  state = await window.api.getState();
  (await window.api.getLogs()).forEach(appendLog);
  render();
})();
