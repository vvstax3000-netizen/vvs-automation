// Standalone crawler for keyword discovery (copy of core logic, no shared imports)
const GRAPHQL_URL = 'https://pcmap-api.place.naver.com/place/graphql';
const PER_PAGE = 50; // Only check top 50 per keyword for discovery efficiency
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GRAPHQL_QUERY = `query getPlacesList($input: PlacesInput) {
  businesses: places(input: $input) {
    total
    items { id name }
  }
}`;

function randomDelay() {
  const ms = 3000 + Math.random() * 3000; // 3-6 seconds
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTopPlaces(keyword) {
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
          input: { query: keyword, start: 1, display: PER_PAGE, adult: false, spq: false }
        }
      })
    });

    if (!res.ok) {
      console.error(`[KeywordCrawler] "${keyword}" failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const items = data?.data?.businesses?.items || [];
    return items.map((item, i) => ({
      rank: i + 1,
      name: item.name || '',
      id: item.id || ''
    }));
  } catch (err) {
    console.error(`[KeywordCrawler] "${keyword}" error:`, err.message);
    return [];
  }
}

function findPlaceRank(results, placeName) {
  if (!placeName) return null;
  const found = results.find(r =>
    r.name.includes(placeName) || placeName.includes(r.name)
  );
  return found ? found.rank : null;
}

module.exports = { fetchTopPlaces, findPlaceRank, randomDelay };
