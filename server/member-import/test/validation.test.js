'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runValidation } = require('../src/services/validation');
const { ImportStateRepository } = require('../src/repositories/importStateRepository');
const { WorkLog } = require('../src/services/workLog');
const defaultConfig = require('../src/config');

function fakeSource(headers, rows) {
  return { fetchHeaderAndRows: async () => ({ headers, rows }) };
}

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-validation-'));
  const importStateRepo = new ImportStateRepository(path.join(dir, 'import-state.json'));
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  return { dir, importStateRepo, workLog };
}

const headers = ['電話番号', 'お名前'];

test('整合性が取れている状態はOKになる', async () => {
  const env = makeEnv();
  const rows = [
    ['09011112222', '客A'],
    ['', '客B']
  ];
  env.importStateRepo.upsertMany([
    { rowNumber: 2, fingerprint: 'f1', phoneNormalized: '09011112222', judge: 'NEW', linkedMemberId: 'NEW-AAAA' },
    { rowNumber: 3, fingerprint: 'f2', phoneNormalized: '', judge: 'BLANK_NEW', linkedMemberId: '' }
  ]);
  const result = await runValidation({ sheetSource: fakeSource(headers, rows), ...env, config: defaultConfig });
  assert.equal(result.ok, true);
});

test('NAME_ONLY_HOLDは電話番号が空欄でも矛盾として検知しない（回帰テスト）', async () => {
  const env = makeEnv();
  const rows = [['', '高橋三郎']];
  env.importStateRepo.upsertMany([
    { rowNumber: 2, fingerprint: 'f1', phoneNormalized: '', judge: 'NAME_ONLY_HOLD', linkedMemberId: '' }
  ]);
  const result = await runValidation({ sheetSource: fakeSource(headers, rows), ...env, config: defaultConfig });
  assert.equal(result.ok, true);
});

test('電話番号の空欄状態と判定が食い違うと検知する', async () => {
  const env = makeEnv();
  const rows = [['09011112222', '客A']];
  // 実際は電話番号ありなのに BLANK_NEW と記録されている矛盾したデータ
  env.importStateRepo.upsertMany([
    { rowNumber: 2, fingerprint: 'f1', phoneNormalized: '', judge: 'BLANK_NEW', linkedMemberId: '' }
  ]);
  const result = await runValidation({ sheetSource: fakeSource(headers, rows), ...env, config: defaultConfig });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('BLANK_NEW判定なのに')));
});

test('同一電話番号に複数の新規IDが発行されている不整合を検知する', async () => {
  const env = makeEnv();
  const rows = [
    ['09099998888', '客A'],
    ['09099998888', '客B']
  ];
  env.importStateRepo.upsertMany([
    { rowNumber: 2, fingerprint: 'f1', phoneNormalized: '09099998888', judge: 'NEW', linkedMemberId: 'NEW-AAAA' },
    { rowNumber: 3, fingerprint: 'f2', phoneNormalized: '09099998888', judge: 'NEW', linkedMemberId: 'NEW-BBBB' }
  ]);
  const result = await runValidation({ sheetSource: fakeSource(headers, rows), ...env, config: defaultConfig });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('複数の新規IDが発行')));
});

test('同一の新規IDが複数の電話番号に発行されている不整合を検知する', async () => {
  const env = makeEnv();
  const rows = [
    ['09011110000', '客A'],
    ['09022220000', '客B']
  ];
  env.importStateRepo.upsertMany([
    { rowNumber: 2, fingerprint: 'f1', phoneNormalized: '09011110000', judge: 'NEW', linkedMemberId: 'NEW-SAME' },
    { rowNumber: 3, fingerprint: 'f2', phoneNormalized: '09022220000', judge: 'NEW', linkedMemberId: 'NEW-SAME' }
  ]);
  const result = await runValidation({ sheetSource: fakeSource(headers, rows), ...env, config: defaultConfig });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('複数の異なる電話番号')));
});
