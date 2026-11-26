// ---------- utilidades ----------
const $ = (sel) => document.querySelector(sel);

// Nome de cada espécie (código -> nome), preenchido com GET /api/especies ao abrir a página
const ROTULO_ESPECIE = {};
const ROTULO_TIPO = { consulta: "🩺 Consulta", vacina: "💉 Vacinação" };
const ROTULO_STATUS = { aguardando: "Aguardando", concluido: "Concluído" };

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// '2021-03-15' -> '15/03/2021'
const formatarData = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
// '2026-11-25 14:03:00' -> '25/11/2026 14:03'
const formatarDataHora = (s) => (s ? `${formatarData(s)} ${s.slice(11, 16)}` : "—");
// mês 3, ano 2021 -> '03/2021'; só o ano -> '2021'
const formatarNascimento = (mes, ano) =>
  !ano ? "—" : mes ? `${String(mes).padStart(2, "0")}/${ano}` : String(ano);
const formatarPeso = (kg) => (kg == null ? "—" : `${kg.toLocaleString("pt-BR")} kg`);

// ---------- sessão ----------
const CHAVE_TOKEN = "clinicaPetToken";
let usuario = null;

function lerToken() {
  try { return localStorage.getItem(CHAVE_TOKEN) || ""; } catch { return ""; }
}
function guardarToken(t) {
  try { t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN); } catch { /* sem storage */ }
}
const ehVet = () => usuario?.papel === "veterinario";

async function api(metodo, url, corpo) {
  const headers = {};
  if (corpo) headers["Content-Type"] = "application/json";
  const token = lerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  const dados = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (resp.status === 401 && !url.startsWith("/api/auth/login")) {
    sair(false);
    throw Object.assign(new Error(dados?.erro || "Faça login."), { status: 401, dados });
  }
  if (!resp.ok) throw Object.assign(new Error(dados?.erro || "Erro"), { status: resp.status, dados });
  return dados;
}

let timerAviso;
function avisar(msg, erro = false) {
  const el = $("#aviso");
  el.textContent = msg;
  el.className = erro ? "aviso erro" : "aviso";
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.hidden = true), 3500);
}

function limparErros(form) {
  form.querySelectorAll(".msg-campo").forEach((e) => e.remove());
  form.querySelectorAll(".invalido").forEach((e) => e.classList.remove("invalido"));
  form.querySelector(".erro-geral").hidden = true;
}

function mostrarErros(form, err) {
  const campos = err.dados?.campos || {};
  let algumNoForm = false;
  for (const [nome, msg] of Object.entries(campos)) {
    const input = form.elements[nome];
    if (!input || input.closest("[hidden]")) continue;
    algumNoForm = true;
    input.classList.add("invalido");
    const p = document.createElement("span");
    p.className = "msg-campo";
    p.textContent = msg;
    input.closest("label").append(p);
  }
  if (!algumNoForm) {
    const geral = form.querySelector(".erro-geral");
    geral.textContent = Object.values(campos)[0] || err.message;
    geral.hidden = false;
  }
}

const dadosDoForm = (form) => Object.fromEntries(new FormData(form).entries());

// Sintomas: obrigatório só quando é consulta
function ligarCampoSintomas(form) {
  const atualizar = () => {
    const consulta = form.elements.tipo.value === "consulta";
    const label = form.querySelector(".campo-sintomas");
    label.firstChild.textContent = consulta ? "Sintomas* " : "Observação (opcional) ";
    form.elements.sintomas.placeholder = consulta
      ? "Ex.: está sem comer há 2 dias, vomitou ontem…"
      : "Ex.: vacina V10 / antirrábica";
  };
  form.elements.tipo.addEventListener("change", atualizar);
  atualizar();
  return atualizar;
}
const atualizarSintomasPet = ligarCampoSintomas($("#form-pet"));
const atualizarSintomasAtend = ligarCampoSintomas($("#form-atendimento"));

// ---------- raça: autocompletar + "não sei" ----------
// Compara sem acento e sem maiúsculas: "pastor alemao" encontra "Pastor Alemão".
const normalizar = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const campoRaca = $("#form-pet").elements.raca;
const listaRaca = $("#sugestoes-raca");
let sugestoes = [];
let destacada = -1;

