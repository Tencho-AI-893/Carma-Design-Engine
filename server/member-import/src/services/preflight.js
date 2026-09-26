'use strict';

const { normalizePhone } = require('../utils/phone');
const { normalizeName } = require('../utils/name');
const { findHeaderIndex } = require('./matching');
const defaultConfig = require('../config');

// 日本の電話番号として妥当な桁数か（9〜11桁）。それ以外は「形式不正」として扱う。
// ※実際の許容範囲（国際番号や内線番号を含むか等）は運用側の実情に合わせて調整してほしい。
function isPlausiblePhoneLength(normalized) {
  return normalized.length >= 9 && normalized.length <= 11;
}

function findDuplicateHeaders(headers) {
  const seen = new Map();
  headers.forEach((h, idx) => {
    const name = String(h || '').trim();
    if (!name) return;
    if (!seen.has(name)) seen.set(name, []);
    seen.get(name).push(idx);
  });
  const problems = [];
  seen.forEach((cols, name) => {
    if (cols.length > 1) {
      problems.push('列名「' + name + '」が' + cols.length + '列重複しています（列インデックス: ' + cols.join(', ') + '）');
    }
  });
  return problems;
}

/**
 * 本処理・Dry Runの前に必ず実行できる事前点検。
 * 副作用は一切ない（読み取りのみ）。
 *
 * 戻り値: { ok, stops: string[], warnings: string[], metrics: {...} }
 * stops が1件でもあれば、呼び出し側は本処理・Dry Runへ進んではいけない。
 */
