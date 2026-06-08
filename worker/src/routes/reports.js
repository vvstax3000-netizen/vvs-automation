import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { naverHeaders } from '../services/crypto.js';

export const reportsRoutes = new Hono();
reportsRoutes.use('*', authMiddleware());

// === Naver API call (HMAC via Web Crypto) ===
async function naverCall(method, path, license, secret, customerId, params = {}) {
  const headers = await naverHeaders(method, path, license, secret, customerId);
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.searchad.naver.com${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { method, headers });
  if (!res.ok) throw new Error(`Naver API ${res.status}`);
  return res.json();
}

// === Fetch Naver ad data ===
async function fetchNaverAdData(db, client, periodStart, periodEnd) {
  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) return { campaigns: [], totalCost: 0 };

  try {
    const camps = await naverCall('GET', '/ncc/campaigns', L, S, C);
    if (!Array.isArray(camps) || !camps.length) return { campaigns: [], totalCost: 0 };

    const results = [];
    let totalCost = 0;
    for (const camp of camps) {
      try {
        const stats = await naverCall('GET', '/stats', L, S, C, {
          id: camp.nccCampaignId,
          fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'avgRnk', 'ccnt']),
          timeRange: JSON.stringify({ since: periodStart, until: periodEnd })
        });
        const days = stats?.data || [];
        let imp = 0, clk = 0, cost = 0, ccnt = 0;
        let ctrSum = 0, cpcSum = 0, avgRnkSum = 0, dayCount = 0;
        for (const d of days) {
          imp += d.impCnt || 0;
          clk += d.clkCnt || 0;
          cost += d.salesAmt || 0;
          ccnt += d.ccnt || 0;
          if (d.ctr) ctrSum += d.ctr;
          if (d.cpc) cpcSum += d.cpc;
          if (d.avgRnk) avgRnkSum += d.avgRnk;
          dayCount++;
        }
        if (imp > 0 || clk > 0) {
          results.push({
            name: camp.name,
            impCnt: imp,
            clkCnt: clk,
            salesAmt: cost,
            ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00',
            cpc: clk > 0 ? Math.round(cost / clk) : 0,
            avgRnk: dayCount > 0 ? (avgRnkSum / dayCount).toFixed(1) : '0',
            ccnt
          });
          totalCost += cost;
        }
      } catch (e) { /* skip */ }
    }
    return { campaigns: results, totalCost: Math.round(totalCost) };
  } catch (err) {
    console.error('[Reports] Naver ad data error:', err.message);
    return { campaigns: [], totalCost: 0 };
  }
}

// === Fetch Meta ad data ===
async function fetchMetaAdData(db, client, periodStart, periodEnd) {
  if (!client.meta_campaign_ids) return { campaigns: [], totalCost: 0, totalMarkupCost: 0 };

  const tokenRow = await db.prepare("SELECT value FROM settings WHERE key = 'meta_api_token'").first();
  const accessToken = tokenRow?.value;
  if (!accessToken) return { campaigns: [], totalCost: 0, totalMarkupCost: 0 };

  const cpmRow = await db.prepare("SELECT value FROM settings WHERE key = 'meta_cpm_markup'").first();
  const cpmMarkup = parseFloat(cpmRow?.value) || 7000;

  const ids = client.meta_campaign_ids.split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return { campaigns: [], totalCost: 0, totalMarkupCost: 0 };

  const tr = encodeURIComponent(JSON.stringify({ since: periodStart, until: periodEnd }));
  const fields = 'campaign_name,impressions,clicks,spend,ctr,cpc,cpm,reach,frequency';
  const results = [];
  let totalCost = 0, totalMarkup = 0;

  for (const id of ids) {
    try {
      const url = `https://graph.facebook.com/v21.0/${id}/insights?fields=${fields}&time_range=${tr}&access_token=${accessToken}`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.error) continue;
      const row = data.data?.[0];
      if (!row) continue;
      const imp = parseInt(row.impressions) || 0;
      const clk = parseInt(row.clicks) || 0;
      const spend = parseFloat(row.spend) || 0;
      const markupCost = Math.round((imp / 1000) * cpmMarkup);
      results.push({
        campaignId: id,
        name: row.campaign_name || `Campaign ${id}`,
        impressions: imp,
        clicks: clk,
        spend: Math.round(spend),
        markupCost,
        ctr: parseFloat(row.ctr) ? parseFloat(row.ctr).toFixed(2) : '0.00',
        cpc: clk > 0 ? Math.round(markupCost / clk) : 0,
        cpm: parseFloat(row.cpm) ? Math.round(parseFloat(row.cpm)) : 0,
        reach: parseInt(row.reach) || 0,
        frequency: parseFloat(row.frequency) ? parseFloat(row.frequency).toFixed(2) : '0.00'
      });
      totalCost += spend;
      totalMarkup += markupCost;
    } catch (e) { /* skip */ }
  }
  return {
    campaigns: results,
    totalCost: Math.round(totalCost),
    totalMarkupCost: totalMarkup
  };
}

