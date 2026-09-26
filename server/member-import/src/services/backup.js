'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function formatStamp(date) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return (
    date.getFullYear() +
    p(date.getMonth() + 1) +
    p(date.getDate()) +
    '_' +
    p(date.getHours()) +
    p(date.getMinutes()) +
    p(date.getSeconds()) +
    '_' +
    p(date.getMilliseconds(), 3)
  );
}

// 同一ミリ秒内に連続実行された場合でも既存バックアップを上書きしないよう、
// 衝突していたらランダムな接尾辞を付けて必ず新しいディレクトリを作る。
function makeUniqueBackupDir(baseDir) {
  let dir = baseDir;
  let attempt = 0;
  while (true) {
    try {
      fs.mkdirSync(dir, { recursive: false });
      return dir;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      attempt++;
      dir = baseDir + '-' + crypto.randomBytes(3).toString('hex');
      if (attempt > 20) throw new Error('バックアップ用ディレクトリ名の衝突を解消できませんでした: ' + baseDir);
    }
  }
}

/**
 * 本処理の前に必ず呼ぶバックアップ。
 * 対象ファイル(存在するものだけ)を data/backups/<timestamp>/ にコピーし、
 * コピー後にSHA-256ハッシュを比較して「確実にコピーできたか」まで検証する。
 * 1つでも検証に失敗したら success:false を返す(= 呼び出し側は本処理に進んではいけない)。
 */
function runBackup(config, workLog) {
  const stamp = formatStamp(new Date());

  const targets = [config.MEMBER_DB_FILE, config.VISIT_HISTORY_FILE, config.IMPORT_STATE_FILE].filter((f) =>
    fs.existsSync(f)
  );

  let backupDir;
  try {
    fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
    backupDir = makeUniqueBackupDir(path.join(config.BACKUP_DIR, stamp));

    const copied = [];
    for (const src of targets) {
      const dest = path.join(backupDir, path.basename(src));
      fs.copyFileSync(src, dest);
      const srcHash = sha256(src);
      const destHash = sha256(dest);
      if (srcHash !== destHash) {
        throw new Error('バックアップ検証失敗（ハッシュ不一致）: ' + src);
      }
      copied.push({ src, dest });
    }

    const manifest = { createdAt: new Date().toISOString(), files: copied };
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    pruneOldBackups(config);

    workLog.log({
      phase: 'backup',
      type: 'success',
      message: 'バックアップ完了: ' + backupDir + '（対象' + copied.length + 'ファイル、ハッシュ検証OK）'
    });

    return { success: true, backupDir, files: copied };
  } catch (e) {
    workLog.log({ phase: 'backup', type: 'error', message: 'バックアップ失敗: ' + e.message });
    return { success: false, error: e.message };
  }
}

function pruneOldBackups(config) {
  if (!fs.existsSync(config.BACKUP_DIR)) return;
  const entries = fs
    .readdirSync(config.BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const excess = entries.length - (config.BACKUP_RETENTION_COUNT || 30);
  if (excess > 0) {
    entries.slice(0, excess).forEach((name) => {
      fs.rmSync(path.join(config.BACKUP_DIR, name), { recursive: true, force: true });
    });
  }
}

/**
 * 指定したバックアップ(タイムスタンプ)から現行データを復元する。
 * 復元前に「復元直前の状態」も安全のため別途バックアップする(二重の安全網)。
 */
function restoreFromBackup(config, stamp, workLog) {
  const backupDir = path.join(config.BACKUP_DIR, stamp);
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('指定されたバックアップが見つかりません: ' + backupDir);
  }

  // 復元前スナップショットを取っておく（＝取り消しできる状態を保つ）
  const preRestore = runBackup(config, workLog);
  if (!preRestore.success) {
    throw new Error('復元前バックアップに失敗したため復元を中止しました: ' + preRestore.error);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.forEach((entry) => {
    fs.copyFileSync(entry.dest, entry.src);
  });

  workLog.log({
    phase: 'restore',
    type: 'success',
    message: 'バックアップ ' + stamp + ' から復元完了（復元前スナップショット: ' + preRestore.backupDir + '）'
  });

  return { success: true, restoredFrom: backupDir, preRestoreBackup: preRestore.backupDir };
}

function listBackups(config) {
  if (!fs.existsSync(config.BACKUP_DIR)) return [];
  return fs
    .readdirSync(config.BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
}

module.exports = { runBackup, restoreFromBackup, listBackups };
