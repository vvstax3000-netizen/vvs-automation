const cron = require('node-cron');
const { queryAll, run } = require('../db/schema');
const { crawlNaverPlace, findRank, randomDelay } = require('./crawler');

async function refreshAllRanks() {
  console.log('[CRON] Starting daily rank refresh...');

  const keywords = queryAll(`
    SELECT k.id, k.keyword, c.place_name
    FROM keywords k
    JOIN clients c ON k.client_id = c.id
    WHERE c.place_name IS NOT NULL AND c.place_name != ''
  `);

  const today = new Date().toISOString().split('T')[0];

  for (const kw of keywords) {
    try {
      const results = await crawlNaverPlace(kw.keyword);
      const rank = findRank(results, kw.place_name);

      run('DELETE FROM rank_records WHERE keyword_id = ? AND recorded_date = ?', [kw.id, today]);
      run('INSERT INTO rank_records (keyword_id, rank, recorded_date) VALUES (?, ?, ?)',
        [kw.id, rank, today]);

      console.log(`[CRON] ${kw.keyword}: ${rank ? rank + '위' : '미노출'}`);
      await randomDelay();
    } catch (err) {
      console.error(`[CRON] Error for "${kw.keyword}":`, err.message);
    }
  }

  console.log('[CRON] Rank refresh complete.');
}

function startCron() {
  cron.schedule('0 15 * * *', () => {
    refreshAllRanks();
  });
  console.log('[CRON] Scheduled: daily rank refresh at 15:00');
}

module.exports = { startCron, refreshAllRanks };