function racasDaEspecie() {
  const especie = $("#form-pet").elements.especie.value;
  return especie ? RACAS[especie] || [] : Object.values(RACAS).flat();
}

function mostrarSugestoes() {
  const busca = normalizar(campoRaca.value);
  const todas = racasDaEspecie();
  // primeiro as que começam com o que foi digitado, depois as que contêm
  const comeca = [], contem = [];
  for (const r of todas) {
    const n = normalizar(r);
    if (!busca || n.startsWith(busca) || n.split(/[\s(-]+/).some((p) => p.startsWith(busca))) comeca.push(r);
    else if (n.includes(busca)) contem.push(r);
  }
  sugestoes = [...comeca, ...contem].slice(0, 8);
  // não mostra a lista se o que foi digitado já é exatamente uma raça
  if (sugestoes.length === 1 && normalizar(sugestoes[0]) === busca) sugestoes = [];
  destacada = -1;
  listaRaca.innerHTML = sugestoes.map((r, i) =>
    `<li role="option" id="sug-raca-${i}" data-indice="${i}">${realcar(r, busca)}</li>`).join("");
  const aberta = sugestoes.length > 0 && !campoRaca.disabled;
  listaRaca.hidden = !aberta;
  campoRaca.setAttribute("aria-expanded", String(aberta));
}

// Deixa em negrito o pedaço que bate com a busca
function realcar(raca, busca) {
  if (!busca) return esc(raca);
  const i = normalizar(raca).indexOf(busca);
  if (i < 0) return esc(raca);
  return esc(raca.slice(0, i)) + "<b>" + esc(raca.slice(i, i + busca.length)) + "</b>" + esc(raca.slice(i + busca.length));
}

function fecharSugestoes() {
  listaRaca.hidden = true;
  campoRaca.setAttribute("aria-expanded", "false");
  destacada = -1;
}

function escolherRaca(i) {
  campoRaca.value = sugestoes[i];
  fecharSugestoes();
}

function destacar(i) {
  destacada = (i + sugestoes.length) % sugestoes.length;
  listaRaca.querySelectorAll("li").forEach((li, j) => li.classList.toggle("ativa", j === destacada));
  campoRaca.setAttribute("aria-activedescendant", `sug-raca-${destacada}`);
  listaRaca.children[destacada]?.scrollIntoView({ block: "nearest" });
}

campoRaca.addEventListener("input", mostrarSugestoes);
campoRaca.addEventListener("focus", mostrarSugestoes);
campoRaca.addEventListener("blur", () => setTimeout(fecharSugestoes, 100));
campoRaca.addEventListener("keydown", (ev) => {
  if (listaRaca.hidden) {
    if (ev.key === "ArrowDown") { mostrarSugestoes(); ev.preventDefault(); }
    return;
  }
  if (ev.key === "ArrowDown") { destacar(destacada + 1); ev.preventDefault(); }
  else if (ev.key === "ArrowUp") { destacar(destacada - 1); ev.preventDefault(); }
  else if (ev.key === "Enter" && destacada >= 0) { escolherRaca(destacada); ev.preventDefault(); }
  else if (ev.key === "Escape") { fecharSugestoes(); ev.preventDefault(); ev.stopPropagation(); }
  else if (ev.key === "Tab" && destacada >= 0) escolherRaca(destacada);
});
// mousedown (e não click) para escolher antes do campo perder o foco
listaRaca.addEventListener("mousedown", (ev) => {
  const li = ev.target.closest("li");
  if (!li) return;
  ev.preventDefault();
  escolherRaca(Number(li.dataset.indice));
});
// Trocou a espécie: as sugestões mudam
$("#form-pet").elements.especie.addEventListener("change", () => {
  if (document.activeElement === campoRaca) mostrarSugestoes();
});

// "Não sei a raça": limpa e trava o campo; a raça vai vazia (NULL no banco)
function marcarNaoSeiRaca(marcado) {
  $("#raca-nao-sei").checked = marcado;
  campoRaca.disabled = marcado;
  if (marcado) { campoRaca.value = ""; fecharSugestoes(); }
  campoRaca.placeholder = marcado ? "Raça não informada" : "Comece a digitar…";
}
$("#raca-nao-sei").addEventListener("change", (ev) => {
  marcarNaoSeiRaca(ev.target.checked);
  if (!ev.target.checked) campoRaca.focus();
});

// ---------- estado ----------
let tutores = [];
let pets = [];

// Preenche um <select> a partir de um recurso da API
// (equivalente ao opcoesDe: { recurso: "tutores", valor: "id", rotulo: "nome" })
function preencherSelect(select, itens, { valor, rotulo, vazio }) {
  const atual = select.value;
  select.innerHTML =
    (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : "") +
    itens.map((i) => `<option value="${esc(i[valor])}">${esc(i[rotulo])}</option>`).join("");
  if ([...select.options].some((o) => o.value === atual)) select.value = atual;
}

// Lista de espécies separada por grupo (Aves, Répteis...) com <optgroup>
function preencherEspecies(select, especies, vazio) {
  const grupos = new Map();
  for (const e of especies) {
    if (!grupos.has(e.grupo)) grupos.set(e.grupo, []);
    grupos.get(e.grupo).push(e);
  }
  select.innerHTML = `<option value="">${esc(vazio)}</option>` +
    [...grupos].map(([grupo, itens]) => `<optgroup label="${esc(grupo)}">` +
      itens.map((e) => `<option value="${esc(e.codigo)}">${esc(e.nome)}</option>`).join("") +
      "</optgroup>").join("");
}

async function carregarTutores() {
  if (!ehVet()) return;
  tutores = await api("GET", "/api/tutores");
  preencherSelect($("#filtro-tutor"), tutores, { valor: "id", rotulo: "nome", vazio: "Todos os tutores" });
  preencherSelect($("#form-pet").elements.tutor_id, tutores, { valor: "id", rotulo: "nome", vazio: "Selecione…" });
  renderizarTutores();
}

// ---------- pets ----------
async function carregarPets() {
  const qs = new URLSearchParams();
  if ($("#busca").value.trim()) qs.set("busca", $("#busca").value.trim());
  if ($("#filtro-especie").value) qs.set("especie", $("#filtro-especie").value);
  if (ehVet() && $("#filtro-tutor").value) qs.set("tutor_id", $("#filtro-tutor").value);
  pets = await api("GET", `/api/pets?${qs}`);

  $("#lista-pets").innerHTML = pets.map((p) => `
    <tr>
      <td><b>${esc(p.nome)}</b></td>
      <td><span class="selo">${esc(ROTULO_ESPECIE[p.especie] || p.especie)}</span></td>
      <td>${p.raca ? esc(p.raca) : '<span class="sub">Não sei</span>'}</td>
      <td>${formatarNascimento(p.mes_nascimento, p.ano_nascimento)}</td>
      <td>${esc(p.idade?.texto || "—")}</td>
      <td>${formatarPeso(p.peso_kg)}</td>
      <td class="so-vet">${esc(p.tutor_nome)}<span class="sub">${esc(p.tutor_telefone)}</span></td>
      <td class="acoes-linha">
        <button class="pequeno" data-atend-pet="${p.id}">${ehVet() ? "Atendimentos" : "Pedir atendimento"}</button>
        <button class="pequeno" data-editar-pet="${p.id}">Editar</button>
        <button class="pequeno perigo" data-excluir-pet="${p.id}" data-nome="${esc(p.nome)}">Excluir</button>
      </td>
    </tr>`).join("");
  $("#vazio-pets").textContent = ehVet() || qs.toString()
    ? "Nenhum pet encontrado."
    : "Você ainda não cadastrou nenhum pet. Clique em “+ Novo pet”.";
  $("#vazio-pets").hidden = pets.length > 0;
  if (ehVet()) carregarResumo();
}

async function carregarResumo() {
  const r = await api("GET", "/api/pets/resumo");
  const cards = [`<div class="card"><b>${r.total}</b><span>pets no total</span></div>`];
  for (const e of r.por_especie) {
    cards.push(`<div class="card"><b>${e.quantidade}</b><span>${esc(ROTULO_ESPECIE[e.especie] || e.especie)}` +
      `${e.peso_medio != null ? ` · média ${formatarPeso(e.peso_medio)}` : ""}</span></div>`);
  }
  $("#resumo").innerHTML = cards.join("");
}

async function abrirPet(id) {
  const form = $("#form-pet");
  form.reset();
  limparErros(form);
  form.dataset.id = id || "";
  $("#titulo-pet").textContent = id ? "Editar pet" : "Novo pet";
  $("#motivo-pet").hidden = Boolean(id); // o motivo só é pedido ao cadastrar
  form.elements.ano_nascimento.max = new Date().getFullYear();
  if (id) {
    const p = await api("GET", `/api/pets/${id}`);
    for (const campo of ["nome", "especie", "raca", "mes_nascimento", "ano_nascimento", "peso_kg", "tutor_id"])
      form.elements[campo].value = p[campo] ?? "";
  }
  marcarNaoSeiRaca(Boolean(id) && !form.elements.raca.value);
  atualizarSintomasPet();
  $("#dlg-pet").showModal();
}

$("#form-pet").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  const id = form.dataset.id;
  const dados = dadosDoForm(form);
  if (id) { delete dados.tipo; delete dados.sintomas; }
  try {
    await api(id ? "PUT" : "POST", id ? `/api/pets/${id}` : "/api/pets", dados);
    $("#dlg-pet").close();
    avisar(id ? "Pet atualizado!" : (dados.tipo ? "Pet cadastrado e pedido de atendimento enviado!" : "Pet cadastrado!"));
    await Promise.all([carregarPets(), carregarTutores(), carregarAtendimentos()]);
  } catch (err) {
    mostrarErros(form, err);
  }
});