// === Fetch sales data ===
async function fetchSalesData(db, clientId, periodStart, periodEnd) {
  const { results: records } = await db.prepare(
    `SELECT * FROM sales_records WHERE client_id = ? AND period_start <= ? AND period_end >= ? ORDER BY period_start DESC`
  ).bind(clientId, periodEnd, periodStart).all();

  if (!records.length) {
    return {
      revenue: 0, visitors: 0, place_views: 0, smart_calls: 0, review_count: 0,
      unit_price: 0, conversion_rate: 0,
      naver_ad_cost: 0, meta_ad_cost: 0, total_ad_cost: 0, cac: 0, roas: 0,
      images: []
    };
  }

  let revenue = 0, visitors = 0, placeViews = 0, smartCalls = 0, reviewCount = 0;
  for (const r of records) {
    revenue += r.revenue || 0;
    visitors += r.visitors || 0;
    placeViews += r.place_views || 0;
    smartCalls += r.smart_calls || 0;
    reviewCount += r.review_count || 0;
  }
  const main = records[0];
  const recordIds = records.map(r => r.id);

  let images = [];
  try {
    if (recordIds.length) {
      const placeholders = recordIds.map(() => '?').join(',');
      const imgResult = await db.prepare(
        `SELECT * FROM sales_images WHERE record_id IN (${placeholders})`
      ).bind(...recordIds).all();
      images = imgResult.results;
    }
  } catch {}

  const totalAdCost = main.total_ad_cost || 0;
  const roas = totalAdCost > 0 ? Math.round(revenue / totalAdCost) : 0;

  return {
    revenue, visitors,
    place_views: placeViews,
    smart_calls: smartCalls,
    review_count: reviewCount,
    unit_price: main.unit_price || 0,
    conversion_rate: main.conversion_rate || 0,
    naver_ad_cost: main.naver_ad_cost || 0,
    meta_ad_cost: main.meta_ad_cost || 0,
    total_ad_cost: totalAdCost,
    cac: main.cac || 0,
    roas,
    images: images.map(i => ({
      id: i.id,
      url: `/uploads/sales/${i.client_id}/${i.record_id}/${i.filename}`,
      filename: i.filename,
      original_name: i.original_name
    }))
  };
}

// === Fetch keyword ranks ===
async function fetchKeywordRanks(db, clientId, periodStart, periodEnd) {
  let rows = [];
  try {
    const result = await db.prepare(`
      SELECT k.keyword, rr.rank, rr.recorded_date
      FROM rank_records rr
      JOIN keywords k ON rr.keyword_id = k.id
      WHERE k.client_id = ? AND rr.recorded_date BETWEEN ? AND ?
      ORDER BY rr.recorded_date DESC
    `).bind(clientId, periodStart, periodEnd).all();
    rows = result.results;
  } catch (e) {
    rows = [];
  }

  const latestByKw = {};
  for (const r of rows) {
    if (!latestByKw[r.keyword]) latestByKw[r.keyword] = r;
  }
  const ranks = Object.values(latestByKw);

  const volMap = {};
  try {
    const volResult = await db.prepare(
      `SELECT keyword, total_search_volume FROM keyword_discovery_results WHERE client_id = ?`
    ).bind(clientId).all();
    for (const v of volResult.results) volMap[v.keyword] = v.total_search_volume || 0;
  } catch {}

  const top = [], rising = [], improve = [];
  for (const r of ranks) {
    const item = { keyword: r.keyword, rank: r.rank, volume: volMap[r.keyword] || 0 };
    if (r.rank && r.rank <= 5) top.push(item);
    else if (r.rank && r.rank <= 10) rising.push(item);
    else improve.push(item);
  }
  top.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  rising.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  improve.sort((a, b) => (a.rank || 999) - (b.rank || 999));

  return { all: ranks, top, rising, improve };
}

