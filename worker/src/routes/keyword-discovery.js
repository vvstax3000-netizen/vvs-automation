import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { naverHeaders } from '../services/crypto.js';
import { fetchTopPlaces, findPlaceRank, randomDelay } from '../services/keyword-crawler.js';

export const keywordDiscoveryRoutes = new Hono();
keywordDiscoveryRoutes.use('*', authMiddleware());

// === Helper: parse Naver volume value ===
function parseVolume(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes('<')) return 5;
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

// === POST /generate — Generate keyword combinations ===
keywordDiscoveryRoutes.post('/generate', async (c) => {
  const db = c.env.DB;
  const { clientId, locations = [], menus = [], brandKeywords = [] } = await c.req.json();

  const set = new Set();
  const suffixes = ['추천', '맛있는곳', '베스트', 'TOP', '순위'];
  const prefixModifiers = ['맛있는', '유명한'];

  const clean = (s) => String(s || '').trim();
  const cleanLocations = locations.map(clean).filter(Boolean);
  const cleanMenus = menus.map(clean).filter(Boolean);

  for (const loc of cleanLocations) {
    for (const menu of cleanMenus) {
      // 1. Basic
      set.add(loc + menu);
      set.add(loc + ' ' + menu);
      // 2. Reverse
      set.add(menu + loc);
      set.add(menu + ' ' + loc);
      // 3. Suffix
      for (const sfx of suffixes) {
        set.add(loc + menu + sfx);
      }
      // 4. "역"
      if (!loc.endsWith('역')) {
        set.add(loc + '역' + menu);
        set.add(loc + '역 ' + menu);
      }
      // 5. "동"
      if (!loc.endsWith('동')) {
        set.add(loc + '동' + menu);
        set.add(loc + '동 ' + menu);
      }
      // 6. "구"
      if (!loc.endsWith('구')) {
        set.add(loc + '구' + menu);
        set.add(loc + '구 ' + menu);
      }
      // 7. Menu + modifier
      for (const mod of prefixModifiers) {
        set.add(loc + mod + menu);
      }
      if (menu !== '맛집' && menu !== '밥집') {
        set.add(loc + menu + '맛집');
      }
    }
  }

  // 8. Compound location (pairs of different locations)
  for (let i = 0; i < cleanLocations.length; i++) {
    for (let j = 0; j < cleanLocations.length; j++) {
      if (i === j) continue;
      for (const menu of cleanMenus) {
        set.add(cleanLocations[i] + cleanLocations[j] + menu);
        set.add(cleanLocations[i] + ' ' + cleanLocations[j] + ' ' + menu);
      }
    }
  }

  // 9. Brand keywords
  for (const b of brandKeywords) {
    const k = clean(b);
    if (k) set.add(k);
  }

  set.delete('');
  const keywords = [...set].filter((k) => k.trim().length > 0);

  // Save preset
  if (clientId) {
    await db.prepare('DELETE FROM keyword_discovery_presets WHERE client_id = ?').bind(clientId).run();
    await db
      .prepare(
        'INSERT INTO keyword_discovery_presets (client_id, locations, menus, brand_keywords) VALUES (?, ?, ?, ?)'
      )
      .bind(clientId, JSON.stringify(cleanLocations), JSON.stringify(cleanMenus), JSON.stringify(brandKeywords))
      .run();
  }

  return c.json({ keywords, totalCount: keywords.length });
});

// === GET /:clientId/preset — Get saved preset ===
keywordDiscoveryRoutes.get('/:clientId/preset', async (c) => {
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT * FROM keyword_discovery_presets WHERE client_id = ?')
    .bind(c.req.param('clientId'))
    .first();

  if (!row) return c.json({ locations: [], menus: [], brandKeywords: [] });

  const parse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  };
  return c.json({
    locations: parse(row.locations),
    menus: parse(row.menus),
    brandKeywords: parse(row.brand_keywords),
  });
});

// === GET /:clientId/results — Get last results ===
keywordDiscoveryRoutes.get('/:clientId/results', async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      'SELECT * FROM keyword_discovery_results WHERE client_id = ? ORDER BY total_search_volume DESC, rank ASC'
    )
    .bind(c.req.param('clientId'))
    .all();
  return c.json(results);
});