// ---------- atendimentos ----------
async function carregarAtendimentos() {
  const qs = new URLSearchParams();
  if ($("#filtro-status").value) qs.set("status", $("#filtro-status").value);
  const lista = await api("GET", `/api/atendimentos?${qs}`);
  const vet = ehVet();
  $("#lista-atendimentos").innerHTML = lista.map((a) => `
    <article class="atend ${a.status}">
      <header>
        <b>${esc(a.pet_nome)}</b>
        <span class="selo">${esc(ROTULO_TIPO[a.tipo] || a.tipo)}</span>
        <span class="status ${a.status}">${esc(ROTULO_STATUS[a.status] || a.status)}</span>
        <span class="sub data">${formatarDataHora(a.criado_em)}</span>
      </header>
      ${vet ? `<p class="sub">Tutor: ${esc(a.tutor_nome)} · ${esc(a.tutor_telefone)}</p>` : ""}
      ${a.sintomas ? `<p><span class="rotulo">${a.tipo === "consulta" ? "Sintomas" : "Observação"}:</span> ${esc(a.sintomas)}</p>` : ""}
      ${a.observacoes ? `<p class="obs"><span class="rotulo">Veterinário:</span> ${esc(a.observacoes)}</p>` : ""}
      ${vet ? `<div class="acoes-linha"><button class="pequeno" data-concluir="${a.id}">Registrar atendimento</button></div>` : ""}
    </article>`).join("");
  $("#vazio-atendimentos").hidden = lista.length > 0;
  atendimentos = lista;
}
let atendimentos = [];

