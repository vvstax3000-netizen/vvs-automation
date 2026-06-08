import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';

export const metaAdsRoutes = new Hono();
metaAdsRoutes.use('*', authMiddleware());

const ACTION_LABELS = {
  'link_click': '링크 클릭', 'post_engagement': '게시물 참여', 'landing_page_view': '랜딩페이지 조회',
  'video_view': '동영상 조회', 'post_reaction': '반응', 'comment': '댓글', 'post': '공유',
  'onsite_conversion.post_save': '저장', 'page_engagement': '페이지 참여', 'photo_view': '사진 조회',
};

async function getMetaConfig(db) {
  const token = await db.prepare("SELECT value FROM settings WHERE key = 'meta_api_token'").first();
  const cpmRow = await db.prepare("SELECT value FROM settings WHERE key = 'meta_cpm'").first();
  return { accessToken: token?.value, cpm: parseFloat(cpmRow?.value) || 7000 };
}

async function getClientCampaigns(db, clientId) {
  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return { error: '광고주를 찾을 수 없습니다', status: 404 };
  if (!client.meta_campaign_ids) return { error: '메타 캠페인 ID가 설정되지 않았습니다.', status: 400 };
  return { client, ids: client.meta_campaign_ids.split(',').map(s => s.trim()).filter(Boolean) };
}

async function metaGet(path, accessToken) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://graph.facebook.com/v21.0/${path}${sep}access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

metaAdsRoutes.get('/:clientId/insights', async (c) => {
  const db = c.env.DB;
  const { since, until } = c.req.query();
  if (!since || !until) return c.json({ error: '조회 기간을 지정해주세요' }, 400);

  const { accessToken, cpm } = await getMetaConfig(db);
  if (!accessToken) return c.json({ error: 'Meta API 토큰이 설정되지 않았습니다.' }, 400);

  const camp = await getClientCampaigns(db, c.req.param('clientId'));
  if (camp.error) return c.json({ error: camp.error }, camp.status);

  try {
    let totalImp = 0, totalReach = 0, totalClicks = 0, totalSpend = 0, weightedFreq = 0;
    let dateStart = since, dateEnd = until;
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    const fields = 'impressions,reach,frequency,clicks,ctr,spend';

    for (const id of camp.ids) {
      try {
        const data = await metaGet(`${id}/insights?fields=${fields}&time_range=${tr}`, accessToken);
        const r = data.data?.[0];
        if (!r) continue;
        const imp = parseInt(r.impressions) || 0;
        totalImp += imp; totalReach += parseInt(r.reach) || 0;
        totalClicks += parseInt(r.clicks) || 0; totalSpend += parseFloat(r.spend) || 0;
        weightedFreq += (parseFloat(r.frequency) || 0) * imp;
        if (r.date_start) dateStart = r.date_start;
        if (r.date_stop) dateEnd = r.date_stop;
      } catch (e) { /* skip */ }
    }

    const frequency = totalImp > 0 ? weightedFreq / totalImp : 0;
    const ctr = totalImp > 0 ? (totalClicks / totalImp) * 100 : 0;
    const totalCost = Math.round((totalImp / 1000) * cpm);
    const cpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    return c.json({
      impressions: totalImp, reach: totalReach, frequency: frequency.toFixed(2),
      clicks: totalClicks, ctr: ctr.toFixed(2), cpc, totalCost, cpm,
      actualSpend: Math.round(totalSpend), campaignCount: camp.ids.length, dateStart, dateEnd
    });
  } catch (err) { return c.json({ error: err.message }, 500); }
});

metaAdsRoutes.get('/:clientId/breakdowns', async (c) => {
  const db = c.env.DB;
  const { since, until, type } = c.req.query();
  if (!since || !until || !type) return c.json({ error: 'since, until, type 필수' }, 400);

  const { accessToken } = await getMetaConfig(db);
  if (!accessToken) return c.json({ error: 'Meta API 토큰이 설정되지 않았습니다.' }, 400);

  const camp = await getClientCampaigns(db, c.req.param('clientId'));
  if (camp.error) return c.json({ error: camp.error }, camp.status);

  const breakdownMap = {
    platform: { param: 'publisher_platform', keys: ['publisher_platform'] },
    placement: { param: 'publisher_platform,platform_position', keys: ['publisher_platform', 'platform_position'] },
    device: { param: 'device_platform', keys: ['device_platform'] },
    age_gender: { param: 'age,gender', keys: ['age', 'gender'] },
    region: { param: 'region', keys: ['region'] },
  };
  const bd = breakdownMap[type];
  if (!bd) return c.json({ error: '지원하지 않는 breakdown type' }, 400);

  try {
    const aggregated = {};
    const tr = encodeURIComponent(JSON.stringify({ since, until }));

    for (const id of camp.ids) {
      try {
        const data = await metaGet(`${id}/insights?fields=impressions,clicks,spend,reach&breakdowns=${bd.param}&time_range=${tr}&limit=100`, accessToken);
        for (const row of (data.data || [])) {
          const key = bd.keys.map(k => row[k] || 'unknown').join('|');
          if (!aggregated[key]) {
            aggregated[key] = { impressions: 0, clicks: 0, spend: 0, reach: 0 };
            for (const k of bd.keys) aggregated[key][k] = row[k] || 'unknown';
          }
          aggregated[key].impressions += parseInt(row.impressions) || 0;
          aggregated[key].clicks += parseInt(row.clicks) || 0;
          aggregated[key].spend += parseFloat(row.spend) || 0;
          aggregated[key].reach += parseInt(row.reach) || 0;
        }
      } catch (e) { /* skip */ }
    }

    const results = Object.values(aggregated)
      .map(r => ({ ...r, ctr: r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : '0.00' }))
      .sort((a, b) => b.impressions - a.impressions);
    return c.json(results);
  } catch (err) { return c.json({ error: err.message }, 500); }
});

