'use strict';

const crypto = require('crypto');
const { normalizePhone } = require('../utils/phone');
const { normalizeName } = require('../utils/name');
const { generateNewMemberId } = require('../utils/id');
const defaultConfig = require('../config');

function findHeaderIndex(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').trim();
    if (!h) continue;
    for (const c of candidates) {
      if (h === c || h.indexOf(c) !== -1) return i;
    }
  }
  return -1;
}

function fingerprintOf(phoneRaw, nameRaw) {
  return crypto
    .createHash('sha256')
    .update(String(phoneRaw || '') + '|' + String(nameRaw || ''))
    .digest('hex')
    .slice(0, 16);
}

/**
 * 1行分の判定ロジック（名寄せの核心部分）。
 *
 * 判定は5種類のみ:
 *   MATCHED         既存会員に紐付け（電話番号が完全一致した場合のみ）
 *   NEW             新規ID発行（電話番号あり・マスタ不一致・氏名候補もなし）
 *   BLANK_NEW       電話番号なし・要確認（自動ではIDを発行しない）
 *   NAME_ONLY_HOLD  氏名一致候補あり・保留（電話番号が空欄 or 不一致のため自動統合しない）
 *   SKIPPED         既に処理済み（何もしない）
 *
 * 重要な安全ルール:
 *   - IDを自動発行するのは MATCHED（既存ID流用）と NEW（新規ID）だけ。
 *   - 電話番号が空欄の行は、氏名がどれだけ似ていても絶対に自動統合しない。
 *   - 氏名一致候補がある行は、電話番号の有無に関わらず「保留」に回し、
 *     人間の確認が終わるまでIDを発行しない。
 */
function classifyRow({ phoneNormalized, masterMatch, nameCandidates }) {
  if (masterMatch) {
    return {
      judge: 'MATCHED',
      reason: '電話番号が既存会員と完全一致'
    };
  }
  if (nameCandidates && nameCandidates.length > 0) {
    return {
      judge: 'NAME_ONLY_HOLD',
      reason:
        '氏名一致候補あり（電話番号' +
        (phoneNormalized ? '不一致' : '空欄') +
        'のため自動統合せず保留）候補: ' +
        nameCandidates.map((c) => c.memberId).join(', ')
    };
  }
  if (!phoneNormalized) {
    return { judge: 'BLANK_NEW', reason: '電話番号が空欄のため要確認（自動ではID発行しない）' };
  }
  return { judge: 'NEW', reason: '電話番号が既存会員と不一致・氏名候補もないため新規発行対象' };
}

/**
 * 名寄せ本体。dryRun=true のときは importStateRepo に一切書き込まない
 * （プレビュー専用。呼び出し側が結果を表示するだけに使う）。
 *
 * options:
 *   sheetSource, memberRepository, importStateRepo, workLog, dryRun(bool)
 */