async function abrirPedido(petId) {
  if (!pets.length) await carregarPets();
  if (!pets.length) return avisar("Cadastre um pet primeiro.", true);
  const form = $("#form-atendimento");
  form.reset();
  limparErros(form);
  preencherSelect(form.elements.pet_id, pets, { valor: "id", rotulo: "nome", vazio: "Selecione…" });
  if (petId) form.elements.pet_id.value = petId;
  atualizarSintomasAtend();
  $("#dlg-atendimento").showModal();
}

$("#form-atendimento").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  try {
    await api("POST", "/api/atendimentos", dadosDoForm(form));
    $("#dlg-atendimento").close();
    avisar("Pedido enviado para a clínica!");
    $("#filtro-status").value = "aguardando";
    await carregarAtendimentos();
  } catch (err) {
    mostrarErros(form, err);
  }
});

function abrirConcluir(id) {
  const a = atendimentos.find((x) => String(x.id) === String(id));
  const form = $("#form-concluir");
  form.reset();
  limparErros(form);
  form.dataset.id = id;
  $("#titulo-concluir").textContent = `${ROTULO_TIPO[a.tipo] || a.tipo} · ${a.pet_nome}`;
  $("#resumo-concluir").textContent = a.sintomas ? `${a.tipo === "consulta" ? "Sintomas" : "Obs."}: ${a.sintomas}` : "";
  form.elements.status.value = a.status === "aguardando" ? "concluido" : a.status;
  form.elements.observacoes.value = a.observacoes || "";
  $("#dlg-concluir").showModal();
}

