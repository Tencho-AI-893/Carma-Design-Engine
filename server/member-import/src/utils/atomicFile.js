'use strict';

const fs = require('fs');
const path = require('path');

// JSONファイルを読み込む。無ければ defaultValue を返す（ファイルは作らない）。
function readJson(filePath, defaultValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return defaultValue;
    throw e;
  }
}

// JSONファイルを「一時ファイルに書いてからrename」で原子的に書き込む。
// 書き込み途中でプロセスが落ちても、既存ファイルが壊れた中間状態になることはない。
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath); // 同一ファイルシステム上ではPOSIX原子的操作
}

module.exports = { readJson, writeJsonAtomic };
