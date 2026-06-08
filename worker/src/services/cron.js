// Cloudflare Workers Cron Trigger용 순위 자동 업데이트
import { crawlNaverPlace, findRank, randomDelay } from './crawler.js';

export async function refreshAllRanks(db) {
  console.log('[CRON] Starting daily rank refresh...');

  const { results: keywords } = await db.prepare(`
    SELECT k.id, k.keyword, c.place_name
    FROM keywords k
    JOIN clients c ON k.client_id = c.id
    WHERE c.place_name IS NOT NULL AND c.place_name != ''
  `).all();

  const today = new Date().toISOString().split('T')[0];

  for (const kw of keywords) {
    try {
      const results = await crawlNaverPlace(kw.keyword);
      const { rank, visitorReviews, blogReviews } = findRank(results, kw.place_name);

      await db.prepare('DELETE FROM rank_records WHERE keyword_id = ? AND recorded_date = ?')
        .bind(kw.id, today).run();
      await db.prepare(
        'INSERT INTO rank_records (keyword_id, rank, visitor_reviews, blog_reviews, recorded_date) VALUES (?, ?, ?, ?, ?)'
      ).bind(kw.id, rank, visitorReviews, blogReviews, today).run();

      console.log(`[CRON] ${kw.keyword}: ${rank ? rank + '위' : '미노출'} (리뷰: ${visitorReviews}/${blogReviews})`);
      await randomDelay();
    } catch (err) {
      console.error(`[CRON] Error for "${kw.keyword}":`, err.message);
    }
  }

  console.log('[CRON] Rank refresh complete.');
}