// === POST /start-check — Run rank check synchronously (Workers mode) ===
// In Workers we cannot use in-memory polling jobs. Instead, all keywords
// are checked synchronously and results are returned in a single response.
keywordDiscoveryRoutes.post('/start-check', async (c) => {
  const db = c.env.DB;
  const { clientId, placeName, keywords } = await c.req.json();

  if (!placeName || !Array.isArray(keywords) || !keywords.length) {
    return c.json({ error: '플레이스명과 키워드 목록이 필요합니다' }, 400);
  }

  const results = [];

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    try {
      const places = await fetchTopPlaces(keyword);
      const { rank } = findPlaceRank(places, placeName);
      results.push({ keyword, rank: rank || null });
    } catch (err) {
      console.error(`[KeywordDiscovery] "${keyword}" failed:`, err.message);
      results.push({ keyword, rank: null, error: err.message });
    }

    if (i < keywords.length - 1) {
      await randomDelay();
    }
  }

  // Save results to DB
  if (clientId) {
    await db.prepare('DELETE FROM keyword_discovery_results WHERE client_id = ?').bind(clientId).run();
    for (const r of results) {
      await db
        .prepare('INSERT INTO keyword_discovery_results (client_id, keyword, rank) VALUES (?, ?, ?)')
        .bind(clientId, r.keyword, r.rank)
        .run();
    }
  }

  return c.json({
    status: 'done',
    progress: { current: keywords.length, total: keywords.length },
    results,
  });
});

// === GET /check-status/:jobId — Not supported in cloud mode ===
keywordDiscoveryRoutes.get('/check-status/:jobId', async (c) => {
  return c.json(
    {
      error: '클라우드 모드에서는 폴링 방식이 지원되지 않습니다. start-check가 결과를 직접 반환합니다.',
      status: 'not_supported',
    },
    501
  );
});

// === POST /stop-check/:jobId — Not supported in cloud mode ===
keywordDiscoveryRoutes.post('/stop-check/:jobId', async (c) => {
  return c.json(
    {
      error: '클라우드 모드에서는 작업 중지가 지원되지 않습니다. start-check가 동기적으로 실행됩니다.',
      status: 'not_supported',
    },
    501
  );
});

// === POST /search-volume — Fetch search volume from Naver Search Ad API ===
keywordDiscoveryRoutes.post('/search-volume', async (c) => {
  const db = c.env.DB;
  const { clientId, keywords } = await c.req.json();

  if (!clientId || !Array.isArray(keywords) || !keywords.length) {
    return c.json({ error: 'clientId와 keywords가 필요합니다' }, 400);
  }

  const client = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(clientId).first();
  if (!client) return c.json({ error: '광고주를 찾을 수 없습니다' }, 404);

  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) {
    return c.json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다' }, 400);
  }

  const path = '/keywordstool';
  const volumeMap = {};

  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    for (const kw of batch) {
      const queryKw = kw.replace(/\s+/g, '');
      if (!queryKw) {
        volumeMap[kw] = { pc: 0, mobile: 0 };
        continue;
      }
      try {
        const qs = new URLSearchParams({ hintKeywords: queryKw, showDetail: '1' })
          .toString()
          .replace(/\+/g, '%20');
        const url = `https://api.searchad.naver.com${path}?${qs}`;
        const headers = await naverHeaders('GET', path, L, S, C);
        const apiRes = await fetch(url, { headers });

        if (!apiRes.ok) {
          volumeMap[kw] = { pc: 0, mobile: 0 };
          continue;
        }
        const data = await apiRes.json();
        const match = (data.keywordList || []).find(
          (it) => it.relKeyword === queryKw || it.relKeyword === kw
        );
        volumeMap[kw] = match
          ? { pc: parseVolume(match.monthlyPcQcCnt), mobile: parseVolume(match.monthlyMobileQcCnt) }
          : { pc: 0, mobile: 0 };
      } catch (err) {
        volumeMap[kw] = { pc: 0, mobile: 0 };
      }
    }
    if (i + 5 < keywords.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const results = [];
  for (const kw of keywords) {
    const v = volumeMap[kw] || { pc: 0, mobile: 0 };
    const total = v.pc + v.mobile;
    await db
      .prepare(
        `UPDATE keyword_discovery_results SET monthly_pc_qc_cnt=?, monthly_mobile_qc_cnt=?, total_search_volume=?
         WHERE client_id=? AND keyword=?`
      )
      .bind(v.pc, v.mobile, total, clientId, kw)
      .run();
    results.push({ keyword: kw, monthlyPcQcCnt: v.pc, monthlyMobileQcCnt: v.mobile, totalSearchVolume: total });
  }

  return c.json({ results });
});
