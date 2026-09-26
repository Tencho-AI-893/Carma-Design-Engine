'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 作業ログ（JSON Lines形式で追記していく）。
 * 1行=1件のJSON。フェーズ・行番号・種別・内容を必ず残せる形にしてある。
 */
class WorkLog {
  constructor(filePath) {
    this.filePath = filePath;
  }

  log(entry) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      phase: entry.phase || '',
      rowNumber: entry.rowNumber != null ? entry.rowNumber : null,
      type: entry.type || 'info',
      message: entry.message || ''
    });
    fs.appendFileSync(this.filePath, line + '\n', 'utf8');
  }

  // 最新N件を返す（「⑤最新ログ確認」相当）
  readRecent(limit = 20) {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  }
}

module.exports = { WorkLog };
