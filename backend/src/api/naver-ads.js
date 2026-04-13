const express = require('express');
const { queryOne } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const {
  getCampaigns, getAdStats, getAdGroups, getAds, getAdCreativeStats,
  classifyCampaignType
} = require('../services/naver-api');

const router = express.Router();
router.use(authMiddleware);

const toArray = (v) => Array.isArray(v) ? v : [];

const TYPE_NAMES = {
  place: '플레이스', powerlink: '파워링크', smb: '소상공인',
  shopping: '쇼핑검색', powercontents: '파워컨텐츠', other: '기타'
};

const SEARCHAD_IMG_BASE = 'https://searchad-phinf.pstatic.net';

router.get('/:clientId/insights', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) return res.status(400).json({ error: '조회 기간을 지정해주세요' });

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });

  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) {
    return res.status(400).json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다.' });
  }

  try {
    const allCampaigns = toArray(await getCampaigns(L, S, C));
    if (!allCampaigns.length) {
      return res.json({ campaigns: [], summary: { total: {}, byType: {} }, topCreatives: [] });
    }

    // 1. Get stats for each campaign + classify
    const campaignResults = [];
    for (const camp of allCampaigns) {
      const type = classifyCampaignType(camp);
      const stats = toArray(await getAdStats(L, S, C, [camp.nccCampaignId], since, until));
      const s = stats[0] || { impCnt: 0, clkCnt: 0, salesAmt: 0 };

      const imp = s.impCnt || 0;
      const clk = s.clkCnt || 0;
      const cost = s.salesAmt || 0;

      console.log(`[NaverAds] Campaign: ${camp.name} | type: ${type} | imp: ${imp} | click: ${clk} | cost: ${cost}`);

      // 2. Get adgroups for this campaign
      const groups = [];
      try {
        const adgroups = toArray(await getAdGroups(L, S, C, camp.nccCampaignId));
        for (const ag of adgroups) {
          const agStats = toArray(await getAdStats(L, S, C, [ag.nccAdgroupId], since, until));
          const gs = agStats[0] || { impCnt: 0, clkCnt: 0, salesAmt: 0 };
          groups.push({
            id: ag.nccAdgroupId,
            name: ag.name,
            impressions: gs.impCnt || 0,
            clicks: gs.clkCnt || 0,
            cost: gs.salesAmt || 0,
            ctr: gs.impCnt > 0 ? ((gs.clkCnt / gs.impCnt) * 100).toFixed(2) : '0.00',
            cpc: gs.clkCnt > 0 ? Math.round(gs.salesAmt / gs.clkCnt) : 0
          });
        }
      } catch (e) { /* skip */ }

      campaignResults.push({
        id: camp.nccCampaignId,
        name: camp.name,
        type,
        typeName: TYPE_NAMES[type] || type,
        status: camp.status || camp.statusReason || '',
        impressions: imp,
        clicks: clk,
        cost,
        ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00',
        cpc: clk > 0 ? Math.round(cost / clk) : 0,
        groups
      });
    }

    // 3. Build summary
    let totalImp = 0, totalClk = 0, totalCost = 0;
    const byType = {};
    for (const c of campaignResults) {
      totalImp += c.impressions;
      totalClk += c.clicks;
      totalCost += c.cost;
      if (!byType[c.type]) byType[c.type] = { impressions: 0, clicks: 0, cost: 0, campaignCount: 0, typeName: c.typeName };
      byType[c.type].impressions += c.impressions;
      byType[c.type].clicks += c.clicks;
      byType[c.type].cost += c.cost;
      byType[c.type].campaignCount++;
    }

    for (const bt of Object.values(byType)) {
      bt.ctr = bt.impressions > 0 ? ((bt.clicks / bt.impressions) * 100).toFixed(2) : '0.00';
      bt.cpc = bt.clicks > 0 ? Math.round(bt.cost / bt.clicks) : 0;
    }

    const total = {
      impressions: totalImp, clicks: totalClk, cost: totalCost,
      ctr: totalImp > 0 ? ((totalClk / totalImp) * 100).toFixed(2) : '0.00',
      cpc: totalClk > 0 ? Math.round(totalCost / totalClk) : 0
    };

    console.log(`[NaverAds] TOTAL: imp: ${totalImp} | click: ${totalClk} | cost: ${totalCost}`);

    // 4. Top creatives per type
    const topCreatives = {};
    for (const type of Object.keys(byType)) {
      const typeCamps = campaignResults
        .filter(c => c.type === type && c.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 3);
      if (!typeCamps.length) continue;
      try {
        const creatives = await getTopCreatives(L, S, C,
          typeCamps.map(c => ({ nccCampaignId: c.id, name: c.name })),
          since, until
        );
        if (creatives.length) topCreatives[type] = creatives;
      } catch (e) { console.error(`[NaverAds] Top creatives error (${type}):`, e.message); }
    }

    res.json({
      campaigns: campaignResults,
      summary: { total, byType },
      topCreatives
    });
  } catch (err) {
    console.error('[NaverAds] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Top Creatives ===
function getAdName(ad) {
  if (ad?.ad?.description) return ad.ad.description;
  if (ad?.referenceData?.ad?.title) {
    const sub = ad.referenceData.ad.subTitle;
    return sub ? `${ad.referenceData.ad.title} - ${sub}` : ad.referenceData.ad.title;
  }
  if (ad?.referenceData?.name) return ad.referenceData.name;
  if (ad?.ad?.info?.name) return ad.ad.info.name;
  if (ad?.ad?.pc?.headline) return ad.ad.pc.headline;
  return null;
}

function getAdImages(ad) {
  if (ad?.ad?.images?.length) return ad.ad.images.map(img => SEARCHAD_IMG_BASE + img);
  if (ad?.referenceData?.ad?.imageUrl) return [ad.referenceData.ad.imageUrl];
  return [];
}

async function getTopCreatives(L, S, C, campaigns, since, until) {
  const allAds = [];
  for (const camp of campaigns) {
    try {
      const adGroups = toArray(await getAdGroups(L, S, C, camp.nccCampaignId));
      for (const ag of adGroups.slice(0, 3)) {
        const ads = toArray(await getAds(L, S, C, ag.nccAdgroupId));
        for (const ad of ads) ad._campaignName = camp.name;
        allAds.push(...ads);
      }
    } catch (e) { /* skip */ }
  }
  if (!allAds.length) return [];

  const adIds = allAds.map(a => a.nccAdId).slice(0, 30);
  const adStats = toArray(await getAdCreativeStats(L, S, C, adIds, since, until));

  return adStats
    .filter(s => s.impCnt > 0 || s.clkCnt > 0)
    .map(stat => {
      const ad = allAds.find(a => a.nccAdId === stat.id);
      return {
        name: getAdName(ad) || ad?._campaignName || `소재 ${stat.id?.substring(14, 26)}`,
        images: getAdImages(ad),
        impressions: stat.impCnt || 0,
        clicks: stat.clkCnt || 0,
        ctr: stat.impCnt > 0 ? (((stat.clkCnt || 0) / stat.impCnt) * 100).toFixed(2) : '0.00'
      };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 3);
}

module.exports = router;
