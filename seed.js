// Cria o usuário administrador inicial.
// Uso: ADMIN_USER=meuadmin ADMIN_PASS=minhasenha node seed.js
const bcrypt = require('bcryptjs');
const dbInit = require('./db');

async function main() {
  const db = await dbInit.init();

  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'mudeesta123';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);

  if (existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE username = ?').run(
      hash,
      'admin',
      username
    );
    console.log(`Usuário admin "${username}" já existia — senha atualizada.`);
  } else {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username,
      hash,
      'admin'
    );
    console.log(`Usuário admin "${username}" criado com sucesso.`);
  }

  console.log('IMPORTANTE: troque a senha padrão assim que possível.');
}

main().catch((err) => {
  console.error('Erro ao executar seed:', err);
  process.exit(1);
});
