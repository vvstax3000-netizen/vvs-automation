import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { naverHeaders } from '../services/crypto.js';

export const salesRoutes = new Hono();
salesRoutes.use('*', authMiddleware());

// === Metric calculation (pure logic) ===
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

// === Naver API call (Web Crypto HMAC) ===
async function naverApiCall(method, path, license, secret, customerId, params = {}) {
  const headers = await naverHeaders(method, path, license, secret, customerId);
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.searchad.naver.com${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { method, headers });
  if (!res.ok) throw new Error(`Naver API ${res.status}`);
  return res.json();
}

// === Naver ad cost ===
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
async function getMetaAdCost(db, client, since, until) {
  const empty = { actual: 0, markup: 0 };
  if (!client.meta_campaign_ids) return empty;

  const tokenRow = await db.prepare("SELECT value FROM settings WHERE key = 'meta_api_token'").first();
  const accessToken = tokenRow?.value;
  if (!accessToken) return empty;

  const cpmRow = await db.prepare("SELECT value FROM settings WHERE key = 'meta_cpm_markup'").first();
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

// === Fetch ad costs (combined) ===
async function fetchAdCosts(db, clientId, since, until) {
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return { naverAdCost: 0, metaActual: 0, metaMarkup: 0 };
  const [naverAdCost, metaCosts] = await Promise.all([
    getNaverAdCost(client, since, until).catch(() => 0),
    getMetaAdCost(db, client, since, until).catch(() => ({ actual: 0, markup: 0 }))
  ]);
  return {
    naverAdCost,
    metaActual: metaCosts.actual,
    metaMarkup: metaCosts.markup
  };
}

// === GET list ===
salesRoutes.get('/:clientId', async (c) => {
  const db = c.env.DB;
  const clientId = c.req.param('clientId');

  const { results: records } = await db.prepare(
    'SELECT * FROM sales_records WHERE client_id = ? ORDER BY period_start DESC'
  ).bind(clientId).all();

  // Attach image counts
  for (const r of records) {
    const row = await db.prepare('SELECT COUNT(*) as cnt FROM sales_images WHERE record_id = ?').bind(r.id).first();
    r.image_count = row?.cnt || 0;
  }
  return c.json({ records });
});

// === GET single ===
salesRoutes.get('/:clientId/:recordId', async (c) => {
  const db = c.env.DB;
  const record = await db.prepare(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('recordId'), c.req.param('clientId')).first();

  if (!record) return c.json({ error: '데이터를 찾을 수 없습니다' }, 404);

  const { results: images } = await db.prepare(
    'SELECT * FROM sales_images WHERE record_id = ? ORDER BY uploaded_at ASC'
  ).bind(c.req.param('recordId')).all();

  return c.json({ record, images });
});

// === POST create ===
salesRoutes.post('/:clientId', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const {
    periodStart, periodEnd, periodType = 'weekly',
    revenue = 0, visitors = 0, placeViews = 0,
    smartCalls = 0, reviewCount = 0, memo = ''
  } = body;

  if (!periodStart || !periodEnd) {
    return c.json({ error: '기간을 입력해주세요' }, 400);
  }

  const clientId = parseInt(c.req.param('clientId'));
  const { naverAdCost, metaActual, metaMarkup } = await fetchAdCosts(db, clientId, periodStart, periodEnd);
  const useMarkup = body.useMarkup == null ? 1 : (body.useMarkup ? 1 : 0);

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

  const result = await db.prepare(
    `INSERT INTO sales_records (
      client_id, period_start, period_end, period_type,
      revenue, visitors, place_views, smart_calls, review_count,
      unit_price, conversion_rate,
      naver_ad_cost, meta_ad_cost, meta_ad_cost_actual, meta_ad_cost_markup, use_markup,
      total_ad_cost, cac, roas, memo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    clientId, periodStart, periodEnd, periodType,
    draft.revenue, draft.visitors, draft.place_views,
    parseInt(smartCalls) || 0, parseInt(reviewCount) || 0,
    m.unitPrice, m.conversionRate,
    naverAdCost, m.metaAdCost, metaActual, metaMarkup, useMarkup,
    m.totalAdCost, m.cac, m.roas, memo
  ).run();

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ success: true, record }, 201);
});

// === PUT update ===
salesRoutes.put('/:clientId/:recordId', async (c) => {
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('recordId'), c.req.param('clientId')).first();

  if (!existing) return c.json({ error: '데이터를 찾을 수 없습니다' }, 404);

  const body = await c.req.json();
  const {
    periodStart = existing.period_start,
    periodEnd = existing.period_end,
    periodType = existing.period_type,
    revenue, visitors, placeViews,
    smartCalls, reviewCount, memo
  } = body;

  const clientId = parseInt(c.req.param('clientId'));

  // Refetch ad cost if period changed
  let naverAdCost = existing.naver_ad_cost;
  let metaActual = existing.meta_ad_cost_actual || 0;
  let metaMarkup = existing.meta_ad_cost_markup || 0;
  if (periodStart !== existing.period_start || periodEnd !== existing.period_end) {
    const costs = await fetchAdCosts(db, clientId, periodStart, periodEnd);
    naverAdCost = costs.naverAdCost;
    metaActual = costs.metaActual;
    metaMarkup = costs.metaMarkup;
  }

  const useMarkup = body.useMarkup == null
    ? (existing.use_markup == null ? 1 : existing.use_markup)
    : (body.useMarkup ? 1 : 0);

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

  await db.prepare(
    `UPDATE sales_records SET
      period_start=?, period_end=?, period_type=?,
      revenue=?, visitors=?, place_views=?, smart_calls=?, review_count=?,
      unit_price=?, conversion_rate=?,
      naver_ad_cost=?, meta_ad_cost=?, meta_ad_cost_actual=?, meta_ad_cost_markup=?, use_markup=?,
      total_ad_cost=?, cac=?, roas=?, memo=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?`
  ).bind(
    periodStart, periodEnd, periodType,
    draft.revenue, draft.visitors, draft.place_views,
    smartCalls != null ? parseInt(smartCalls) : existing.smart_calls,
    reviewCount != null ? parseInt(reviewCount) : existing.review_count,
    m.unitPrice, m.conversionRate,
    naverAdCost, m.metaAdCost, metaActual, metaMarkup, useMarkup,
    m.totalAdCost, m.cac, m.roas,
    memo != null ? memo : existing.memo,
    c.req.param('recordId')
  ).run();

  const updated = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(c.req.param('recordId')).first();
  return c.json({ success: true, record: updated });
});

// === DELETE record ===
salesRoutes.delete('/:clientId/:recordId', async (c) => {
  const db = c.env.DB;
  const recordId = c.req.param('recordId');
  const clientId = c.req.param('clientId');

  // Clean up image DB records (files are not on Workers; R2 migration pending)
  await db.prepare('DELETE FROM sales_images WHERE record_id = ?').bind(recordId).run();

  const result = await db.prepare(
    'DELETE FROM sales_records WHERE id = ? AND client_id = ?'
  ).bind(recordId, clientId).run();

  if (result.meta.changes === 0) return c.json({ error: '데이터를 찾을 수 없습니다' }, 404);
  return c.json({ success: true });
});

// TODO: 이미지 업로드/삭제 — R2 스토리지 연동 후 구현 예정
// POST /:clientId/:recordId/images  (multer + fs → R2 업로드)
// DELETE /:clientId/:recordId/images/:imageId  (fs.unlink → R2 삭제)
salesRoutes.post('/:clientId/:recordId/images', async (c) => {
  return c.json({ error: '이미지 업로드 기능 준비 중입니다' }, 501);
});

salesRoutes.delete('/:clientId/:recordId/images/:imageId', async (c) => {
  return c.json({ error: '이미지 삭제 기능 준비 중입니다' }, 501);
});

// === Refresh ad cost ===
salesRoutes.post('/:clientId/:recordId/refresh-adcost', async (c) => {
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT * FROM sales_records WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('recordId'), c.req.param('clientId')).first();

  if (!existing) return c.json({ error: '데이터를 찾을 수 없습니다' }, 404);

  const { naverAdCost, metaActual, metaMarkup } = await fetchAdCosts(
    db,
    parseInt(c.req.param('clientId')),
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

  await db.prepare(
    `UPDATE sales_records SET
      naver_ad_cost=?, meta_ad_cost=?, meta_ad_cost_actual=?, meta_ad_cost_markup=?,
      total_ad_cost=?, cac=?, roas=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`
  ).bind(naverAdCost, m.metaAdCost, metaActual, metaMarkup, m.totalAdCost, m.cac, m.roas, c.req.param('recordId')).run();

  return c.json({
    naverAdCost,
    metaAdCostActual: metaActual,
    metaAdCostMarkup: metaMarkup,
    metaAdCost: m.metaAdCost,
    useMarkup,
    totalAdCost: m.totalAdCost, cac: m.cac, roas: m.roas
  });
});
