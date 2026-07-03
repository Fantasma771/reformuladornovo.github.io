const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const dbInit = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-este-segredo-em-producao';

let db;

app.use(express.json());
app.use(
  cookieSession({
    name: 'ef_session',
    secret: SESSION_SECRET,
    maxAge: 12 * 60 * 60 * 1000 // 12h
  })
);

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'não autenticado' });
    return res.redirect('/login.html');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'acesso negado' });
    return res.redirect('/app.html');
  }
  next();
}

// ---------- HEALTH CHECK (necessário para o Wasmer Edge) ----------
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// ---------- AUTENTICAÇÃO ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'informe usuário e senha' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ip = getIp(req);
  const ua = req.headers['user-agent'] || '';

  const ok = user && bcrypt.compareSync(password, user.password_hash);

  db.prepare(
    'INSERT INTO logins (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, ?)'
  ).run(user ? user.id : 0, username, ip, ua, ok ? 1 : 0);

  if (!ok) return res.status(401).json({ error: 'usuário ou senha inválidos' });

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  db.prepare(
    `INSERT INTO sessions_online (user_id, username, last_seen) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET last_seen = datetime('now'), username = excluded.username`
  ).run(user.id, user.username);

  res.json({ ok: true, username: user.username, role: user.role });
});

app.post('/api/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions_online WHERE user_id = ?').run(req.session.userId);
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username, role: req.session.role });
});

// ---------- ATIVIDADE / HEARTBEAT ----------

app.post('/api/activity', requireAuth, (req, res) => {
  const { action, detail } = req.body || {};
  if (!action) return res.status(400).json({ error: 'ação obrigatória' });

  db.prepare(
    'INSERT INTO activities (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(req.session.userId, req.session.username, action, JSON.stringify(detail || {}), getIp(req));

  db.prepare(
    `INSERT INTO sessions_online (user_id, username, last_seen) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET last_seen = datetime('now')`
  ).run(req.session.userId, req.session.username);

  res.json({ ok: true });
});

app.post('/api/heartbeat', requireAuth, (req, res) => {
  db.prepare(
    `INSERT INTO sessions_online (user_id, username, last_seen) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET last_seen = datetime('now')`
  ).run(req.session.userId, req.session.username);
  res.json({ ok: true });
});

// ---------- PAINEL ADMIN (API) ----------

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const onlineNow = db
    .prepare(`SELECT COUNT(*) c FROM sessions_online WHERE last_seen >= datetime('now', '-5 minutes')`)
    .get().c;
  const loginsToday = db
    .prepare(`SELECT COUNT(*) c FROM logins WHERE created_at >= datetime('now', 'start of day') AND success = 1`)
    .get().c;
  const activitiesToday = db
    .prepare(`SELECT COUNT(*) c FROM activities WHERE created_at >= datetime('now', 'start of day')`)
    .get().c;

  res.json({ totalUsers, onlineNow, loginsToday, activitiesToday });
});

app.get('/api/admin/online', requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT username, last_seen FROM sessions_online WHERE last_seen >= datetime('now', '-5 minutes') ORDER BY last_seen DESC`
    )
    .all();
  res.json(rows);
});

app.get('/api/admin/logins', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const rows = db.prepare('SELECT * FROM logins ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.get('/api/admin/activities', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const rows = db.prepare('SELECT * FROM activities ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json(rows);
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'usuário e senha obrigatórios' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username,
      hash,
      role === 'admin' ? 'admin' : 'user'
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'usuário já existe' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- ARQUIVOS ESTÁTICOS PROTEGIDOS ----------

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/app.html');
  res.redirect('/login.html');
});

app.get('/app.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/admin.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// login.html, tracker.js, css etc podem ser públicos
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  db = await dbInit.init();
  app.listen(PORT, HOST, () => {
    console.log(`Equipe Fantasma rodando em http://${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
