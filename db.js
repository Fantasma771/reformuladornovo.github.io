// Banco de dados 100% JavaScript puro (sem SQLite, sem WASM, sem addons nativos).
//
// O runtime Node do Wasmer Edge não expõe o objeto global `WebAssembly`, então
// qualquer biblioteca baseada em WASM (como o sql.js) falha com:
//   "ReferenceError: WebAssembly is not defined"
// Por isso este arquivo implementa um pequeno "banco" em memória, persistido em
// um arquivo JSON, cobrindo exatamente as consultas usadas em server.js e seed.js.
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'db');
const DB_FILE = path.join(DB_DIR, 'data.json');

let store = null;

function nowSqlite() {
  // Formato 'YYYY-MM-DD HH:MM:SS' (UTC), igual ao datetime('now') do SQLite,
  // e ordenável como string.
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function minutesAgo(mins) {
  return new Date(Date.now() - mins * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function startOfDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function persist() {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

function norm(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

class Statement {
  constructor(sql) {
    this.sql = norm(sql);
  }

  run(...params) {
    const sql = this.sql;

    if (sql.startsWith('INSERT INTO logins')) {
      const [user_id, username, ip, user_agent, success] = params;
      const id = ++store.seq.logins;
      store.logins.push({ id, user_id, username, ip, user_agent, success, created_at: nowSqlite() });
      persist();
      return { changes: 1 };
    }

    if (sql.startsWith('INSERT INTO sessions_online') && sql.includes('ON CONFLICT')) {
      const [user_id, username] = params;
      const existing = store.sessions_online.find((s) => s.user_id === user_id);
      if (existing) {
        existing.last_seen = nowSqlite();
        if (sql.includes('username = excluded.username')) existing.username = username;
      } else {
        store.sessions_online.push({ user_id, username, last_seen: nowSqlite() });
      }
      persist();
      return { changes: 1 };
    }

    if (sql.startsWith('DELETE FROM sessions_online')) {
      const [user_id] = params;
      const before = store.sessions_online.length;
      store.sessions_online = store.sessions_online.filter((s) => s.user_id !== user_id);
      persist();
      return { changes: before - store.sessions_online.length };
    }

    if (sql.startsWith('INSERT INTO activities')) {
      const [user_id, username, action, detail, ip] = params;
      const id = ++store.seq.activities;
      store.activities.push({ id, user_id, username, action, detail, ip, created_at: nowSqlite() });
      persist();
      return { changes: 1 };
    }

    if (sql.startsWith('INSERT INTO users')) {
      const [username, password_hash, role] = params;
      if (store.users.some((u) => u.username === username)) {
        const err = new Error('UNIQUE constraint failed: users.username');
        throw err;
      }
      const id = ++store.seq.users;
      store.users.push({ id, username, password_hash, role, created_at: nowSqlite() });
      persist();
      return { changes: 1 };
    }

    if (sql.startsWith('UPDATE users SET password_hash')) {
      const [password_hash, role, username] = params;
      const u = store.users.find((x) => x.username === username);
      if (u) {
        u.password_hash = password_hash;
        u.role = role;
        persist();
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    if (sql.startsWith('DELETE FROM users')) {
      const [id] = params;
      const before = store.users.length;
      store.users = store.users.filter((u) => String(u.id) !== String(id));
      persist();
      return { changes: before - store.users.length };
    }

    throw new Error('Statement.run não implementado para: ' + sql);
  }

  get(...params) {
    const sql = this.sql;

    if (sql === 'SELECT * FROM users WHERE username = ?') {
      const [username] = params;
      return store.users.find((u) => u.username === username);
    }

    if (sql === 'SELECT id FROM users WHERE username = ?') {
      const [username] = params;
      const u = store.users.find((x) => x.username === username);
      return u ? { id: u.id } : undefined;
    }

    if (sql.includes('COUNT(*) c FROM users')) {
      return { c: store.users.length };
    }

    if (sql.includes('COUNT(*) c FROM sessions_online')) {
      const threshold = minutesAgo(5);
      return { c: store.sessions_online.filter((s) => s.last_seen >= threshold).length };
    }

    if (sql.includes('COUNT(*) c FROM logins')) {
      const threshold = startOfDay();
      return { c: store.logins.filter((l) => l.created_at >= threshold && l.success === 1).length };
    }

    if (sql.includes('COUNT(*) c FROM activities')) {
      const threshold = startOfDay();
      return { c: store.activities.filter((a) => a.created_at >= threshold).length };
    }

    throw new Error('Statement.get não implementado para: ' + sql);
  }

  all(...params) {
    const sql = this.sql;

    if (sql.startsWith('SELECT username, last_seen FROM sessions_online')) {
      const threshold = minutesAgo(5);
      return store.sessions_online
        .filter((s) => s.last_seen >= threshold)
        .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
        .map((s) => ({ username: s.username, last_seen: s.last_seen }));
    }

    if (sql.startsWith('SELECT * FROM logins ORDER BY id DESC')) {
      const [limit] = params;
      return [...store.logins].sort((a, b) => b.id - a.id).slice(0, limit);
    }

    if (sql.startsWith('SELECT * FROM activities ORDER BY id DESC')) {
      const [limit] = params;
      return [...store.activities].sort((a, b) => b.id - a.id).slice(0, limit);
    }

    if (sql.startsWith('SELECT id, username, role, created_at FROM users')) {
      return [...store.users]
        .sort((a, b) => a.id - b.id)
        .map((u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at }));
    }

    throw new Error('Statement.all não implementado para: ' + sql);
  }
}

const dbApi = {
  prepare(sql) {
    return new Statement(sql);
  },
  exec() {
    // não usado (as tabelas já existem como estruturas em memória)
  },
  pragma() {
    // no-op — mantido apenas por compatibilidade
  }
};

async function init() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  if (fs.existsSync(DB_FILE)) {
    store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    store = {
      users: [],
      logins: [],
      activities: [],
      sessions_online: [],
      seq: { users: 0, logins: 0, activities: 0 }
    };
    persist();
  }

  return dbApi;
}

module.exports = { init };
