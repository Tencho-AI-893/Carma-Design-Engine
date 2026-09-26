'use strict';

const { readJson } = require('../utils/atomicFile');
const { normalizePhone } = require('../utils/phone');
const { normalizeName } = require('../utils/name');

/**
 * MemberRepository インターフェース（既存ローカル会員DBへの「読み取り専用」アクセス）:
 *   findAll() -> [{ memberId, name, phoneNormalized, raw }]
 *   findByPhone(normalizedPhone) -> member | null
 *
 * このモジュールは既存会員DBへ一切書き込まない。新規会員の実際の登録は、
 * このパイプラインの範囲外（別の、人が確認する導線）で行う前提にしてある。
 * これは「誤った会員統合を起こさない」「既存ローカルDBを壊さない」を
 * 最優先するための設計判断であり、GASの旧設計（Form Responsesへの
 * タグ付けのみで会員マスタ自体は書き換えない）と同じ考え方を踏襲している。
 *
 * 実際のSMCarmaServerの会員DBがSQLite/Postgres/その他何であっても、
 * この2メソッドを実装したアダプタに差し替えるだけで良いようにしてある。
 */
class MemberRepository {
  async findAll() {
    throw new Error('not implemented');
  }
  async findByPhone(_normalizedPhone) {
    throw new Error('not implemented');
  }
}

// テスト・Dry Run動作確認用の参照実装。実データには接続しない。
// JSONファイル形式: [{ memberId, name, phone }, ...]
class JsonFileMemberRepository extends MemberRepository {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this._cache = null;
  }

  _load() {
    if (this._cache) return this._cache;
    const raw = readJson(this.filePath, []);
    const byPhone = new Map();
    const byName = new Map();
    const all = raw.map((m) => {
      const phoneNormalized = normalizePhone(m.phone);
      const nameNormalized = normalizeName(m.name);
      const record = { memberId: m.memberId, name: m.name, phoneNormalized, raw: m };
      if (phoneNormalized) {
        if (!byPhone.has(phoneNormalized)) byPhone.set(phoneNormalized, []);
        byPhone.get(phoneNormalized).push(record);
      }
      if (nameNormalized) {
        if (!byName.has(nameNormalized)) byName.set(nameNormalized, []);
        byName.get(nameNormalized).push(record);
      }
      return record;
    });
    this._cache = { all, byPhone, byName };
    return this._cache;
  }

  async findAll() {
    return this._load().all;
  }

  async findByPhone(normalizedPhone) {
    if (!normalizedPhone) return null;
    const matches = this._load().byPhone.get(normalizedPhone);
    return matches && matches.length > 0 ? matches[0] : null;
  }

  async findByName(normalizedName) {
    if (!normalizedName) return [];
    return this._load().byName.get(normalizedName) || [];
  }
}

module.exports = { MemberRepository, JsonFileMemberRepository };
