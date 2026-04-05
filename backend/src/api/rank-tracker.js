const express = require('express');
const { queryAll, queryOne, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { crawlNaverPlace, findRank, randomDelay } = require('../services/crawler');
const { getKeywordStats } = require('../services/naver-api');

const router = express.Router();
router.use(authMiddleware);

// List keywords with latest ranks
router.get('/:clientId/keywords', (req, res) => {
  const keywords = queryAll(`
    SELECT k.*,
      (SELECT rr.rank FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as latest_rank,
      (SELECT rr.recorded_date FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as latest_date
    FROM keywords k
    WHERE k.client_id = ?
    ORDER BY k.created_at ASC
  `, [req.params.clientId]);

  res.json(keywords);
});

// Add keywords (multiple)
router.post('/:clientId/keywords', (req, res) => {
  const { keywords } = req.body;
  if (!keywords || !keywords.length) {
    return res.status(400).json({ error: '키워드를 입력해주세요' });
  }

  const added = [];
  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;

    const existing = queryOne(
      'SELECT id FROM keywords WHERE client_id = ? AND keyword = ?',
      [req.params.clientId, trimmed]
    );
    if (existing) continue;

    const result = run(
      'INSERT INTO keywords (client_id, keyword) VALUES (?, ?)',
      [req.params.clientId, trimmed]
    );
    added.push({ id: result.lastInsertRowid, keyword: trimmed });
  }

  res.status(201).json(added);
});

// Delete keyword
router.delete('/keywords/:id', (req, res) => {
  run('DELETE FROM rank_records WHERE keyword_id = ?', [req.params.id]);
  const result = run('DELETE FROM keywords WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: '키워드를 찾을 수 없습니다' });
  }
  res.json({ message: '삭제되었습니다' });
});

// Update memo
router.put('/keywords/:id/memo', (req, res) => {
  const { memo } = req.body;
  run('UPDATE keywords SET memo = ? WHERE id = ?', [memo || '', req.params.id]);
  res.json({ message: '메모가 저장되었습니다' });
});

// Get daily rank history
router.get('/keywords/:id/history', (req, res) => {
  const records = queryAll(`
    SELECT rank, recorded_date
    FROM rank_records
    WHERE keyword_id = ?
    ORDER BY recorded_date DESC
    LIMIT 90
  `, [req.params.id]);

  res.json(records);
});

// Refresh all ranks for a client
router.post('/:clientId/refresh', async (req, res) => {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  if (!client.place_name) {
    return res.status(400).json({ error: '업체 플레이스명을 먼저 설정해주세요' });
  }

  const keywords = queryAll('SELECT * FROM keywords WHERE client_id = ?', [req.params.clientId]);
  const today = new Date().toISOString().split('T')[0];
  const results = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    try {
      const crawled = await crawlNaverPlace(kw.keyword);
      const rank = findRank(crawled, client.place_name);

      run('DELETE FROM rank_records WHERE keyword_id = ? AND recorded_date = ?', [kw.id, today]);
      run('INSERT INTO rank_records (keyword_id, rank, recorded_date) VALUES (?, ?, ?)',
        [kw.id, rank, today]);

      results.push({ keyword_id: kw.id, keyword: kw.keyword, rank });

      if (i < keywords.length - 1) await randomDelay();
    } catch (err) {
      results.push({ keyword_id: kw.id, keyword: kw.keyword, error: err.message });
    }
  }

  res.json({ message: '순위 업데이트 완료', results });
});

// Fetch search volume from Naver API
router.post('/:clientId/search-volume', async (req, res) => {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });

  if (!client.naver_api_license || !client.naver_api_secret || !client.naver_customer_id) {
    return res.status(400).json({ error: '네이버 검색광고 API 키가 설정되지 않았습니다' });
  }

  const keywords = queryAll('SELECT * FROM keywords WHERE client_id = ?', [req.params.clientId]);
  if (!keywords.length) return res.json({ message: '키워드가 없습니다' });

  const stats = await getKeywordStats(
    keywords.map(k => k.keyword),
    client.naver_api_license, client.naver_api_secret, client.naver_customer_id
  );

  if (!stats) return res.status(500).json({ error: '검색량 조회에 실패했습니다' });

  for (const stat of stats) {
    const kw = keywords.find(k => k.keyword === stat.keyword);
    if (kw) {
      run('UPDATE keywords SET search_volume = ? WHERE id = ?', [stat.total, kw.id]);
    }
  }

  res.json({ message: '검색량 업데이트 완료', stats });
});

module.exports = router;
