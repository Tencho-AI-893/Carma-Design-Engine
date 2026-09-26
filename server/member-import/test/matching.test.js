'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runMatching } = require('../src/services/matching');
const { FixtureSheetSource } = require('../src/sources/sheetSource');
const { JsonFileMemberRepository } = require('../src/repositories/memberRepository');
const { ImportStateRepository } = require('../src/repositories/importStateRepository');
const { WorkLog } = require('../src/services/workLog');

const fixturesDir = path.join(__dirname, 'fixtures');

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-matching-'));
  const sheetSource = new FixtureSheetSource(path.join(fixturesDir, 'form-responses.json'));
  const memberRepository = new JsonFileMemberRepository(path.join(fixturesDir, 'members.json'));
  const importStateRepo = new ImportStateRepository(path.join(dir, 'import-state.json'));
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  return { dir, sheetSource, memberRepository, importStateRepo, workLog };
}

function byRowNumber(results, rowNumber) {
  return results.find((r) => r.rowNumber === rowNumber);
}

test('各行が期待通りに判定される（電話番号の表記ゆれ・氏名候補の優先順位を含む）', async () => {
  const env = makeEnv();
  const result = await runMatching({ ...env, dryRun: true });
  const r = result.results;

  // row2: 佐藤花子 と表記ゆれ違いの電話番号 → 既存一致
  assert.equal(byRowNumber(r, 2).judge, 'MATCHED');
  assert.equal(byRowNumber(r, 2).linkedMemberId, 'M-0001');

  // row3: 電話番号空欄・氏名候補なし → 電話番号なし要確認
  assert.equal(byRowNumber(r, 3).judge, 'BLANK_NEW');

  // row4: 電話番号あり・マスタ不一致・氏名候補なし → 新規
  assert.equal(byRowNumber(r, 4).judge, 'NEW');

  // row5: スペース区切りの電話番号 → 既存一致（鈴木次郎）
  assert.equal(byRowNumber(r, 5).judge, 'MATCHED');
  assert.equal(byRowNumber(r, 5).linkedMemberId, 'M-0002');

  // row6: 全角数字の電話番号 → 既存一致（高橋三郎）
  assert.equal(byRowNumber(r, 6).judge, 'MATCHED');
  assert.equal(byRowNumber(r, 6).linkedMemberId, 'M-0003');

  // row7: 電話番号空欄だが氏名が既存会員と一致 → 保留（電話番号空欄より優先）
  assert.equal(byRowNumber(r, 7).judge, 'NAME_ONLY_HOLD');

  // row8,9: 同一電話番号・マスタ不一致 → どちらも新規だが同じIDが割り当てられる
  const row8 = byRowNumber(r, 8);
  const row9 = byRowNumber(r, 9);
  assert.equal(row8.judge, 'NEW');
  assert.equal(row9.judge, 'NEW');
  assert.equal(row8.linkedMemberId, row9.linkedMemberId, '同一電話番号には同一の新規IDが割り当てられるべき');

  // row10: 電話番号はマスタ不一致だが氏名が一致 → 保留
  assert.equal(byRowNumber(r, 10).judge, 'NAME_ONLY_HOLD');
});

test('Dry Runは import-state ファイルに一切書き込まない', async () => {
  const env = makeEnv();
  await runMatching({ ...env, dryRun: true });
  assert.equal(fs.existsSync(env.importStateRepo.filePath), false);
});

test('本番実行は再実行しても同じ行に別IDを発行しない（べき等性）', async () => {
  const env = makeEnv();
  const first = await runMatching({ ...env, dryRun: false });
  const firstRow8 = byRowNumber(first.results, 8);

  const second = await runMatching({ ...env, dryRun: false });
  const secondRow8 = byRowNumber(second.results, 8);

  assert.equal(secondRow8.judge, 'SKIPPED');
  assert.equal(secondRow8.linkedMemberId, firstRow8.linkedMemberId);
  assert.equal(second.counts.skipped, first.totalRows - first.errorRows.length);
});

test('処理済み後にデータが変更されると自動上書きせず要確認に回す', async () => {
  const env = makeEnv();
  await runMatching({ ...env, dryRun: false });

  // 元データが後から書き換わった状況を模擬する（fixtureを一時的に差し替え）
  // table[0]=見出し行, table[1]=行番号2, table[2]=行番号3 なので、
  // 行番号3（山田太郎・元は電話番号空欄）の電話番号を書き換える
  const alteredPath = path.join(env.dir, 'form-responses-altered.json');
  const original = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'form-responses.json'), 'utf8'));
  original[2][2] = '090-0000-1111';
  fs.writeFileSync(alteredPath, JSON.stringify(original), 'utf8');

  const { FixtureSheetSource } = require('../src/sources/sheetSource');
  const alteredEnv = { ...env, sheetSource: new FixtureSheetSource(alteredPath) };
  const second = await runMatching({ ...alteredEnv, dryRun: false });

  assert.equal(byRowNumber(second.results, 3).judge, 'FINGERPRINT_MISMATCH_HOLD');
  // 書き換わっていない行はそのままスキップされる
  assert.equal(byRowNumber(second.results, 2).judge, 'SKIPPED');
});
