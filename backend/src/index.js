const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { getDb, queryOne, run } = require('./db/schema');
const { startCron } = require('./services/cron');

const authRoutes = require('./api/auth');
const clientRoutes = require('./api/clients');
const rankTrackerRoutes = require('./api/rank-tracker');
const publicRoutes = require('./api/public');
const settingsRoutes = require('./api/settings');
const metaAdsRoutes = require('./api/meta-ads');
const naverAdsRoutes = require('./api/naver-ads');
const keywordDiscoveryRoutes = require('./api/keyword-discovery');
const salesRoutes = require('./api/sales');
const reportsRoutes = require('./api/reports');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/rank-tracker', rankTrackerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/meta-ads', metaAdsRoutes);
app.use('/api/naver-ads', naverAdsRoutes);
app.use('/api/keyword-discovery', keywordDiscoveryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/uploads/sales', express.static(path.join(__dirname, '..', 'data', 'sales-images')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function start() {
  await getDb();
  // 최초 배포 시 계정이 하나도 없으면 기본 관리자 계정 자동 생성.
  // (아이디: admin / 비밀번호: admin1234 — 로그인 후 반드시 변경하세요)
  if (!queryOne('SELECT id FROM users LIMIT 1')) {
    run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', bcrypt.hashSync('admin1234', 10)]);
    console.log('기본 admin 계정 생성됨 (비밀번호: admin1234) — 반드시 변경하세요');
  }
  startCron();
  app.listen(PORT, () => {
    console.log(`VVS Backend running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
