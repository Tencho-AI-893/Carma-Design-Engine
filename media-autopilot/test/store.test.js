"use strict";
// storeレイヤーのスモークテスト: node test/store.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { Store } = require("../src/store");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "map-test-"));
const store = new Store(dir);

// 設定
assert.strictEqual(store.getSettings().dryRun, true, "初期はdry-run");
store.updateSettings({ dailyCap: 5 });
assert.strictEqual(store.getSettings().dailyCap, 5);

// 下書き
const d1 = store.addDraft({ member: "test01", detailUrl: "https://example.com/detail?id=1" });
assert.ok(d1 && d1.id === 1);
assert.strictEqual(store.addDraft({ member: "test01", detailUrl: "x" }), null, "重複は作らない");
const d2 = store.addDraft({ member: "test02", detailUrl: "https://example.com/detail?id=2" });
store.setDraftStatus(d2.id, "sent");
store.incrementSent();
assert.strictEqual(store.sentToday(), 1);
assert.strictEqual(store.remainingToday(), 4);
store.deleteDrafts([d1.id]);
assert.strictEqual(store.listDrafts().length, 1);

// 面接
const iv1 = store.addInterview({ member: "A", source: "scout", scheduledAt: "2026-07-27T23:44" });
const iv2 = store.addInterview({ member: "B", source: "scout", scheduledAt: "2026-07-28T12:00" });
store.addInterview({ member: "C", source: "scout", scheduledAt: "2026-07-29T12:00" });
store.setInterviewStage(iv1.id, "visited");
store.setInterviewStage(iv2.id, "hired");
const stats = store.interviewStats();
assert.strictEqual(stats.set, 3);
assert.strictEqual(stats.visited, 2, "来店+採用が来店扱い");
assert.strictEqual(stats.hired, 1);
assert.strictEqual(stats.rate, 67);

// 再読み込みで永続化されていること
const store2 = new Store(dir);
assert.strictEqual(store2.listDrafts().length, 1);
assert.strictEqual(store2.listInterviews().length, 3);
assert.strictEqual(store2.getSettings().dailyCap, 5);

fs.rmSync(dir, { recursive: true, force: true });
console.log("store.test.js: すべてOK");
