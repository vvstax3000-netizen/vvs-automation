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

      // Sort campaigns by cost desc, pick top 3 with data for creative lookup
      const campsWithStats = camps
        .map((c, i) => ({ ...c, _cost: stats[i]?.salesAmt || 0 }))
        .filter(c => c._cost > 0)
        .sort((a, b) => b._cost - a._cost)
        .slice(0, 3);

      let topCreatives = [];
      try {
        topCreatives = await getTopCreatives(apiLicense, apiSecret, customerId, campsWithStats, since, until);
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
  if (ad?.ad?.headline) return ad.ad.headline;
  if (ad?.adAttr?.headline) return ad.adAttr.headline;
  return null;
}

function getAdImages(ad) {
  // LOCAL_AD: ad.images[] are relative paths
  if (ad?.ad?.images?.length) {
    return ad.ad.images.map(img => SEARCHAD_IMG_BASE + img);
  }
  // PLACE_AD (SMB): referenceData.ad.imageUrl is full URL
  if (ad?.referenceData?.ad?.imageUrl) {
    return [ad.referenceData.ad.imageUrl];
  }
  return [];
}

async function getTopCreatives(apiLicense, apiSecret, customerId, campaigns, since, until) {
  const allAds = [];

  for (const camp of campaigns) {
    try {
      const adGroups = toArray(await getAdGroups(apiLicense, apiSecret, customerId, camp.nccCampaignId));

      for (const ag of adGroups.slice(0, 3)) {
        const ads = toArray(await getAds(apiLicense, apiSecret, customerId, ag.nccAdgroupId));
        for (const ad of ads) {
          ad._campaignName = camp.name; // attach for fallback
        }
        allAds.push(...ads);
      }
    } catch (err) {
      // skip on error
    }
  }

  if (!allAds.length) return [];

  const adIds = allAds.map(a => a.nccAdId).slice(0, 30);
  const adStats = toArray(await getAdCreativeStats(apiLicense, apiSecret, customerId, adIds, since, until));

  const merged = adStats
    .filter(stat => stat.impCnt > 0 || stat.clkCnt > 0)
    .map(stat => {
      const ad = allAds.find(a => a.nccAdId === stat.id);
      const name = getAdName(ad) || ad?._campaignName || `소재 ${stat.id?.substring(14, 26)}`;
      const images = getAdImages(ad);
      return {
        name,
        images,
        impressions: stat.impCnt || 0,
        clicks: stat.clkCnt || 0,
        ctr: stat.impCnt > 0 ? (((stat.clkCnt || 0) / stat.impCnt) * 100).toFixed(2) : '0.00'
      };
    });

  merged.sort((a, b) => b.clicks - a.clicks);
  return merged.slice(0, 3);
}

module.exports = router;
