import jwt from '@tsndr/cloudflare-worker-jwt';

// JWT 인증 미들웨어
export function authMiddleware() {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: '인증이 필요합니다' }, 401);
    }

    const token = authHeader.split(' ')[1];
    const secret = c.env.JWT_SECRET || 'vvs-secret-key-change-in-production';

    try {
      const isValid = await jwt.verify(token, secret);
      if (!isValid) {
        return c.json({ error: '유효하지 않은 토큰입니다' }, 401);
      }
      const { payload } = jwt.decode(token);
      c.set('user', payload);
      await next();
    } catch (err) {
      return c.json({ error: '유효하지 않은 토큰입니다' }, 401);
    }
  };
}
