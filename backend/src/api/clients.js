const express = require('express');
const { queryAll, queryOne, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// List all clients
router.get('/', (req, res) => {
  const clients = queryAll('SELECT * FROM clients ORDER BY created_at DESC');
  res.json(clients);
});

// Get single client
router.get('/:id', (req, res) => {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  res.json(client);
});

// Create client
router.post('/', (req, res) => {
  const {
    company_name, industry, address, contact_person, phone,
    contract_start, contract_end,
    naver_api_license, naver_api_secret, naver_customer_id,
    meta_ad_account_id
  } = req.body;

  if (!company_name) {
    return res.status(400).json({ error: '업체명은 필수입니다' });
  }

  const result = run(
    `INSERT INTO clients (company_name, industry, address, contact_person, phone,
      contract_start, contract_end, naver_api_license, naver_api_secret,
      naver_customer_id, meta_ad_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [company_name, industry, address, contact_person, phone,
     contract_start, contract_end,
     naver_api_license, naver_api_secret, naver_customer_id,
     meta_ad_account_id]
  );

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(client);
});

// Update client
router.put('/:id', (req, res) => {
  const {
    company_name, industry, address, contact_person, phone,
    contract_start, contract_end,
    naver_api_license, naver_api_secret, naver_customer_id,
    meta_ad_account_id
  } = req.body;

  if (!company_name) {
    return res.status(400).json({ error: '업체명은 필수입니다' });
  }

  const result = run(
    `UPDATE clients SET
      company_name=?, industry=?, address=?, contact_person=?, phone=?,
      contract_start=?, contract_end=?,
      naver_api_license=?, naver_api_secret=?, naver_customer_id=?,
      meta_ad_account_id=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [company_name, industry, address, contact_person, phone,
     contract_start, contract_end,
     naver_api_license, naver_api_secret, naver_customer_id,
     meta_ad_account_id, req.params.id]
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  res.json(client);
});

// Delete client
router.delete('/:id', (req, res) => {
  const result = run('DELETE FROM clients WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  }
  res.json({ message: '삭제되었습니다' });
});

module.exports = router;
