const crypto = require('crypto');

function generateSignature(timestamp, method, path, secret) {
  const message = `${timestamp}.${method}.${path}`;
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

async function getKeywordStats(keywordList, apiLicense, apiSecret, customerId) {
  if (!apiLicense || !apiSecret || !customerId) return null;

  const timestamp = String(Date.now());
  const method = 'GET';
  const path = '/keywordstool';
  const signature = generateSignature(timestamp, method, path, apiSecret);

  const params = new URLSearchParams({
    hintKeywords: keywordList.join(','),
    showDetail: '1'
  });

  try {
    const res = await fetch(`https://api.searchad.naver.com${path}?${params}`, {
      headers: {
        'X-API-KEY': apiLicense,
        'X-Customer': customerId,
        'X-Timestamp': timestamp,
        'X-Signature': signature
      }
    });

    if (!res.ok) {
      console.error('[NaverAPI] Failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return (data.keywordList || []).map(item => ({
      keyword: item.relKeyword,
      monthlyPc: parseVolume(item.monthlyPcQcCnt),
      monthlyMobile: parseVolume(item.monthlyMobileQcCnt),
      total: parseVolume(item.monthlyPcQcCnt) + parseVolume(item.monthlyMobileQcCnt)
    }));
  } catch (err) {
    console.error('[NaverAPI] Error:', err.message);
    return null;
  }
}

function parseVolume(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    if (val.includes('<')) return 5;
    return parseInt(val.replace(/,/g, ''), 10) || 0;
  }
  return 0;
}

module.exports = { getKeywordStats };
