'use strict';

/**
 * スタンドアロンの動作確認用サーバー。
 * 実データには一切繋がず、fixtures/ 配下のダミーデータで /form-import を
 * 一通り試せるようにするための開発用アプリ。
 *
 *   npm run dev
 *   curl -X POST http://localhost:4321/form-import/preflight
 *
 * 本番のSMCarmaServerに組み込む場合はこのファイルではなく
 * src/routes/formImport.js のRouterを既存app.jsから使うこと。
 */
const path = require('path');
const express = require('express');
const config = require('./config');
const createFormImportRouter = require('./routes/formImport');
const { FixtureSheetSource } = require('./sources/sheetSource');
const { JsonFileMemberRepository } = require('./repositories/memberRepository');
const { ImportStateRepository } = require('./repositories/importStateRepository');

const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures');

const devConfig = Object.assign({}, config, {
  DATA_DIR: path.join(__dirname, '..', 'data', 'dev'),
  BACKUP_DIR: path.join(__dirname, '..', 'data', 'dev', 'backups'),
  LOCK_FILE: path.join(__dirname, '..', 'data', 'dev', '.member-import.lock'),
  WORK_LOG_FILE: path.join(__dirname, '..', 'data', 'dev', 'work-log.jsonl'),
  IMPORT_STATE_FILE: path.join(__dirname, '..', 'data', 'dev', 'import-state.json'),
  MEMBER_DB_FILE: path.join(fixturesDir, 'members.json'),
  VISIT_HISTORY_FILE: path.join(__dirname, '..', 'data', 'dev', 'visit_history.json'),
  DRY_RUN_RESULT_FILE: path.join(__dirname, '..', 'data', 'dev', 'dry-run-result.json')
});

const sheetSource = new FixtureSheetSource(path.join(fixturesDir, 'form-responses.json'));
const memberRepository = new JsonFileMemberRepository(devConfig.MEMBER_DB_FILE);
const importStateRepo = new ImportStateRepository(devConfig.IMPORT_STATE_FILE);

const app = express();
app.use(express.json());
app.use('/form-import', createFormImportRouter({ sheetSource, memberRepository, importStateRepo, config: devConfig }));

const port = process.env.PORT || 4321;
if (require.main === module) {
  app.listen(port, () => {
    console.log('member-import dev server listening on http://localhost:' + port + '/form-import');
  });
}

module.exports = app;
