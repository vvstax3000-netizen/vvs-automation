import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';

export const settingsRoutes = new Hono();
settingsRoutes.use('*', authMiddleware());

settingsRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of results) settings[r.key] = r.value;
  return c.json(settings);
});

settingsRoutes.put('/', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .bind(key, String(value)).run();
  }
  return c.json({ message: '설정이 저장되었습니다' });
});
