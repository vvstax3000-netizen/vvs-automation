const express = require('express');
const { queryAll, queryOne } = require('../db/schema');

const router = express.Router();

// Public rank data by slug
router.get('/rank/:slug', (req, res) => {
  const client = queryOne(
    'SELECT id, company_name, place_name, slug FROM clients WHERE slug = ?',
    [req.params.slug]
  );
  if (!client) return res.status(404).json({ error: '페이지를 찾을 수 없습니다' });

  const keywords = queryAll(`
    SELECT k.id, k.keyword, k.memo, k.search_volume,
      (SELECT rr.rank FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as latest_rank,
      (SELECT rr.recorded_date FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as latest_date,
      (SELECT rr.rank FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1 OFFSET 1) as prev_rank,
      (SELECT rr.visitor_reviews FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as visitor_reviews,
      (SELECT rr.blog_reviews FROM rank_records rr
       WHERE rr.keyword_id = k.id
       ORDER BY rr.recorded_date DESC LIMIT 1) as blog_reviews
    FROM keywords k
    WHERE k.client_id = ?
    ORDER BY k.created_at ASC
  `, [client.id]);

  res.json({ client, keywords });
});

// Public rank history
router.get('/rank/:slug/keywords/:keywordId/history', (req, res) => {
  const client = queryOne('SELECT id FROM clients WHERE slug = ?', [req.params.slug]);
  if (!client) return res.status(404).json({ error: '페이지를 찾을 수 없습니다' });

  const keyword = queryOne(
    'SELECT * FROM keywords WHERE id = ? AND client_id = ?',
    [req.params.keywordId, client.id]
  );
  if (!keyword) return res.status(404).json({ error: '키워드를 찾을 수 없습니다' });

  const records = queryAll(`
    SELECT rank, visitor_reviews, blog_reviews, recorded_date
    FROM rank_records
    WHERE keyword_id = ?
    ORDER BY recorded_date DESC
    LIMIT 90
  `, [req.params.keywordId]);

  for (let i = 0; i < records.length; i++) {
    const curr = records[i];
    const prev = records[i + 1];
    curr.change = (prev && curr.rank && prev.rank) ? prev.rank - curr.rank : null;
  }

  res.json(records);
});

module.exports = router;
