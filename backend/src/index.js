const express = require('express');
const cors = require('cors');
const { getDb } = require('./db/schema');
const { startCron } = require('./services/cron');

const authRoutes = require('./api/auth');
const clientRoutes = require('./api/clients');
const rankTrackerRoutes = require('./api/rank-tracker');
const publicRoutes = require('./api/public');
const settingsRoutes = require('./api/settings');
const metaAdsRoutes = require('./api/meta-ads');
const naverAdsRoutes = require('./api/naver-ads');

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function start() {
  await getDb();
  startCron();
  app.listen(PORT, () => {
    console.log(`VVS Backend running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
