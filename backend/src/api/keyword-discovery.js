const express = require('express');
const crypto = require('crypto');
const { queryAll, queryOne, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');
const { fetchTopPlaces, findPlaceRank, randomDelay } = require('../services/keyword-crawler');

const router = express.Router();

// In-memory job store
const activeJobs = new Map();

// Lazy table initialization (first request)
let tablesReady = false;
function ensureTables() {
  if (tablesReady) return;
  run(`CREATE TABLE IF NOT EXISTS keyword_discovery_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    rank INTEGER,
    monthly_pc_qc_cnt INTEGER DEFAULT 0,
    monthly_mobile_qc_cnt INTEGER DEFAULT 0,
    total_search_volume INTEGER DEFAULT 0,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  run(`CREATE TABLE IF NOT EXISTS keyword_discovery_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL UNIQUE,
    locations TEXT DEFAULT '',
    menus TEXT DEFAULT '',
    brand_keywords TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  tablesReady = true;
}

router.use(authMiddleware);
router.use((req, res, next) => { ensureTables(); next(); });

// === Generate keyword combinations (expanded patterns) ===
router.post('/generate', (req, res) => {
  const { clientId, locations = [], menus = [], brandKeywords = [] } = req.body;
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
  const keywords = [...set].filter(k => k.trim().length > 0);

  // Save preset
  if (clientId) {
    run('DELETE FROM keyword_discovery_presets WHERE client_id = ?', [clientId]);
    run(
      'INSERT INTO keyword_discovery_presets (client_id, locations, menus, brand_keywords) VALUES (?, ?, ?, ?)',
      [clientId, JSON.stringify(cleanLocations), JSON.stringify(cleanMenus), JSON.stringify(brandKeywords)]
    );
  }

  res.json({ keywords, totalCount: keywords.length });
});

// === Get preset ===
router.get('/:clientId/preset', (req, res) => {
  const row = queryOne('SELECT * FROM keyword_discovery_presets WHERE client_id = ?', [req.params.clientId]);
  if (!row) return res.json({ locations: [], menus: [], brandKeywords: [] });
  const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
  res.json({
    locations: parse(row.locations),
    menus: parse(row.menus),
    brandKeywords: parse(row.brand_keywords)
  });
});

// === Get last results ===
router.get('/:clientId/results', (req, res) => {
  const rows = queryAll(
    `SELECT * FROM keyword_discovery_results WHERE client_id = ? ORDER BY total_search_volume DESC, rank ASC`,
    [req.params.clientId]
  );
  res.json(rows);
});

// === Start rank check job (polling-based) ===
router.post('/start-check', (req, res) => {
  const { clientId, placeName, keywords } = req.body;
  if (!placeName || !Array.isArray(keywords) || !keywords.length) {
    return res.status(400).json({ error: '플레이스명과 키워드 목록이 필요합니다' });
  }

  const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const job = {
    id: jobId,
    clientId,
    placeName,
    keywords,
    status: 'running',
    results: [],
    currentIndex: 0,
    total: keywords.length,
    stopped: false,
    error: null
  };
  activeJobs.set(jobId, job);

  processKeywords(job).catch(err => {
    console.error('[KeywordDiscovery] job error:', err.message);
    job.status = 'error';
    job.error = err.message;
  });

  res.json({ jobId, totalKeywords: keywords.length });
});

async function processKeywords(job) {
  for (let i = 0; i < job.keywords.length; i++) {
    if (job.stopped) break;
    const keyword = job.keywords[i];
    try {
      const places = await fetchTopPlaces(keyword);
      const rank = findPlaceRank(places, job.placeName);
      job.results.push({ keyword, rank: rank || null });
    } catch (err) {
      console.error(`[KeywordDiscovery] "${keyword}" failed:`, err.message);
      job.results.push({ keyword, rank: null, error: err.message });
    }
    job.currentIndex = i + 1;

    if (i < job.keywords.length - 1 && !job.stopped) {
      await randomDelay();
    }
  }

  if (!job.stopped) {
    job.status = 'done';
    // Save results to DB
    if (job.clientId) {
      run('DELETE FROM keyword_discovery_results WHERE client_id = ?', [job.clientId]);
      for (const r of job.results) {
        run(
          `INSERT INTO keyword_discovery_results (client_id, keyword, rank) VALUES (?, ?, ?)`,
          [job.clientId, r.keyword, r.rank]
        );
      }
    }
  }
}

// === Check job status (polling) ===
router.get('/check-status/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const lastIndex = parseInt(req.query.lastIndex) || 0;
  const newResults = job.results.slice(lastIndex);

  res.json({
    status: job.status,
    progress: { current: job.currentIndex, total: job.total },
    results: job.results,
    newResults,
    error: job.error || null
  });
});

// === Stop job ===
router.post('/stop-check/:jobId', (req, res) => {
  const job = activeJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.stopped = true;
  job.status = 'stopped';
  // Save partial results if any
  if (job.clientId && job.results.length) {
    run('DELETE FROM keyword_discovery_results WHERE client_id = ?', [job.clientId]);
    for (const r of job.results) {
      run(
        `INSERT INTO keyword_discovery_results (client_id, keyword, rank) VALUES (?, ?, ?)`,
        [job.clientId, r.keyword, r.rank]
      );
    }
  }
  res.json({ stopped: true, results: job.results });
});

// === Search volume via Naver Search Ad API ===
function naverHeaders(method, path, license, secret, customerId) {
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${method}.${path}`).digest('base64');
  return {
    'X-API-KEY': license,
    'X-Customer': customerId,
    'X-Timestamp': ts,
    'X-Signature': sig
  };
}

function parseVolume(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (s.includes('<')) return 5;
  return parseInt(s.replace(/,/g, ''), 10) || 0;
}

router.post('/search-volume', async (req, res) => {
  const { clientId, keywords } = req.body;
  if (!clientId || !Array.isArray(keywords) || !keywords.length) {
    return res.status(400).json({ error: 'clientId와 keywords가 필요합니다' });
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) return res.status(404).json({ error: '광고주를 찾을 수 없습니다' });

  const { naver_api_license: L, naver_api_secret: S, naver_customer_id: C } = client;
  if (!L || !S || !C) {
    return res.status(400).json({ error: '광고주의 네이버 API 키가 설정되지 않았습니다' });
  }

  const path = '/keywordstool';
  const volumeMap = {};

  for (let i = 0; i < keywords.length; i += 5) {
    const batch = keywords.slice(i, i + 5);
    for (const kw of batch) {
      const queryKw = kw.replace(/\s+/g, '');
      if (!queryKw) { volumeMap[kw] = { pc: 0, mobile: 0 }; continue; }
      try {
        const qs = new URLSearchParams({ hintKeywords: queryKw, showDetail: '1' })
          .toString().replace(/\+/g, '%20');
        const url = `https://api.searchad.naver.com${path}?${qs}`;
        const apiRes = await fetch(url, { headers: naverHeaders('GET', path, L, S, C) });

        if (!apiRes.ok) { volumeMap[kw] = { pc: 0, mobile: 0 }; continue; }
        const data = await apiRes.json();
        const match = (data.keywordList || []).find(
          it => it.relKeyword === queryKw || it.relKeyword === kw
        );
        volumeMap[kw] = match
          ? { pc: parseVolume(match.monthlyPcQcCnt), mobile: parseVolume(match.monthlyMobileQcCnt) }
          : { pc: 0, mobile: 0 };
      } catch (err) {
        volumeMap[kw] = { pc: 0, mobile: 0 };
      }
    }
    if (i + 5 < keywords.length) await new Promise(r => setTimeout(r, 500));
  }

  const results = [];
  for (const kw of keywords) {
    const v = volumeMap[kw] || { pc: 0, mobile: 0 };
    const total = v.pc + v.mobile;
    run(
      `UPDATE keyword_discovery_results SET monthly_pc_qc_cnt=?, monthly_mobile_qc_cnt=?, total_search_volume=?
       WHERE client_id=? AND keyword=?`,
      [v.pc, v.mobile, total, clientId, kw]
    );
    results.push({ keyword: kw, monthlyPcQcCnt: v.pc, monthlyMobileQcCnt: v.mobile, totalSearchVolume: total });
  }

  res.json({ results });
});

module.exports = router;
