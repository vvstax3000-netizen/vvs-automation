const express = require('express');
const { queryOne } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/:clientId/insights', async (req, res) => {
  const { since, until } = req.query;
  if (!since || !until) {
    return res.status(400).json({ error: '조회 기간을 지정해주세요' });
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [req.params.clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });
  if (!client.meta_ad_account_id) {
    return res.status(400).json({ error: '메타 광고 계정 ID가 설정되지 않았습니다' });
  }

  const tokenRow = queryOne("SELECT value FROM settings WHERE key = 'meta_api_token'");
  if (!tokenRow?.value) {
    return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다. 설정에서 입력해주세요.' });
  }

  const cpmRow = queryOne("SELECT value FROM settings WHERE key = 'meta_cpm'");
  const cpm = parseFloat(cpmRow?.value) || 7000;

  try {
    const accountId = client.meta_ad_account_id.startsWith('act_')
      ? client.meta_ad_account_id
      : `act_${client.meta_ad_account_id}`;

    const timeRange = JSON.stringify({ since, until });
    const fields = 'impressions,reach,frequency,clicks,ctr,spend';
    const url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&access_token=${tokenRow.value}`;

    const apiRes = await fetch(url);
    const data = await apiRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message || 'Meta API 오류' });
    }

    const raw = data.data?.[0] || {};
    const impressions = parseInt(raw.impressions) || 0;
    const reach = parseInt(raw.reach) || 0;
    const frequency = parseFloat(raw.frequency) || 0;
    const clicks = parseInt(raw.clicks) || 0;
    const ctr = parseFloat(raw.ctr) || 0;

    // Markup: ignore actual spend, recalculate with fixed CPM
    const totalCost = Math.round((impressions / 1000) * cpm);
    const cpc = clicks > 0 ? Math.round(totalCost / clicks) : 0;

    res.json({
      impressions,
      reach,
      frequency: frequency.toFixed(2),
      clicks,
      ctr: ctr.toFixed(2),
      cpc,
      totalCost,
      cpm,
      dateStart: raw.date_start || since,
      dateEnd: raw.date_stop || until
    });
  } catch (err) {
    console.error('[MetaAds] Error:', err.message);
    res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다' });
  }
});

module.exports = router;
