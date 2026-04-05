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

router.get('/:clientId/insights', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) {
    return res.status(400).json({ error: '조회 기간을 지정해주세요' });
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });

  const apiLicense = client.naver_api_license;
  const apiSecret = client.naver_api_secret;
  const customerId = client.naver_customer_id;

  if (!apiLicense || !apiSecret || !customerId) {
    return res.status(400).json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다. 광고주 관리에서 입력해주세요.' });
  }

  try {
    const campaigns = toArray(await getCampaigns(apiLicense, apiSecret, customerId));
    if (!campaigns.length) {
      return res.json({ place: null, powerlink: null, smb: null, other: null });
    }

    const grouped = {};
    for (const camp of campaigns) {
      const type = classifyCampaignType(camp);
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(camp);
    }

    const result = {};
    for (const [type, camps] of Object.entries(grouped)) {
      const ids = camps.map(c => c.nccCampaignId);
      const stats = toArray(await getAdStats(apiLicense, apiSecret, customerId, ids, since, until));

      let impressions = 0, clicks = 0, cost = 0;
      for (const s of stats) {
        impressions += s.impCnt || 0;
        clicks += s.clkCnt || 0;
        cost += s.salesAmt || 0;
      }

      const ctr = impressions > 0 ? ((clicks / impressions) * 100) : 0;
      const cpc = clicks > 0 ? Math.round(cost / clicks) : 0;

      let topCreatives = [];
      try {
        topCreatives = await getTopCreatives(apiLicense, apiSecret, customerId, camps, since, until);
      } catch (err) {
        console.error(`[NaverAds] Top creatives error for ${type}:`, err.message);
      }

      result[type] = {
        campaignCount: camps.length,
        impressions,
        clicks,
        ctr: ctr.toFixed(2),
        cpc,
        totalCost: cost,
        topCreatives
      };
    }

    res.json(result);
  } catch (err) {
    console.error('[NaverAds] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function getTopCreatives(apiLicense, apiSecret, customerId, campaigns, since, until) {
  const allAds = [];

  for (const camp of campaigns.slice(0, 5)) {
    try {
      const adGroups = toArray(await getAdGroups(apiLicense, apiSecret, customerId, camp.nccCampaignId));

      for (const ag of adGroups.slice(0, 5)) {
        const ads = toArray(await getAds(apiLicense, apiSecret, customerId, ag.nccAdgroupId));
        allAds.push(...ads);
      }
    } catch (err) {
      // skip on error
    }
  }

  if (!allAds.length) return [];

  const adIds = allAds.map(a => a.nccAdId).slice(0, 20);
  const adStats = toArray(await getAdCreativeStats(apiLicense, apiSecret, customerId, adIds, since, until));

  const merged = adStats.map(stat => {
    const ad = allAds.find(a => a.nccAdId === stat.id);
    return {
      name: ad?.ad?.pc?.headline || ad?.ad?.headline || ad?.adAttr?.headline || `Ad ${stat.id?.substring(0, 8)}`,
      impressions: stat.impCnt || 0,
      clicks: stat.clkCnt || 0,
      ctr: stat.impCnt > 0 ? (((stat.clkCnt || 0) / stat.impCnt) * 100).toFixed(2) : '0.00'
    };
  });

  merged.sort((a, b) => b.clicks - a.clicks);
  return merged.slice(0, 3);
}

module.exports = router;
