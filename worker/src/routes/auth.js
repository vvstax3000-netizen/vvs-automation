import { Hono } from 'hono';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { verifyPassword } from '../services/crypto.js';

export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ error: 'ID와 비밀번호를 입력해주세요' }, 400);
  }

  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();

  if (!user || !(await verifyPassword(password, user.password))) {
    return c.json({ error: 'ID 또는 비밀번호가 올바르지 않습니다' }, 401);
  }

  const secret = c.env.JWT_SECRET || 'vvs-secret-key-change-in-production';
  const token = await jwt.sign(
    { id: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + 86400 },
    secret
  );

  return c.json({ token, user: { id: user.id, username: user.username } });
});
