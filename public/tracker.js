// Tracker de sessão/atividade para o painel admin
(function () {
  async function me() {
    const r = await fetch('/api/me');
    return r.json();
  }

  async function init() {
    const info = await me();
    if (!info.authenticated) {
      window.location.href = '/login.html';
      return;
    }
    const nameEl = document.getElementById('ef-username');
    const adminLink = document.getElementById('ef-admin-link');
    const logoutLink = document.getElementById('ef-logout-link');
    if (nameEl) nameEl.textContent = 'Logado como: ' + info.username;
    if (adminLink && info.role === 'admin') adminLink.style.display = 'inline';
    if (logoutLink) {
      logoutLink.addEventListener('click', async function (e) {
        e.preventDefault();
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });
    }

    // heartbeat para contar "usuários online agora"
    fetch('/api/heartbeat', { method: 'POST' });
    setInterval(function () {
      fetch('/api/heartbeat', { method: 'POST' });
    }, 60 * 1000);
  }

  window.EF_track = function (action, detail) {
    fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, detail })
    }).catch(function () {});
  };

  init();
})();