$("#form-concluir").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  try {
    await api("PATCH", `/api/atendimentos/${form.dataset.id}`, dadosDoForm(form));
    $("#dlg-concluir").close();
    avisar("Atendimento atualizado!");
    await carregarAtendimentos();
  } catch (err) {
    mostrarErros(form, err);
  }
});

// ---------- tutores ----------
function renderizarTutores() {
  $("#lista-tutores").innerHTML = tutores.map((t) => `
    <tr>
      <td><b>${esc(t.nome)}</b>${t.tem_conta ? ' <span class="selo">tem conta</span>' : ""}</td>
      <td>${esc(t.telefone)}</td>
      <td>${esc(t.email || "—")}</td>
      <td>${t.qtd_pets}</td>
      <td class="acoes-linha">
        <button class="pequeno" data-ver-pets="${t.id}">Ver pets</button>
        <button class="pequeno" data-editar-tutor="${t.id}">Editar</button>
        <button class="pequeno perigo" data-excluir-tutor="${t.id}" data-nome="${esc(t.nome)}">Excluir</button>
      </td>
    </tr>`).join("");
}

let tutorRapido = false; // true quando o tutor é criado a partir do formulário de pet

function abrirTutor(id, rapido = false) {
  const form = $("#form-tutor");
  form.reset();
  limparErros(form);
  form.dataset.id = id || "";
  tutorRapido = rapido;
  $("#titulo-tutor").textContent = id ? "Editar tutor" : "Novo tutor";
  if (id) {
    const t = tutores.find((x) => String(x.id) === String(id));
    form.elements.nome.value = t.nome;
    form.elements.telefone.value = t.telefone;
    form.elements.email.value = t.email || "";
  }
  $("#dlg-tutor").showModal();
}

$("#form-tutor").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  const id = form.dataset.id;
  try {
    const t = await api(id ? "PUT" : "POST", id ? `/api/tutores/${id}` : "/api/tutores", dadosDoForm(form));
    $("#dlg-tutor").close();
    avisar(id ? "Tutor atualizado!" : "Tutor cadastrado!");
    await Promise.all([carregarTutores(), carregarPets()]);
    if (tutorRapido) $("#form-pet").elements.tutor_id.value = t.id; // já seleciona o novo tutor
  } catch (err) {
    mostrarErros(form, err);
  }
});

// ---------- login / cadastro ----------
function trocarAuth(qual) {
  document.querySelectorAll(".auth-aba").forEach((b) => b.classList.toggle("ativa", b.dataset.auth === qual));
  $("#form-login").hidden = qual !== "login";
  $("#form-registro").hidden = qual !== "registro";
}

function atualizarTipoRegistro() {
  const vet = $("#form-registro").elements.papel.value === "veterinario";
  document.querySelectorAll(".reg-vet").forEach((e) => (e.hidden = !vet));
  document.querySelectorAll(".reg-cliente").forEach((e) => (e.hidden = vet));
}
$("#form-registro").addEventListener("change", (ev) => {
  if (ev.target.name === "papel") atualizarTipoRegistro();
});

async function entrou({ token, usuario: u }) {
  guardarToken(token);
  usuario = u;
  await mostrarApp();
}

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  try {
    await entrou(await api("POST", "/api/auth/login", dadosDoForm(form)));
    form.reset();
  } catch (err) {
    mostrarErros(form, err);
  }
});

$("#form-registro").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  limparErros(form);
  const dados = dadosDoForm(form);
  if (dados.papel === "veterinario") delete dados.telefone;
  else delete dados.codigo_clinica;
  try {
    await entrou(await api("POST", "/api/auth/registro", dados));
    form.reset();
    atualizarTipoRegistro();
    avisar(`Bem-vindo(a), ${usuario.nome}!`);
  } catch (err) {
    mostrarErros(form, err);
  }
});

function mostrarLogin() {
  document.body.dataset.papel = "";
  $("#tela-auth").hidden = false;
  trocarAuth("login");
}

