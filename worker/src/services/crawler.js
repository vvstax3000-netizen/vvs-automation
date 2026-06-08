// 네이버 플레이스 크롤러 (Cloudflare Workers ES module)

const GRAPHQL_URL = 'https://pcmap-api.place.naver.com/place/graphql';

/**
 * 2~5초 랜덤 딜레이
 */
export function randomDelay() {
  const ms = Math.floor(Math.random() * 3000) + 2000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 네이버 플레이스 검색 결과를 최대 300건까지 크롤링
 * @param {string} keyword - 검색 키워드
 * @returns {Promise<Array>} 검색 결과 배열
 */
export async function crawlNaverPlace(keyword) {
  const allResults = [];
  const pageSize = 50;
  const maxResults = 300;
  const maxPages = Math.ceil(maxResults / pageSize);

  for (let page = 1; page <= maxPages; page++) {
    const start = (page - 1) * pageSize + 1;

    const query = `
      query getPlacesList($input: PlacesInput) {
        businesses: places(input: $input) {
          total
          items {
            id
            name
            category
            roadAddress
            address
            x
            y
            imageUrl
            reviewCount
            visitorReviewCount
            blogReviewCount
          }
        }
      }
    `;

    const variables = {
      input: {
        query: keyword,
        start,
        display: pageSize,
        deviceType: 'pcmap',
        x: '126.9783882',
        y: '37.5666103',
      },
    };

    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://map.naver.com/',
          Origin: 'https://map.naver.com',
        },
        body: JSON.stringify([{ operationName: 'getPlacesList', query, variables }]),
      });

      if (!res.ok) {
        console.error(`[Crawler] GraphQL 요청 실패: ${res.status}`);
        break;
      }

      const json = await res.json();
      const data = Array.isArray(json) ? json[0] : json;
      const items = data?.data?.businesses?.items;
      const total = data?.data?.businesses?.total ?? 0;

      if (!items || items.length === 0) {
        break;
      }

      for (const item of items) {
        allResults.push({
          id: item.id,
          name: item.name,
          category: item.category,
          roadAddress: item.roadAddress,
          address: item.address,
          x: item.x,
          y: item.y,
          imageUrl: item.imageUrl,
          reviewCount: item.reviewCount,
          visitorReviewCount: item.visitorReviewCount,
          blogReviewCount: item.blogReviewCount,
        });
      }

      // 전체 결과보다 많이 가져왔으면 종료
      if (allResults.length >= total || allResults.length >= maxResults) {
        break;
      }

      // 다음 페이지 요청 전 딜레이
      if (page < maxPages) {
        await randomDelay();
      }
    } catch (err) {
      console.error(`[Crawler] 페이지 ${page} 크롤링 오류:`, err.message);
      break;
    }
  }

  return allResults;
}

/**
 * 검색 결과에서 업체명으로 순위 찾기
 * @param {Array} results - crawlNaverPlace 결과
 * @param {string} placeName - 찾을 업체명
 * @returns {{ rank: number|null, place: object|null }}
 */
export function findRank(results, placeName) {
  if (!results || !Array.isArray(results)) {
    return { rank: null, place: null };
  }

  const normalized = placeName.trim().toLowerCase();

  for (let i = 0; i < results.length; i++) {
    const name = (results[i].name || '').trim().toLowerCase();
    if (name === normalized || name.includes(normalized) || normalized.includes(name)) {
      return { rank: i + 1, place: results[i] };
    }
  }

  return { rank: null, place: null };
}