async function runMatching({ sheetSource, memberRepository, importStateRepo, workLog, dryRun, config }) {
  const cfg = config || defaultConfig;
  const { headers, rows } = await sheetSource.fetchHeaderAndRows();

  const phoneCol = findHeaderIndex(headers, cfg.PHONE_HEADER_CANDIDATES);
  const nameCol = findHeaderIndex(headers, cfg.NAME_HEADER_CANDIDATES);

  if (phoneCol === -1) {
    throw new Error('電話番号列が見つかりません（見出し候補に一致なし）');
  }

  const allMembers = await memberRepository.findAll();
  const nameIndex = new Map();
  allMembers.forEach((m) => {
    if (!m.phoneNormalized && m.name) {
      // 電話番号を持たない既存会員も氏名照合の対象にする
    }
    const n = normalizeName(m.name);
    if (n) {
      if (!nameIndex.has(n)) nameIndex.set(n, []);
      nameIndex.get(n).push(m);
    }
  });

  const state = importStateRepo.loadAll();
  const sourcePhoneToId = new Map();
  Object.values(state.byRowNumber || {}).forEach((entry) => {
    if (entry.judge === 'NEW' && entry.phoneNormalized && entry.linkedMemberId) {
      sourcePhoneToId.set(entry.phoneNormalized, entry.linkedMemberId);
    }
  });

  const results = [];
  const counts = {
    matched: 0,
    brandNew: 0,
    blankNew: 0,
    nameOnlyHold: 0,
    skipped: 0,
    fingerprintMismatch: 0
  };

  const stateUpdates = [];
  const rowErrors = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 見出し行=1行目、データは2行目からという既存の数え方に合わせる
    const row = rows[i];

    try {
      const phoneRaw = row[phoneCol];
      const nameRaw = nameCol !== -1 ? row[nameCol] : '';
      const phoneNormalized = normalizePhone(phoneRaw);
      const nameNormalized = normalizeName(nameRaw);
      const fingerprint = fingerprintOf(phoneRaw, nameRaw);

      const existing = state.byRowNumber ? state.byRowNumber[String(rowNumber)] : null;

      if (existing) {
        if (existing.fingerprint === fingerprint) {
          counts.skipped++;
          results.push({
            rowNumber,
            name: nameRaw,
            phone: phoneRaw,
            currentId: existing.linkedMemberId || '',
            judge: 'SKIPPED',
            linkedMemberId: existing.linkedMemberId || '',
            reason: '既に処理済みのためスキップ'
          });
          continue;
        }
        // 処理済み後にデータが書き換わっている → 自動では上書きせず要確認に回す
        counts.fingerprintMismatch++;
        results.push({
          rowNumber,
          name: nameRaw,
          phone: phoneRaw,
          currentId: existing.linkedMemberId || '',
          judge: 'FINGERPRINT_MISMATCH_HOLD',
          linkedMemberId: existing.linkedMemberId || '',
          reason: '処理済み後に元データが変更された形跡があるため、既存IDを保持したまま要確認にしました'
        });
        workLog.log({
          phase: 'matching',
          rowNumber,
          type: 'warn',
          message: '行' + rowNumber + ': 処理済み後にデータ変更を検知。自動上書きせず保持。'
        });
        continue;
      }

      const masterMatch = phoneNormalized ? await memberRepository.findByPhone(phoneNormalized) : null;
      const nameCandidates = !masterMatch && nameNormalized ? nameIndex.get(nameNormalized) || [] : [];

      const classified = classifyRow({ phoneNormalized, masterMatch, nameCandidates });
      let linkedMemberId = '';

      if (classified.judge === 'MATCHED') {
        linkedMemberId = masterMatch.memberId;
        counts.matched++;
      } else if (classified.judge === 'NEW') {
        if (sourcePhoneToId.has(phoneNormalized)) {
          linkedMemberId = sourcePhoneToId.get(phoneNormalized);
        } else {
          linkedMemberId = generateNewMemberId();
          sourcePhoneToId.set(phoneNormalized, linkedMemberId);
        }
        counts.brandNew++;
      } else if (classified.judge === 'BLANK_NEW') {
        counts.blankNew++;
      } else if (classified.judge === 'NAME_ONLY_HOLD') {
        counts.nameOnlyHold++;
      }

      results.push({
        rowNumber,
        name: nameRaw,
        phone: phoneRaw,
        currentId: '',
        judge: classified.judge,
        linkedMemberId,
        reason: classified.reason
      });

      stateUpdates.push({
        rowNumber,
        fingerprint,
        phoneNormalized,
        judge: classified.judge,
        linkedMemberId,
        candidateNote: classified.judge === 'NAME_ONLY_HOLD' ? classified.reason : '',
        error: ''
      });
    } catch (rowError) {
      rowErrors.push({ rowNumber, message: rowError.message });
      results.push({
        rowNumber,
        name: '',
        phone: '',
        currentId: '',
        judge: 'ERROR',
        linkedMemberId: '',
        reason: 'エラー: ' + rowError.message
      });
      stateUpdates.push({
        rowNumber,
        fingerprint: '',
        phoneNormalized: '',
        judge: 'ERROR',
        linkedMemberId: '',
        candidateNote: '',
        error: rowError.message
      });
    }
  }

  if (!dryRun && stateUpdates.length > 0) {
    importStateRepo.upsertMany(stateUpdates);
  }

  rowErrors.forEach((e) => {
    workLog.log({ phase: 'matching', rowNumber: e.rowNumber, type: 'error', message: e.message });
  });

  workLog.log({
    phase: 'matching',
    type: dryRun ? 'dry-run-summary' : 'summary',
    message:
      '既存一致=' +
      counts.matched +
      ' 新規=' +
      counts.brandNew +
      ' 空欄要確認=' +
      counts.blankNew +
      ' 氏名一致保留=' +
      counts.nameOnlyHold +
      ' スキップ=' +
      counts.skipped +
      ' 変更検知保留=' +
      counts.fingerprintMismatch +
      ' エラー=' +
      rowErrors.length
  });

  return { results, counts, errorRows: rowErrors, totalRows: rows.length, phoneCol, nameCol };
}

module.exports = { runMatching, classifyRow, findHeaderIndex, fingerprintOf };
