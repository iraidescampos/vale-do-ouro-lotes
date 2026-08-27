import { createMapZoom } from "./map-zoom.js";
import { bindCurrencyInput } from "./currency-input.js";

const STATUS = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  indisponivel: "Indisponível",
  sem_cadastro: "Cadastro pendente",
};
const RESERVATION_STATUS = { ativa: "Ativa", convertida: "Convertida em venda", cancelada: "Cancelada", expirada: "Expirada" };
const ADMIN_ACTION = { reserva_criada: "Reserva criada", reserva_cancelada: "Reserva cancelada", lote_atualizado: "Lote atualizado", corretor_criado: "Corretor criado" };

const PLAN_FACTORS = { 12: 1, 24: 1.07, 36: 1.11, 48: 1.15, 60: 1.19, 120: 1.4, 150: 1.51, 180: 1.63, 210: 1.75, 240: 1.88 };
const BLOCKS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
const config = window.VALE_CONFIG ?? {};

const state = { lots: [], mapGeometry: null, lotMeasurements: null, selectedId: null, query: "", block: "all", status: "all", session: null, mapMode: "aerial", isAdmin: false, adminReservations: [], adminHistory: [], adminBrokers: [], adminBrokersError: "", adminTab: "lots" };
let supabase;
let suppressMapClick = false;

const aerialZoom = createMapZoom({
  onDragEnd: () => {
    suppressMapClick = true;
    window.setTimeout(() => { suppressMapClick = false; }, 400);
  },
});

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const elements = {
  hero: document.querySelector(".hero"),
  pageMapa: document.querySelector("#mapa"),
  pageLotes: document.querySelector("#lotes"),
  map: document.querySelector("#commercialMap"),
  panel: document.querySelector("#lotPanel"),
  table: document.querySelector("#lotsTableBody"),
  summary: document.querySelector("#summaryCards"),
  visibleCount: document.querySelector("#visibleCount"),
  search: document.querySelector("#searchInput"),
  block: document.querySelector("#blockFilter"),
  status: document.querySelector("#statusFilter"),
  loginForm: document.querySelector("#loginForm"),
  loginError: document.querySelector("#loginError"),
  sessionEmail: document.querySelector("#sessionEmail"),
  connectionBadge: document.querySelector("#connectionBadge"),
  logoutButton: document.querySelector("#logoutButton"),
  reservationDialog: document.querySelector("#reservationDialog"),
  reservationForm: document.querySelector("#reservationForm"),
  confirmReservationButton: document.querySelector("#confirmReservationButton"),
  technicalDialog: document.querySelector("#technicalMapDialog"),
  toast: document.querySelector("#toast"),
  printReport: document.querySelector("#printReport"),
  adminButton: document.querySelector("#openAdminPanel"),
  adminSection: document.querySelector("#administracao"),
  adminSummary: document.querySelector("#adminSummary"),
  adminLotsTable: document.querySelector("#adminLotsTableBody"),
  adminReservationsTable: document.querySelector("#adminReservationsTableBody"),
  adminBrokersTable: document.querySelector("#adminBrokersTableBody"),
  brokerCount: document.querySelector("#brokerCount"),
  brokerForm: document.querySelector("#brokerForm"),
  brokerError: document.querySelector("#brokerError"),
  createBrokerButton: document.querySelector("#createBrokerButton"),
  showBrokerPassword: document.querySelector("#showBrokerPassword"),
  adminHistoryTable: document.querySelector("#adminHistoryTableBody"),
  adminLotSearch: document.querySelector("#adminLotSearch"),
  adminLotStatus: document.querySelector("#adminLotStatus"),
  adminLotDialog: document.querySelector("#adminLotDialog"),
  adminLotForm: document.querySelector("#adminLotForm"),
  saveAdminLotButton: document.querySelector("#saveAdminLot"),
};

