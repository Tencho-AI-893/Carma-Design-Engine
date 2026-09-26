'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runMatching } = require('../src/services/matching');
const { runPreflight } = require('../src/services/preflight');
const { JsonFileMemberRepository } = require('../src/repositories/memberRepository');
const { ImportStateRepository } = require('../src/repositories/importStateRepository');
const { WorkLog } = require('../src/services/workLog');
const defaultConfig = require('../src/config');

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-scale-'));
  const importStateRepo = new ImportStateRepository(path.join(dir, 'import-state.json'));
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  return { dir, importStateRepo, workLog };
}

function fakeSource(headers, rows) {
  return { fetchHeaderAndRows: async () => ({ headers, rows }) };
}

test('1件だけのデータでも正しく処理できる', async () => {
  const env = makeEnv();
  const memberRepository = new JsonFileMemberRepository(path.join(__dirname, 'fixtures', 'members.json'));
  const sheetSource = fakeSource(['電話番号', 'お名前'], [['09011111111', '佐藤 花子']]);
  const result = await runMatching({ sheetSource, memberRepository, ...env, dryRun: false });
  assert.equal(result.totalRows, 1);
  assert.equal(result.results[0].judge, 'MATCHED');
});

test('データ0件でも例外にならない', async () => {
  const env = makeEnv();
  const memberRepository = new JsonFileMemberRepository(path.join(__dirname, 'fixtures', 'members.json'));
  const sheetSource = fakeSource(['電話番号', 'お名前'], []);
  const result = await runMatching({ sheetSource, memberRepository, ...env, dryRun: false });
  assert.equal(result.totalRows, 0);
  assert.deepEqual(result.counts, {
    matched: 0,
    brandNew: 0,
    blankNew: 0,
    nameOnlyHold: 0,
    skipped: 0,
    fingerprintMismatch: 0
  });

  const preflight = await runPreflight({ sheetSource, memberRepository, ...env, config: defaultConfig });
  assert.equal(preflight.ok, true);
  assert.ok(preflight.warnings.some((w) => w.includes('0件')));
});

test('約1万件規模でも正しく・現実的な時間で処理できる（重複電話番号・重複ID検知含む）', async () => {
  const env = makeEnv();

  const members = [];
  for (let i = 0; i < 3000; i++) {
    members.push({ memberId: 'M-' + i, name: '既存会員' + i, phone: '080' + String(1000000 + i) });
  }
  const membersPath = path.join(env.dir, 'members-large.json');
  fs.writeFileSync(membersPath, JSON.stringify(members));
  const memberRepository = new JsonFileMemberRepository(membersPath);

  const headers = ['電話番号', 'お名前'];
  const rows = [];
  const TOTAL = 10000;
  for (let i = 0; i < TOTAL; i++) {
    if (i % 5 === 0) {
      // 既存会員と一致させる
      rows.push(['080' + String(1000000 + (i % 3000)), '既存会員' + (i % 3000)]);
    } else if (i % 5 === 1) {
      // 電話番号空欄
      rows.push(['', '新規名前' + i]);
    } else if (i % 5 === 2) {
      // 同一電話番号を複数行で使い回す（新規IDの重複発行が起きないことを確認する）
      rows.push(['0901234' + String(i % 7).padStart(4, '0'), '重複電話番号さん' + i]);
    } else {
      // 完全にユニークな新規
      rows.push(['0709' + String(2000000 + i), 'ユニーク新規' + i]);
    }
  }

  const sheetSource = fakeSource(headers, rows);

  const start = Date.now();
  const result = await runMatching({ sheetSource, memberRepository, ...env, dryRun: false });
  const elapsedMs = Date.now() - start;

  assert.equal(result.totalRows, TOTAL);
  assert.equal(result.errorRows.length, 0);
  assert.ok(elapsedMs < 15000, '1万件の処理が15秒以内に終わること（実測: ' + elapsedMs + 'ms）');

  // 同一電話番号(7パターンに集約)の新規行が、それぞれ単一のIDに集約されているか検証
  const dupPhoneRows = result.results.filter((r) => /^重複電話番号さん/.test(r.name));
  const idsByPhone = new Map();
  dupPhoneRows.forEach((r) => {
    const phone = r.phone;
    if (!idsByPhone.has(phone)) idsByPhone.set(phone, new Set());
    idsByPhone.get(phone).add(r.linkedMemberId);
  });
  idsByPhone.forEach((idSet) => {
    assert.equal(idSet.size, 1, '同一電話番号には同一の新規IDが割り当てられるべき');
  });
});
