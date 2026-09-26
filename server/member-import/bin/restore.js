#!/usr/bin/env node
'use strict';

/**
 * コマンド1発の復元スクリプト。
 *
 *   node bin/restore.js --list          … 復元できるバックアップの一覧を表示
 *   node bin/restore.js <timestamp>      … 指定したバックアップに復元する
 *
 * 実際のSMCarmaServerに組み込むときは、config.js のパスを本番の
 * データファイルに向けてから使うこと（環境変数 MM_* で上書き可能）。
 */
const config = require('../src/config');
const { WorkLog } = require('../src/services/workLog');
const { listBackups, restoreFromBackup } = require('../src/services/backup');

const workLog = new WorkLog(config.WORK_LOG_FILE);
const arg = process.argv[2];

if (!arg || arg === '--help' || arg === '-h') {
  console.log('使い方:');
  console.log('  node bin/restore.js --list        バックアップ一覧を表示');
  console.log('  node bin/restore.js <timestamp>   指定バックアップへ復元');
  process.exit(arg ? 0 : 1);
}

if (arg === '--list') {
  const backups = listBackups(config);
  if (backups.length === 0) {
    console.log('バックアップが1件もありません。');
  } else {
    console.log('復元できるバックアップ（新しい順）:');
    backups.forEach((b) => console.log('  ' + b));
  }
  process.exit(0);
}

try {
  const result = restoreFromBackup(config, arg, workLog);
  console.log('復元が完了しました。');
  console.log('  復元元: ' + result.restoredFrom);
  console.log('  復元前の状態は念のためここに保存されています: ' + result.preRestoreBackup);
  process.exit(0);
} catch (e) {
  console.error('復元に失敗しました: ' + e.message);
  process.exit(1);
}
