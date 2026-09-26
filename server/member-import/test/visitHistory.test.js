'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extendVisitHistory } = require('../src/services/visitHistory');
const { WorkLog } = require('../src/services/workLog');
const defaultConfig = require('../src/config');

function makeEnv(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-visit-'));
  const file = path.join(dir, 'visit_history.json');
  fs.writeFileSync(file, JSON.stringify(records));
  const config = Object.assign({}, defaultConfig, { VISIT_HISTORY_FILE: file });
  const workLog = new WorkLog(path.join(dir, 'work-log.jsonl'));
  return { config, workLog, file };
}

test('既存フィールドは変更せず、新フィールドだけ追加され、行数は変わらない', () => {
  const env = makeEnv([
    { visitId: 1, memberId: 'M-1', visitDate: '2026-01-01' },
    { visitId: 2, memberId: 'M-2', visitDate: '2026-01-02', nominationType: '本指名' } // 一部だけ既に手動で入っているケース
  ]);

  const result = extendVisitHistory(env);

  assert.equal(result.ok, true);
  assert.equal(result.rowsBefore, 2);
  assert.equal(result.rowsAfter, 2);

  const after = JSON.parse(fs.readFileSync(env.file, 'utf8'));
  assert.equal(after[0].visitId, 1);
  assert.equal(after[0].memberId, 'M-1');
  assert.equal(after[0].nominationType, null);
  assert.equal(after[0].castName, null);
  assert.equal(after[1].nominationType, '本指名'); // 既存値を上書きしない
});
