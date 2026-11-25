// Login do conector remoto: o membro confirma a senha aqui; a página cria uma sessão nova no Supabase do portal e
// entrega ao servidor do agente, que devolve o código ao app (Claude, ChatGPT…). A senha não sai desta página.
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  function show(id) { ['carregando', 'invalido', 'formulario', 'pronto'].forEach(function (s) { el(s).hidden = s !== id; }); }
  function fail(msg) { el('erro').textContent = msg; el('erro').hidden = false; }

  var pedido = new URLSearchParams(location.hash.slice(1)).get('pedido');
  history.replaceState(null, '', location.pathname);
  if (!pedido) { show('invalido'); return; }

  var info = null;
  fetch('/conectar/pedido?pedido=' + encodeURIComponent(pedido))
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.erro || 'Pedido inválido.'); return j; }); })
    .then(function (j) {
      info = j;
      el('app').textContent = j.app;
      el('destino').textContent = j.destino;
      show('formulario');
      el('email').focus();
    })
    .catch(function (e) { el('invalidoMsg').textContent = e.message; show('invalido'); });

  var busy = false;
  el('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy || !info) return;
    el('erro').hidden = true;
    var email = el('email').value.trim();
    var senha = el('senha').value;
    if (!email || !senha) { fail('Preencha e-mail e senha.'); return; }
    busy = true; el('botao').disabled = true; el('botao').textContent = 'Conectando…';
    fetch(info.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: info.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, password: senha })
    })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.refresh_token) throw new Error(r.status === 400 ? 'E-mail ou senha inválidos.' : 'Não foi possível entrar agora.'); return j; }); })
      .then(function (s) {
        // Fase 0: marca esta sessão como "do agente" no portal. A ponte /api/whatsapp aplica a política
        // da pessoa aos envios dela e registra como via agente.
        return fetch(info.supabaseUrl + '/rest/v1/rpc/register_agent_session', {
          method: 'POST',
          headers: { apikey: info.anonKey, authorization: 'Bearer ' + s.access_token, 'content-type': 'application/json' },
          body: JSON.stringify({ p_app: String(info.app || 'conector').slice(0, 60) })
        }).then(function (r) { if (!r.ok) throw new Error('Não foi possível registrar a conexão no portal.'); return s; });
      })
      .then(function (s) {
        return fetch('/conectar/aprovar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pedido: pedido, refresh_token: s.refresh_token }) });
      })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.redirect) throw new Error(j.erro || 'Não foi possível concluir.'); return j; }); })
      .then(function (j) { show('pronto'); location.replace(j.redirect); })
      .catch(function (e) {
        fail(e.message || 'Não foi possível conectar.');
        busy = false; el('botao').disabled = false; el('botao').textContent = 'Conectar';
      });
  });
})();
