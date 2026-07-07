/* Liplop · auth — login OBRIGATÓRIO (portão).
 *
 * Onde há Supabase configurado, o app fica trancado atrás de um portão de
 * login até a pessoa entrar. No 1º login, o cloud-sync migra o cache da pessoa
 * pra conta (sem perder nada). Quando logada, libera o app + menu da conta.
 *
 * Se /api/config não trouxer SUPABASE_URL/ANON_KEY (ex.: produção antes do
 * cutover, ou local), este módulo NÃO faz nada: o app segue só com cache,
 * sem portão. Assim a produção fica intocada até a virada combinada.
 */
(function () {
  'use strict';
  let sb = null;
  let user = null;

  async function init() {
    let cfg;
    try { cfg = await (await fetch('/api/config')).json(); }
    catch (e) { if (window.liplopRunNewUserFlow) window.liplopRunNewUserFlow(null); return; }
    const ready = cfg && cfg.supabaseUrl && cfg.supabaseAnonKey
      && window.supabase && window.supabase.createClient;
    // sem config => app segue só com cache, sem portão; tour roda por navegador (anônimo)
    if (!ready) { if (window.liplopRunNewUserFlow) window.liplopRunNewUserFlow(null); return; }
    window.liplopHasAuth = true;   // tem login: o tour é disparado pela CONTA (não pelo fallback anônimo)

    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    window.liplopSupabase = sb;
    injectStyles();
    injectUI();

    const { data } = await sb.auth.getSession();
    user = data.session && data.session.user || null;
    render();
    sb.auth.onAuthStateChange(function (_e, session) {
      user = session && session.user || null;
      render();
    });
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('liplop-auth-css')) return;
    const s = document.createElement('style');
    s.id = 'liplop-auth-css';
    s.textContent = `
      .lp-auth-btn{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,0.16);
        border:1px solid rgba(255,255,255,0.4);color:#fff;font-size:13px;font-weight:600;
        padding:7px 14px;border-radius:999px;cursor:pointer;flex-shrink:0;font-family:inherit}
      .lp-auth-btn:hover{background:rgba(255,255,255,0.26)}
      .lp-auth-overlay{position:fixed;inset:0;z-index:10060;background:linear-gradient(160deg,#ffffff 0%,#FCEFF4 100%);
        display:none;align-items:center;justify-content:center;padding:20px}
      .lp-auth-overlay.open{display:flex}
      .lp-auth-brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:20px;color:var(--text,#1A0E15);margin-bottom:18px;justify-content:center}
      .lp-auth-logo{width:30px;height:30px;border-radius:50%;background:var(--rose,#D43A6E);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800}
      .lp-auth-card{background:var(--card,#fff);border:1px solid var(--border,#ECE2E8);border-radius:18px;
        width:380px;max-width:100%;padding:30px 28px;box-shadow:0 24px 60px rgba(0,0,0,0.3);text-align:center}
      .lp-auth-card h3{margin:0 0 6px;font-size:20px;font-weight:800;color:var(--text,#1A0E15)}
      .lp-auth-card p{margin:0 0 22px;font-size:13.5px;color:var(--mid,#6E5762);line-height:1.5}
      .lp-auth-input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--border,#ECE2E8);
        border-radius:10px;font-size:14px;font-family:inherit;margin-bottom:12px;color:var(--text,#1A0E15);outline:none}
      .lp-auth-input:focus{border-color:var(--rose,#D43A6E)}
      .lp-auth-primary{width:100%;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:700;
        color:#fff;cursor:pointer;font-family:inherit;background:linear-gradient(135deg,#f472b6,#ec4899)}
      .lp-auth-primary:hover{filter:brightness(1.05)}
      .lp-auth-or{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--dim,#A2909B);font-size:12px}
      .lp-auth-or::before,.lp-auth-or::after{content:'';flex:1;height:1px;background:var(--border,#ECE2E8)}
      .lp-auth-google{width:100%;border:1px solid var(--border,#ECE2E8);background:var(--card,#fff);border-radius:10px;
        padding:11px;font-size:14px;font-weight:600;color:var(--text,#1A0E15);cursor:pointer;font-family:inherit;
        display:flex;align-items:center;justify-content:center;gap:9px}
      .lp-auth-google:hover{border-color:var(--rose,#D43A6E)}
      .lp-auth-msg{margin-top:14px;font-size:13px;line-height:1.5;min-height:18px}
      .lp-auth-close{position:absolute;background:none;border:none;color:var(--dim,#A2909B);font-size:22px;
        cursor:pointer;top:14px;right:18px;line-height:1}
      .lp-auth-menu{position:fixed;background:var(--card,#fff);border:1px solid var(--border,#ECE2E8);
        border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,0.18);padding:6px;min-width:200px;z-index:10061;display:none}
      .lp-auth-menu.open{display:block}
      .lp-auth-menu .em{padding:9px 12px;font-size:12px;color:var(--dim,#A2909B);border-bottom:1px solid var(--border,#ECE2E8);
        margin-bottom:4px;word-break:break-all}
      .lp-auth-menu button{width:100%;text-align:left;background:none;border:none;padding:9px 12px;border-radius:8px;
        font-size:13.5px;color:var(--text,#1A0E15);cursor:pointer;font-family:inherit}
      .lp-auth-menu button:hover{background:var(--card2,#F7F2F5)}
      .lp-sub-overlay{position:fixed;inset:0;z-index:10062;background:rgba(12,5,9,0.5);display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
      .lp-sub-overlay.open{display:flex}
      .lp-sub-rows{display:flex;flex-direction:column;margin-top:8px}
      .lp-sub-row{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid var(--border,#ECE2E8);font-size:14px}
      .lp-sub-row:last-child{border-bottom:none}
      .lp-sub-k{color:var(--mid,#6E5762);flex-shrink:0}
      .lp-sub-v{color:var(--text,#1A0E15);font-weight:600;text-align:right;word-break:break-word}
    `;
    document.head.appendChild(s);
  }

  function injectUI() {
    // botão no topbar
    const right = document.querySelector('.topbar-right');
    if (right && !document.getElementById('lp-auth-btn')) {
      const btn = document.createElement('button');
      btn.id = 'lp-auth-btn';
      btn.className = 'lp-auth-btn';
      btn.onclick = onBtnClick;
      right.appendChild(btn);   // conta ancorada na direita
      // menu da conta
      const menu = document.createElement('div');
      menu.id = 'lp-auth-menu';
      menu.className = 'lp-auth-menu';
      menu.innerHTML = '<div class="em" id="lp-auth-email"></div>'
        + '<button id="lp-auth-profile">Meu perfil</button>'
        + '<button id="lp-auth-sub">Minha assinatura</button>'
        + '<button id="lp-auth-editname">Editar nome</button>'
        + '<button id="lp-auth-signout">Sair</button>';
      document.body.appendChild(menu);
      menu.querySelector('#lp-auth-profile').onclick = function () { closeMenu(); if (window.switchTab) window.switchTab('perfil'); };
      menu.querySelector('#lp-auth-signout').onclick = function () { closeMenu(); signOut(); };
      menu.querySelector('#lp-auth-sub').onclick = function () { closeMenu(); openSubModal(); };
      menu.querySelector('#lp-auth-editname').onclick = function () { closeMenu(); openNameModal(); };
      document.addEventListener('click', function (e) {
        if (!e.target.closest('#lp-auth-menu') && !e.target.closest('#lp-auth-btn')) closeMenu();
      });
    }
    // modal de login
    if (!document.getElementById('lp-auth-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'lp-auth-overlay';
      ov.className = 'lp-auth-overlay open';   // portão visível por padrão até a sessão ser confirmada
      ov.innerHTML =
        '<div class="lp-auth-card">'
        + '<div class="lp-auth-brand"><span class="lp-auth-logo">L</span>Liplop</div>'
        + '<h3>Entre pra acessar seu painel</h3>'
        + '<p>Descubra seu fit com cada vaga, gere currículos que passam na triagem e prepare suas entrevistas pra passar nas melhores vagas.</p>'
        + '<input class="lp-auth-input" id="lp-auth-name-input" type="text" placeholder="Seu nome" autocomplete="name" />'
        + '<input class="lp-auth-input" id="lp-auth-email-input" type="email" placeholder="seu@email.com" autocomplete="email" />'
        + '<button class="lp-auth-primary" id="lp-auth-magic">Enviar link de acesso</button>'
        + '<div class="lp-auth-or">ou</div>'
        + '<button class="lp-auth-google" id="lp-auth-google">'
        + '<svg width="17" height="17" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.9 35.6 44 30.3 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>'
        + 'Entrar com Google</button>'
        + '<div class="lp-auth-msg" id="lp-auth-msg"></div>'
        + '<p style="font-size:11.5px;color:var(--dim,#A2909B);margin:14px 0 0;line-height:1.5">📩 O link chega por e-mail e costuma cair no spam. Vale conferir lá também.</p>'
        + '</div>';
      document.body.appendChild(ov);
      ov.querySelector('#lp-auth-magic').onclick = signInMagic;
      ov.querySelector('#lp-auth-google').onclick = signInGoogle;
    }
    // modal "Minha assinatura" (dismissível)
    if (!document.getElementById('lp-sub-overlay')) {
      const so = document.createElement('div');
      so.id = 'lp-sub-overlay';
      so.className = 'lp-sub-overlay';
      so.innerHTML =
        '<div class="lp-auth-card" style="position:relative;text-align:left">'
        + '<button class="lp-auth-close" id="lp-sub-x">×</button>'
        + '<h3 style="text-align:center">Minha assinatura</h3>'
        + '<div id="lp-sub-body" style="margin-top:8px"></div>'
        + '</div>';
      document.body.appendChild(so);
      so.querySelector('#lp-sub-x').onclick = function () { so.classList.remove('open'); };
      so.addEventListener('click', function (e) { if (e.target === so) so.classList.remove('open'); });
    }
    // modal "Editar nome"
    if (!document.getElementById('lp-name-overlay')) {
      const no = document.createElement('div');
      no.id = 'lp-name-overlay';
      no.className = 'lp-sub-overlay';
      no.innerHTML =
        '<div class="lp-auth-card" style="position:relative">'
        + '<button class="lp-auth-close" id="lp-name-x">×</button>'
        + '<h3 style="text-align:center">Editar nome</h3>'
        + '<p style="text-align:center">Como você quer ser chamada no Liplop.</p>'
        + '<input class="lp-auth-input" id="lp-name-input" type="text" placeholder="Seu nome" autocomplete="name" />'
        + '<button class="lp-auth-primary" id="lp-name-save">Salvar</button>'
        + '<div class="lp-auth-msg" id="lp-name-msg"></div>'
        + '</div>';
      document.body.appendChild(no);
      no.querySelector('#lp-name-x').onclick = function () { no.classList.remove('open'); };
      no.addEventListener('click', function (e) { if (e.target === no) no.classList.remove('open'); });
      no.querySelector('#lp-name-save').onclick = saveName;
      no.querySelector('#lp-name-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveName(); });
    }
  }

  function displayName(u) {
    const md = (u && u.user_metadata) || {};
    return md.full_name || md.name || ((u && u.email || 'conta').split('@')[0]);
  }

  function render() {
    const gate = document.getElementById('lp-auth-overlay');
    const btn = document.getElementById('lp-auth-btn');
    if (user) {
      if (gate) gate.classList.remove('open');            // libera o app
      if (btn) {
        btn.style.display = '';
        btn.innerHTML = displayName(user).split(' ')[0] + ' <span style="opacity:.8;font-size:13px;vertical-align:middle;margin-left:2px">▾</span>';
      }
      const em = document.getElementById('lp-auth-email');
      if (em) em.innerHTML = '<strong style="color:var(--text,#1A0E15);font-weight:700;display:block;font-size:13px;margin-bottom:2px">' + displayName(user) + '</strong>' + (user.email || '');
      try { window.liplopUserEmail = user.email || ''; } catch (e) {}   // exposto pro checkout pre-preencher o e-mail
      // tour por conta: dispara depois que o portão liberou (uma vez por conta nesta página)
      if (window.liplopRunNewUserFlow) window.liplopRunNewUserFlow(user.id);
    } else {
      if (gate) gate.classList.add('open');               // tranca o app
      if (btn) btn.style.display = 'none';                // nada de "Entrar" solto no topbar
    }
  }

  // ── ações ─────────────────────────────────────────────────────────────────
  function onBtnClick() { user ? toggleMenu() : openLogin(); }
  function openLogin() { const o = document.getElementById('lp-auth-overlay'); if (o) o.classList.add('open'); }
  function closeLogin() { const o = document.getElementById('lp-auth-overlay'); if (o) o.classList.remove('open'); }
  function toggleMenu() {
    const m = document.getElementById('lp-auth-menu'); const b = document.getElementById('lp-auth-btn');
    if (!m || !b) return;
    const r = b.getBoundingClientRect();
    m.style.top = (r.bottom + 8) + 'px';
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.classList.toggle('open');
  }
  function closeMenu() { const m = document.getElementById('lp-auth-menu'); if (m) m.classList.remove('open'); }

  function msg(text, ok) {
    const el = document.getElementById('lp-auth-msg');
    if (el) { el.textContent = text; el.style.color = ok ? 'var(--green,#16a34a)' : 'var(--rose,#D43A6E)'; }
  }

  async function signInMagic() {
    const input = document.getElementById('lp-auth-email-input');
    const email = (input && input.value || '').trim();
    const nameEl = document.getElementById('lp-auth-name-input');
    const name = (nameEl && nameEl.value || '').trim();
    if (!email || email.indexOf('@') < 0) { msg('Digite um e-mail válido.'); return; }
    msg('Enviando...', true);
    const options = { emailRedirectTo: window.location.origin };
    if (name) options.data = { full_name: name };   // vira user_metadata no cadastro
    const { error } = await sb.auth.signInWithOtp({ email: email, options: options });
    if (error) { msg('Erro: ' + error.message); return; }
    const el = document.getElementById('lp-auth-msg');
    if (el) {
      el.style.color = '';
      el.innerHTML =
        '<div style="margin-top:14px;background:var(--card2,#F7F2F5);border:1px solid var(--border,#ECE2E8);border-radius:10px;padding:12px 14px;text-align:left">'
        + '<div style="font-size:13.5px;font-weight:700;color:var(--green,#16a34a);margin-bottom:4px">Link enviado</div>'
        + '<div style="font-size:12.5px;color:var(--mid,#6E5762);line-height:1.5">Confira seu e-mail. Ele costuma cair na caixa de <strong style="background:rgba(244,114,182,0.28);color:var(--text,#1A0E15);padding:1px 7px;border-radius:5px;white-space:nowrap">spam</strong>, então vale dar uma olhada lá também.</div>'
        + '</div>';
    }
  }

  async function signInGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) msg('Erro: ' + error.message);
  }

  async function signOut() { await sb.auth.signOut(); }

  function openNameModal() {
    const no = document.getElementById('lp-name-overlay');
    const inp = document.getElementById('lp-name-input');
    const m = document.getElementById('lp-name-msg');
    if (!no || !inp) return;
    if (m) m.textContent = '';
    inp.value = (user && user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '';
    no.classList.add('open');
    setTimeout(function () { inp.focus(); }, 50);
  }

  async function saveName() {
    const no = document.getElementById('lp-name-overlay');
    const inp = document.getElementById('lp-name-input');
    const m = document.getElementById('lp-name-msg');
    if (!sb || !inp) return;
    const n = (inp.value || '').trim();
    if (!n) { if (m) { m.textContent = 'Digite um nome.'; m.style.color = 'var(--rose,#D43A6E)'; } return; }
    if (m) { m.textContent = 'Salvando…'; m.style.color = 'var(--mid,#6E5762)'; }
    try {
      const r = await sb.auth.updateUser({ data: { full_name: n } });
      if (r && r.error) throw r.error;
      const uid = (r && r.data && r.data.user && r.data.user.id) || (user && user.id);
      if (uid) { try { await sb.from('profiles').update({ full_name: n }).eq('id', uid); } catch (e) {} }
      if (r && r.data && r.data.user) { user = r.data.user; render(); }
      if (no) no.classList.remove('open');
    } catch (e) {
      if (m) { m.textContent = 'Não foi possível salvar: ' + (e.message || e); m.style.color = 'var(--rose,#D43A6E)'; }
    }
  }

  // ── Minha assinatura (tela no app) ─────────────────────────────────────────
  async function token() {
    const sess = await sb.auth.getSession();
    return sess && sess.data && sess.data.session && sess.data.session.access_token;
  }

  async function openSubModal() {
    const so = document.getElementById('lp-sub-overlay');
    const body = document.getElementById('lp-sub-body');
    if (!so || !body || !sb) return;
    body.innerHTML = '<p style="text-align:center;color:var(--mid,#6E5762);margin:18px 0">Carregando…</p>';
    so.classList.add('open');
    try {
      const r = await fetch('/api/subscription', { method: 'POST', headers: { Authorization: 'Bearer ' + (await token()) } });
      renderSub(await r.json());
    } catch (e) {
      body.innerHTML = '<p style="text-align:center;color:var(--rose,#D43A6E)">Erro ao carregar: ' + e.message + '</p>';
    }
  }

  function subRow(k, v) {
    return '<div class="lp-sub-row"><span class="lp-sub-k">' + k + '</span><span class="lp-sub-v">' + v + '</span></div>';
  }
  function fmtDate(ts) { try { return new Date(ts * 1000).toLocaleDateString('pt-BR'); } catch (e) { return '—'; } }
  function planLabel(s) {
    if (s.amount == null) return s.nickname || '—';
    let v;
    try { v = (s.amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: (s.currency || 'brl').toUpperCase() }); }
    catch (e) { v = 'R$ ' + (s.amount / 100).toFixed(2); }
    let per = '';
    if (s.interval === 'month') per = s.intervalCount > 1 ? ('/' + s.intervalCount + ' meses') : '/mês';
    else if (s.interval === 'year') per = '/ano';
    else if (s.interval) per = '/' + s.interval;
    return v + per + (s.nickname ? (' · ' + s.nickname) : '');
  }
  function statusLabel(st, cancel) {
    const map = { active: 'Ativa', trialing: 'Em teste', past_due: 'Pagamento atrasado', canceled: 'Cancelada', unpaid: 'Não paga', incomplete: 'Incompleta', incomplete_expired: 'Expirada' };
    let base = map[st] || st || '—';
    if (cancel && st === 'active') base = 'Ativa (cancela no fim do período)';
    return base;
  }

  function renderSub(d) {
    const body = document.getElementById('lp-sub-body');
    if (!body) return;
    if (d && d.error) {
      body.innerHTML = '<p style="text-align:center;color:var(--rose,#D43A6E);margin:14px 0">' + d.error + '</p>';
      return;
    }
    const rows = [];
    rows.push(subRow('Nome', d.name || '—'));
    rows.push(subRow('E-mail', d.email || '—'));
    if (!d.hasCustomer || !d.subscription) {
      body.innerHTML = '<div class="lp-sub-rows">' + rows.join('') + '</div>'
        + '<p style="font-size:13px;color:var(--mid,#6E5762);line-height:1.5;margin:16px 0 0">Não encontramos uma assinatura ativa ligada a este e-mail. Se você assinou com outro e-mail, entre com ele.</p>';
      return;
    }
    const s = d.subscription;
    rows.push(subRow('Plano', planLabel(s)));
    rows.push(subRow('Status', statusLabel(s.status, s.cancelAtPeriodEnd)));
    if (s.currentPeriodEnd) rows.push(subRow(s.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima cobrança', fmtDate(s.currentPeriodEnd)));
    if (d.card) rows.push(subRow('Cartão', (d.card.brand || 'cartão') + ' •••• ' + d.card.last4));
    body.innerHTML = '<div class="lp-sub-rows">' + rows.join('') + '</div>'
      + '<button class="lp-auth-primary" id="lp-sub-portal" style="margin-top:18px">Gerenciar meios de pagamento</button>'
      + '<p style="font-size:11.5px;color:var(--dim,#A2909B);text-align:center;margin:10px 0 0">Trocar cartão e cancelar são feitos com segurança no ambiente da Stripe.</p>';
    const pb = document.getElementById('lp-sub-portal');
    if (pb) pb.onclick = openPortal;
  }

  async function openPortal() {
    if (!sb) return;
    try {
      const r = await fetch('/api/portal', { method: 'POST', headers: { Authorization: 'Bearer ' + (await token()) } });
      const d = await r.json();
      if (d.url) { window.location.href = d.url; }
      else if (d.error === 'no_customer') { alert('Não encontramos um pagamento ligado ao seu e-mail. Se você assinou com outro e-mail, entre com ele.'); }
      else { alert('Não foi possível abrir os meios de pagamento: ' + (d.error || 'erro')); }
    } catch (e) { alert('Erro ao abrir os meios de pagamento: ' + e.message); }
  }

  window.liplopAuth = {
    init: init, openLogin: openLogin, signOut: signOut,
    getUser: function () { return user; }, client: function () { return sb; }
  };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
