// 네이버 검색광고 API 클라이언트 (Cloudflare Workers ES module)
// Web Crypto API 기반 HMAC 서명 사용

import { naverHeaders } from './crypto.js';

// ──────────────────────────────────────────────
// 캠페인 유형 분류
// ──────────────────────────────────────────────

export const CAMPAIGN_TYPES = {
  POWER_LINK: '파워링크',
  SHOPPING: '쇼핑검색',
  POWER_CONTENT: '파워컨텐츠',
  BRAND_SEARCH: '브랜드검색',
  PLACE: '플레이스',
  DISPLAY: '디스플레이',
  UNKNOWN: '기타',
};

/**
 * 캠페인 객체로부터 유형 분류
 * @param {object} campaign
 * @returns {string}
 */
export function classifyCampaignType(campaign) {
  const type = (campaign.campaignTp || campaign.campaignType || '').toUpperCase();
  const name = (campaign.name || '').toLowerCase();

  if (type === 'WEB_SITE' || type === 'WEBSITE') return CAMPAIGN_TYPES.POWER_LINK;
  if (type === 'SHOPPING') return CAMPAIGN_TYPES.SHOPPING;
  if (type === 'POWER_CONTENTS' || type === 'CONTENT') return CAMPAIGN_TYPES.POWER_CONTENT;
  if (type === 'BRAND_SEARCH' || type === 'BRAND') return CAMPAIGN_TYPES.BRAND_SEARCH;
  if (type === 'PLACE' || name.includes('플레이스')) return CAMPAIGN_TYPES.PLACE;
  if (type === 'DISPLAY') return CAMPAIGN_TYPES.DISPLAY;

  return CAMPAIGN_TYPES.UNKNOWN;
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

  const results = [];

  for (const campaignId of campaignIds) {
    try {
      const data = await naverApiCall(
        'GET',
        `/stats`,
        apiLicense,
        apiSecret,
        customerId,
        {
          id: campaignId,
          fields: JSON.stringify([
            'impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc',
            'avgRnk', 'ccnt', 'crto', 'convAmt', 'ror',
          ]),
          timeRange: JSON.stringify({ since, until }),
          datePreset: 'custom',
        }
      );

      if (data && Array.isArray(data.data)) {
        results.push(...data.data.map((row) => ({ ...row, campaignId })));
      } else if (data) {
        results.push({ ...data, campaignId });
      }
    } catch (err) {
      console.error(`[NaverAPI] 캠페인 ${campaignId} 통계 조회 실패:`, err.message);
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

  const results = [];

  for (const adId of adIds) {
    try {
      const data = await naverApiCall(
        'GET',
        `/stats`,
        apiLicense,
        apiSecret,
        customerId,
        {
          id: adId,
          fields: JSON.stringify([
            'impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc',
            'avgRnk', 'ccnt', 'crto', 'convAmt', 'ror',
          ]),
          timeRange: JSON.stringify({ since, until }),
          datePreset: 'custom',
        }
      );

      if (data && Array.isArray(data.data)) {
        results.push(...data.data.map((row) => ({ ...row, adId })));
      } else if (data) {
        results.push({ ...data, adId });
      }
    } catch (err) {
      console.error(`[NaverAPI] 광고 ${adId} 통계 조회 실패:`, err.message);
    }
  }

  return results;
}
