'use strict';

const express = require('express');
const { runPreflight, runDryRunLocked, runFullPipeline, runValidation } = require('../pipeline');
const { WorkLog } = require('../services/workLog');
const { listBackups, restoreFromBackup } = require('../services/backup');

/**
 * /form-import 配下のAPIをまとめたルーター。
 * 実際のSMCarmaServerに組み込むときは、既存のapp.jsで:
 *
 *   const formImport = require('./server/member-import/src/routes/formImport');
 *   app.use('/form-import', formImport({ sheetSource, memberRepository, importStateRepo, config }));
 *
 * のように、実データにつながるアダプタ(sheetSource/memberRepository)を
 * 渡してマウントするだけでよい。既存のapp.jsの他の部分は一切変更しない。
 */
function createFormImportRouter({ sheetSource, memberRepository, importStateRepo, config }) {
  const router = express.Router();
  const workLog = new WorkLog(config.WORK_LOG_FILE);

  router.get('/', (req, res) => {
    res.json({
      name: 'SM.Carma 会員データ取り込み',
      endpoints: [
        'POST /form-import/preflight',
        'POST /form-import/dry-run',
        'POST /form-import/run',
        'GET  /form-import/validate',
        'GET  /form-import/logs',
        'GET  /form-import/backups',
        'POST /form-import/restore'
      ]
    });
  });

  // ① 事前チェック
  router.post('/preflight', async (req, res) => {
    try {
      const result = await runPreflight({ sheetSource, memberRepository, importStateRepo, config });
      res.status(result.ok ? 200 : 409).json(result);
    } catch (e) {
      workLog.log({ phase: 'preflight', type: 'error', message: e.message });
      res.status(500).json({ ok: false, stops: ['STOP: Preflightで予期しないエラー: ' + e.message] });
    }
  });

  // ② Dry Run
  router.post('/dry-run', async (req, res) => {
    try {
      const preflight = await runPreflight({ sheetSource, memberRepository, importStateRepo, config });
      if (!preflight.ok) {
        return res.status(409).json({ success: false, step: 'preflight', preflight });
      }
      const result = await runDryRunLocked({ sheetSource, memberRepository, importStateRepo, workLog, config });
      if (result.locked) {
        return res.status(423).json({ success: false, error: result.error });
      }
      res.json({ success: true, ...result });
    } catch (e) {
      workLog.log({ phase: 'dry-run', type: 'error', message: e.message });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ③ 本番実行
  router.post('/run', async (req, res) => {
    try {
      const result = await runFullPipeline({ sheetSource, memberRepository, importStateRepo, workLog, config });
      res.status(result.success ? 200 : 409).json(result);
    } catch (e) {
      workLog.log({ phase: 'run', type: 'error', message: e.message });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ④ 検証
  router.get('/validate', async (req, res) => {
    try {
      const result = await runValidation({ sheetSource, importStateRepo, workLog, config });
      res.status(result.ok ? 200 : 409).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, problems: ['検証実行エラー: ' + e.message] });
    }
  });

  // ⑤ 最新ログ確認
  router.get('/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ entries: workLog.readRecent(limit) });
  });

  router.get('/backups', (req, res) => {
    res.json({ backups: listBackups(config) });
  });

  router.post('/restore', (req, res) => {
    const stamp = req.body && req.body.stamp;
    if (!stamp) {
      return res.status(400).json({ success: false, error: 'stamp（復元したいバックアップのタイムスタンプ）を指定してください' });
    }
    try {
      const result = restoreFromBackup(config, stamp, workLog);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}

module.exports = createFormImportRouter;
