'use strict';

const path = require('path');

// このモジュールの設定。実際のSMCarmaServerに組み込む際は、環境変数か
// 呼び出し側から上書きして使う。ここに実データのシート名・列名・DBパスを
// 決め打ちで書かない — 実際の値は運用側の設定として渡す前提。
const DATA_DIR = process.env.MM_DATA_DIR || path.join(__dirname, '..', 'data');

const CONFIG = {
  DATA_DIR,
  BACKUP_DIR: process.env.MM_BACKUP_DIR || path.join(DATA_DIR, 'backups'),
  LOCK_FILE: path.join(DATA_DIR, '.member-import.lock'),
  WORK_LOG_FILE: path.join(DATA_DIR, 'work-log.jsonl'),
  IMPORT_STATE_FILE: path.join(DATA_DIR, 'import-state.json'),
  MEMBER_DB_FILE: process.env.MM_MEMBER_DB_FILE || path.join(DATA_DIR, 'members.json'),
  VISIT_HISTORY_FILE: process.env.MM_VISIT_HISTORY_FILE || path.join(DATA_DIR, 'visit_history.json'),
  DRY_RUN_RESULT_FILE: path.join(DATA_DIR, 'dry-run-result.json'),

  // 見出し名の候補（実データの表記が違えば呼び出し側の config で上書きする）
  PHONE_HEADER_CANDIDATES: ['電話番号', 'お電話番号', 'TEL', 'Phone'],
  MEMBER_ID_HEADER_CANDIDATES: ['会員ID', '会員番号', 'ID'],
  NAME_HEADER_CANDIDATES: ['お名前', '氏名', '名前', 'Name'],
  VISIT_DATE_HEADER_CANDIDATES: ['来店日時', '来店日', 'タイムスタンプ', 'Timestamp'],
  CAST_HEADER_CANDIDATES: ['担当キャスト', 'キャスト名'],

  // 判定コードの日本語表示名は services/dryRun.js の JUDGE_LABELS_JA が唯一の情報源。
  // ここには重複を持たない。

  VISIT_HISTORY_NEW_FIELDS: ['nominationType', 'usageMinutes', 'castName', 'feedback', 'feedbackNote'],

  BACKUP_RETENTION_COUNT: 30
};

module.exports = CONFIG;