async function runPreflight({ sheetSource, memberRepository, importStateRepo, config }) {
  const cfg = config || defaultConfig;
  const stops = [];
  const warnings = [];
  const metrics = {};

  let headers = [];
  let rows = [];
  try {
    const result = await sheetSource.fetchHeaderAndRows();
    headers = result.headers;
    rows = result.rows;
  } catch (e) {
    stops.push('STOP: スプレッドシート（データ取得元）への接続・読み取りに失敗しました: ' + e.message);
    return { ok: false, stops, warnings, metrics };
  }

  if (headers.length === 0) {
    stops.push('STOP: データ取得元の見出し行が空です。シート構成を確認してください。');
    return { ok: false, stops, warnings, metrics };
  }

  const dupHeaderProblems = findDuplicateHeaders(headers);
  if (dupHeaderProblems.length > 0) {
    dupHeaderProblems.forEach((p) => stops.push('STOP: ' + p));
  }

  const phoneCol = findHeaderIndex(headers, cfg.PHONE_HEADER_CANDIDATES);
  const nameCol = findHeaderIndex(headers, cfg.NAME_HEADER_CANDIDATES);
  const visitDateCol = findHeaderIndex(headers, cfg.VISIT_DATE_HEADER_CANDIDATES);
  const castCol = findHeaderIndex(headers, cfg.CAST_HEADER_CANDIDATES);

  if (phoneCol === -1) {
    stops.push('STOP: 電話番号列が見つかりません（見出し候補: ' + cfg.PHONE_HEADER_CANDIDATES.join('/') + '）');
  }
  if (nameCol === -1) {
    warnings.push('お客様名の列が見つかりません（氏名一致による保留判定ができません）');
  }
  if (visitDateCol === -1) {
    warnings.push('来店日時の列が見つかりません（見出し候補: ' + cfg.VISIT_DATE_HEADER_CANDIDATES.join('/') + '）');
  }
  if (castCol === -1) {
    warnings.push('担当キャストの列が見つかりません（見出し候補: ' + cfg.CAST_HEADER_CANDIDATES.join('/') + '）');
  }

  // 会員DBへの読み取り確認（会員ID列・電話番号列が実質的に読めるか）
  let allMembers = [];
  try {
    allMembers = await memberRepository.findAll();
  } catch (e) {
    stops.push('STOP: 既存会員DBの読み取りに失敗しました: ' + e.message);
  }
  if (allMembers.length > 0) {
    const missingId = allMembers.filter((m) => !m.memberId).length;
    if (missingId > 0) {
      stops.push('STOP: 既存会員DBに会員ID未設定のレコードが' + missingId + '件あります');
    }
  } else {
    warnings.push('既存会員DBが0件です（本当に空の状態か確認してください）');
  }

  // バックアップ書き込み権限の確認（実際に書いてすぐ消す軽量チェック）。
  // Preflightは「読み取り専用」が原則なので、このチェックのために新規作成した
  // ディレクトリは、元々存在しなかった場合は痕跡を残さず削除しておく。
  {
    const fs = require('fs');
    const path = require('path');
    const backupDirExistedBefore = fs.existsSync(cfg.BACKUP_DIR);
    try {
      fs.mkdirSync(cfg.BACKUP_DIR, { recursive: true });
      const probePath = path.join(cfg.BACKUP_DIR, '.preflight-write-test-' + Date.now());
      fs.writeFileSync(probePath, 'ok');
      fs.rmSync(probePath, { force: true });
      metrics.backupWritable = true;
    } catch (e) {
      stops.push('STOP: バックアップ保存先への書き込み権限がありません: ' + e.message);
      metrics.backupWritable = false;
    } finally {
      if (!backupDirExistedBefore) {
        try {
          fs.rmdirSync(cfg.BACKUP_DIR);
        } catch (e) {
          // 空でなければ何もしない（他プロセスが既に何か作っていた等）
        }
      }
    }
  }

  if (stops.length > 0) {
    // 構造的な問題がある場合はここで打ち切り（件数集計は意味を持たないため）
    return { ok: false, stops, warnings, metrics };
  }

  // ここから件数系のメトリクス（phoneCol確定後のみ実施可能）
  const state = importStateRepo.loadAll();
  const processedRowNumbers = new Set(Object.keys(state.byRowNumber || {}));

  const nameIndex = new Map();
  allMembers.forEach((m) => {
    const n = normalizeName(m.name);
    if (n) {
      if (!nameIndex.has(n)) nameIndex.set(n, []);
      nameIndex.get(n).push(m);
    }
  });

  let blankPhoneCount = 0;
  let invalidFormatCount = 0;
  let nameCandidateCount = 0;
  const phoneFrequency = new Map();
  let alreadyIdCount = 0;

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const phoneRaw = row[phoneCol];
    const nameRaw = nameCol !== -1 ? row[nameCol] : '';
    const phoneNormalized = normalizePhone(phoneRaw);

    if (processedRowNumbers.has(String(rowNumber))) {
      alreadyIdCount++;
    }

    if (!phoneNormalized) {
      blankPhoneCount++;
    } else {
      if (!isPlausiblePhoneLength(phoneNormalized)) invalidFormatCount++;
      phoneFrequency.set(phoneNormalized, (phoneFrequency.get(phoneNormalized) || 0) + 1);
    }

    const nameNormalized = normalizeName(nameRaw);
    if (nameNormalized && nameIndex.has(nameNormalized)) {
      nameCandidateCount++;
    }
  });

  let duplicatePhoneRowCount = 0;
  let duplicatePhoneGroupCount = 0;
  phoneFrequency.forEach((count) => {
    if (count > 1) {
      duplicatePhoneGroupCount++;
      duplicatePhoneRowCount += count;
    }
  });

  metrics.totalRows = rows.length;
  metrics.alreadyProcessedCount = alreadyIdCount;
  metrics.unprocessedCount = rows.length - alreadyIdCount;
  metrics.blankPhoneCount = blankPhoneCount;
  metrics.duplicatePhoneGroupCount = duplicatePhoneGroupCount;
  metrics.duplicatePhoneRowCount = duplicatePhoneRowCount;
  metrics.invalidPhoneFormatCount = invalidFormatCount;
  metrics.nameCandidateCount = nameCandidateCount;
  metrics.existingMemberCount = allMembers.length;

  if (rows.length === 0) {
    warnings.push('処理対象の行が0件です（新規フォーム回答がない可能性があります）');
  }

  return { ok: stops.length === 0, stops, warnings, metrics };
}

module.exports = { runPreflight, isPlausiblePhoneLength, findDuplicateHeaders };