const adminLotMoney = {
  pricePerM2: bindCurrencyInput(elements.adminLotForm.elements.pricePerM2),
  downPayment: bindCurrencyInput(elements.adminLotForm.elements.downPayment),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function xmlEscape(value) {
  return escapeHtml(value).replaceAll("&#039;", "&apos;");
}

function decimal(value) {
  return value == null ? null : Number(value);
}

function transformLot(row) {
  const totalPrice = decimal(row.total_price);
  const defaultDownPayment = decimal(row.default_down_payment);
  const financedAmount = totalPrice == null ? null : Math.max(0, totalPrice - (defaultDownPayment ?? 0));
  const installments = Object.fromEntries(Object.entries(PLAN_FACTORS).map(([term, factor]) => [term, financedAmount == null ? null : financedAmount / Number(term) * factor]));
  return {
    id: row.id,
    block: row.block,
    lot: Number(row.lot),
    areaM2: decimal(row.area_m2),
    pricePerM2: decimal(row.price_per_m2),
    totalPrice,
    defaultDownPayment,
    financedAmount,
    installments,
    status: row.status,
    buyerName: row.buyer_name ?? null,
  };
}

function filteredLots() {
  const query = state.query.trim().toUpperCase().replaceAll(" ", "");
  return state.lots.filter((lot) => {
    const matchesQuery = !query || lot.id.toUpperCase().includes(query) || `QUADRA${lot.block}`.includes(query);
    const matchesBlock = state.block === "all" || lot.block === state.block;
    const matchesStatus = state.status === "all" || lot.status === state.status;
    return matchesQuery && matchesBlock && matchesStatus;
  });
}

function formatMeters(value) {
  return value == null ? "—" : `${number.format(value)} m`;
}

function compactMeasurements(lot) {
  const measures = lot.measurements;
  if (!measures) return "Não informadas";
  const base = `Frente ${formatMeters(measures.frontM)} · Fundo ${formatMeters(measures.backM)} · Esq. ${formatMeters(measures.leftM)} · Dir. ${formatMeters(measures.rightM)}`;
  const extras = measures.additionalSides.map((side) => `${side.label} ${formatMeters(side.meters)}`);
  return [base, ...extras].join(" · ");
}

function measurementsMarkup(lot) {
  const measures = lot.measurements;
  if (!measures) return `<section class="lot-measurements missing-measures"><h4>Medidas do lote</h4><p>As medidas laterais deste lote não constam na planilha técnica enviada.</p></section>`;
  const sides = [
    ["Frente", measures.frontM],
    ["Fundo", measures.backM],
    ["Lado esquerdo", measures.leftM],
    ["Lado direito", measures.rightM],
    ...measures.additionalSides.map((side) => [side.label, side.meters]),
  ];
  return `<section class="lot-measurements">
    <h4>Medidas do lote</h4>
    <div class="measurement-grid">${sides.map(([label, value]) => `<div><span>${label}</span><strong>${formatMeters(value)}</strong></div>`).join("")}</div>
    <p>Medidas extraídas da planilha técnica.</p>
  </section>`;
}

function renderSummary() {
  const counts = state.lots.reduce((acc, lot) => ({ ...acc, [lot.status]: (acc[lot.status] || 0) + 1 }), {});
  elements.summary.innerHTML = `
    <article class="summary-card featured"><span>Total no mapa</span><strong>${state.lots.length}</strong><span>lotes no loteamento</span></article>
    <article class="summary-card"><span>Disponíveis</span><strong>${counts.disponivel || 0}</strong></article>
    <article class="summary-card"><span>Reservados</span><strong>${counts.reservado || 0}</strong></article>
    <article class="summary-card"><span>Vendidos</span><strong>${counts.vendido || 0}</strong></article>
    <article class="summary-card"><span>Indisponíveis</span><strong>${(counts.indisponivel || 0) + (counts.sem_cadastro || 0)}</strong></article>`;
}

function lotButton(lot, visibleIds) {
  const filteredOut = !visibleIds.has(lot.id);
  return `<button class="lot-shape ${lot.status} ${state.selectedId === lot.id ? "selected" : ""} ${filteredOut ? "filtered-out" : ""}"
    type="button" data-lot-id="${lot.id}" title="Quadra ${lot.block}, lote ${lot.lot} — ${STATUS[lot.status]}" ${filteredOut ? 'tabindex="-1"' : ""}>${lot.lot}</button>`;
}

function renderSector(title, subtitle, blocks, visibleIds) {
  return `<section class="map-sector">
    <div class="map-sector-heading"><h3>${title}</h3><span>${subtitle}</span></div>
    <div class="block-row">${blocks.map((block) => {
      const lots = state.lots.filter((lot) => lot.block === block);
      return `<article class="map-block"><h4>Quadra ${block}<small>${lots.length} lote${lots.length === 1 ? "" : "s"}</small></h4><div class="lot-grid">${lots.map((lot) => lotButton(lot, visibleIds)).join("")}</div></article>`;
    }).join("")}</div>
  </section>`;
}

function renderAerialMap() {
  if (!state.mapGeometry) return `<div class="empty-selection"><h3>Carregando a planta vetorial</h3><p>Aguarde enquanto o desenho técnico é preparado.</p></div>`;
  const visibleIds = new Set(filteredLots().map((lot) => lot.id));
  const geometryById = new Map(state.mapGeometry.lots.map((geometry) => [geometry.id, geometry]));
  const viewBox = state.mapGeometry.viewBox;
  const overlays = state.lots.map((lot) => {
    const geometry = geometryById.get(lot.id);
    if (!geometry) return "";
    const filteredOut = !visibleIds.has(lot.id);
    const className = `cad-lot ${lot.status} ${state.selectedId === lot.id ? "selected" : ""} ${filteredOut ? "filtered-out" : ""}`;
    const label = `Quadra ${lot.block}, lote ${lot.lot}, ${STATUS[lot.status]}`;
    const centerX = geometry.center.x;
    const centerY = -geometry.center.y;
    if (geometry.marker) {
      return `<g class="${className} cad-marker" data-lot-id="${lot.id}" role="button" tabindex="${filteredOut ? -1 : 0}" aria-label="${label}">
        <circle cx="${centerX}" cy="${centerY}" r="10"></circle><text x="${centerX}" y="${centerY + 2}">${lot.id}</text><title>${label}</title>
      </g>`;
    }
    const points = geometry.points.map((point) => `${point.x},${-point.y}`).join(" ");
    return `<g class="${className}" data-lot-id="${lot.id}" role="button" tabindex="${filteredOut ? -1 : 0}" aria-label="${label}">
      <polygon points="${points}"></polygon><text x="${centerX}" y="${centerY + 1.7}">${lot.lot}</text><title>${label}</title>
    </g>`;
  }).join("");
  return `<div class="map-pan-hint" aria-hidden="true">↔ Arraste para os lados · pinça ou roda do mouse para dar zoom</div>
  <div class="cad-map-shell">
    <div class="cad-map-viewport">
      <div class="cad-map-stage">
        <img src="assets/planta-dwg.svg" alt="Planta vetorial extraída do projeto DWG" />
        <svg class="cad-map-overlay" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMinYMin meet" aria-label="Lotes interativos sobre a planta real">
          ${overlays}
        </svg>
      </div>
      <div class="map-zoom-controls" role="group" aria-label="Zoom do mapa">
        <button type="button" data-zoom="in" aria-label="Aumentar zoom">+</button>
        <button type="button" data-zoom="out" aria-label="Diminuir zoom">−</button>
        <button type="button" data-zoom="reset" aria-label="Restaurar zoom">⤢</button>
      </div>
    </div>
    <div class="aerial-map-caption"><strong>Planta real do DWG</strong><span>Os polígonos seguem as divisas vetoriais do projeto. O contorno aberto do H-11 foi reconstruído pelas divisas vizinhas; F-1 e G-1 permanecem como marcadores.</span></div>
  </div>`;
}

function renderMap() {
  const aerial = state.mapMode === "aerial";
  elements.map.classList.toggle("aerial-active", aerial);
  document.querySelector("#aerialMapButton").classList.toggle("active", aerial);
  document.querySelector("#blockMapButton").classList.toggle("active", !aerial);
  if (aerial) {
    elements.map.innerHTML = renderAerialMap();
    const viewport = elements.map.querySelector(".cad-map-viewport");
    const stage = elements.map.querySelector(".cad-map-stage");
    if (viewport && stage) aerialZoom.attach(viewport, stage);
    return;
  }
  const visibleIds = new Set(filteredLots().map((lot) => lot.id));
  elements.map.innerHTML = `<div class="sector-map">
    ${renderSector("Setor Rodovia", "Quadras A a G", ["A", "B", "C", "D", "E", "F", "G"], visibleIds)}
    <div class="map-road">Rua 13 · eixo comercial</div>
    ${renderSector("Setor Rua 13", "Quadras H a N", ["H", "I", "J", "K", "L", "M", "N"], visibleIds)}
  </div>`;
}

function renderTable() {
  const lots = filteredLots();
  elements.visibleCount.textContent = lots.length;
  elements.table.innerHTML = lots.length ? lots.map((lot) => `
    <tr>
      <td><strong>${lot.block}-${lot.lot}</strong></td>
      <td>${number.format(lot.areaM2)} m²</td>
      <td>${lot.pricePerM2 == null ? "—" : money.format(lot.pricePerM2)}</td>
      <td>${lot.totalPrice == null ? "A cadastrar" : money.format(lot.totalPrice)}</td>
      <td>${lot.defaultDownPayment == null ? "—" : money.format(lot.defaultDownPayment)}</td>
      <td><span class="status-pill ${lot.status}">${STATUS[lot.status]}</span></td>
      <td><button class="table-link" data-lot-id="${lot.id}" type="button">Ver lote</button></td>
    </tr>`).join("") : `<tr><td colspan="7">Nenhum lote encontrado com estes filtros.</td></tr>`;
}

function adminAuditDetails(entry) {
  if (entry.action === "lote_atualizado") {
    const from = STATUS[entry.details?.status_from] ?? entry.details?.status_from ?? "—";
    const to = STATUS[entry.details?.status_to] ?? entry.details?.status_to ?? "—";
    return `${from} → ${to}`;
  }
  if (entry.action === "reserva_criada" && entry.details?.duration_hours) return `Validade: ${entry.details.duration_hours} hora(s)`;
  if (entry.action === "corretor_criado") return `${entry.details?.name ?? "Corretor"} · ${entry.details?.email ?? "—"}`;
  return "—";
}

function optionalDateTime(value) {
  return value ? dateTime.format(new Date(value)) : "Ainda não entrou";
}

function renderAdminSummary() {
  const activeReservations = state.adminReservations.filter((reservation) => reservation.reservation_status === "ativa").length;
  const availableLots = state.lots.filter((lot) => lot.status === "disponivel").length;
  const reservedLots = state.lots.filter((lot) => lot.status === "reservado").length;
  const soldLots = state.lots.filter((lot) => lot.status === "vendido").length;
  elements.adminSummary.innerHTML = `
    <article><span>Reservas ativas</span><strong>${activeReservations}</strong></article>
    <article><span>Lotes reservados</span><strong>${reservedLots}</strong></article>
    <article><span>Lotes disponíveis</span><strong>${availableLots}</strong></article>
    <article><span>Lotes vendidos</span><strong>${soldLots}</strong></article>`;
}

function renderAdminLots() {
  const query = elements.adminLotSearch.value.trim().toUpperCase().replaceAll(" ", "");
  const status = elements.adminLotStatus.value;
  const lots = state.lots.filter((lot) => (!query || lot.id.includes(query)) && (status === "all" || lot.status === status));
  elements.adminLotsTable.innerHTML = lots.length ? lots.map((lot) => `<tr>
    <td><strong>${lot.id}</strong></td><td>${number.format(lot.areaM2)} m²</td>
    <td>${lot.pricePerM2 == null ? "—" : money.format(lot.pricePerM2)}</td>
    <td>${lot.totalPrice == null ? "—" : money.format(lot.totalPrice)}</td>
    <td>${lot.defaultDownPayment == null ? "—" : money.format(lot.defaultDownPayment)}</td>
    <td><span class="status-pill ${lot.status}">${STATUS[lot.status]}</span></td>
    <td>${lot.buyerName ? escapeHtml(lot.buyerName) : "—"}</td>
    <td><button class="table-link" type="button" data-admin-edit-lot="${lot.id}">Editar</button></td>
  </tr>`).join("") : `<tr><td colspan="8">Nenhum lote encontrado.</td></tr>`;
}

function renderAdminReservations() {
  elements.adminReservationsTable.innerHTML = state.adminReservations.length ? state.adminReservations.map((reservation) => `<tr class="${reservation.reservation_status === "ativa" ? "active-reservation-row" : ""}">
    <td><strong>${escapeHtml(reservation.lot_id)}</strong></td>
    <td>${escapeHtml(reservation.customer_name)}</td>
    <td>${escapeHtml(reservation.customer_phone)}</td>
    <td>${escapeHtml(reservation.broker_email ?? "—")}</td>
    <td>${dateTime.format(new Date(reservation.created_at))}</td>
    <td>${dateTime.format(new Date(reservation.expires_at))}</td>
    <td><span class="reservation-pill ${reservation.reservation_status}">${RESERVATION_STATUS[reservation.reservation_status] ?? reservation.reservation_status}</span></td>
    <td>${reservation.reservation_status === "ativa" ? `<button class="table-link danger-link" type="button" data-admin-cancel-reservation="${reservation.id}" data-lot-id="${escapeHtml(reservation.lot_id)}">Cancelar</button>` : "—"}</td>
  </tr>`).join("") : `<tr><td colspan="8">Ainda não existem reservas.</td></tr>`;
}

function renderAdminBrokers() {
  elements.brokerCount.textContent = state.adminBrokers.length;
  if (state.adminBrokersError) {
    elements.adminBrokersTable.innerHTML = `<tr><td colspan="5" class="table-error">${escapeHtml(state.adminBrokersError)}</td></tr>`;
    return;
  }
  elements.adminBrokersTable.innerHTML = state.adminBrokers.length ? state.adminBrokers.map((broker) => `<tr>
    <td><strong>${escapeHtml(broker.name || "Sem nome")}</strong></td>
    <td>${escapeHtml(broker.email)}</td>
    <td><span class="access-pill ${broker.isAdmin ? "admin" : "broker"}">${broker.isAdmin ? "Administrador" : "Corretor"}</span></td>
    <td>${optionalDateTime(broker.createdAt)}</td>
    <td>${optionalDateTime(broker.lastSignInAt)}</td>
  </tr>`).join("") : `<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>`;
}

function renderAdminHistory() {
  elements.adminHistoryTable.innerHTML = state.adminHistory.length ? state.adminHistory.map((entry) => `<tr>
    <td>${dateTime.format(new Date(entry.created_at))}</td>
    <td>${ADMIN_ACTION[entry.action] ?? escapeHtml(entry.action)}</td>
    <td>${escapeHtml(entry.lot_id ?? "—")}</td>
    <td>${escapeHtml(entry.actor_email ?? "Sistema")}</td>
    <td>${escapeHtml(adminAuditDetails(entry))}</td>
  </tr>`).join("") : `<tr><td colspan="5">O histórico começará a ser preenchido com as próximas alterações.</td></tr>`;
}

function renderAdmin() {
  if (!state.isAdmin) return;
  renderAdminSummary();
  renderAdminLots();
  renderAdminReservations();
  renderAdminBrokers();
  renderAdminHistory();
}

function switchAdminTab(tab) {
  state.adminTab = tab;
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.classList.toggle("active", button.dataset.adminTab === tab));
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== tab; });
}

