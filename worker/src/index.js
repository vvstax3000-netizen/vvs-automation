import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { settingsRoutes } from './routes/settings.js';
import { rankTrackerRoutes } from './routes/rank-tracker.js';
import { publicRoutes } from './routes/public.js';
import { metaAdsRoutes } from './routes/meta-ads.js';
import { naverAdsRoutes } from './routes/naver-ads.js';
import { keywordDiscoveryRoutes } from './routes/keyword-discovery.js';
import { salesRoutes } from './routes/sales.js';
import { reportsRoutes } from './routes/reports.js';
import { refreshAllRanks } from './services/cron.js';

const app = new Hono();

// CORS
app.use('*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/rank-tracker', rankTrackerRoutes);
app.route('/api/public', publicRoutes);
app.route('/api/meta-ads', metaAdsRoutes);
app.route('/api/naver-ads', naverAdsRoutes);
app.route('/api/keyword-discovery', keywordDiscoveryRoutes);
app.route('/api/sales', salesRoutes);
app.route('/api/reports', reportsRoutes);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// 404
app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('[Error]', err.message);
  return c.json({ error: err.message }, 500);
});

export default {
  fetch: app.fetch,

  // Cron Trigger: 매일 06:00 UTC (15:00 KST) 순위 자동 업데이트
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshAllRanks(env.DB));
  }
};
