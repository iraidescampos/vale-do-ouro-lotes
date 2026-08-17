// Controlador de pan/zoom reutilizável para o mapa interativo.
// Usa Pointer Events (mouse, toque e caneta funcionam com o mesmo código em
// qualquer navegador moderno). O estado (escala/posição) vive aqui fora do DOM,
// então persiste mesmo quando o mapa é redesenhado (troca de filtro, seleção de lote).
export function createMapZoom({ minScale = 1, maxScale = 4, onDragEnd } = {}) {
  const MOVE_THRESHOLD = 6;
  let viewport = null;
  let stage = null;
  let scale = 1;
  let x = 0;
  let y = 0;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let moved = false;

  function apply() {
    if (stage) stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function rect() {
    return viewport.getBoundingClientRect();
  }

  function clampScale(value) {
    return Math.min(maxScale, Math.max(minScale, value));
  }

  function clampPan() {
    const r = rect();
    const extraW = Math.max(0, (r.width * scale - r.width) / 2);
    const extraH = Math.max(0, (r.height * scale - r.height) / 2);
    x = Math.min(extraW, Math.max(-extraW, x));
    y = Math.min(extraH, Math.max(-extraH, y));
  }

  function contentAnchor(clientX, clientY, atScale, atX, atY) {
    const r = rect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    return { px: (cx - atX) / atScale, py: (cy - atY) / atScale };
  }

  function placeAnchor(anchor, clientX, clientY, atScale) {
    const r = rect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    x = cx - atScale * anchor.px;
    y = cy - atScale * anchor.py;
  }

  function zoomAt(nextScale, clientX, clientY) {
    if (!viewport) return;
    const anchor = contentAnchor(clientX, clientY, scale, x, y);
    scale = clampScale(nextScale);
    placeAnchor(anchor, clientX, clientY, scale);
    clampPan();
    apply();
  }

  function zoomBy(factor) {
    const r = rect();
    zoomAt(scale * factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  function reset() {
    scale = 1;
    x = 0;
    y = 0;
    apply();
  }

  function onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.88 : 1.12;
    zoomAt(scale * factor, event.clientX, event.clientY);
  }

  function points() {
    return [...pointers.values()];
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try { viewport.setPointerCapture(event.pointerId); } catch { /* alguns navegadores recusam capturar certos ponteiros; o gesto continua funcionando via pointermove */ }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (pointers.size === 1) {
      const [p] = points();
      drag = { anchor: contentAnchor(p.x, p.y, scale, x, y) };
      pinch = null;
    } else if (pointers.size === 2) {
      const [a, b] = points();
      const mid = midpoint(a, b);
      pinch = { anchor: contentAnchor(mid.x, mid.y, scale, x, y), startDistance: Math.max(1, distance(a, b)), startScale: scale };
      drag = null;
    }
  }

  function onPointerMove(event) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (Math.hypot(event.clientX - point.startX, event.clientY - point.startY) > MOVE_THRESHOLD) moved = true;

    if (pointers.size === 1 && drag) {
      const [p] = points();
      placeAnchor(drag.anchor, p.x, p.y, scale);
      clampPan();
      apply();
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = points();
      scale = clampScale(pinch.startScale * (distance(a, b) / pinch.startDistance));
      const mid = midpoint(a, b);
      placeAnchor(pinch.anchor, mid.x, mid.y, scale);
      clampPan();
      apply();
    }
  }

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const [p] = points();
      drag = { anchor: contentAnchor(p.x, p.y, scale, x, y) };
    } else if (pointers.size === 0) {
      drag = null;
      if (moved) onDragEnd?.();
      moved = false;
    }
  }

  function attach(nextViewport, nextStage) {
    viewport = nextViewport;
    stage = nextStage;
    pointers.clear();
    drag = null;
    pinch = null;
    moved = false;
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    apply();
  }

  return {
    attach,
    reset,
    zoomIn: () => zoomBy(1.35),
    zoomOut: () => zoomBy(1 / 1.35),
  };
}