async function loadAdminData() {
  if (!state.isAdmin) return;
  const [{ data: reservations, error: reservationsError }, { data: history, error: historyError }, { data: brokerData, error: brokersError }] = await Promise.all([
    supabase.rpc("admin_list_reservations"),
    supabase.rpc("admin_list_audit", { p_limit: 200 }),
    supabase.functions.invoke("manage-brokers", { body: { action: "list" } }),
  ]);
  state.adminReservations = reservationsError ? [] : reservations ?? [];
  state.adminHistory = historyError ? [] : history ?? [];
  if (brokersError || brokerData?.error) {
    state.adminBrokers = [];
    state.adminBrokersError = "Não foi possível carregar os usuários. Atualize a página e tente novamente.";
  } else {
    state.adminBrokers = brokerData?.brokers ?? [];
    state.adminBrokersError = "";
  }
  renderAdmin();
  if (reservationsError || historyError) showToast("Parte dos dados administrativos não pôde ser carregada.", true);
  else if (brokersError || brokerData?.error) showToast("Lotes e reservas carregados; a lista de corretores está temporariamente indisponível.", true);
}

function setPageTab(tab) {
  state.pageTab = tab;
  document.querySelectorAll("[data-page-tab]").forEach((button) => {
    const active = button.dataset.pageTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.hero.hidden = tab !== "mapa";
  elements.pageMapa.hidden = tab !== "mapa";
  elements.pageLotes.hidden = tab !== "lotes";
  elements.adminSection.hidden = tab !== "administracao";
}

async function switchPageTab(tab) {
  if (tab === "administracao" && !state.isAdmin) return;
  setPageTab(tab);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (tab === "administracao") await loadAdminData();
}

function updateAdminLotComputedTotal() {
  const area = Number(elements.adminLotForm.elements.areaM2.value);
  const pricePerM2 = adminLotMoney.pricePerM2.getValue();
  const output = document.querySelector("#adminLotComputedTotal");
  if (!area || pricePerM2 == null) {
    output.textContent = "—";
    return;
  }
  output.textContent = money.format(area * pricePerM2);
}

function openAdminLotEditor(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot || !state.isAdmin) return;
  document.querySelector("#adminLotTitle").textContent = `Editar ${lot.id}`;
  elements.adminLotForm.elements.lotId.value = lot.id;
  elements.adminLotForm.elements.status.value = lot.status;
  elements.adminLotForm.elements.areaM2.value = lot.areaM2 ?? "";
  elements.adminLotForm.elements.buyerName.value = lot.buyerName ?? "";
  adminLotMoney.pricePerM2.setValue(lot.pricePerM2);
  adminLotMoney.downPayment.setValue(lot.defaultDownPayment);
  updateAdminLotComputedTotal();
  elements.adminLotDialog.showModal();
}

async function saveAdminLot(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return elements.adminLotDialog.close();
  if (!elements.adminLotForm.reportValidity()) return;
  const data = new FormData(elements.adminLotForm);
  const parameters = {
    p_lot_id: String(data.get("lotId")),
    p_status: String(data.get("status")),
    p_area_m2: Number(data.get("areaM2")),
    p_price_per_m2: adminLotMoney.pricePerM2.getValue(),
    p_default_down_payment: adminLotMoney.downPayment.getValue(),
    p_buyer_name: String(data.get("buyerName") ?? "").trim() || null,
  };
  elements.saveAdminLotButton.disabled = true;
  elements.saveAdminLotButton.textContent = "Salvando...";
  const { error } = await supabase.rpc("admin_update_lot_full", parameters);
  elements.saveAdminLotButton.disabled = false;
  elements.saveAdminLotButton.textContent = "Salvar alterações";
  if (error) return showToast(error.message || "Não foi possível atualizar o lote.", true);
  elements.adminLotDialog.close();
  await loadLots();
  await loadAdminData();
  showToast(`${parameters.p_lot_id} atualizado com segurança.`);
}

async function cancelAdminReservation(reservationId, lotId) {
  if (!state.isAdmin || !window.confirm(`Cancelar a reserva ativa do lote ${lotId}?`)) return;
  const { error } = await supabase.rpc("admin_cancel_reservation", { p_reservation_id: reservationId });
  if (error) return showToast(error.message || "Não foi possível cancelar a reserva.", true);
  await loadLots();
  await loadAdminData();
  showToast(`Reserva do ${lotId} cancelada; o lote voltou a ficar disponível.`);
}

function generateTemporaryPassword() {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*"];
  const randomFrom = (characters) => characters[crypto.getRandomValues(new Uint32Array(1))[0] % characters.length];
  const passwordCharacters = groups.map(randomFrom);
  const allCharacters = groups.join("");
  while (passwordCharacters.length < 16) passwordCharacters.push(randomFrom(allCharacters));
  for (let index = passwordCharacters.length - 1; index > 0; index -= 1) {
    const target = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [passwordCharacters[index], passwordCharacters[target]] = [passwordCharacters[target], passwordCharacters[index]];
  }
  const field = elements.brokerForm.elements.password;
  field.value = passwordCharacters.join("");
  field.type = "text";
  elements.showBrokerPassword.checked = true;
  field.focus();
  field.select();
}

async function createBroker(event) {
  event.preventDefault();
  if (!state.isAdmin || !elements.brokerForm.reportValidity()) return;
  const form = new FormData(elements.brokerForm);
  const payload = {
    action: "create",
    name: String(form.get("name") ?? "").trim(),
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    password: String(form.get("password") ?? ""),
  };
  elements.brokerError.textContent = "";
  elements.createBrokerButton.disabled = true;
  elements.createBrokerButton.textContent = "Criando...";
  const { data, error } = await supabase.functions.invoke("manage-brokers", { body: payload });
  elements.createBrokerButton.disabled = false;
  elements.createBrokerButton.textContent = "Criar corretor";
  if (error || data?.error) {
    let message = data?.error;
    if (!message && error?.context?.json) {
      try { message = (await error.context.json())?.error; } catch { /* A resposta sem JSON usa a mensagem padrão abaixo. */ }
    }
    elements.brokerError.textContent = message || "Não foi possível criar o corretor. Confira os dados e tente novamente.";
    return;
  }
  elements.brokerForm.reset();
  elements.brokerForm.elements.password.type = "password";
  await loadAdminData();
  showToast(`${payload.name} já pode entrar no sistema com o e-mail cadastrado.`);
}

function simulationMarkup(lot) {
  if (lot.totalPrice == null) return `<div class="blocked-note">Este lote aparece na planta, mas ainda não tem preço ou condições cadastradas.</div>`;
  return `<div class="simulator">
    <h4>Simulação rápida</h4>
    <label><span>Valor da entrada</span><input id="downPaymentInput" type="text" inputmode="decimal" autocomplete="off" /></label>
    <div class="quick-percentages" aria-label="Atalhos de entrada">
      <button type="button" data-entry-percent="5">5%</button><button type="button" data-entry-percent="10">10%</button><button type="button" data-entry-percent="20">20%</button>
    </div>
    <label><span>Prazo</span><select id="termSelect">${Object.keys(PLAN_FACTORS).map((term) => `<option value="${term}" ${term === "240" ? "selected" : ""}>${term} meses</option>`).join("")}</select></label>
    <div class="simulation-result"><span>Parcela estimada</span><strong id="monthlyPayment">—</strong><small id="simulationMeta"></small></div>
  </div>`;
}

function renderPanel() {
  const lot = state.lots.find((item) => item.id === state.selectedId);
  if (!lot) return;
  const canReserve = Boolean(state.session) && lot.status === "disponivel";
  elements.panel.innerHTML = `
    <div class="lot-panel-header"><div><p class="eyebrow">Quadra ${lot.block}</p><h3>Lote ${lot.lot}</h3></div><span class="status-pill ${lot.status}">${STATUS[lot.status]}</span></div>
    <div class="detail-grid">
      <div class="detail-card"><span>Área</span><strong>${number.format(lot.areaM2)} m²</strong></div>
      <div class="detail-card"><span>Valor por m²</span><strong>${lot.pricePerM2 == null ? "—" : money.format(lot.pricePerM2)}</strong></div>
      <div class="detail-card"><span>Valor do lote</span><strong>${lot.totalPrice == null ? "A cadastrar" : money.format(lot.totalPrice)}</strong></div>
      <div class="detail-card"><span>Entrada padrão</span><strong>${lot.defaultDownPayment == null ? "—" : money.format(lot.defaultDownPayment)}</strong></div>
      ${lot.buyerName ? `<div class="detail-card"><span>Comprador</span><strong>${escapeHtml(lot.buyerName)}</strong></div>` : ""}
    </div>
    ${measurementsMarkup(lot)}
    ${simulationMarkup(lot)}
    ${canReserve ? `<button class="button button-primary panel-action" id="reserveButton" type="button">Reservar este lote</button>` : `<div class="blocked-note">A reserva só está disponível para lotes marcados como disponíveis.</div>`}`;
  if (lot.totalPrice != null) bindSimulator(lot);
  document.querySelector("#reserveButton")?.addEventListener("click", openReservation);
}

function bindSimulator(lot) {
  const downPaymentEl = document.querySelector("#downPaymentInput");
  const downPayment = bindCurrencyInput(downPaymentEl);
  downPayment.setValue(lot.defaultDownPayment ?? 0);
  const term = document.querySelector("#termSelect");
  const update = () => {
    const entry = Math.max(0, Math.min(downPayment.getValue() ?? 0, lot.totalPrice));
    const months = Number(term.value);
    const factor = PLAN_FACTORS[months];
    const financed = lot.totalPrice - entry;
    const monthly = (financed / months) * factor;
    document.querySelector("#monthlyPayment").textContent = money.format(monthly);
    document.querySelector("#simulationMeta").textContent = `${months} meses · saldo ${money.format(financed)}`;
  };
  downPaymentEl.addEventListener("currencychange", update);
  term.addEventListener("change", update);
  document.querySelectorAll("[data-entry-percent]").forEach((button) => button.addEventListener("click", () => {
    downPayment.setValue(lot.totalPrice * Number(button.dataset.entryPercent) / 100);
    update();
  }));
  update();
}

function selectLot(id, scroll = false) {
  state.selectedId = id;
  renderMap();
  renderPanel();
  if (scroll && window.innerWidth < 1050) elements.panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function refresh() {
  renderSummary();
  renderMap();
  renderTable();
  if (state.selectedId) renderPanel();
}

function openReservation() {
  const lot = state.lots.find((item) => item.id === state.selectedId);
  if (!lot || lot.status !== "disponivel") return;
  document.querySelector("#reservationTitle").textContent = `Reservar ${lot.id}`;
  elements.reservationDialog.showModal();
}

async function confirmReservation(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return elements.reservationDialog.close();
  if (!elements.reservationForm.reportValidity()) return;
  const lot = state.lots.find((item) => item.id === state.selectedId);
  if (!lot || lot.status !== "disponivel") return;

  const data = new FormData(elements.reservationForm);
  elements.confirmReservationButton.disabled = true;
  elements.confirmReservationButton.textContent = "Reservando...";
  const { error } = await supabase.rpc("reserve_lot", {
    p_lot_id: lot.id,
    p_customer_name: String(data.get("customer") ?? "").trim(),
    p_customer_phone: String(data.get("phone") ?? "").trim(),
    p_duration_hours: Number(data.get("duration")),
  });
  elements.confirmReservationButton.disabled = false;
  elements.confirmReservationButton.textContent = "Confirmar reserva";

  if (error) {
    await loadLots();
    const unavailable = error.message.toLowerCase().includes("não está disponível") || error.message.toLowerCase().includes("not available");
    showToast(unavailable ? "Este lote acabou de ficar indisponível. Os dados foram atualizados." : "Não foi possível concluir a reserva. Tente novamente.", true);
    return;
  }

  elements.reservationDialog.close();
  elements.reservationForm.reset();
  await loadLots();
  showToast(`${lot.id} reservado com sucesso.`);
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

function exportExcel() {
  const lots = filteredLots();
  const headers = ["Quadra", "Lote", "Área (m²)", "Frente (m)", "Fundo (m)", "Lado esquerdo (m)", "Lado direito (m)", "Outras medidas", "Valor m²", "Valor do lote", "Entrada", "Financiado", "12x", "24x", "36x", "48x", "60x", "120x", "150x", "180x", "210x", "240x", "Situação"];
  const rows = lots.map((lot) => [lot.block, lot.lot, lot.areaM2, lot.measurements?.frontM ?? null, lot.measurements?.backM ?? null, lot.measurements?.leftM ?? null, lot.measurements?.rightM ?? null, lot.measurements?.additionalSides.map((side) => `${side.label}: ${formatMeters(side.meters)}`).join("; ") ?? "", lot.pricePerM2, lot.totalPrice, lot.defaultDownPayment, lot.financedAmount, ...[12,24,36,48,60,120,150,180,210,240].map((term) => lot.installments[term] ?? null), STATUS[lot.status]]);
  const cell = (value, header = false) => `<Cell ss:StyleID="${header ? "Header" : typeof value === "number" ? "Number" : "Text"}"><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${xmlEscape(value ?? "")}</Data></Cell>`;
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#12382F" ss:Pattern="Solid"/></Style><Style ss:ID="Text"/><Style ss:ID="Number"><NumberFormat ss:Format="#\,##0.00"/></Style></Styles><Worksheet ss:Name="Lotes"><Table>${`<Row>${headers.map((value) => cell(value, true)).join("")}</Row>`}${rows.map((row) => `<Row>${row.map((value) => cell(value)).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
  downloadBlob(new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `lotes-vale-do-ouro-${new Date().toISOString().slice(0,10)}.xls`);
  showToast("Arquivo do Excel gerado com os lotes filtrados.");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildPrintReport() {
  const lots = filteredLots();
  elements.printReport.innerHTML = `<h1>Vale do Ouro — relatório de lotes</h1><p>Gerado em ${new Date().toLocaleString("pt-BR")} · ${lots.length} lotes</p><table><thead><tr><th>Quadra</th><th>Lote</th><th>Área</th><th>Medidas</th><th>Valor m²</th><th>Valor lote</th><th>Entrada</th><th>12x</th><th>24x</th><th>36x</th><th>60x</th><th>120x</th><th>180x</th><th>240x</th><th>Situação</th></tr></thead><tbody>${lots.map((lot) => `<tr><td>${lot.block}</td><td>${lot.lot}</td><td>${number.format(lot.areaM2)} m²</td><td>${compactMeasurements(lot)}</td><td>${lot.pricePerM2 == null ? "—" : money.format(lot.pricePerM2)}</td><td>${lot.totalPrice == null ? "—" : money.format(lot.totalPrice)}</td><td>${lot.defaultDownPayment == null ? "—" : money.format(lot.defaultDownPayment)}</td>${[12,24,36,60,120,180,240].map((term) => `<td>${lot.installments[term] == null ? "—" : money.format(lot.installments[term])}</td>`).join("")}<td>${STATUS[lot.status]}</td></tr>`).join("")}</tbody></table>`;
}

function friendlyLoginError(error) {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("email not confirmed")) return "Este e-mail ainda não foi confirmado no sistema.";
  if (message.includes("failed to fetch")) return "Não foi possível conectar ao servidor. Confira a internet.";
  return "Não foi possível entrar. Tente novamente.";
}

function showLogin() {
  state.session = null;
  state.lots = [];
  state.selectedId = null;
  state.isAdmin = false;
  state.adminReservations = [];
  state.adminHistory = [];
  state.adminBrokers = [];
  state.adminBrokersError = "";
  elements.adminButton.hidden = true;
  setPageTab("mapa");
  document.body.classList.remove("authenticated");
  elements.loginForm.password.value = "";
  elements.loginForm.email.focus();
}

async function loadLots() {
  elements.connectionBadge.textContent = "Carregando lotes...";
  elements.connectionBadge.classList.remove("error");
  if (!state.mapGeometry) {
    const geometryResponse = await fetch("data/lot-map.json");
    if (!geometryResponse.ok) throw new Error("Não foi possível carregar a geometria do mapa.");
    state.mapGeometry = await geometryResponse.json();
  }
  if (!state.lotMeasurements) {
    const measurementsResponse = await fetch("data/lot-measures.json");
    if (!measurementsResponse.ok) throw new Error("Não foi possível carregar as medidas dos lotes.");
    const measurementData = await measurementsResponse.json();
    state.lotMeasurements = new Map(measurementData.lots.map((measurement) => [measurement.id, measurement]));
  }
  const { data, error } = await supabase
    .from("lots")
    .select("id,block,lot,area_m2,price_per_m2,total_price,default_down_payment,status,buyer_name,updated_at")
    .order("block", { ascending: true })
    .order("lot", { ascending: true });

  if (error) {
    elements.connectionBadge.textContent = "Falha na conexão";
    elements.connectionBadge.classList.add("error");
    elements.map.innerHTML = `<div class="empty-selection"><h3>Falha ao carregar os lotes</h3><p>Atualize a página ou tente novamente em instantes.</p></div>`;
    throw error;
  }

  state.lots = data.map((row) => ({ ...transformLot(row), measurements: state.lotMeasurements.get(row.id) ?? null }));
  if (state.selectedId && !state.lots.some((lot) => lot.id === state.selectedId)) state.selectedId = null;
  elements.connectionBadge.textContent = "Dados online";
  refresh();
}

async function checkAdminAccess() {
  const { data, error } = await supabase.rpc("current_user_is_admin");
  state.isAdmin = !error && data === true;
  elements.adminButton.hidden = !state.isAdmin;
  if (!state.isAdmin) elements.adminSection.hidden = true;
}

async function activateSession(session) {
  state.session = session;
  elements.sessionEmail.textContent = session.user.email ?? "Corretor autenticado";
  document.body.classList.add("authenticated");
  await loadLots();
  await checkAdminAccess();
}

async function handleLogin(event) {
  event.preventDefault();
  elements.loginError.textContent = "";
  const submit = elements.loginForm.querySelector('button[type="submit"]');
  const data = new FormData(elements.loginForm);
  submit.disabled = true;
  submit.textContent = "Entrando...";
  const { data: authData, error } = await supabase.auth.signInWithPassword({
    email: String(data.get("email") ?? "").trim(),
    password: String(data.get("password") ?? ""),
  });
  submit.disabled = false;
  submit.textContent = "Entrar";

  if (error || !authData.session) {
    elements.loginError.textContent = friendlyLoginError(error);
    return;
  }

  elements.loginForm.password.value = "";
  try {
    await activateSession(authData.session);
  } catch {
    showToast("Login realizado, mas os lotes não puderam ser carregados.", true);
  }
}

async function handleLogout() {
  elements.logoutButton.disabled = true;
  await supabase.auth.signOut();
  elements.logoutButton.disabled = false;
  showLogin();
}

function bindEvents() {
  elements.map.addEventListener("click", (event) => {
    if (suppressMapClick) return;
    // setPointerCapture no pan/zoom prende o alvo do click no viewport; refazer o
    // hit-test pelas coordenadas evita que o clique do mouse se perca no desktop.
    const hit = document.elementFromPoint(event.clientX, event.clientY) ?? event.target;
    const zoomButton = hit.closest("[data-zoom]");
    if (zoomButton) {
      if (zoomButton.dataset.zoom === "in") aerialZoom.zoomIn();
      else if (zoomButton.dataset.zoom === "out") aerialZoom.zoomOut();
      else aerialZoom.reset();
      return;
    }
    const button = hit.closest("[data-lot-id]");
    if (button && !button.classList.contains("filtered-out")) selectLot(button.dataset.lotId, true);
  });
  elements.map.addEventListener("keydown", (event) => { const lot = event.target.closest("[data-lot-id]"); if (lot && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectLot(lot.dataset.lotId, true); } });
  elements.table.addEventListener("click", (event) => { const button = event.target.closest("[data-lot-id]"); if (button) { switchPageTab("mapa"); selectLot(button.dataset.lotId); } });
  document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); switchPageTab("mapa"); });
  document.querySelectorAll("[data-page-tab]").forEach((button) => button.addEventListener("click", () => switchPageTab(button.dataset.pageTab)));
  elements.search.addEventListener("input", () => { state.query = elements.search.value; refresh(); });
  elements.block.addEventListener("change", () => { state.block = elements.block.value; refresh(); });
  elements.status.addEventListener("change", () => { state.status = elements.status.value; refresh(); });
  document.querySelector("#clearFilters").addEventListener("click", () => { state.query = ""; state.block = "all"; state.status = "all"; elements.search.value = ""; elements.block.value = "all"; elements.status.value = "all"; refresh(); });
  document.querySelector("#aerialMapButton").addEventListener("click", () => { state.mapMode = "aerial"; renderMap(); });
  document.querySelector("#blockMapButton").addEventListener("click", () => { state.mapMode = "blocks"; renderMap(); });
  document.querySelector("#exportExcel").addEventListener("click", exportExcel);
  document.querySelector("#exportPdf").addEventListener("click", () => { buildPrintReport(); window.print(); });
  document.querySelector("#openTechnicalMap").addEventListener("click", () => elements.technicalDialog.showModal());
  document.querySelector("#closeTechnicalMap").addEventListener("click", () => elements.technicalDialog.close());
  elements.reservationForm.addEventListener("submit", confirmReservation);
  document.querySelector("#refreshAdmin").addEventListener("click", loadAdminData);
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab)));
  elements.adminLotSearch.addEventListener("input", renderAdminLots);
  elements.adminLotStatus.addEventListener("change", renderAdminLots);
  elements.adminLotsTable.addEventListener("click", (event) => { const button = event.target.closest("[data-admin-edit-lot]"); if (button) openAdminLotEditor(button.dataset.adminEditLot); });
  elements.adminReservationsTable.addEventListener("click", (event) => { const button = event.target.closest("[data-admin-cancel-reservation]"); if (button) cancelAdminReservation(button.dataset.adminCancelReservation, button.dataset.lotId); });
  elements.adminLotForm.addEventListener("submit", saveAdminLot);
  elements.adminLotForm.elements.areaM2.addEventListener("input", updateAdminLotComputedTotal);
  elements.adminLotForm.elements.pricePerM2.addEventListener("currencychange", updateAdminLotComputedTotal);
  elements.brokerForm.addEventListener("submit", createBroker);
  document.querySelector("#generateBrokerPassword").addEventListener("click", generateTemporaryPassword);
  elements.showBrokerPassword.addEventListener("change", () => { elements.brokerForm.elements.password.type = elements.showBrokerPassword.checked ? "text" : "password"; });
  elements.loginForm.addEventListener("submit", handleLogin);
  elements.logoutButton.addEventListener("click", handleLogout);
}

async function init() {
  BLOCKS.forEach((block) => elements.block.insertAdjacentHTML("beforeend", `<option value="${block}">Quadra ${block}</option>`));
  bindEvents();
  setPageTab("mapa");

  try {
    if (!config.supabaseUrl || !config.supabasePublishableKey?.startsWith("sb_publishable_")) {
      throw new Error("Configuração pública do Supabase ausente.");
    }
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) await activateSession(data.session);
    else showLogin();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") state.session = session;
      if (event === "SIGNED_OUT" && state.session) showLogin();
    });
  } catch (error) {
    elements.loginError.textContent = error.message.includes("Configuração")
      ? "A conexão com o sistema ainda não foi configurada."
      : "Não foi possível iniciar a conexão. Confira a internet e atualize a página.";
  }
}

init();
