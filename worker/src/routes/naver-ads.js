import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { getCampaigns, getAdStats, getAdGroups, getAds, getAdCreativeStats, classifyCampaignType } from '../services/naver-api.js';

export const naverAdsRoutes = new Hono();
naverAdsRoutes.use('*', authMiddleware());

const toArray = (v) => Array.isArray(v) ? v : [];
const TYPE_NAMES = { place: '플레이스', powerlink: '파워링크', smb: '소상공인', shopping: '쇼핑검색', powercontents: '파워컨텐츠', other: '기타' };
const SEARCHAD_IMG_BASE = 'https://searchad-phinf.pstatic.net';

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
        impressions: stat.impCnt || 0, clicks: stat.clkCnt || 0,
        ctr: stat.impCnt > 0 ? (((stat.clkCnt || 0) / stat.impCnt) * 100).toFixed(2) : '0.00'
      };
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 3);
}

naverAdsRoutes.get('/:clientId/insights', async (c) => {
  const db = c.env.DB;
  const { since, until } = c.req.query();
  if (!since || !until) return c.json({ error: '조회 기간을 지정해주세요' }, 400);

  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(c.req.param('clientId')).first();
  if (!client) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);

  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) return c.json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다.' }, 400);

  try {
    const allCampaigns = toArray(await getCampaigns(L, S, C));
    if (!allCampaigns.length) return c.json({ campaigns: [], summary: { total: {}, byType: {} }, topCreatives: [] });

    const campaignResults = [];
    for (const camp of allCampaigns) {
      const type = classifyCampaignType(camp);
      const stats = toArray(await getAdStats(L, S, C, [camp.nccCampaignId], since, until));
      const s = stats[0] || { impCnt: 0, clkCnt: 0, salesAmt: 0 };
      const imp = s.impCnt || 0, clk = s.clkCnt || 0, cost = s.salesAmt || 0;

      const groups = [];
      try {
        const adgroups = toArray(await getAdGroups(L, S, C, camp.nccCampaignId));
        for (const ag of adgroups) {
          const agStats = toArray(await getAdStats(L, S, C, [ag.nccAdgroupId], since, until));
          const gs = agStats[0] || { impCnt: 0, clkCnt: 0, salesAmt: 0 };
          groups.push({
            id: ag.nccAdgroupId, name: ag.name,
            impressions: gs.impCnt || 0, clicks: gs.clkCnt || 0, cost: gs.salesAmt || 0,
            ctr: gs.impCnt > 0 ? ((gs.clkCnt / gs.impCnt) * 100).toFixed(2) : '0.00',
            cpc: gs.clkCnt > 0 ? Math.round(gs.salesAmt / gs.clkCnt) : 0
          });
        }
      } catch (e) { /* skip */ }

      campaignResults.push({
        id: camp.nccCampaignId, name: camp.name, type, typeName: TYPE_NAMES[type] || type,
        status: camp.status || camp.statusReason || '',
        impressions: imp, clicks: clk, cost,
        ctr: imp > 0 ? ((clk / imp) * 100).toFixed(2) : '0.00',
        cpc: clk > 0 ? Math.round(cost / clk) : 0, groups
      });
    }

    let totalImp = 0, totalClk = 0, totalCost = 0;
    const byType = {};
    for (const cr of campaignResults) {
      totalImp += cr.impressions; totalClk += cr.clicks; totalCost += cr.cost;
      if (!byType[cr.type]) byType[cr.type] = { impressions: 0, clicks: 0, cost: 0, campaignCount: 0, typeName: cr.typeName };
      byType[cr.type].impressions += cr.impressions; byType[cr.type].clicks += cr.clicks;
      byType[cr.type].cost += cr.cost; byType[cr.type].campaignCount++;
    }
    for (const bt of Object.values(byType)) {
      bt.ctr = bt.impressions > 0 ? ((bt.clicks / bt.impressions) * 100).toFixed(2) : '0.00';
      bt.cpc = bt.clicks > 0 ? Math.round(bt.cost / bt.clicks) : 0;
    }
    const total = { impressions: totalImp, clicks: totalClk, cost: totalCost,
      ctr: totalImp > 0 ? ((totalClk / totalImp) * 100).toFixed(2) : '0.00',
      cpc: totalClk > 0 ? Math.round(totalCost / totalClk) : 0
    };

    const topCreatives = {};
    for (const type of Object.keys(byType)) {
      const typeCamps = campaignResults.filter(cr => cr.type === type && cr.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 3);
      if (!typeCamps.length) continue;
      try {
        const creatives = await getTopCreatives(L, S, C, typeCamps.map(cr => ({ nccCampaignId: cr.id, name: cr.name })), since, until);
        if (creatives.length) topCreatives[type] = creatives;
      } catch (e) { /* skip */ }
    }

    return c.json({ campaigns: campaignResults, summary: { total, byType }, topCreatives });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});
