'use strict';

const { readJson, writeJsonAtomic } = require('../utils/atomicFile');

/**
 * 取り込み処理の「進捗台帳」。行番号(rowNumber)をキーに、その行が
 * 既にどう判定されたか(judge/紐付け先ID/候補フラグ/エラー)を記録する。
 *
 * これにより:
 *  - 再実行しても既に処理済みの行は再判定しない(IDが変わらない)
 *  - 途中で止まっても、次回はここから再開できる
 *  - 行の中身(電話番号や氏名)が処理後に書き換わっていないか fingerprint で検知する
 */
class ImportStateRepository {
  constructor(filePath) {
    this.filePath = filePath;
  }

  loadAll() {
    return readJson(this.filePath, { byRowNumber: {} });
  }

  saveAll(state) {
    writeJsonAtomic(this.filePath, state);
  }

  get(rowNumber) {
    const state = this.loadAll();
    return state.byRowNumber[String(rowNumber)] || null;
  }

  // entries: [{ rowNumber, fingerprint, phoneNormalized, judge, linkedMemberId, candidateNote, error }]
  upsertMany(entries) {
    const state = this.loadAll();
    entries.forEach((entry) => {
      state.byRowNumber[String(entry.rowNumber)] = {
        fingerprint: entry.fingerprint,
        // phoneNormalizedは必ず保存する。ここを落とすと、後日の再実行や
        // validationでの「同一電話番号の重複ID検知」ができなくなり、
        // 同じ人に複数の新規IDを発行しかねない重大な回帰バグになる。
        phoneNormalized: entry.phoneNormalized || '',
        judge: entry.judge,
        linkedMemberId: entry.linkedMemberId || '',
        candidateNote: entry.candidateNote || '',
        error: entry.error || '',
        processedAt: new Date().toISOString()
      };
    });
    this.saveAll(state);
  }
}

module.exports = { ImportStateRepository };
