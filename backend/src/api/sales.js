const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { queryAll, queryOne, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'sales-images');

// === Lazy table init ===
let tablesReady = false;
function ensureTables() {
  if (tablesReady) return;
  run(`CREATE TABLE IF NOT EXISTS sales_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    period_type TEXT DEFAULT 'weekly',
    revenue INTEGER DEFAULT 0,
    visitors INTEGER DEFAULT 0,
    place_views INTEGER DEFAULT 0,
    smart_calls INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    unit_price INTEGER DEFAULT 0,
    conversion_rate REAL DEFAULT 0,
    naver_ad_cost INTEGER DEFAULT 0,
    meta_ad_cost INTEGER DEFAULT 0,
    total_ad_cost INTEGER DEFAULT 0,
    cac INTEGER DEFAULT 0,
    roas REAL DEFAULT 0,
    memo TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  run(`CREATE TABLE IF NOT EXISTS sales_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Migration: add markup columns if missing
  try { run('ALTER TABLE sales_records ADD COLUMN meta_ad_cost_actual INTEGER DEFAULT 0'); } catch {}
  try { run('ALTER TABLE sales_records ADD COLUMN meta_ad_cost_markup INTEGER DEFAULT 0'); } catch {}
  try { run('ALTER TABLE sales_records ADD COLUMN use_markup INTEGER DEFAULT 1'); } catch {}
  tablesReady = true;
}

router.use(authMiddleware);
router.use((req, res, next) => { ensureTables(); next(); });

// === Multer config (image upload) ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(IMAGES_DIR, String(req.params.clientId), String(req.params.recordId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safeName = file.originalname.replace(/[^\w.\-가-힣]/g, '_');
    cb(null, `${ts}-${safeName}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// === Metric calculation ===
function calcMetrics(record) {
  const revenue = record.revenue || 0;
  const visitors = record.visitors || 0;
  const placeViews = record.place_views || 0;
  const naverAdCost = record.naver_ad_cost || 0;
  const useMarkup = record.use_markup == null ? 1 : record.use_markup;
  const metaAdCost = useMarkup
    ? (record.meta_ad_cost_markup || 0)
    : (record.meta_ad_cost_actual || 0);

  const unitPrice = visitors > 0 ? Math.round(revenue / visitors) : 0;
  const conversionRate = placeViews > 0 ? (visitors / placeViews) * 100 : 0;
  const totalAdCost = naverAdCost + metaAdCost;
  const cac = visitors > 0 ? Math.round(totalAdCost / visitors) : 0;
  const roas = totalAdCost > 0 ? (revenue / totalAdCost) * 100 : 0;

  return { unitPrice, conversionRate, totalAdCost, cac, roas, metaAdCost };
}

// === Naver ad cost ===
async function naverApiCall(method, path, license, secret, customerId, params = {}) {
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${method}.${path}`).digest('base64');
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.searchad.naver.com${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-KEY': license,
      'X-Customer': customerId,
      'X-Timestamp': ts,
      'X-Signature': sig
    }
  });
  if (!res.ok) throw new Error(`Naver API ${res.status}`);
  return res.json();
}

async function getNaverAdCost(client, since, until) {
  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) return 0;

  try {
    const campaigns = await naverApiCall('GET', '/ncc/campaigns', L, S, C);
    if (!Array.isArray(campaigns) || !campaigns.length) return 0;

    let total = 0;
    for (const camp of campaigns) {
      try {
        const result = await naverApiCall('GET', '/stats', L, S, C, {
          id: camp.nccCampaignId,
          fields: JSON.stringify(['salesAmt']),
          timeRange: JSON.stringify({ since, until })
        });
        const days = result?.data || [];
        for (const d of days) total += d.salesAmt || 0;
      } catch (e) { /* skip campaign */ }
    }
    return Math.round(total);
  } catch (err) {
    console.error('[Sales] Naver ad cost error:', err.message);
    return 0;
  }
}

