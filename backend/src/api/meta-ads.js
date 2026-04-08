const express = require('express');
const { queryOne } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const ACTION_LABELS = {
  'link_click': '링크 클릭',
  'post_engagement': '게시물 참여',
  'landing_page_view': '랜딩페이지 조회',
  'video_view': '동영상 조회',
  'post_reaction': '반응',
  'comment': '댓글',
  'post': '공유',
  'onsite_conversion.post_save': '저장',
  'page_engagement': '페이지 참여',
  'photo_view': '사진 조회',
};

function getMetaConfig() {
  const token = queryOne("SELECT value FROM settings WHERE key = 'meta_api_token'");
  const cpmRow = queryOne("SELECT value FROM settings WHERE key = 'meta_cpm'");
  return { accessToken: token?.value, cpm: parseFloat(cpmRow?.value) || 7000 };
}

function getClientCampaigns(clientId) {
  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
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

// === Existing: Summary insights ===
router.get('/:clientId/insights', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: '조회 기간을 지정해주세요' });

  const { accessToken, cpm } = getMetaConfig();
  if (!accessToken) return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다.' });

  const camp = getClientCampaigns(req.params.clientId);
  if (camp.error) return res.status(camp.status).json({ error: camp.error });

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
        totalImp += imp;
        totalReach += parseInt(r.reach) || 0;
        totalClicks += parseInt(r.clicks) || 0;
        totalSpend += parseFloat(r.spend) || 0;
        weightedFreq += (parseFloat(r.frequency) || 0) * imp;
        if (r.date_start) dateStart = r.date_start;
        if (r.date_stop) dateEnd = r.date_stop;
      } catch (e) { console.error(`[MetaAds] insights ${id}:`, e.message); }
    }

    const frequency = totalImp > 0 ? weightedFreq / totalImp : 0;
    const ctr = totalImp > 0 ? (totalClicks / totalImp) * 100 : 0;
    const totalCost = Math.round((totalImp / 1000) * cpm);
    const cpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    res.json({
      impressions: totalImp, reach: totalReach, frequency: frequency.toFixed(2),
      clicks: totalClicks, ctr: ctr.toFixed(2), cpc, totalCost, cpm,
      actualSpend: Math.round(totalSpend),
      campaignCount: camp.ids.length, dateStart, dateEnd
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Breakdowns ===
router.get('/:clientId/breakdowns', async (req, res) => {
  const { since, until, type } = req.query;
  if (!since || !until || !type) return res.status(400).json({ error: 'since, until, type 필수' });

  const { accessToken } = getMetaConfig();
  if (!accessToken) return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다.' });

  const camp = getClientCampaigns(req.params.clientId);
  if (camp.error) return res.status(camp.status).json({ error: camp.error });

  const breakdownMap = {
    platform: { param: 'publisher_platform', keys: ['publisher_platform'] },
    placement: { param: 'publisher_platform,platform_position', keys: ['publisher_platform', 'platform_position'] },
    device: { param: 'device_platform', keys: ['device_platform'] },
    age_gender: { param: 'age,gender', keys: ['age', 'gender'] },
    region: { param: 'region', keys: ['region'] },
  };

  const bd = breakdownMap[type];
  if (!bd) return res.status(400).json({ error: '지원하지 않는 breakdown type' });

  try {
    const aggregated = {};
    const tr = encodeURIComponent(JSON.stringify({ since, until }));

    for (const id of camp.ids) {
      try {
        const data = await metaGet(
          `${id}/insights?fields=impressions,clicks,spend,reach&breakdowns=${bd.param}&time_range=${tr}&limit=100`,
          accessToken
        );
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
      } catch (e) { console.error(`[MetaAds] breakdown ${id}:`, e.message); }
    }

    const results = Object.values(aggregated)
      .map(r => ({ ...r, ctr: r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : '0.00' }))
      .sort((a, b) => b.impressions - a.impressions);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Actions ===
router.get('/:clientId/actions', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: 'since, until 필수' });

  const { accessToken } = getMetaConfig();
  if (!accessToken) return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다.' });

  const camp = getClientCampaigns(req.params.clientId);
  if (camp.error) return res.status(camp.status).json({ error: camp.error });

  try {
    const actionMap = {};
    const tr = encodeURIComponent(JSON.stringify({ since, until }));

    for (const id of camp.ids) {
      try {
        const data = await metaGet(
          `${id}/insights?fields=actions,video_thruplay_watched_actions&time_range=${tr}`,
          accessToken
        );
        const row = data.data?.[0];
        if (!row) continue;
        for (const a of (row.actions || [])) {
          actionMap[a.action_type] = (actionMap[a.action_type] || 0) + parseInt(a.value) || 0;
        }
      } catch (e) { console.error(`[MetaAds] actions ${id}:`, e.message); }
    }

    const actions = Object.entries(actionMap)
      .map(([type, value]) => ({ type, value, label: ACTION_LABELS[type] || type }))
      .sort((a, b) => b.value - a.value);

    res.json({ actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Adsets ===
router.get('/:clientId/adsets', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: 'since, until 필수' });

  const { accessToken } = getMetaConfig();
  if (!accessToken) return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다.' });

  const camp = getClientCampaigns(req.params.clientId);
  if (camp.error) return res.status(camp.status).json({ error: camp.error });

  try {
    const adsets = [];
    const tr = encodeURIComponent(JSON.stringify({ since, until }));

    for (const campId of camp.ids) {
      try {
        const data = await metaGet(`${campId}/adsets?fields=id,name,status&limit=100`, accessToken);
        for (const as of (data.data || [])) {
          try {
            const ins = await metaGet(
              `${as.id}/insights?fields=impressions,clicks,spend,reach&time_range=${tr}`,
              accessToken
            );
            const r = ins.data?.[0] || {};
            const imp = parseInt(r.impressions) || 0;
            const clk = parseInt(r.clicks) || 0;
            adsets.push({
              id: as.id, name: as.name, status: as.status,
              impressions: imp, clicks: clk,
              spend: parseFloat(r.spend) || 0, reach: parseInt(r.reach) || 0,
              ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00'
            });
          } catch (e) { /* skip */ }
        }
      } catch (e) { console.error(`[MetaAds] adsets ${campId}:`, e.message); }
    }

    adsets.sort((a, b) => b.impressions - a.impressions);
    res.json(adsets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Ads ===
router.get('/:clientId/ads', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: 'since, until 필수' });

  const { accessToken } = getMetaConfig();
  if (!accessToken) return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다.' });

  const camp = getClientCampaigns(req.params.clientId);
  if (camp.error) return res.status(camp.status).json({ error: camp.error });

  try {
    const ads = [];
    const tr = encodeURIComponent(JSON.stringify({ since, until }));

    for (const campId of camp.ids) {
      try {
        const data = await metaGet(
          `${campId}/ads?fields=id,name,status,creative&limit=100`,
          accessToken
        );
        for (const ad of (data.data || [])) {
          try {
            // Fetch high-res thumbnail via creative ID
            let thumbnailUrl = null;
            if (ad.creative?.id) {
              try {
                const cr = await metaGet(
                  `${ad.creative.id}?fields=thumbnail_url,title,body&thumbnail_width=480&thumbnail_height=480`,
                  accessToken
                );
                thumbnailUrl = cr.thumbnail_url || null;
                if (!ad._title) ad._title = cr.title || '';
                if (!ad._body) ad._body = cr.body || '';
              } catch (e) { /* skip */ }
            }

            const ins = await metaGet(
              `${ad.id}/insights?fields=impressions,clicks,spend,reach,actions&time_range=${tr}`,
              accessToken
            );
            const r = ins.data?.[0] || {};
            const imp = parseInt(r.impressions) || 0;
            const clk = parseInt(r.clicks) || 0;
            const actionMap = {};
            for (const a of (r.actions || [])) {
              actionMap[a.action_type] = (actionMap[a.action_type] || 0) + (parseInt(a.value) || 0);
            }
            ads.push({
              id: ad.id, name: ad.name, status: ad.status,
              thumbnailUrl,
              title: ad._title || '',
              body: ad._body || '',
              impressions: imp, clicks: clk,
              spend: parseFloat(r.spend) || 0, reach: parseInt(r.reach) || 0,
              ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00',
              engagement: actionMap['post_engagement'] || 0
            });
          } catch (e) { /* skip */ }
        }
      } catch (e) { console.error(`[MetaAds] ads ${campId}:`, e.message); }
    }

    ads.sort((a, b) => b.impressions - a.impressions);
    res.json(ads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
