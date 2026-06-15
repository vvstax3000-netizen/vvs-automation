// 네이버 검색광고 API 클라이언트 (Cloudflare Workers ES module)
// Web Crypto API 기반 HMAC 서명 사용

import { naverHeaders } from './crypto.js';

// ──────────────────────────────────────────────
// 캠페인 유형 분류
// ──────────────────────────────────────────────

// campaignTp 코드 → 프론트엔드/라우트가 사용하는 영문 유형 키
export const CAMPAIGN_TYPES = {
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

/**
 * 캠페인 객체로부터 유형 분류 (영문 키 반환: place/powerlink/smb/shopping/powercontents/other)
 * @param {object} campaign
 * @returns {string}
 */
export function classifyCampaignType(campaign) {
  // 이름 기반 우선 분류 (예: "지역소상공인" 캠페인은 campaignTp가 PLACE라도 SMB로 취급)
  const name = (campaign.name || '');
  if (name.includes('소상공인') || name.includes('지역소상공인')) return 'smb';

  const typeCode = String(campaign.campaignTp || campaign.campaignType || '');
  if (CAMPAIGN_TYPES[typeCode]) return CAMPAIGN_TYPES[typeCode];

  // Fallback
  const lower = name.toLowerCase();
  if (lower.includes('플레이스') || lower.includes('place')) return 'place';
  if (lower.includes('파워링크') || lower.includes('powerlink')) return 'powerlink';
  return 'other';
}

// ──────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────

/**
 * 검색량 값 파싱 (문자열 "< 10" 등 처리)
 * @param {*} val
 * @returns {number}
 */
export function parseVolume(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '< 10') return 5;
  const num = parseInt(str.replace(/,/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

// ──────────────────────────────────────────────
// 공통 API 호출
// ──────────────────────────────────────────────

/**
 * 네이버 검색광고 API 공통 호출
 * @param {string} method - HTTP 메서드 (GET, POST 등)
 * @param {string} path - API 경로
 * @param {string} apiLicense - API 라이선스 키
 * @param {string} apiSecret - API 시크릿 키
 * @param {string} customerId - 고객 ID
 * @param {object} params - 쿼리 파라미터
 * @returns {Promise<any>}
 */
export async function naverApiCall(method, path, apiLicense, apiSecret, customerId, params = {}) {
  const headers = await naverHeaders(method, path, apiLicense, apiSecret, customerId);
  const qs = new URLSearchParams(params).toString().replace(/\+/g, '%20');
  const url = `https://api.searchad.naver.com${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, { method, headers });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[NaverAPI] ${method} ${path} failed: ${res.status}`, text);
    throw new Error(`네이버 API 오류 (${res.status})`);
  }

  return res.json();
}

// ──────────────────────────────────────────────
// 키워드 검색량 조회
// ──────────────────────────────────────────────

/**
 * 키워드 검색량 통계 조회
 * @param {string[]} keywordList - 키워드 배열 (최대 5개)
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @returns {Promise<Array>}
 */
export async function getKeywordStats(keywordList, apiLicense, apiSecret, customerId) {
  if (!keywordList || keywordList.length === 0) return [];

  // 네이버 API는 최대 5개씩 조회 가능
  const results = [];
  const chunkSize = 5;

  for (let i = 0; i < keywordList.length; i += chunkSize) {
    const chunk = keywordList.slice(i, i + chunkSize);
    const data = await naverApiCall('GET', '/keywordstool', apiLicense, apiSecret, customerId, {
      hintKeywords: chunk.join(','),
      showDetail: '1',
    });

    const items = data.keywordList || [];

    for (const kw of chunk) {
      const found = items.find(
        (item) => (item.relKeyword || '').trim().toLowerCase() === kw.trim().toLowerCase()
      );

      if (found) {
        results.push({
          keyword: kw,
          monthlyPcQcCnt: parseVolume(found.monthlyPcQcCnt),
          monthlyMobileQcCnt: parseVolume(found.monthlyMobileQcCnt),
          totalSearch:
            parseVolume(found.monthlyPcQcCnt) + parseVolume(found.monthlyMobileQcCnt),
          compIdx: found.compIdx || '',
          plAvgDepth: found.plAvgDepth || 0,
        });
      } else {
        results.push({
          keyword: kw,
          monthlyPcQcCnt: 0,
          monthlyMobileQcCnt: 0,
          totalSearch: 0,
          compIdx: '',
          plAvgDepth: 0,
        });
      }
    }
  }

  return results;
}

// ──────────────────────────────────────────────
// 캠페인 관리
// ──────────────────────────────────────────────

/**
 * 전체 캠페인 목록 조회
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @returns {Promise<Array>}
 */
export async function getCampaigns(apiLicense, apiSecret, customerId) {
  const campaigns = await naverApiCall('GET', '/ncc/campaigns', apiLicense, apiSecret, customerId);
  return Array.isArray(campaigns) ? campaigns : [];
}

/**
 * 캠페인별 광고 통계 조회
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @param {string[]} campaignIds
 * @param {string} since - 시작일 (YYYY-MM-DD)
 * @param {string} until - 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array>}
 */
export async function getAdStats(apiLicense, apiSecret, customerId, campaignIds, since, until) {
  if (!campaignIds || campaignIds.length === 0) return [];

  const fields = JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc']);
  const timeRange = JSON.stringify({ since, until });
  const results = [];

  for (const id of campaignIds) {
    try {
      const data = await naverApiCall('GET', '/stats', apiLicense, apiSecret, customerId, {
        id,
        fields,
        timeRange,
      });

      // 기간 내 일별 데이터를 하나로 합산
      const days = Array.isArray(data?.data) ? data.data : (data ? [data] : []);
      let impCnt = 0, clkCnt = 0, salesAmt = 0;
      for (const d of days) {
        impCnt += d.impCnt || 0;
        clkCnt += d.clkCnt || 0;
        salesAmt += d.salesAmt || 0;
      }
      results.push({ id, impCnt, clkCnt, salesAmt });
    } catch (err) {
      console.error(`[NaverAPI] 캠페인 ${id} 통계 조회 실패:`, err.message);
    }
  }

  return results;
}

/**
 * 캠페인 내 광고그룹 목록 조회
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @param {string} campaignId
 * @returns {Promise<Array>}
 */
export async function getAdGroups(apiLicense, apiSecret, customerId, campaignId) {
  const groups = await naverApiCall(
    'GET',
    '/ncc/adgroups',
    apiLicense,
    apiSecret,
    customerId,
    { nccCampaignId: campaignId }
  );
  return Array.isArray(groups) ? groups : [];
}

/**
 * 광고그룹 내 광고 목록 조회
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @param {string} adGroupId
 * @returns {Promise<Array>}
 */
export async function getAds(apiLicense, apiSecret, customerId, adGroupId) {
  const ads = await naverApiCall(
    'GET',
    '/ncc/ads',
    apiLicense,
    apiSecret,
    customerId,
    { nccAdgroupId: adGroupId }
  );
  return Array.isArray(ads) ? ads : [];
}

/**
 * 광고 소재별 통계 조회
 * @param {string} apiLicense
 * @param {string} apiSecret
 * @param {string} customerId
 * @param {string[]} adIds
 * @param {string} since - 시작일 (YYYY-MM-DD)
 * @param {string} until - 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array>}
 */
export async function getAdCreativeStats(apiLicense, apiSecret, customerId, adIds, since, until) {
  if (!adIds || adIds.length === 0) return [];

  const fields = JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']);
  const timeRange = JSON.stringify({ since, until });
  const results = [];

  for (const id of adIds) {
    try {
      const data = await naverApiCall('GET', '/stats', apiLicense, apiSecret, customerId, {
        id,
        fields,
        timeRange,
      });

      const days = Array.isArray(data?.data) ? data.data : (data ? [data] : []);
      let impCnt = 0, clkCnt = 0, salesAmt = 0;
      for (const d of days) {
        impCnt += d.impCnt || 0;
        clkCnt += d.clkCnt || 0;
        salesAmt += d.salesAmt || 0;
      }
      results.push({ id, impCnt, clkCnt, salesAmt });
    } catch (err) {
      console.error(`[NaverAPI] \uad11\uace0 ${id} \ud1b5\uacc4 \uc870\ud68c \uc2e4\ud328:`, err.message);
    }
  }

  return results;
}