// === Rule-based analysis text ===
function generateAnalysisText(d) {
  const summaryPoints = [];
  if (d.revenue > 0) {
    summaryPoints.push(`이번 기간 매출 ${d.revenue.toLocaleString()}원, 방문객 ${d.visitors}팀으로 객단가 ${d.unit_price.toLocaleString()}원을 기록했습니다.`);
  }
  if (d.conversion_rate >= 20) {
    summaryPoints.push(`플레이스 유입 대비 전환율 ${d.conversion_rate.toFixed(2)}%로 양호한 수준입니다.`);
  } else if (d.conversion_rate > 0) {
    summaryPoints.push(`전환율 ${d.conversion_rate.toFixed(2)}%로 개선이 필요합니다. 플레이스 사진/리뷰 관리를 권장합니다.`);
  }
  if (d.roas >= 1) {
    summaryPoints.push(`ROAS ${Math.round(d.roas)}%로 광고 효율이 좋습니다.`);
  } else if (d.roas > 0) {
    summaryPoints.push(`ROAS ${Math.round(d.roas)}%로 광고비 대비 매출이 낮습니다. 키워드/타겟 최적화가 필요합니다.`);
  }
  if (d.review_count >= 5) {
    summaryPoints.push(`리뷰 ${d.review_count}건 등록으로 꾸준한 리뷰 유입이 이루어지고 있습니다.`);
  }

  let channelAnalysis = '';
  if (d.naverCampaigns.length > 0) {
    const c = d.naverCampaigns;
    const totalClk = c.reduce((s, x) => s + (x.clkCnt || 0), 0);
    const totalCost = c.reduce((s, x) => s + (x.salesAmt || 0), 0);
    const avgCpc = totalClk > 0 ? Math.round(totalCost / totalClk) : 0;
    channelAnalysis += `네이버 검색광고: ${c.length}개 캠페인, 총 클릭 ${totalClk.toLocaleString()}회, 평균 CPC ${avgCpc.toLocaleString()}원, 광고비 ${totalCost.toLocaleString()}원. `;
  }
  if (d.metaCampaigns.length > 0) {
    const c = d.metaCampaigns;
    const totalImp = c.reduce((s, x) => s + (x.impressions || 0), 0);
    const totalClk = c.reduce((s, x) => s + (x.clicks || 0), 0);
    const totalMarkup = c.reduce((s, x) => s + (x.markupCost || 0), 0);
    const avgCtr = totalImp > 0 ? ((totalClk / totalImp) * 100).toFixed(2) : '0.00';
    channelAnalysis += `메타 광고: 총 노출 ${totalImp.toLocaleString()}회, 클릭 ${totalClk.toLocaleString()}회, CTR ${avgCtr}%, 광고비 ${totalMarkup.toLocaleString()}원.`;
  }

  let cacAnalysis = '';
  if (d.cac > 0) {
    cacAnalysis = `고객 1팀 유치에 ${d.cac.toLocaleString()}원이 소요되었습니다. `;
    const cacRatio = d.unit_price > 0 ? (d.cac / d.unit_price) * 100 : 0;
    if (cacRatio <= 10) cacAnalysis += 'CAC가 객단가 대비 낮아 효율적인 광고 집행입니다.';
    else if (cacRatio <= 30) cacAnalysis += 'CAC가 적정 범위입니다.';
    else cacAnalysis += 'CAC가 높아 광고 효율 개선이 필요합니다.';
  }

  const actionKeep = [];
  const actionTry = [];
  if (d.conversion_rate >= 20) actionKeep.push(`높은 전환율 유지 (${d.conversion_rate.toFixed(2)}%)`);
  if (d.roas >= 1) actionKeep.push(`효율적인 광고 운영 유지 (ROAS ${Math.round(d.roas)}%)`);
  if (d.keyword_top.length >= 3) actionKeep.push(`상위 키워드 ${d.keyword_top.length}개 유지 관리`);
  if (d.review_count >= 5) actionKeep.push(`리뷰 유입 관리 유지 (${d.review_count}건)`);

  if (d.conversion_rate > 0 && d.conversion_rate < 20) actionTry.push('플레이스 사진/리뷰 관리 강화로 전환율 개선');
  if (d.keyword_improve.length >= 5) actionTry.push(`하위 키워드 ${d.keyword_improve.length}개 리워드 캠페인 검토`);
  if (d.smart_calls < 10) actionTry.push('스마트콜 전화 유입 증대 방안 검토');
  if (d.roas > 0 && d.roas < 1) actionTry.push('광고 키워드/타겟 최적화로 ROAS 개선');

  if (actionKeep.length === 0) actionKeep.push('현재 성과 데이터 축적 중');
  if (actionTry.length === 0) actionTry.push('데이터 축적 후 개선 방향 도출 예정');

  return {
    summaryPoints: summaryPoints.join('\n'),
    channelAnalysis,
    cacAnalysis,
    actionPlanKeep: actionKeep,
    actionPlanTry: actionTry
  };
}

