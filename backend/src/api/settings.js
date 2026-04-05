const express = require('express');
const { queryAll, run } = require('../db/schema');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const rows = queryAll('SELECT key, value FROM settings');
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

router.put('/', (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
  res.json({ message: '설정이 저장되었습니다' });
});

module.exports = router;
