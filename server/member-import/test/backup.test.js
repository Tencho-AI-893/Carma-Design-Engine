'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runBackup, restoreFromBackup, listBackups } = require('../src/services/backup');
const { WorkLog } = require('../src/services/workLog');

function makeEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-backup-'));
  const config = {
    BACKUP_DIR: path.join(dir, 'backups'),
    MEMBER_DB_FILE: path.join(dir, 'members.json'),
    VISIT_HISTORY_FILE: path.join(dir, 'visit_history.json'),
    IMPORT_STATE_FILE: path.join(dir, 'import-state.json'),
    BACKUP_RETENTION_COUNT: 30
  };
  fs.writeFileSync(config.MEMBER_DB_FILE, JSON.stringify([{ memberId: 'M-1', name: 'テスト', phone: '09000000000' }]));
  fs.writeFileSync(config.VISIT_HISTORY_FILE, JSON.stringify([{ visitId: 1 }]));
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  return { dir, config, workLog };
}

test('バックアップはハッシュ検証込みで成功する', () => {
  const { config, workLog } = makeEnv();
  const result = runBackup(config, workLog);
  assert.equal(result.success, true);
  assert.ok(fs.existsSync(path.join(result.backupDir, 'members.json')));
  assert.ok(fs.existsSync(path.join(result.backupDir, 'manifest.json')));
});

test('バックアップ先に書き込めない場合は失敗として報告される', () => {
  const { config, workLog, dir } = makeEnv();
  const blocker = path.join(dir, 'blocker-file');
  fs.writeFileSync(blocker, 'x');
  config.BACKUP_DIR = path.join(blocker, 'backups');
  const result = runBackup(config, workLog);
  assert.equal(result.success, false);
  assert.ok(result.error);
});

test('バックアップから復元でき、復元前スナップショットも残る', () => {
  const { config, workLog } = makeEnv();
  const first = runBackup(config, workLog);
  const stamp = path.basename(first.backupDir);

  fs.writeFileSync(config.MEMBER_DB_FILE, JSON.stringify([{ memberId: 'M-999', name: '壊れたデータ', phone: '' }]));

  const restoreResult = restoreFromBackup(config, stamp, workLog);
  assert.equal(restoreResult.success, true);

  const restored = JSON.parse(fs.readFileSync(config.MEMBER_DB_FILE, 'utf8'));
  assert.equal(restored[0].memberId, 'M-1');

  const backups = listBackups(config);
  assert.ok(backups.length >= 2, '復元前スナップショットも含めて2件以上のバックアップがあるはず');
});
