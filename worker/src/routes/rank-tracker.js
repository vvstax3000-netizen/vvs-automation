import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { crawlNaverPlace, findRank, randomDelay } from '../services/crawler.js';
import { getKeywordStats } from '../services/naver-api.js';

export const rankTrackerRoutes = new Hono();
rankTrackerRoutes.use('*', authMiddleware());

rankTrackerRoutes.get('/:clientId/keywords', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT k.*,
      (SELECT rr.rank FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as latest_rank,
      (SELECT rr.recorded_date FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as latest_date,
      (SELECT rr.rank FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1 OFFSET 1) as prev_rank,
      (SELECT rr.visitor_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as visitor_reviews,
      (SELECT rr.blog_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as blog_reviews,
      (SELECT rr.visitor_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1 OFFSET 1) as prev_visitor_reviews,
      (SELECT rr.blog_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1 OFFSET 1) as prev_blog_reviews
    FROM keywords k WHERE k.client_id = ? ORDER BY k.created_at ASC
  `).bind(c.req.param('clientId')).all();
  return c.json(results);
});

rankTrackerRoutes.get('/:clientId/review-stats', async (c) => {
  const db = c.env.DB;
  const clientId = c.req.param('clientId');
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const weekAgoStr = weekAgo.toISOString().split('T')[0];

  const latest = await db.prepare(`
    SELECT rr.visitor_reviews, rr.blog_reviews FROM rank_records rr
    JOIN keywords k ON rr.keyword_id = k.id
    WHERE k.client_id = ? AND rr.visitor_reviews > 0
    ORDER BY rr.recorded_date DESC LIMIT 1
  `).bind(clientId).first();

  const weekOld = await db.prepare(`
    SELECT rr.visitor_reviews, rr.blog_reviews FROM rank_records rr
    JOIN keywords k ON rr.keyword_id = k.id
    WHERE k.client_id = ? AND rr.recorded_date <= ? AND rr.visitor_reviews > 0
    ORDER BY rr.recorded_date DESC LIMIT 1
  `).bind(clientId, weekAgoStr).first();

  return c.json({
    visitorReviews: latest?.visitor_reviews || 0,
    blogReviews: latest?.blog_reviews || 0,
    weeklyVisitorChange: (weekOld?.visitor_reviews > 0) ? (latest?.visitor_reviews || 0) - weekOld.visitor_reviews : 0,
    weeklyBlogChange: (weekOld?.blog_reviews > 0) ? (latest?.blog_reviews || 0) - weekOld.blog_reviews : 0
  });
});

rankTrackerRoutes.post('/:clientId/keywords', async (c) => {
  const db = c.env.DB;
  const { keywords } = await c.req.json();
  if (!keywords || !keywords.length) return c.json({ error: '키워드를 입력해주세요' }, 400);

  const added = [];
  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    const existing = await db.prepare('SELECT id FROM keywords WHERE client_id = ? AND keyword = ?')
      .bind(c.req.param('clientId'), trimmed).first();
    if (existing) continue;
    const result = await db.prepare('INSERT INTO keywords (client_id, keyword) VALUES (?, ?)')
      .bind(c.req.param('clientId'), trimmed).run();
    added.push({ id: result.meta.last_row_id, keyword: trimmed });
  }
  return c.json(added, 201);
});

rankTrackerRoutes.delete('/keywords/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('DELETE FROM rank_records WHERE keyword_id = ?').bind(id).run();
  const result = await db.prepare('DELETE FROM keywords WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: '키워드를 찾을 수 없습니다' }, 404);
  return c.json({ message: '삭제되었습니다' });
});

rankTrackerRoutes.put('/keywords/:id/memo', async (c) => {
  const db = c.env.DB;
  const { memo } = await c.req.json();
  await db.prepare('UPDATE keywords SET memo = ? WHERE id = ?').bind(memo || '', c.req.param('id')).run();
  return c.json({ message: '메모가 저장되었습니다' });
});

rankTrackerRoutes.get('/keywords/:id/history', async (c) => {
  const db = c.env.DB;
  const { results: records } = await db.prepare(`
    SELECT rank, visitor_reviews, blog_reviews, recorded_date
    FROM rank_records WHERE keyword_id = ? ORDER BY recorded_date DESC LIMIT 90
  `).bind(c.req.param('id')).all();

  for (let i = 0; i < records.length; i++) {
    const curr = records[i];
    const prev = records[i + 1];
    curr.change = (prev && curr.rank && prev.rank) ? prev.rank - curr.rank : null;
  }
  return c.json(records);
});

rankTrackerRoutes.post('/:clientId/refresh', async (c) => {
  const db = c.env.DB;
  const clientId = c.req.param('clientId');
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);
  if (!client.place_name) return c.json({ error: '업체 플레이스명을 먼저 설정해주세요' }, 400);

  const { results: keywords } = await db.prepare('SELECT * FROM keywords WHERE client_id = ?').bind(clientId).all();
  const today = new Date().toISOString().split('T')[0];
  const results = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    try {
      const crawled = await crawlNaverPlace(kw.keyword);
      const { rank, visitorReviews, blogReviews } = findRank(crawled, client.place_name);
      await db.prepare('DELETE FROM rank_records WHERE keyword_id = ? AND recorded_date = ?').bind(kw.id, today).run();
      await db.prepare('INSERT INTO rank_records (keyword_id, rank, visitor_reviews, blog_reviews, recorded_date) VALUES (?, ?, ?, ?, ?)')
        .bind(kw.id, rank, visitorReviews, blogReviews, today).run();
      results.push({ keyword_id: kw.id, keyword: kw.keyword, rank, visitorReviews, blogReviews });
      if (i < keywords.length - 1) await randomDelay();
    } catch (err) {
      results.push({ keyword_id: kw.id, keyword: kw.keyword, error: err.message });
    }
  }
  return c.json({ message: '순위 업데이트 완료', results });
});

rankTrackerRoutes.post('/:clientId/search-volume', async (c) => {
  const db = c.env.DB;
  const clientId = c.req.param('clientId');
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);
  if (!client.naver_api_license || !client.naver_api_secret || !client.naver_customer_id) {
    return c.json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다' }, 400);
  }

  const { results: keywords } = await db.prepare('SELECT * FROM keywords WHERE client_id = ?').bind(clientId).all();
  if (!keywords.length) return c.json({ message: '키워드가 없습니다' });

  const stats = await getKeywordStats(
    keywords.map(k => k.keyword),
    client.naver_api_license, client.naver_api_secret, client.naver_customer_id
  );
  if (!stats) return c.json({ error: '검색량 조회에 실패했습니다' }, 500);

  for (const stat of stats) {
    const kw = keywords.find(k => k.keyword === stat.keyword);
    if (kw) await db.prepare('UPDATE keywords SET search_volume = ? WHERE id = ?').bind(stat.total, kw.id).run();
  }
  return c.json({ message: '검색량 업데이트 완료', stats });
});