async function mostrarApp() {
  document.body.dataset.papel = usuario.papel;
  $("#tela-auth").hidden = true;
  $("#quem").textContent = `${usuario.nome} · ${ehVet() ? "Veterinário(a)" : "Tutor(a)"}`;
  trocarAba("pets");
  // Filtros de outra sessão não valem para esta
  $("#busca").value = "";
  $("#filtro-especie").value = "";
  $("#filtro-tutor").value = "";
  $("#filtro-status").value = "aguardando";
  $("#lista-pets").innerHTML = "";
  $("#lista-atendimentos").innerHTML = "";
  await carregarTutores();
  await Promise.all([carregarPets(), carregarAtendimentos()]);
}

async function sair(avisarServidor = true) {
  if (avisarServidor && lerToken()) await api("POST", "/api/auth/logout").catch(() => {});
  guardarToken("");
  usuario = null;
  tutores = [];
  pets = [];
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  mostrarLogin();
}

// ---------- eventos ----------
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.fechar !== undefined) b.closest("dialog").close();
    else if (b.dataset.auth) trocarAuth(b.dataset.auth);
    else if (b.dataset.aba) trocarAba(b.dataset.aba);
    else if (b.id === "sair") await sair();
    else if (b.id === "novo-pet") await abrirPet();
    else if (b.id === "novo-atendimento") await abrirPedido();
    else if (b.id === "novo-tutor") abrirTutor();
    else if (b.id === "tutor-rapido") abrirTutor(null, true);
    else if (b.dataset.editarPet) await abrirPet(b.dataset.editarPet);
    else if (b.dataset.atendPet) {
      if (ehVet()) {
        $("#filtro-status").value = "";
        trocarAba("atendimentos");
        await carregarAtendimentos();
        const nome = pets.find((p) => String(p.id) === b.dataset.atendPet)?.nome;
        if (nome) avisar(`Atendimentos de todos os pets. Procure por ${nome}.`);
      } else await abrirPedido(b.dataset.atendPet);
    }
    else if (b.dataset.concluir) abrirConcluir(b.dataset.concluir);
    else if (b.dataset.editarTutor) abrirTutor(b.dataset.editarTutor);
    else if (b.dataset.verPets) {
      $("#filtro-tutor").value = b.dataset.verPets;
      trocarAba("pets");
      await carregarPets();
    } else if (b.dataset.excluirPet) {
      if (!confirm(`Excluir o pet ${b.dataset.nome}? Os pedidos de atendimento dele também serão apagados.`)) return;
      await api("DELETE", `/api/pets/${b.dataset.excluirPet}`);
      avisar("Pet excluído.");
      await Promise.all([carregarPets(), carregarTutores(), carregarAtendimentos()]);
    } else if (b.dataset.excluirTutor) {
      if (!confirm(`Excluir o tutor ${b.dataset.nome}?`)) return;
      await api("DELETE", `/api/tutores/${b.dataset.excluirTutor}`);
      avisar("Tutor excluído.");
      await carregarTutores();
    }
  } catch (err) {
    if (err.status !== 401) avisar(err.message, true);
  }
});

function trocarAba(nome) {
  document.querySelectorAll(".aba[data-aba]").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === nome));
  $("#aba-pets").hidden = nome !== "pets";
  $("#aba-atendimentos").hidden = nome !== "atendimentos";
  $("#aba-tutores").hidden = nome !== "tutores";
}

let timerBusca;
$("#busca").addEventListener("input", () => {
  clearTimeout(timerBusca);
  timerBusca = setTimeout(carregarPets, 250);
});
$("#filtro-especie").addEventListener("change", carregarPets);
$("#filtro-tutor").addEventListener("change", carregarPets);
$("#filtro-status").addEventListener("change", carregarAtendimentos);

// ---------- início ----------
(async function iniciar() {
  try {
    const especies = await api("GET", "/api/especies");
    for (const e of especies) ROTULO_ESPECIE[e.codigo] = e.nome;
    preencherEspecies($("#filtro-especie"), especies, "Todas as espécies");
    preencherEspecies($("#form-pet").elements.especie, especies, "Selecione…");
  } catch {
    avisar("Não foi possível falar com a API. O servidor está rodando?", true);
    return;
  }
  if (!lerToken()) return mostrarLogin();
  try {
    usuario = await api("GET", "/api/auth/eu");
    await mostrarApp();
  } catch (err) {
    if (err.status !== 401) avisar(err.message, true);
  }
})();
