"use strict";
// JSONファイルによる永続化レイヤー。
// Electron外（テスト・CLI）でも動くよう、保存先ディレクトリはコンストラクタで受け取る。

const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  loginUrl: "https://suser.15navi.com/",
  loginId: "",
  loginPassword: "",
  dryRun: true,
  dailyCap: 30,
  listUrl: "https://suser.15navi.com/offer/list.aspx?sort=regist",
  maxPages: 2,
  subjectTemplate: "ご連絡",
  bodyTemplate: `突然のご連絡、失礼します。
2001年から梅田で続いているプライベートクラブCarmaです。
派手に募集はしていませんが、ご縁がありそうな方にだけお知らせしています。

自分のペースで、自分の判断で動きたい。
そういう方が長く続いている場所です。

もし少しでも気になれば、LINEで「話だけ」と送ってもらえれば十分です。
急かしません。`,
  bumpEnabled: true,
  bumpIntervalMin: 30,
  bumpUrl: "",
  bumpSelector: ""
};

// 面接ステージ: set(設定済) → reminded(リマインド済) → visited(来店) / noshow(飛び) → hired(採用)
const STAGES = ["set", "reminded", "visited", "noshow", "hired"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "store.json");
    fs.mkdirSync(dir, { recursive: true });
    this.data = this._load();
  }

  _load() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      raw = {};
    }
    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      drafts: raw.drafts || [],
      interviews: raw.interviews || [],
      counters: raw.counters || {},
      nextDraftId: raw.nextDraftId || 1,
      nextInterviewId: raw.nextInterviewId || 1
    };
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  // === 設定 ===
  getSettings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  // === 本日送信カウンタ ===
  sentToday() {
    return this.data.counters[today()] || 0;
  }

  incrementSent() {
    this.data.counters[today()] = this.sentToday() + 1;
    this.save();
  }

  remainingToday() {
    return Math.max(0, this.data.settings.dailyCap - this.sentToday());
  }

  // === 下書き ===
  listDrafts() {
    return [...this.data.drafts].sort((a, b) => b.id - a.id);
  }

  // 同じ会員の下書き/送信済みがあれば作らない
  addDraft({ member, detailUrl }) {
    const dup = this.data.drafts.find((d) => d.member === member && d.status !== "failed");
    if (dup) return null;
    const s = this.data.settings;
    const draft = {
      id: this.data.nextDraftId++,
      member,
      detailUrl,
      subject: s.subjectTemplate.replaceAll("{name}", member),
      body: s.bodyTemplate.replaceAll("{name}", member),
      status: "draft",
      reason: "",
      createdAt: new Date().toISOString(),
      sentAt: null
    };
    this.data.drafts.push(draft);
    this.save();
    return draft;
  }

  setDraftStatus(id, status, reason = "") {
    const d = this.data.drafts.find((x) => x.id === id);
    if (!d) return null;
    d.status = status;
    d.reason = reason;
    if (status === "sent") d.sentAt = new Date().toISOString();
    this.save();
    return d;
  }

  deleteDrafts(ids) {
    const set = new Set(ids);
    this.data.drafts = this.data.drafts.filter((d) => !set.has(d.id));
    this.save();
  }

  // === 面接 ===
  listInterviews() {
    return [...this.data.interviews].sort((a, b) => b.id - a.id);
  }

  addInterview({ member, source, scheduledAt, note }) {
    const iv = {
      id: this.data.nextInterviewId++,
      member,
      source: source || "scout",
      stage: "set",
      scheduledAt,
      note: note || "",
      createdAt: new Date().toISOString(),
      resultAt: null
    };
    this.data.interviews.push(iv);
    this.save();
    return iv;
  }

  setInterviewStage(id, stage) {
    if (!STAGES.includes(stage)) throw new Error(`不正なステージ: ${stage}`);
    const iv = this.data.interviews.find((x) => x.id === id);
    if (!iv) return null;
    iv.stage = stage;
    if (stage === "visited" || stage === "noshow") {
      iv.resultAt = new Date().toISOString();
    }
    this.save();
    return iv;
  }

  // 設定→来店の歩留まり集計
  interviewStats() {
    const ivs = this.data.interviews;
    const count = (st) => ivs.filter((i) => i.stage === st).length;
    const total = ivs.length;
    // 来店以降(来店・採用)を来店扱いにする
    const visited = count("visited") + count("hired");
    return {
      set: total,
      reminded: count("reminded"),
      visited,
      noshow: count("noshow"),
      hired: count("hired"),
      rate: total > 0 ? Math.round((visited / total) * 100) : 0,
      denominator: total
    };
  }
}

module.exports = { Store, DEFAULT_SETTINGS, STAGES };
