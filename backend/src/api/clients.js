const express = require('express');
const { queryAll, queryOne, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

router.get('/', (req, res) => {
  const clients = queryAll('SELECT * FROM clients ORDER BY created_at DESC');
  res.json(clients);
});

router.get('/:id', (req, res) => {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  res.json(client);
});

router.post('/', (req, res) => {
  const {
    company_name, industry, address, contact_person, phone,
    contract_start, contract_end,
    naver_api_license, naver_api_secret, naver_customer_id,
    meta_ad_account_id, place_name, slug
  } = req.body;

  if (!company_name) {
    return res.status(400).json({ error: '업체명은 필수입니다' });
  }

  if (slug) {
    const existing = queryOne('SELECT id FROM clients WHERE slug = ?', [slug]);
    if (existing) return res.status(400).json({ error: '이미 사용 중인 슬러그입니다' });
  }

  const result = run(
    `INSERT INTO clients (company_name, industry, address, contact_person, phone,
      contract_start, contract_end, naver_api_license, naver_api_secret, naver_customer_id,
      meta_ad_account_id, place_name, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [company_name, industry || '', address || '', contact_person || '', phone || '',
     contract_start || '', contract_end || '',
     naver_api_license || '', naver_api_secret || '', naver_customer_id || '',
     meta_ad_account_id || '', place_name || null, slug || null]
  );

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const {
    company_name, industry, address, contact_person, phone,
    contract_start, contract_end,
    naver_api_license, naver_api_secret, naver_customer_id,
    meta_ad_account_id, place_name, slug
  } = req.body;

  if (!company_name) {
    return res.status(400).json({ error: '업체명은 필수입니다' });
  }

  if (slug) {
    const existing = queryOne('SELECT id FROM clients WHERE slug = ? AND id != ?', [slug, req.params.id]);
    if (existing) return res.status(400).json({ error: '이미 사용 중인 슬러그입니다' });
  }

  const result = run(
    `UPDATE clients SET
      company_name=?, industry=?, address=?, contact_person=?, phone=?,
      contract_start=?, contract_end=?,
      naver_api_license=?, naver_api_secret=?, naver_customer_id=?,
      meta_ad_account_id=?, place_name=?, slug=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [company_name, industry || '', address || '', contact_person || '', phone || '',
     contract_start || '', contract_end || '',
     naver_api_license || '', naver_api_secret || '', naver_customer_id || '',
     meta_ad_account_id || '', place_name || null, slug || null, req.params.id]
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  res.json(client);
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM rank_records WHERE keyword_id IN (SELECT id FROM keywords WHERE client_id = ?)', [req.params.id]);
  run('DELETE FROM keywords WHERE client_id = ?', [req.params.id]);
  const result = run('DELETE FROM clients WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  }
  res.json({ message: '삭제되었습니다' });
});

module.exports = router;
