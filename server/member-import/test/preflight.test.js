'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPreflight } = require('../src/services/preflight');
const { FixtureSheetSource } = require('../src/sources/sheetSource');
const { JsonFileMemberRepository } = require('../src/repositories/memberRepository');
const { ImportStateRepository } = require('../src/repositories/importStateRepository');
const defaultConfig = require('../src/config');

const fixturesDir = path.join(__dirname, 'fixtures');

function makeEnv(overrideBackupDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-preflight-'));
  const sheetSource = new FixtureSheetSource(path.join(fixturesDir, 'form-responses.json'));
  const memberRepository = new JsonFileMemberRepository(path.join(fixturesDir, 'members.json'));
  const importStateRepo = new ImportStateRepository(path.join(dir, 'import-state.json'));
  const config = Object.assign({}, defaultConfig, { BACKUP_DIR: overrideBackupDir || path.join(dir, 'backups') });
  return { dir, sheetSource, memberRepository, importStateRepo, config };
}

function fakeSource(headers, rows) {
  return { fetchHeaderAndRows: async () => ({ headers, rows }) };
}

test('正常なデータではSTOPが出ない', async () => {
  const env = makeEnv();
  const result = await runPreflight(env);
  assert.equal(result.ok, true);
  assert.equal(result.stops.length, 0);
  assert.equal(result.metrics.totalRows, 9);
  assert.equal(result.metrics.blankPhoneCount, 2); // row3(氏名候補なし)・row7(氏名候補あり)の2件
  assert.equal(result.metrics.duplicatePhoneGroupCount, 1); // row8/9の重複
  assert.equal(result.metrics.nameCandidateCount >= 2, true); // row7,10 相当
});

test('電話番号列が見つからない場合はSTOPで停止する', async () => {
  const env = makeEnv();
  env.sheetSource = fakeSource(['お名前', '担当キャスト'], [['山田太郎', 'キャストA']]);
  const result = await runPreflight(env);
  assert.equal(result.ok, false);
  assert.ok(result.stops.some((s) => s.includes('電話番号列')));
});

test('列名が重複しているとSTOPで停止する', async () => {
  const env = makeEnv();
  env.sheetSource = fakeSource(['電話番号', 'お名前', '電話番号'], [['09011112222', '山田太郎', '09011112222']]);
  const result = await runPreflight(env);
  assert.equal(result.ok, false);
  assert.ok(result.stops.some((s) => s.includes('重複')));
});

test('バックアップ保存先に書き込めない場合はSTOPで停止する', async () => {
  // バックアップ先の途中パスをディレクトリではなく「ファイル」にすることで、
  // root権限で実行されていても確実に書き込み失敗を再現する
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-preflight-badpath-'));
  const blockerFile = path.join(dir, 'blocker-file');
  fs.writeFileSync(blockerFile, 'x');
  const env = makeEnv(path.join(blockerFile, 'backups'));
  const result = await runPreflight(env);
  assert.equal(result.ok, false);
  assert.ok(result.stops.some((s) => s.includes('バックアップ')));
});

test('見出し行が空のシートはSTOPで停止する', async () => {
  const env = makeEnv();
  env.sheetSource = fakeSource([], []);
  const result = await runPreflight(env);
  assert.equal(result.ok, false);
});
