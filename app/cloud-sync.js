/* Liplop · cloud-sync (Etapa 2): escrita dupla + migração do cache.
 *
 * Quando logado, espelha no Supabase os dados que hoje vivem no localStorage
 * (perfil, kanban, marca), SEM parar de gravar no cache. Só faz UPSERT, nunca
 * apaga linha no banco. O cache continua a fonte da verdade nesta etapa.
 *
 * Migração: no 1º login (profiles.migrated_at = null), empurra todo o cache
 * atual pra conta e marca migrated_at. Idempotente.
 *
 * Inerte se não houver Supabase (window.liplopSupabase): o app segue só cache.
 */
(function () {
  'use strict';

  // localStorage key -> domínio
  var KEY_DOMAIN = {
    'liplop-profile': 'profile',
    'liplop-profile-objectives-v1': 'profile',
    'liplop-profile-roles-v1': 'profile',
    'liplop-job-search-v1': 'profile',
    'liplop-onboarded-at': 'profile',
    'job-crm-opps-v2': 'opps',
    'liplop-marca-project-v1': 'marca',
    'liplop-marca-tone-v1': 'marca',
    'liplop-marca-calendar-v1': 'marca',
    'liplop-marca-message-v1': 'marca',
    'liplop-marca-cal-start-v1': 'marca',
    'liplop-marca-estrategia-v1': 'marca',
    'liplop-docs-v1': 'docs'
  };

  var sb = null, user = null, timer = null, dirty = {};

  // --- escrita dupla: detecta mudanças interceptando o setItem ---
  var origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) {
    origSet(k, v);                                  // sempre grava no cache primeiro
    if (user && sb && KEY_DOMAIN[k]) { dirty[KEY_DOMAIN[k]] = true; schedule(); }
  };
  function schedule() { clearTimeout(timer); timer = setTimeout(flush, 1500); }

  // --- leitura do cache ---
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsJSON(k, def) { try { return JSON.parse(localStorage.getItem(k) || def); } catch (e) { try { return JSON.parse(def); } catch (_) { return null; } } }

  function profileRow() {
    var row = {
      id: user.id,
      profile_text: lsGet('liplop-profile'),
      objectives: lsGet('liplop-profile-objectives-v1'),
      roles: lsGet('liplop-profile-roles-v1'),
      job_search: lsJSON('liplop-job-search-v1', '{}')
    };
    // só manda onboarded_at quando existe, pra nunca apagar a data já gravada no banco
    var ob = lsGet('liplop-onboarded-at');
    if (ob) row.onboarded_at = ob;
    return row;
  }
  function oppRows() {
    var opps = lsJSON('job-crm-opps-v2', '[]');
    if (!Array.isArray(opps)) return [];
    return opps.map(function (o, i) {
      return {
        user_id: user.id,
        legacy_id: (o.id != null ? o.id : i),
        company: o.company || null, role: o.role || null, status: o.status || null,
        stage: o.stage || null, fit: (o.fit != null ? o.fit : null), link: o.link || null,
        jd_text: o.jd_text || null, contacts: (o.contacts || []), next: o.next || null,
        notes: o.notes || null, organic: !!o.organic, referred: !!o.referred,
        analysis: o.analysis || null, position: i
      };
    });
  }
  function marcaRow() {
    return {
      user_id: user.id,
      project: lsJSON('liplop-marca-project-v1', 'null'),
      tone: lsGet('liplop-marca-tone-v1'),
      calendar: lsJSON('liplop-marca-calendar-v1', 'null'),
      message: lsGet('liplop-marca-message-v1'),
      cal_start: lsGet('liplop-marca-cal-start-v1'),
      estrategia: lsGet('liplop-marca-estrategia-v1')
    };
  }

  function pushProfile() { return sb.from('profiles').upsert(profileRow(), { onConflict: 'id' }); }
  function pushMarca() { return sb.from('marca').upsert(marcaRow(), { onConflict: 'user_id' }); }
  function pushOpps() {
    var rows = oppRows();
    if (!rows.length) return Promise.resolve();
    return sb.from('opportunities').upsert(rows, { onConflict: 'user_id,legacy_id' });
  }
  function docRows() {
    var docs = lsJSON('liplop-docs-v1', '[]');
    if (!Array.isArray(docs)) return [];
    return docs.filter(function (d) { return d && d.key; }).map(function (d) {
      return {
        user_id: user.id, legacy_key: d.key,
        title: (d.company ? (d.role + ' · ' + d.company) : d.role) || 'Currículo',
        content: d.content || ''
      };
    });
  }
  function pushDocs() {
    var rows = docRows();
    if (!rows.length) return Promise.resolve();
    return sb.from('resumes').upsert(rows, { onConflict: 'user_id,legacy_key' });
  }

  async function flush() {
    if (!user || !sb) return;
    var doms = Object.keys(dirty); dirty = {};
    for (var i = 0; i < doms.length; i++) {
      try {
        if (doms[i] === 'profile') await pushProfile();
        else if (doms[i] === 'opps') await pushOpps();
        else if (doms[i] === 'marca') await pushMarca();
        else if (doms[i] === 'docs') await pushDocs();
      } catch (e) { console.warn('[liplop-sync]', doms[i], e && e.message || e); }
    }
  }

  // Limpa os dados locais (perfil, kanban, marca, docs) do dominio sincronizado.
  function clearLocalDomains() {
    try { Object.keys(KEY_DOMAIN).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }

  // --- no login: 1ª vez migra o cache; depois passa a LER do banco ---
  async function onLogin() {
    if (!user || !sb) return;

    // Troca de conta no MESMO navegador: se o cache pertence a OUTRO usuario, limpa antes
    // de migrar/hidratar (senao o novo usuario herda perfil/vagas alheios e o onboarding e
    // pulado). Recarrega pra reiniciar limpo. So dispara em troca real de conta.
    var cacheOwner = null;
    try { cacheOwner = localStorage.getItem('liplop-cache-uid'); } catch (e) {}
    if (cacheOwner && cacheOwner !== user.id) {
      clearLocalDomains();
      try { localStorage.setItem('liplop-cache-uid', user.id); } catch (e) {}
      console.info('[liplop-sync] troca de conta detectada: cache local limpo');
      location.reload();
      return;
    }
    try { localStorage.setItem('liplop-cache-uid', user.id); } catch (e) {}

    try {
      var sel = await sb.from('profiles').select('migrated_at').eq('id', user.id).maybeSingle();
      if (sel.data && sel.data.migrated_at) {
        await hydrateFromCloud();                  // já migrou: a fonte da verdade é o banco
      } else {
        await pushProfile();                       // 1º login: empurra o cache pra conta
        await pushMarca();
        await pushOpps();
        await pushDocs();
        await sb.from('profiles').update({ migrated_at: new Date().toISOString() }).eq('id', user.id);
        console.info('[liplop-sync] cache migrado para a conta');
      }
    } catch (e) { console.warn('[liplop-sync] onLogin', e && e.message || e); }
  }

  // --- Etapa 3: puxa do banco e abastece o cache (com fallback: se falhar, mantém o cache) ---
  async function hydrateFromCloud() {
    if (!user || !sb) return;
    try {
      var p = await sb.from('profiles').select('profile_text,objectives,roles,job_search').eq('id', user.id).maybeSingle();
      if (p && p.data) {
        if (p.data.profile_text != null) origSet('liplop-profile', p.data.profile_text);
        if (p.data.objectives != null) origSet('liplop-profile-objectives-v1', p.data.objectives);
        if (p.data.roles != null) origSet('liplop-profile-roles-v1', p.data.roles);
        if (p.data.job_search != null) origSet('liplop-job-search-v1', JSON.stringify(p.data.job_search));
      }
      var o = await sb.from('opportunities').select('*').eq('user_id', user.id).order('position', { ascending: true });
      if (o && !o.error && Array.isArray(o.data)) {       // espelha o banco (inclusive vazio)
        var arr = o.data.map(function (r) {
          return {
            id: r.legacy_id, company: r.company, role: r.role, status: r.status, stage: r.stage,
            fit: r.fit, link: r.link, jd_text: r.jd_text, contacts: r.contacts || [], next: r.next,
            notes: r.notes, organic: r.organic || undefined, referred: r.referred || undefined, analysis: r.analysis
          };
        });
        // Rede de segurança: NUNCA sobrescreve um cache que tem MAIS vagas que o banco.
        // Evita perda de dado se a pessoa logar num navegador cujo cache local é mais
        // completo que a conta (ex.: conta que já migrou por outro navegador com menos dados).
        var localOppsCount = 0;
        try { var _lc = JSON.parse(lsGet('job-crm-opps-v2') || '[]'); localOppsCount = Array.isArray(_lc) ? _lc.length : 0; } catch (e) {}
        if (arr.length >= localOppsCount) {
          origSet('job-crm-opps-v2', JSON.stringify(arr));
        } else {
          console.warn('[liplop-sync] hydrate: banco tem ' + arr.length + ' vaga(s), cache tem ' + localOppsCount + '; mantendo o cache pra nao perder dado');
        }
      }
      var m = await sb.from('marca').select('*').eq('user_id', user.id).maybeSingle();
      if (m && m.data) {
        if (m.data.project != null) origSet('liplop-marca-project-v1', JSON.stringify(m.data.project));
        if (m.data.tone != null) origSet('liplop-marca-tone-v1', m.data.tone);
        if (m.data.calendar != null) origSet('liplop-marca-calendar-v1', JSON.stringify(m.data.calendar));
        if (m.data.message != null) origSet('liplop-marca-message-v1', m.data.message);
        if (m.data.cal_start != null) origSet('liplop-marca-cal-start-v1', m.data.cal_start);
        if (m.data.estrategia != null) origSet('liplop-marca-estrategia-v1', m.data.estrategia);
      }
      var rs = await sb.from('resumes').select('*').eq('user_id', user.id);
      if (rs && !rs.error && Array.isArray(rs.data)) {       // documentos (curriculos)
        var docs = rs.data.filter(function (r) { return r.legacy_key; }).map(function (r) {
          return { id: 'd_' + r.id, key: r.legacy_key, role: r.title || 'Currículo', company: '', content: r.content || '', createdAt: r.created_at, updatedAt: r.updated_at };
        });
        origSet('liplop-docs-v1', JSON.stringify(docs));
      }
      if (window.liplopReloadFromCache) window.liplopReloadFromCache();
      console.info('[liplop-sync] dados carregados do banco');
    } catch (e) { console.warn('[liplop-sync] hydrate', e && e.message || e); }
  }

  // --- exclusão pontual de vaga (chamada pelo app ao excluir um card) ---
  async function deleteOpp(legacyId) {
    if (!user || !sb || legacyId == null) return;
    try {
      await sb.from('opportunities').delete().eq('user_id', user.id).eq('legacy_id', legacyId);
    } catch (e) { console.warn('[liplop-sync] delete opp', e && e.message || e); }
  }
  async function deleteDocByKey(key) {
    if (!user || !sb || !key) return;
    try {
      await sb.from('resumes').delete().eq('user_id', user.id).eq('legacy_key', key);
    } catch (e) { console.warn('[liplop-sync] delete doc', e && e.message || e); }
  }
  window.liplopCloud = { deleteOpp: deleteOpp, deleteDoc: deleteDocByKey };

  // --- espera o cliente Supabase (auth.js) e assina mudanças de sessão ---
  var tries = 0;
  var wait = setInterval(function () {
    tries++;
    if (window.liplopSupabase) {
      clearInterval(wait);
      sb = window.liplopSupabase;
      sb.auth.getSession().then(function (r) {
        user = (r.data.session && r.data.session.user) || null;
        if (user) onLogin();
      });
      sb.auth.onAuthStateChange(function (_e, session) {
        var was = user;
        user = (session && session.user) || null;
        if (user && !was) onLogin();                         // acabou de logar
      });
    } else if (tries > 50) { clearInterval(wait); }          // ~10s: desiste, app segue só cache
  }, 200);
})();