// === Build report data (orchestrator) ===
async function buildReportData(db, clientId, periodStart, periodEnd) {
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) throw new Error('광고주를 찾을 수 없습니다');

  const [sales, naver, meta, ranks] = await Promise.all([
    fetchSalesData(db, clientId, periodStart, periodEnd),
    fetchNaverAdData(db, client, periodStart, periodEnd).catch(() => ({ campaigns: [], totalCost: 0 })),
    fetchMetaAdData(db, client, periodStart, periodEnd).catch(() => ({ campaigns: [], totalCost: 0, totalMarkupCost: 0 })),
    fetchKeywordRanks(db, clientId, periodStart, periodEnd)
  ]);

  const data = {
    ...sales,
    naverCampaigns: naver.campaigns,
    metaCampaigns: meta.campaigns,
    keyword_top: ranks.top,
    keyword_rising: ranks.rising,
    keyword_improve: ranks.improve,
    keyword_all: ranks.all
  };
  const analysis = generateAnalysisText(data);

  return { sales, naver, meta, ranks, analysis };
}

// === Row → parsed report object ===
function rowToReport(row) {
  if (!row) return null;
  const parse = (s, def) => { try { return JSON.parse(s); } catch { return def; } };
  return {
    ...row,
    naver_campaigns_data: parse(row.naver_campaigns_data, []),
    meta_campaigns_data: parse(row.meta_campaigns_data, []),
    keyword_ranks_data: parse(row.keyword_ranks_data, []),
    keyword_top: parse(row.keyword_top, []),
    keyword_rising: parse(row.keyword_rising, []),
    keyword_improve: parse(row.keyword_improve, []),
    sales_images: parse(row.sales_images, []),
    action_plan_keep: parse(row.action_plan_keep, []),
    action_plan_try: parse(row.action_plan_try, [])
  };
}

// === GET list ===
reportsRoutes.get('/:clientId', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT id, client_id, period_start, period_end, period_type, status,
            revenue, visitors, roas, total_ad_cost, created_at
     FROM reports WHERE client_id = ? ORDER BY period_start DESC, created_at DESC`
  ).bind(c.req.param('clientId')).all();
  return c.json({ reports: results });
});

// === GET single ===
reportsRoutes.get('/:clientId/:reportId', async (c) => {
  const db = c.env.DB;
  const row = await db.prepare(
    'SELECT * FROM reports WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('reportId'), c.req.param('clientId')).first();
  if (!row) return c.json({ error: '보고서를 찾을 수 없습니다' }, 404);
  return c.json({ report: rowToReport(row) });
});

// === POST generate ===
reportsRoutes.post('/:clientId/generate', async (c) => {
  const db = c.env.DB;
  const { periodStart, periodEnd, periodType = 'weekly' } = await c.req.json();
  if (!periodStart || !periodEnd) {
    return c.json({ error: '기간을 입력해주세요' }, 400);
  }
  const clientId = parseInt(c.req.param('clientId'));

  try {
    const { sales, naver, meta, ranks, analysis } = await buildReportData(db, clientId, periodStart, periodEnd);

    const result = await db.prepare(
      `INSERT INTO reports (
        client_id, period_start, period_end, period_type, status,
        revenue, visitors, place_views, smart_calls, review_count,
        unit_price, conversion_rate,
        naver_ad_cost, meta_ad_cost, total_ad_cost, cac, roas,
        naver_campaigns_data, meta_campaigns_data, keyword_ranks_data,
        keyword_top, keyword_rising, keyword_improve, sales_images,
        summary_points, channel_analysis, cac_analysis,
        action_plan_keep, action_plan_try
      ) VALUES (?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      clientId, periodStart, periodEnd, periodType,
      sales.revenue, sales.visitors, sales.place_views,
      sales.smart_calls, sales.review_count,
      sales.unit_price, sales.conversion_rate,
      sales.naver_ad_cost, sales.meta_ad_cost, sales.total_ad_cost,
      sales.cac, sales.roas,
      JSON.stringify(naver.campaigns),
      JSON.stringify(meta.campaigns),
      JSON.stringify(ranks.all),
      JSON.stringify(ranks.top),
      JSON.stringify(ranks.rising),
      JSON.stringify(ranks.improve),
      JSON.stringify(sales.images),
      analysis.summaryPoints,
      analysis.channelAnalysis,
      analysis.cacAnalysis,
      JSON.stringify(analysis.actionPlanKeep),
      JSON.stringify(analysis.actionPlanTry)
    ).run();

    const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(result.meta.last_row_id).first();
    return c.json({ success: true, report: rowToReport(row) }, 201);
  } catch (err) {
    console.error('[Reports] generate error:', err.message);
    return c.json({ error: err.message }, 500);
  }
});