metaAdsRoutes.get('/:clientId/actions', async (c) => {
  const db = c.env.DB;
  const { since, until } = c.req.query();
  if (!since || !until) return c.json({ error: 'since, until 필수' }, 400);

  const { accessToken } = await getMetaConfig(db);
  if (!accessToken) return c.json({ error: 'Meta API 토큰이 설정되지 않았습니다.' }, 400);

  const camp = await getClientCampaigns(db, c.req.param('clientId'));
  if (camp.error) return c.json({ error: camp.error }, camp.status);

  try {
    const actionMap = {};
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    for (const id of camp.ids) {
      try {
        const data = await metaGet(`${id}/insights?fields=actions,video_thruplay_watched_actions&time_range=${tr}`, accessToken);
        const row = data.data?.[0];
        if (!row) continue;
        for (const a of (row.actions || [])) actionMap[a.action_type] = (actionMap[a.action_type] || 0) + (parseInt(a.value) || 0);
      } catch (e) { /* skip */ }
    }
    const actions = Object.entries(actionMap).map(([type, value]) => ({ type, value, label: ACTION_LABELS[type] || type })).sort((a, b) => b.value - a.value);
    return c.json({ actions });
  } catch (err) { return c.json({ error: err.message }, 500); }
});

metaAdsRoutes.get('/:clientId/adsets', async (c) => {
  const db = c.env.DB;
  const { since, until } = c.req.query();
  if (!since || !until) return c.json({ error: 'since, until 필수' }, 400);

  const { accessToken } = await getMetaConfig(db);
  if (!accessToken) return c.json({ error: 'Meta API 토큰이 설정되지 않았습니다.' }, 400);

  const camp = await getClientCampaigns(db, c.req.param('clientId'));
  if (camp.error) return c.json({ error: camp.error }, camp.status);

  try {
    const adsets = [];
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    for (const campId of camp.ids) {
      try {
        const data = await metaGet(`${campId}/adsets?fields=id,name,status&limit=100`, accessToken);
        for (const as of (data.data || [])) {
          try {
            const ins = await metaGet(`${as.id}/insights?fields=impressions,clicks,spend,reach&time_range=${tr}`, accessToken);
            const r = ins.data?.[0] || {};
            const imp = parseInt(r.impressions) || 0, clk = parseInt(r.clicks) || 0;
            adsets.push({ id: as.id, name: as.name, status: as.status, impressions: imp, clicks: clk,
              spend: parseFloat(r.spend) || 0, reach: parseInt(r.reach) || 0,
              ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00' });
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* skip */ }
    }
    adsets.sort((a, b) => b.impressions - a.impressions);
    return c.json(adsets);
  } catch (err) { return c.json({ error: err.message }, 500); }
});

metaAdsRoutes.get('/:clientId/ads', async (c) => {
  const db = c.env.DB;
  const { since, until } = c.req.query();
  if (!since || !until) return c.json({ error: 'since, until 필수' }, 400);

  const { accessToken } = await getMetaConfig(db);
  if (!accessToken) return c.json({ error: 'Meta API 토큰이 설정되지 않았습니다.' }, 400);

  const camp = await getClientCampaigns(db, c.req.param('clientId'));
  if (camp.error) return c.json({ error: camp.error }, camp.status);

  try {
    const ads = [];
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    for (const campId of camp.ids) {
      try {
        const data = await metaGet(`${campId}/ads?fields=id,name,status,creative&limit=100`, accessToken);
        for (const ad of (data.data || [])) {
          try {
            let thumbnailUrl = null;
            if (ad.creative?.id) {
              try {
                const cr = await metaGet(`${ad.creative.id}?fields=thumbnail_url,title,body&thumbnail_width=480&thumbnail_height=480`, accessToken);
                thumbnailUrl = cr.thumbnail_url || null;
                if (!ad._title) ad._title = cr.title || '';
                if (!ad._body) ad._body = cr.body || '';
              } catch (e) { /* skip */ }
            }
            const ins = await metaGet(`${ad.id}/insights?fields=impressions,clicks,spend,reach,actions&time_range=${tr}`, accessToken);
            const r = ins.data?.[0] || {};
            const imp = parseInt(r.impressions) || 0, clk = parseInt(r.clicks) || 0;
            const actionMap = {};
            for (const a of (r.actions || [])) actionMap[a.action_type] = (actionMap[a.action_type] || 0) + (parseInt(a.value) || 0);
            ads.push({
              id: ad.id, name: ad.name, status: ad.status, thumbnailUrl,
              title: ad._title || '', body: ad._body || '',
              impressions: imp, clicks: clk, spend: parseFloat(r.spend) || 0, reach: parseInt(r.reach) || 0,
              ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00', engagement: actionMap['post_engagement'] || 0
            });
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* skip */ }
    }
    ads.sort((a, b) => b.impressions - a.impressions);
    return c.json(ads);
  } catch (err) { return c.json({ error: err.message }, 500); }
});
