import { Hono } from 'hono';

export const publicRoutes = new Hono();

publicRoutes.get('/rank/:slug', async (c) => {
  const db = c.env.DB;
  const client = await db.prepare(
    'SELECT id, company_name, place_name, slug FROM clients WHERE slug = ?'
  ).bind(c.req.param('slug')).first();
  if (!client) return c.json({ error: '페이지를 찾을 수 없습니다' }, 404);

  const { results: keywords } = await db.prepare(`
    SELECT k.id, k.keyword, k.memo, k.search_volume,
      (SELECT rr.rank FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as latest_rank,
      (SELECT rr.recorded_date FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as latest_date,
      (SELECT rr.rank FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1 OFFSET 1) as prev_rank,
      (SELECT rr.visitor_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as visitor_reviews,
      (SELECT rr.blog_reviews FROM rank_records rr WHERE rr.keyword_id = k.id ORDER BY rr.recorded_date DESC LIMIT 1) as blog_reviews
    FROM keywords k WHERE k.client_id = ? ORDER BY k.created_at ASC
  `).bind(client.id).all();

  return c.json({ client, keywords });
});

publicRoutes.get('/rank/:slug/keywords/:keywordId/history', async (c) => {
  const db = c.env.DB;
  const client = await db.prepare('SELECT id FROM clients WHERE slug = ?').bind(c.req.param('slug')).first();
  if (!client) return c.json({ error: '페이지를 찾을 수 없습니다' }, 404);

  const keyword = await db.prepare('SELECT * FROM keywords WHERE id = ? AND client_id = ?')
    .bind(c.req.param('keywordId'), client.id).first();
  if (!keyword) return c.json({ error: '키워드를 찾을 수 없습니다' }, 404);

  const { results: records } = await db.prepare(`
    SELECT rank, visitor_reviews, blog_reviews, recorded_date
    FROM rank_records WHERE keyword_id = ? ORDER BY recorded_date DESC LIMIT 90
  `).bind(c.req.param('keywordId')).all();

  for (let i = 0; i < records.length; i++) {
    const curr = records[i];
    const prev = records[i + 1];
    curr.change = (prev && curr.rank && prev.rank) ? prev.rank - curr.rank : null;
  }

  return c.json(records);
});
