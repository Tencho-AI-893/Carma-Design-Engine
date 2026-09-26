'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runFullPipeline } = require('../src/pipeline');
const { FixtureSheetSource } = require('../src/sources/sheetSource');
const { JsonFileMemberRepository } = require('../src/repositories/memberRepository');
const { ImportStateRepository } = require('../src/repositories/importStateRepository');
const { WorkLog } = require('../src/services/workLog');
const defaultConfig = require('../src/config');

const fixturesDir = path.join(__dirname, 'fixtures');

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pipeline-'));
  const sheetSource = new FixtureSheetSource(path.join(fixturesDir, 'form-responses.json'));
  const memberRepository = new JsonFileMemberRepository(path.join(fixturesDir, 'members.json'));
  const importStateRepo = new ImportStateRepository(path.join(dir, 'import-state.json'));
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  const config = Object.assign({}, defaultConfig, {
    DATA_DIR: dir,
    BACKUP_DIR: path.join(dir, 'backups'),
    LOCK_FILE: path.join(dir, '.member-import.lock'),
    WORK_LOG_FILE: path.join(dir, 'work-log.jsonl'),
    IMPORT_STATE_FILE: path.join(dir, 'import-state.json'),
    MEMBER_DB_FILE: path.join(fixturesDir, 'members.json'),
    VISIT_HISTORY_FILE: path.join(dir, 'visit_history.json')
  });
  fs.writeFileSync(config.VISIT_HISTORY_FILE, JSON.stringify([{ visitId: 1 }]));
  return { dir, sheetSource, memberRepository, importStateRepo, workLog, config };
}

test('Preflightで問題があればBackup以降は一切実行しない', async () => {
  const env = makeEnv();
  env.sheetSource = { fetchHeaderAndRows: async () => ({ headers: ['お名前'], rows: [['x']] }) }; // 電話番号列なし

  const result = await runFullPipeline(env);

  assert.equal(result.success, false);
  assert.equal(result.step, 'preflight');
  assert.equal(fs.existsSync(env.config.BACKUP_DIR), false, 'バックアップが作られていてはいけない');
  assert.equal(fs.existsSync(env.config.IMPORT_STATE_FILE), false, '名寄せが実行されていてはいけない');
});

test('Backupが失敗すればMember Matching以降は一切実行しない', async () => {
  // Preflight自体はバックアップ書き込み権限もチェックするため、Preflight通過後に
  // 初めてBackupが失敗するケースは _runBackup の差し込みで再現する。
  const env = makeEnv();
  const result = await runFullPipeline({
    ...env,
    _runBackup: () => ({ success: false, error: '模擬的なバックアップ失敗（テスト注入）' })
  });

  assert.equal(result.success, false);
  assert.equal(result.step, 'backup');
  assert.equal(fs.existsSync(env.config.IMPORT_STATE_FILE), false, '名寄せが実行されていてはいけない');
});

test('正常系はPreflight→Backup→Matching→VisitHistory→Validationの順に完了する', async () => {
  const env = makeEnv();
  const result = await runFullPipeline(env);

  assert.equal(result.success, true);
  assert.equal(result.preflight.ok, true);
  assert.equal(result.backup.success, true);
  assert.ok(result.matching.counts.matched >= 1);
  assert.equal(result.visitHistory.ok, true);
  assert.equal(typeof result.validation.ok, 'boolean');
  assert.ok(fs.existsSync(env.config.IMPORT_STATE_FILE));
});

test('同時に2回本番実行しても、片方は多重実行防止で停止する', async () => {
  const env = makeEnv();
  const [a, b] = await Promise.all([runFullPipeline(env), runFullPipeline(env)]);
  const results = [a, b];
  const lockedCount = results.filter((r) => r.step === 'lock').length;
  const succeededCount = results.filter((r) => r.success).length;

  assert.equal(lockedCount, 1, '片方は多重実行防止で止まるべき');
  assert.equal(succeededCount, 1, 'もう片方は正常に完了するべき');
});
