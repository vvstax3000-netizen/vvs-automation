const crypto = require('crypto');

function generateSignature(timestamp, method, path, secret) {
  const message = `${timestamp}.${method}.${path}`;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

function naverHeaders(method, path, apiLicense, apiSecret, customerId) {
  const timestamp = String(Date.now());
  const signature = generateSignature(timestamp, method, path, apiSecret);
  return {
    'X-API-KEY': apiLicense,
    'X-Customer': customerId,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}

async function naverApiCall(method, path, apiLicense, apiSecret, customerId, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.searchad.naver.com${path}${qs ? '?' + qs : ''}`;
  const headers = naverHeaders(method, path, apiLicense, apiSecret, customerId);

  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[NaverAPI] ${method} ${path} failed: ${res.status}`, text);
    throw new Error(`네이버 API 오류 (${res.status})`);
  }
  return res.json();
}

// Get keyword search volume
async function getKeywordStats(keywordList, apiLicense, apiSecret, customerId) {
  if (!apiLicense || !apiSecret || !customerId) return null;

  try {
    const data = await naverApiCall('GET', '/keywordstool', apiLicense, apiSecret, customerId, {
      hintKeywords: keywordList.join(','),
      showDetail: '1'
    });
    return (data.keywordList || []).map(item => ({
      keyword: item.relKeyword,
      monthlyPc: parseVolume(item.monthlyPcQcCnt),
      monthlyMobile: parseVolume(item.monthlyMobileQcCnt),
      total: parseVolume(item.monthlyPcQcCnt) + parseVolume(item.monthlyMobileQcCnt)
    }));
  } catch (err) {
    console.error('[NaverAPI] getKeywordStats error:', err.message);
    return null;
  }
}

// Get all campaigns
async function getCampaigns(apiLicense, apiSecret, customerId) {
  return naverApiCall('GET', '/ncc/campaigns', apiLicense, apiSecret, customerId);
}

// Get stat report for campaign IDs (query each individually)
async function getAdStats(apiLicense, apiSecret, customerId, campaignIds, since, until) {
  if (!campaignIds.length) return [];

  const fields = JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ctr", "cpc"]);
  const timeRange = JSON.stringify({ since, until });
  const results = [];

  for (const id of campaignIds) {
    try {
      const res = await naverApiCall('GET', '/stats', apiLicense, apiSecret, customerId, {
        id,
        fields,
        timeRange
      });
      // Sum daily data into one entry per campaign
      const days = res?.data || [];
      let impCnt = 0, clkCnt = 0, salesAmt = 0;
      for (const d of days) {
        impCnt += d.impCnt || 0;
        clkCnt += d.clkCnt || 0;
        salesAmt += d.salesAmt || 0;
      }
      results.push({ id, impCnt, clkCnt, salesAmt });
    } catch (err) {
      console.error(`[NaverAPI] Stats error for ${id}:`, err.message);
    }
  }

  return results;
}

// Get ad groups for a campaign
async function getAdGroups(apiLicense, apiSecret, customerId, campaignId) {
  return naverApiCall('GET', '/ncc/adgroups', apiLicense, apiSecret, customerId, {
    nccCampaignId: campaignId
  });
}

// Get ads for ad group
async function getAds(apiLicense, apiSecret, customerId, adGroupId) {
  return naverApiCall('GET', '/ncc/ads', apiLicense, apiSecret, customerId, {
    nccAdgroupId: adGroupId
  });
}

// Get stat for ad IDs
async function getAdCreativeStats(apiLicense, apiSecret, customerId, adIds, since, until) {
  if (!adIds.length) return [];

  const fields = JSON.stringify(["impCnt", "clkCnt", "salesAmt"]);
  const timeRange = JSON.stringify({ since, until });
  const results = [];

  for (const id of adIds) {
    try {
      const res = await naverApiCall('GET', '/stats', apiLicense, apiSecret, customerId, {
        id,
        fields,
        timeRange
      });
      const days = res?.data || [];
      let impCnt = 0, clkCnt = 0, salesAmt = 0;
      for (const d of days) {
        impCnt += d.impCnt || 0;
        clkCnt += d.clkCnt || 0;
        salesAmt += d.salesAmt || 0;
      }
      results.push({ id, impCnt, clkCnt, salesAmt });
    } catch (err) {
      // skip
    }
  }

  return results;
}

function parseVolume(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val.includes('<')) return 5;
    return parseInt(val.replace(/,/g, ''), 10) || 0;
  }
  return 0;
}

// Campaign type mapping (API returns string codes like WEB_SITE, PLACE, etc.)
const CAMPAIGN_TYPES = {
  'WEB_SITE': 'powerlink',
  'SHOPPING': 'shopping',
  'POWER_CONTENTS': 'powercontents',
  'PLACE': 'place',
  'BRAND_SEARCH': 'smb',
  // Legacy numeric codes
  '1': 'powerlink',
  '2': 'shopping',
  '4': 'powercontents',
  '5': 'place',
  '6': 'smb',
};

function classifyCampaignType(campaign) {
  // Name-based override first (e.g. "지역소상공인" campaigns have type PLACE but are SMB)
  const name = (campaign.name || '');
  if (name.includes('소상공인') || name.includes('지역소상공인')) return 'smb';

  const typeCode = String(campaign.campaignTp || '');
  if (CAMPAIGN_TYPES[typeCode]) return CAMPAIGN_TYPES[typeCode];

  // Fallback
  const lower = name.toLowerCase();
  if (lower.includes('플레이스') || lower.includes('place')) return 'place';
  if (lower.includes('파워링크') || lower.includes('powerlink')) return 'powerlink';
  return 'other';
}

module.exports = {
  getKeywordStats,
  getCampaigns,
  getAdStats,
  getAdGroups,
  getAds,
  getAdCreativeStats,
  classifyCampaignType,
  CAMPAIGN_TYPES
};