// === Meta ad cost (returns both actual spend and markup) ===
async function getMetaAdCost(client, since, until) {
  const empty = { actual: 0, markup: 0 };
  if (!client.meta_campaign_ids) return empty;
  const tokenRow = queryOne("SELECT value FROM settings WHERE key = 'meta_api_token'");
  const accessToken = tokenRow?.value;
  if (!accessToken) return empty;

  const cpmRow = queryOne("SELECT value FROM settings WHERE key = 'meta_cpm_markup'");
  const cpm = parseFloat(cpmRow?.value) || 7000;

  const ids = client.meta_campaign_ids.split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return empty;

  let totalSpend = 0, totalImpressions = 0;
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  for (const id of ids) {
    try {
      const url = `https://graph.facebook.com/v21.0/${id}/insights?fields=spend,impressions&time_range=${tr}&access_token=${accessToken}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) continue;
      const r = data.data?.[0];
      if (r) {
        totalSpend += parseFloat(r.spend) || 0;
        totalImpressions += parseInt(r.impressions) || 0;
      }
    } catch (e) { /* skip */ }
  }
  return {
    actual: Math.round(totalSpend),
    markup: Math.round((totalImpressions / 1000) * cpm)
  };
}

async function fetchAdCosts(clientId, since, until) {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) return { naverAdCost: 0, metaActual: 0, metaMarkup: 0 };
  const [naverAdCost, metaCosts] = await Promise.all([
    getNaverAdCost(client, since, until).catch(() => 0),
    getMetaAdCost(client, since, until).catch(() => ({ actual: 0, markup: 0 }))
  ]);
  return {
    naverAdCost,
    metaActual: metaCosts.actual,
    metaMarkup: metaCosts.markup
  };
}

// === GET list ===
router.get('/:clientId', (req, res) => {
  const records = queryAll(
    `SELECT * FROM sales_records WHERE client_id = ? ORDER BY period_start DESC`,
    [req.params.clientId]
  );
  // Attach image counts
  for (const r of records) {
    const c = queryOne('SELECT COUNT(*) as cnt FROM sales_images WHERE record_id = ?', [r.id]);
    r.image_count = c?.cnt || 0;
  }
  res.json({ records });
});

// === GET single ===
router.get('/:clientId/:recordId', (req, res) => {
  const record = queryOne(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?',
    [req.params.recordId, req.params.clientId]
  );
  if (!record) return res.status(404).json({ error: '데이터를 찾을 수 없습니다' });
  const images = queryAll(
    'SELECT * FROM sales_images WHERE record_id = ? ORDER BY uploaded_at ASC',
    [req.params.recordId]
  );
  res.json({ record, images });
});

// === POST create ===
router.post('/:clientId', async (req, res) => {
  const {
    periodStart, periodEnd, periodType = 'weekly',
    revenue = 0, visitors = 0, placeViews = 0,
    smartCalls = 0, reviewCount = 0, memo = ''
  } = req.body;

  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: '기간을 입력해주세요' });
  }

  const clientId = parseInt(req.params.clientId);
  const { naverAdCost, metaActual, metaMarkup } = await fetchAdCosts(clientId, periodStart, periodEnd);
  const useMarkup = req.body.useMarkup == null ? 1 : (req.body.useMarkup ? 1 : 0);

  const draft = {
    revenue: parseInt(revenue) || 0,
    visitors: parseInt(visitors) || 0,
    place_views: parseInt(placeViews) || 0,
    naver_ad_cost: naverAdCost,
    meta_ad_cost_actual: metaActual,
    meta_ad_cost_markup: metaMarkup,
    use_markup: useMarkup
  };
  const m = calcMetrics(draft);

  const result = run(
    `INSERT INTO sales_records (
      client_id, period_start, period_end, period_type,
      revenue, visitors, place_views, smart_calls, review_count,
      unit_price, conversion_rate,
      naver_ad_cost, meta_ad_cost, meta_ad_cost_actual, meta_ad_cost_markup, use_markup,
      total_ad_cost, cac, roas, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      clientId, periodStart, periodEnd, periodType,
      draft.revenue, draft.visitors, draft.place_views,
      parseInt(smartCalls) || 0, parseInt(reviewCount) || 0,
      m.unitPrice, m.conversionRate,
      naverAdCost, m.metaAdCost, metaActual, metaMarkup, useMarkup,
      m.totalAdCost, m.cac, m.roas, memo
    ]
  );

  const record = queryOne('SELECT * FROM sales_records WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ success: true, record });
});

// === PUT update ===
router.put('/:clientId/:recordId', async (req, res) => {
  const existing = queryOne(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?',
    [req.params.recordId, req.params.clientId]
  );
  if (!existing) return res.status(404).json({ error: '데이터를 찾을 수 없습니다' });

  const {
    periodStart = existing.period_start,
    periodEnd = existing.period_end,
    periodType = existing.period_type,
    revenue, visitors, placeViews,
    smartCalls, reviewCount, memo
  } = req.body;

  const clientId = parseInt(req.params.clientId);
  // Refetch ad cost if period changed
  let naverAdCost = existing.naver_ad_cost;
  let metaActual = existing.meta_ad_cost_actual || 0;
  let metaMarkup = existing.meta_ad_cost_markup || 0;
  if (periodStart !== existing.period_start || periodEnd !== existing.period_end) {
    const costs = await fetchAdCosts(clientId, periodStart, periodEnd);
    naverAdCost = costs.naverAdCost;
    metaActual = costs.metaActual;
    metaMarkup = costs.metaMarkup;
  }

  const useMarkup = req.body.useMarkup == null
    ? (existing.use_markup == null ? 1 : existing.use_markup)
    : (req.body.useMarkup ? 1 : 0);

  const draft = {
    revenue: revenue != null ? parseInt(revenue) : existing.revenue,
    visitors: visitors != null ? parseInt(visitors) : existing.visitors,
    place_views: placeViews != null ? parseInt(placeViews) : existing.place_views,
    naver_ad_cost: naverAdCost,
    meta_ad_cost_actual: metaActual,
    meta_ad_cost_markup: metaMarkup,
    use_markup: useMarkup
  };
  const m = calcMetrics(draft);

  run(
    `UPDATE sales_records SET
      period_start=?, period_end=?, period_type=?,
      revenue=?, visitors=?, place_views=?, smart_calls=?, review_count=?,
      unit_price=?, conversion_rate=?,
      naver_ad_cost=?, meta_ad_cost=?, meta_ad_cost_actual=?, meta_ad_cost_markup=?, use_markup=?,
      total_ad_cost=?, cac=?, roas=?, memo=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [
      periodStart, periodEnd, periodType,
      draft.revenue, draft.visitors, draft.place_views,
      smartCalls != null ? parseInt(smartCalls) : existing.smart_calls,
      reviewCount != null ? parseInt(reviewCount) : existing.review_count,
      m.unitPrice, m.conversionRate,
      naverAdCost, m.metaAdCost, metaActual, metaMarkup, useMarkup,
      m.totalAdCost, m.cac, m.roas,
      memo != null ? memo : existing.memo,
      req.params.recordId
    ]
  );

  const updated = queryOne('SELECT * FROM sales_records WHERE id = ?', [req.params.recordId]);
  res.json({ success: true, record: updated });
});

// === DELETE record ===
router.delete('/:clientId/:recordId', (req, res) => {
  const images = queryAll('SELECT * FROM sales_images WHERE record_id = ?', [req.params.recordId]);
  for (const img of images) {
    try { fs.unlinkSync(img.file_path); } catch {}
  }
  // Try to remove record dir
  try {
    const dir = path.join(IMAGES_DIR, String(req.params.clientId), String(req.params.recordId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}

  run('DELETE FROM sales_images WHERE record_id = ?', [req.params.recordId]);
  const result = run(
    'DELETE FROM sales_records WHERE id = ? AND client_id = ?',
    [req.params.recordId, req.params.clientId]
  );
  if (result.changes === 0) return res.status(404).json({ error: '데이터를 찾을 수 없습니다' });
  res.json({ success: true });
});

// === POST image upload ===
router.post('/:clientId/:recordId/images', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });

  const existingCount = queryOne(
    'SELECT COUNT(*) as cnt FROM sales_images WHERE record_id = ?',
    [req.params.recordId]
  );
  if (existingCount?.cnt >= 5) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: '최대 5장까지 업로드 가능합니다' });
  }

  const result = run(
    `INSERT INTO sales_images (record_id, client_id, filename, original_name, file_path, file_size)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.params.recordId,
      req.params.clientId,
      req.file.filename,
      req.file.originalname,
      req.file.path,
      req.file.size
    ]
  );

  const image = queryOne('SELECT * FROM sales_images WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json({ success: true, image });
});

// === DELETE image ===
router.delete('/:clientId/:recordId/images/:imageId', (req, res) => {
  const img = queryOne(
    'SELECT * FROM sales_images WHERE id = ? AND record_id = ?',
    [req.params.imageId, req.params.recordId]
  );
  if (!img) return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });

  try { fs.unlinkSync(img.file_path); } catch {}
  run('DELETE FROM sales_images WHERE id = ?', [req.params.imageId]);
  res.json({ success: true });
});

