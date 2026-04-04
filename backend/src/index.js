const express = require('express');
const cors = require('cors');
const { getDb } = require('./db/schema');

const authRoutes = require('./api/auth');
const clientRoutes = require('./api/clients');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`VVS Backend running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
