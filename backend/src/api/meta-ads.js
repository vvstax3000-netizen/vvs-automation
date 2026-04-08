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
  if (!client.meta_campaign_ids) {
    return res.status(400).json({ error: '메타 캠페인 ID가 설정되지 않았습니다. 광고주 관리에서 입력해주세요.' });
  }

  const tokenRow = queryOne("SELECT value FROM settings WHERE key = 'meta_api_token'");
  if (!tokenRow?.value) {
    return res.status(400).json({ error: 'Meta API 토큰이 설정되지 않았습니다. 설정에서 입력해주세요.' });
  }

  const cpmRow = queryOne("SELECT value FROM settings WHERE key = 'meta_cpm'");
  const cpm = parseFloat(cpmRow?.value) || 7000;

  const accessToken = tokenRow.value;
  const campaignIds = client.meta_campaign_ids.split(',').map(s => s.trim()).filter(Boolean);

  try {
    let totalImpressions = 0, totalReach = 0, totalClicks = 0, totalSpend = 0;
    let dateStart = since, dateEnd = until;
    let weightedFrequency = 0;

    const timeRange = JSON.stringify({ since, until });
    const fields = 'impressions,reach,frequency,clicks,ctr,spend';

    for (const campaignId of campaignIds) {
      const url = `https://graph.facebook.com/v21.0/${campaignId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&access_token=${accessToken}`;
      const apiRes = await fetch(url);
      const data = await apiRes.json();

      if (data.error) {
        console.error(`[MetaAds] Campaign ${campaignId}:`, data.error.message);
        continue;
      }

      const raw = data.data?.[0];
      if (!raw) continue;

      const imp = parseInt(raw.impressions) || 0;
      const reach = parseInt(raw.reach) || 0;
      const clicks = parseInt(raw.clicks) || 0;
      const spend = parseFloat(raw.spend) || 0;
      const freq = parseFloat(raw.frequency) || 0;

      totalImpressions += imp;
      totalReach += reach;
      totalClicks += clicks;
      totalSpend += spend;
      weightedFrequency += freq * imp;

      if (raw.date_start) dateStart = raw.date_start;
      if (raw.date_stop) dateEnd = raw.date_stop;
    }

    const frequency = totalImpressions > 0 ? weightedFrequency / totalImpressions : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const totalCost = Math.round((totalImpressions / 1000) * cpm);
    const cpc = totalClicks > 0 ? Math.round(totalCost / totalClicks) : 0;

    res.json({
      impressions: totalImpressions,
      reach: totalReach,
      frequency: frequency.toFixed(2),
      clicks: totalClicks,
      ctr: ctr.toFixed(2),
      cpc,
      totalCost,
      cpm,
      campaignCount: campaignIds.length,
      dateStart,
      dateEnd
    });
  } catch (err) {
    console.error('[MetaAds] Error:', err.message);
    res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다' });
  }
});

module.exports = router;
