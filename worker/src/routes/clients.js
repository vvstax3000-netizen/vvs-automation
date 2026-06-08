import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';

export const clientRoutes = new Hono();
clientRoutes.use('*', authMiddleware());

clientRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  return c.json(results);
});

clientRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(c.req.param('id')).first();
  if (!client) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);
  return c.json(client);
});

clientRoutes.post('/', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { company_name, industry, address, contact_person, phone,
    contract_start, contract_end, naver_api_license, naver_api_secret,
    naver_customer_id, meta_campaign_ids, place_name, slug } = body;

  if (!company_name) return c.json({ error: '업체명은 필수입니다' }, 400);

  if (slug) {
    const existing = await db.prepare('SELECT id FROM clients WHERE slug = ?').bind(slug).first();
    if (existing) return c.json({ error: '이미 사용 중인 슬러그입니다' }, 400);
  }

  const result = await db.prepare(
    `INSERT INTO clients (company_name, industry, address, contact_person, phone,
      contract_start, contract_end, naver_api_license, naver_api_secret, naver_customer_id,
      meta_campaign_ids, place_name, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    company_name, industry || '', address || '', contact_person || '', phone || '',
    contract_start || '', contract_end || '',
    naver_api_license || '', naver_api_secret || '', naver_customer_id || '',
    meta_campaign_ids || '', place_name || null, slug || null
  ).run();

  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json(client, 201);
});

clientRoutes.put('/:id', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const { company_name, industry, address, contact_person, phone,
    contract_start, contract_end, naver_api_license, naver_api_secret,
    naver_customer_id, meta_campaign_ids, place_name, slug } = body;

  if (!company_name) return c.json({ error: '업체명은 필수입니다' }, 400);

  if (slug) {
    const existing = await db.prepare('SELECT id FROM clients WHERE slug = ? AND id != ?')
      .bind(slug, c.req.param('id')).first();
    if (existing) return c.json({ error: '이미 사용 중인 슬러그입니다' }, 400);
  }

  const result = await db.prepare(
    `UPDATE clients SET
      company_name=?, industry=?, address=?, contact_person=?, phone=?,
      contract_start=?, contract_end=?,
      naver_api_license=?, naver_api_secret=?, naver_customer_id=?,
      meta_campaign_ids=?, place_name=?, slug=?, updated_at=datetime('now')
    WHERE id=?`
  ).bind(
    company_name, industry || '', address || '', contact_person || '', phone || '',
    contract_start || '', contract_end || '',
    naver_api_license || '', naver_api_secret || '', naver_customer_id || '',
    meta_campaign_ids || '', place_name || null, slug || null, c.req.param('id')
  ).run();

  if (result.meta.changes === 0) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);

  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(c.req.param('id')).first();
  return c.json(client);
});

clientRoutes.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('DELETE FROM rank_records WHERE keyword_id IN (SELECT id FROM keywords WHERE client_id = ?)').bind(id).run();
  await db.prepare('DELETE FROM keywords WHERE client_id = ?').bind(id).run();
  const result = await db.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);
  return c.json({ message: '삭제되었습니다' });
});
