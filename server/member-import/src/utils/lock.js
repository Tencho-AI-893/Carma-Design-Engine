'use strict';

const fs = require('fs');
const path = require('path');

/**
 * ファイルベースの簡易ロック（LockServiceのNode版）。
 * 「複数回実行・同時実行・再実行」でIDの二重発行や書き込み競合が
 * 起きないようにするための排他制御。
 *
 * - ロックファイルを O_EXCL(排他的新規作成) で作る。既に存在すればロック中とみなす。
 * - プロセスが異常終了してロックが残った場合に備え、staleMs 以上古いロックは
 *   壊れたロックとみなして奪取する（無期限にロックされっぱなしになるのを防ぐ）。
 */
class FileLock {
  constructor(lockFilePath, staleMs = 10 * 60 * 1000) {
    this.lockFilePath = lockFilePath;
    this.staleMs = staleMs;
    this.acquired = false;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.lockFilePath), { recursive: true });

    try {
      const fd = fs.openSync(this.lockFilePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      fs.closeSync(fd);
      this.acquired = true;
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }

    // 既にロックファイルがある場合、古すぎれば壊れたロックとして奪取する
    try {
      const stat = fs.statSync(this.lockFilePath);
      const age = Date.now() - stat.mtimeMs;
      if (age > this.staleMs) {
        fs.rmSync(this.lockFilePath, { force: true });
        return this.acquire();
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return this.acquire(); // 消えていたので取り直す
    }

    return false;
  }

  release() {
    if (!this.acquired) return;
    try {
      fs.rmSync(this.lockFilePath, { force: true });
    } finally {
      this.acquired = false;
    }
  }
}

// ロックを取得して fn を実行し、成功・失敗にかかわらず必ず解放する。
// ロックが取れなかった場合は { locked: true } を返し、fn は実行しない。
// fn は「同期関数」専用。Promiseを返す非同期関数には withLockAsync を使うこと
// （ここでawaitしてしまうと、非同期処理が終わる前にロックを解放してしまうバグになる）。
function withLock(lockFilePath, fn) {
  const lock = new FileLock(lockFilePath);
  if (!lock.acquire()) {
    return { locked: true };
  }
  try {
    const result = fn();
    return { locked: false, result };
  } finally {
    lock.release();
  }
}

// withLock の非同期版。fn の返す Promise が解決(または例外)するまで
// ロックを保持し続けてから解放する。
async function withLockAsync(lockFilePath, fn) {
  const lock = new FileLock(lockFilePath);
  if (!lock.acquire()) {
    return { locked: true };
  }
  try {
    const result = await fn();
    return { locked: false, result };
  } finally {
    lock.release();
  }
}

module.exports = { FileLock, withLock, withLockAsync };
