'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileLock, withLockAsync } = require('../src/utils/lock');

function tmpLockPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-lock-'));
  return path.join(dir, 'test.lock');
}

test('同じロックを二重取得できない', () => {
  const lockPath = tmpLockPath();
  const a = new FileLock(lockPath);
  const b = new FileLock(lockPath);
  assert.equal(a.acquire(), true);
  assert.equal(b.acquire(), false);
  a.release();
  assert.equal(b.acquire(), true);
  b.release();
});

test('withLockAsyncは非同期処理が終わるまでロックを保持する（早期解放バグの回帰テスト）', async () => {
  const lockPath = tmpLockPath();
  let duringFirstRunSecondCouldLock = null;

  const first = withLockAsync(lockPath, async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return 'first-done';
  });

  // 最初の実行がまだ終わっていないタイミングで2つ目を試す
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = new FileLock(lockPath);
  duringFirstRunSecondCouldLock = second.acquire();

  const firstResult = await first;

  assert.equal(duringFirstRunSecondCouldLock, false, '実行中は他方がロックを取得できてはいけない');
  assert.equal(firstResult.locked, false);
  assert.equal(firstResult.result, 'first-done');
});

test('古すぎるロックファイルは壊れたロックとして奪取される', () => {
  const lockPath = tmpLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: new Date(0).toISOString() }));
  fs.utimesSync(lockPath, new Date(0), new Date(0));

  const lock = new FileLock(lockPath, 1000); // staleMs=1秒
  assert.equal(lock.acquire(), true);
  lock.release();
});
