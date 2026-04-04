const { getDb, run, queryOne } = require('./schema');
const bcrypt = require('bcryptjs');

async function seed() {
  await getDb();

  const existing = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existing) {
    const hash = bcrypt.hashSync('admin1234', 10);
    run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hash]);
    console.log('Seed completed: admin user created');
  } else {
    console.log('Seed skipped: admin user already exists');
  }
}

seed().catch(console.error);