// === Refresh ad cost ===
router.post('/:clientId/:recordId/refresh-adcost', async (req, res) => {
  const existing = queryOne(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?',
    [req.params.recordId, req.params.clientId]
  );
  if (!existing) return res.status(404).json({ error: '데이터를 찾을 수 없습니다' });

  const { naverAdCost, metaActual, metaMarkup } = await fetchAdCosts(
    parseInt(req.params.clientId),
    existing.period_start,
    existing.period_end
  );

  const useMarkup = existing.use_markup == null ? 1 : existing.use_markup;
  const draft = {
    revenue: existing.revenue,
    visitors: existing.visitors,
    place_views: existing.place_views,
    naver_ad_cost: naverAdCost,
    meta_ad_cost_actual: metaActual,
    meta_ad_cost_markup: metaMarkup,
    use_markup: useMarkup
  };
  const m = calcMetrics(draft);

  run(
    `UPDATE sales_records SET
      naver_ad_cost=?, meta_ad_cost=?, meta_ad_cost_actual=?, meta_ad_cost_markup=?,
      total_ad_cost=?, cac=?, roas=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`,
    [naverAdCost, m.metaAdCost, metaActual, metaMarkup, m.totalAdCost, m.cac, m.roas, req.params.recordId]
  );

  res.json({
    naverAdCost,
    metaAdCostActual: metaActual,
    metaAdCostMarkup: metaMarkup,
    metaAdCost: m.metaAdCost,
    useMarkup,
    totalAdCost: m.totalAdCost, cac: m.cac, roas: m.roas
  });
});

module.exports = router;
