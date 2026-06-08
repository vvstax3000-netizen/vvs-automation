// 네이버 플레이스 키워드 크롤러 (Cloudflare Workers ES module)
// 상위 50개만 빠르게 가져오는 경량 버전

const GRAPHQL_URL = 'https://pcmap-api.place.naver.com/place/graphql';

/**
 * 3~6초 랜덤 딜레이
 */
export function randomDelay() {
  const ms = Math.floor(Math.random() * 3000) + 3000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 네이버 플레이스 상위 50개 결과 조회
 * @param {string} keyword - 검색 키워드
 * @returns {Promise<Array>} 상위 50개 결과
 */
export async function fetchTopPlaces(keyword) {
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
      start: 1,
      display: 50,
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
      console.error(`[KeywordCrawler] GraphQL 요청 실패: ${res.status}`);
      return [];
    }

    const json = await res.json();
    const data = Array.isArray(json) ? json[0] : json;
    const items = data?.data?.businesses?.items;

    if (!items || items.length === 0) {
      return [];
    }

    return items.map((item) => ({
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
    }));
  } catch (err) {
    console.error(`[KeywordCrawler] 크롤링 오류:`, err.message);
    return [];
  }
}

/**
 * 검색 결과에서 업체명으로 순위 찾기
 * @param {Array} results - fetchTopPlaces 결과
 * @param {string} placeName - 찾을 업체명
 * @returns {{ rank: number|null, place: object|null }}
 */
export function findPlaceRank(results, placeName) {
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
