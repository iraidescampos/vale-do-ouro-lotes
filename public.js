import { createMapZoom } from "./map-zoom.js";
import { bindCurrencyInput } from "./currency-input.js";

const STATUS = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  indisponivel: "Indisponível",
  sem_cadastro: "Cadastro pendente",
};

const PLAN_FACTORS = { 12: 1, 24: 1.07, 36: 1.11, 48: 1.15, 60: 1.19, 120: 1.4, 150: 1.51, 180: 1.63, 210: 1.75, 240: 1.88 };
const BLOCKS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
const config = window.VALE_CONFIG ?? {};

const state = { lots: [], mapGeometry: null, lotMeasurements: null, selectedId: null, query: "", block: "all", status: "all", mapMode: "aerial" };
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

const elements = {
  map: document.querySelector("#commercialMap"),
  panel: document.querySelector("#lotPanel"),
  summary: document.querySelector("#summaryCards"),
  search: document.querySelector("#searchInput"),
  block: document.querySelector("#blockFilter"),
  status: document.querySelector("#statusFilter"),
  reservationDialog: document.querySelector("#reservationDialog"),
  reservationForm: document.querySelector("#reservationForm"),
  confirmReservationButton: document.querySelector("#confirmReservationButton"),
  technicalDialog: document.querySelector("#technicalMapDialog"),
  toast: document.querySelector("#toast"),
};

function decimal(value) {
  return value == null ? null : Number(value);
}

function transformLot(row) {
  const totalPrice = decimal(row.total_price);
  const defaultDownPayment = decimal(row.default_down_payment);
  return {
    id: row.id,
    block: row.block,
    lot: Number(row.lot),
    areaM2: decimal(row.area_m2),
    pricePerM2: decimal(row.price_per_m2),
    totalPrice,
    defaultDownPayment,
    status: row.status,
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
    <article class="summary-card featured"><span>Lotes disponíveis agora</span><strong>${counts.disponivel || 0}</strong><span>de ${state.lots.length} no loteamento</span></article>
    <article class="summary-card"><span>Reservados</span><strong>${counts.reservado || 0}</strong></article>
    <article class="summary-card"><span>Vendidos</span><strong>${counts.vendido || 0}</strong></article>`;
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

function renderPanel() {
  const lot = state.lots.find((item) => item.id === state.selectedId);
  if (!lot) return;
  const canReserve = lot.status === "disponivel";
  elements.panel.innerHTML = `
    <div class="lot-panel-header"><div><p class="eyebrow">Quadra ${lot.block}</p><h3>Lote ${lot.lot}</h3></div><span class="status-pill ${lot.status}">${STATUS[lot.status]}</span></div>
    <div class="detail-grid">
      <div class="detail-card"><span>Área</span><strong>${number.format(lot.areaM2)} m²</strong></div>
      <div class="detail-card"><span>Valor por m²</span><strong>${lot.pricePerM2 == null ? "—" : money.format(lot.pricePerM2)}</strong></div>
      <div class="detail-card"><span>Valor do lote</span><strong>${lot.totalPrice == null ? "A cadastrar" : money.format(lot.totalPrice)}</strong></div>
      <div class="detail-card"><span>Entrada padrão</span><strong>${lot.defaultDownPayment == null ? "—" : money.format(lot.defaultDownPayment)}</strong></div>
    </div>
    ${measurementsMarkup(lot)}
    ${simulationMarkup(lot)}
    ${canReserve
      ? `<button class="button button-primary panel-action" id="reserveButton" type="button">Reservar este lote</button>`
      : `<div class="blocked-note">A reserva só está disponível para lotes marcados como disponíveis.</div>`}`;
  if (lot.totalPrice != null) bindSimulator(lot);
  document.querySelector("#reserveButton")?.addEventListener("click", openReservation);
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
  const { error } = await supabase.rpc("public_reserve_lot", {
    p_lot_id: lot.id,
    p_customer_name: String(data.get("customer") ?? "").trim(),
    p_customer_phone: String(data.get("phone") ?? "").trim(),
  });
  elements.confirmReservationButton.disabled = false;
  elements.confirmReservationButton.textContent = "Confirmar reserva";

  if (error) {
    await loadLots().catch(() => {});
    showToast(error.message || "Não foi possível concluir a reserva. Tente novamente.", true);
    return;
  }

  elements.reservationDialog.close();
  elements.reservationForm.reset();
  await loadLots();
  showToast(`${lot.id} reservado com sucesso! Sua reserva fica garantida por 5 dias corridos.`);
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

async function loadLots() {
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
  const { data, error } = await supabase.rpc("public_list_lots");
  if (error) throw error;
  state.lots = (data ?? []).map((row) => ({ ...transformLot(row), measurements: state.lotMeasurements.get(row.id) ?? null }));
  if (state.selectedId && !state.lots.some((lot) => lot.id === state.selectedId)) state.selectedId = null;
  refresh();
}

function bindEvents() {
  elements.map.addEventListener("click", (event) => {
    if (suppressMapClick) return;
    const zoomButton = event.target.closest("[data-zoom]");
    if (zoomButton) {
      if (zoomButton.dataset.zoom === "in") aerialZoom.zoomIn();
      else if (zoomButton.dataset.zoom === "out") aerialZoom.zoomOut();
      else aerialZoom.reset();
      return;
    }
    const button = event.target.closest("[data-lot-id]");
    if (button && !button.classList.contains("filtered-out")) selectLot(button.dataset.lotId, true);
  });
  elements.map.addEventListener("keydown", (event) => { const lot = event.target.closest("[data-lot-id]"); if (lot && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectLot(lot.dataset.lotId, true); } });
  elements.search.addEventListener("input", () => { state.query = elements.search.value; refresh(); });
  elements.block.addEventListener("change", () => { state.block = elements.block.value; refresh(); });
  elements.status.addEventListener("change", () => { state.status = elements.status.value; refresh(); });
  document.querySelector("#clearFilters").addEventListener("click", () => { state.query = ""; state.block = "all"; state.status = "all"; elements.search.value = ""; elements.block.value = "all"; elements.status.value = "all"; refresh(); });
  document.querySelector("#aerialMapButton").addEventListener("click", () => { state.mapMode = "aerial"; renderMap(); });
  document.querySelector("#blockMapButton").addEventListener("click", () => { state.mapMode = "blocks"; renderMap(); });
  document.querySelector("#openTechnicalMap").addEventListener("click", () => elements.technicalDialog.showModal());
  document.querySelector("#closeTechnicalMap").addEventListener("click", () => elements.technicalDialog.close());
  elements.reservationForm.addEventListener("submit", confirmReservation);
}

async function init() {
  BLOCKS.forEach((block) => elements.block.insertAdjacentHTML("beforeend", `<option value="${block}">Quadra ${block}</option>`));
  bindEvents();

  try {
    if (!config.supabaseUrl || !config.supabasePublishableKey?.startsWith("sb_publishable_")) {
      throw new Error("Configuração pública ausente.");
    }
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await loadLots();
  } catch (error) {
    elements.map.innerHTML = `<div class="empty-selection"><h3>Não foi possível carregar o mapa</h3><p>Atualize a página ou tente novamente em instantes.</p></div>`;
    showToast(
      error.message?.includes("Configuração") ? "A conexão com o sistema ainda não foi configurada." : "Não foi possível carregar os lotes. Atualize a página.",
      true,
    );
  }
}

init();