// === PUT update (manual edit) ===
reportsRoutes.put('/:clientId/:reportId', async (c) => {
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT * FROM reports WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('reportId'), c.req.param('clientId')).first();
  if (!existing) return c.json({ error: '보고서를 찾을 수 없습니다' }, 404);

  const body = await c.req.json();
  const allowed = [
    'summary_points', 'channel_analysis', 'cac_analysis',
    'action_plan_keep', 'action_plan_try'
  ];
  const fields = [];
  const values = [];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      let val = body[k];
      if (k === 'action_plan_keep' || k === 'action_plan_try') {
        val = JSON.stringify(val);
      }
      fields.push(`${k}=?`);
      values.push(val);
    }
  }
  if (fields.length) {
    fields.push('updated_at=CURRENT_TIMESTAMP');
    values.push(c.req.param('reportId'));
    await db.prepare(`UPDATE reports SET ${fields.join(', ')} WHERE id=?`).bind(...values).run();
  }
  const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(c.req.param('reportId')).first();
  return c.json({ success: true, report: rowToReport(row) });
});

// === DELETE ===
reportsRoutes.delete('/:clientId/:reportId', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    'DELETE FROM reports WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('reportId'), c.req.param('clientId')).run();
  if (result.meta.changes === 0) return c.json({ error: '보고서를 찾을 수 없습니다' }, 404);
  return c.json({ success: true });
});

// === Regenerate ===
reportsRoutes.post('/:clientId/:reportId/regenerate', async (c) => {
  const db = c.env.DB;
  const existing = await db.prepare(
    'SELECT * FROM reports WHERE id = ? AND client_id = ?'
  ).bind(c.req.param('reportId'), c.req.param('clientId')).first();
  if (!existing) return c.json({ error: '보고서를 찾을 수 없습니다' }, 404);
  const clientId = parseInt(c.req.param('clientId'));

  try {
    const { sales, naver, meta, ranks, analysis } = await buildReportData(
      db, clientId, existing.period_start, existing.period_end
    );

    await db.prepare(
      `UPDATE reports SET
        revenue=?, visitors=?, place_views=?, smart_calls=?, review_count=?,
        unit_price=?, conversion_rate=?,
        naver_ad_cost=?, meta_ad_cost=?, total_ad_cost=?, cac=?, roas=?,
        naver_campaigns_data=?, meta_campaigns_data=?, keyword_ranks_data=?,
        keyword_top=?, keyword_rising=?, keyword_improve=?, sales_images=?,
        summary_points=?, channel_analysis=?, cac_analysis=?,
        action_plan_keep=?, action_plan_try=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?`
    ).bind(
      sales.revenue, sales.visitors, sales.place_views,
      sales.smart_calls, sales.review_count,
      sales.unit_price, sales.conversion_rate,
      sales.naver_ad_cost, sales.meta_ad_cost, sales.total_ad_cost,
      sales.cac, sales.roas,
      JSON.stringify(naver.campaigns),
      JSON.stringify(meta.campaigns),
      JSON.stringify(ranks.all),
      JSON.stringify(ranks.top),
      JSON.stringify(ranks.rising),
      JSON.stringify(ranks.improve),
      JSON.stringify(sales.images),
      analysis.summaryPoints,
      analysis.channelAnalysis,
      analysis.cacAnalysis,
      JSON.stringify(analysis.actionPlanKeep),
      JSON.stringify(analysis.actionPlanTry),
      c.req.param('reportId')
    ).run();

    const row = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(c.req.param('reportId')).first();
    return c.json({ success: true, report: rowToReport(row) });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// === Notion export (stub) ===
reportsRoutes.post('/:clientId/:reportId/export-notion', async (c) => {
  // TODO: Notion API integration
  return c.json({ success: true, notionUrl: '' });
});
