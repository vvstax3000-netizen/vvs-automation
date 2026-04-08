const GRAPHQL_URL = 'https://pcmap-api.place.naver.com/place/graphql';
const MAX_RANK = 300;
const PER_PAGE = 50;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GRAPHQL_QUERY = `query getPlacesList($input: PlacesInput) {
  businesses: places(input: $input) {
    total
    items { id name visitorReviewCount blogCafeReviewCount }
  }
}`;

function parseCount(val) {
  if (!val) return 0;
  return parseInt(String(val).replace(/,/g, ''), 10) || 0;
}

function randomDelay() {
  const ms = 2000 + Math.random() * 3000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function crawlNaverPlace(keyword) {
  const allResults = [];
  const totalPages = Math.ceil(MAX_RANK / PER_PAGE);

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * PER_PAGE + 1;
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'Referer': `https://pcmap.place.naver.com/restaurant/list?query=${encodeURIComponent(keyword)}`,
          'Origin': 'https://pcmap.place.naver.com'
        },
        body: JSON.stringify({
          operationName: 'getPlacesList',
          query: GRAPHQL_QUERY,
          variables: {
            input: { query: keyword, start, display: PER_PAGE, adult: false, spq: false }
          }
        })
      });

      if (!res.ok) {
        console.error(`[Crawler] "${keyword}" page ${page} failed: ${res.status}`);
        break;
      }

      const data = await res.json();
      const items = data?.data?.businesses?.items || [];

      for (let i = 0; i < items.length; i++) {
        allResults.push({
          rank: start + i,
          name: items[i].name || '',
          id: items[i].id || '',
          visitorReviews: parseCount(items[i].visitorReviewCount),
          blogReviews: parseCount(items[i].blogCafeReviewCount)
        });
      }

      if (items.length < PER_PAGE) break;
      if (page < totalPages) await randomDelay();
    } catch (err) {
      console.error(`[Crawler] "${keyword}" page ${page} error:`, err.message);
      break;
    }
  }

  return allResults.slice(0, MAX_RANK);
}

function findRank(results, placeName) {
  if (!placeName) return { rank: null, placeId: null, visitorReviews: 0, blogReviews: 0 };
  const found = results.find(r =>
    r.name.includes(placeName) || placeName.includes(r.name)
  );
  if (!found) return { rank: null, placeId: null, visitorReviews: 0, blogReviews: 0 };
  return {
    rank: found.rank,
    placeId: found.id,
    visitorReviews: found.visitorReviews || 0,
    blogReviews: found.blogReviews || 0
  };
}

module.exports = { crawlNaverPlace, findRank, randomDelay };
