(() => {
  "use strict";

  const STORAGE_KEY = "ff-strategi-v1";
  const PHASES = ["landing", "early", "mid", "late"];
  const PHASE_LABELS = { landing: "Landing", early: "Early zone", mid: "Mid zone", late: "Late zone" };
  const MAPS = [
    { id: "bermuda", name: "Bermuda", src: "assets/bermuda.jpg" },
    { id: "kalahari", name: "Kalahari", src: "assets/Kalahari.jpg" },
    { id: "nextera", name: "Nextera", src: "assets/Nextera.png" },
    { id: "purgatory", name: "Purgatory", src: "assets/Purgatory.jpg" },
    { id: "solara", name: "Solara", src: "assets/Solara.jpg" }
  ];
  const DEFAULT_STATE = {
    currentMapId: "bermuda",
    currentPlanId: "plan-1",
    visiblePhases: { landing: true, early: true, mid: false, late: false },
    activePhase: "early",
    plans: [
      { id: "plan-1", mapId: "bermuda", name: "Match 1 – Plan A", objects: [], squadA: "", squadB: "", note: "" },
      { id: "plan-2", mapId: "bermuda", name: "Match 2 – Plan A", objects: [], squadA: "", squadB: "", note: "" },
      { id: "plan-3", mapId: "bermuda", name: "Match 2 – Plan B", objects: [], squadA: "", squadB: "", note: "" }
    ]
  };
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const canvasRegion = document.querySelector(".canvas-region");
  const canvasWrap = document.querySelector(".canvas-wrap");
  const zoomLevel = document.getElementById("zoomLevel");
  const appShell = document.getElementById("appShell");
  const planList = document.getElementById("planList");
  const currentPlanTitle = document.getElementById("currentPlanTitle");
  const objectEditor = document.getElementById("objectEditor");
  const objectColor = document.getElementById("objectColor");
  const objectWidth = document.getElementById("objectWidth");
  const textSize = document.getElementById("textSize");
  const textPadding = document.getElementById("textPadding");
  const mapSelect = document.getElementById("mapSelect");
  const saveStatus = document.getElementById("saveStatus");
  const toast = document.getElementById("toast");
  const textDialog = document.getElementById("textDialog");
  const textForm = document.getElementById("textForm");
  const textInput = document.getElementById("textInput");
  const confirmDialog = document.getElementById("confirmDialog");
  const toolButtons = [...document.querySelectorAll(".tool-button")];
  const image = new Image();

  let state = loadState();
  ensureCurrentMapPlan();
  image.src = currentMap().src;
  let activeTool = "select";
  let drawing = false;
  let draft = null;
  let polygonPoints = [];
  let selectedObjectId = null;
  let dragOffset = null;
  let dragStartSnapshot = null;
  let panStart = null;
  let pendingTouchTap = null;
  let history = [];
  let historyIndex = -1;
  let saveTimer = 0;
  let toastTimer = 0;
  let pendingTextPosition = null;
  let editingTextId = null;
  let pendingConfirmAction = null;
  let zoom = 1;
  let baseCanvasSize = 0;
  const activeTouchPointers = new Map();
  let touchGesture = null;
  let suppressTouchDrawing = false;
  const MIN_ZOOM = 1;
  const ZOOM_FACTOR = 1.25;

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed.plans) || parsed.plans.length === 0) throw new Error("Data strategi tidak valid.");
      return {
        ...structuredClone(DEFAULT_STATE),
        ...parsed,
        currentMapId: MAPS.some((map) => map.id === parsed.currentMapId) ? parsed.currentMapId : "bermuda",
        visiblePhases: { ...DEFAULT_STATE.visiblePhases, ...parsed.visiblePhases },
        plans: parsed.plans.map((plan) => ({
          id: String(plan.id),
          name: String(plan.name),
          mapId: MAPS.some((map) => map.id === plan.mapId) ? plan.mapId : "bermuda",
          objects: Array.isArray(plan.objects) ? plan.objects : [],
          squadA: String(plan.squadA || ""),
          squadB: String(plan.squadB || ""),
          note: String(plan.note || "")
        }))
      };
    } catch (error) {
      console.error("Gagal memuat strategi dari penyimpanan browser.", error);
      queueMicrotask(() => showToast("Draft tidak bisa dimuat. Penyimpanan browser mungkin rusak."));
      return structuredClone(DEFAULT_STATE);
    }
  }

  function currentMap() {
    return MAPS.find((map) => map.id === state.currentMapId) || MAPS[0];
  }

  function plansForCurrentMap() {
    return state.plans.filter((plan) => plan.mapId === state.currentMapId);
  }

  function matchNumberFromName(name) {
    return Number(name.match(/^Match\s+(\d+)/)?.[1] || 0);
  }

  function nextPlanLetter(plans, matchNumber) {
    const usedLetters = new Set(plans
      .filter((plan) => matchNumberFromName(plan.name) === matchNumber)
      .map((plan) => plan.name.match(/^Match\s+\d+\s+[–-]\s+Plan\s+(.+)$/)?.[1]));
    for (let index = 0; index < 26; index += 1) {
      const letter = String.fromCharCode(65 + index);
      if (!usedLetters.has(letter)) return letter;
    }
    return String(usedLetters.size + 1);
  }

  function createPlan(mapId, matchNumber, planLetter = "A") {
    return {
      id: `plan-${mapId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mapId,
      name: `Match ${matchNumber} – Plan ${planLetter}`,
      objects: [],
      squadA: "",
      squadB: "",
      note: ""
    };
  }

  function ensureCurrentMapPlan() {
    let plan = state.plans.find((item) => item.id === state.currentPlanId && item.mapId === state.currentMapId);
    if (!plan) plan = plansForCurrentMap()[0];
    if (!plan) {
      plan = createPlan(state.currentMapId, 1);
      state.plans.push(plan);
    }
    state.currentPlanId = plan.id;
  }

  function currentPlan() {
    return state.plans.find((plan) => plan.id === state.currentPlanId && plan.mapId === state.currentMapId)
      || plansForCurrentMap()[0];
  }

  function snapshot() {
    return JSON.stringify(state);
  }

  function pushHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function restoreHistory(index) {
    if (index < 0 || index >= history.length) return;
    historyIndex = index;
    state = JSON.parse(history[index]);
    ensureCurrentMapPlan();
    image.src = currentMap().src;
    zoom = 1;
    selectedObjectId = null;
    renderAll();
    updateZoomLayout();
    persist();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;
    document.getElementById("undoButton").disabled = !canUndo;
    document.getElementById("redoButton").disabled = !canRedo;
    if (mobileUndoButton) mobileUndoButton.disabled = !canUndo;
    if (mobileRedoButton) mobileRedoButton.disabled = !canRedo;
  }

  function persist() {
    saveStatus.textContent = "Menyimpan...";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        saveStatus.textContent = "Tersimpan di perangkat ini";
      } catch (error) {
        console.error("Gagal menyimpan strategi ke penyimpanan browser.", error);
        saveStatus.textContent = "Gagal menyimpan draft";
        showToast("Penyimpanan gagal. Periksa ruang penyimpanan browser.");
      }
    }, 180);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function requestConfirmation(title, message, action) {
    document.getElementById("confirmDialogTitle").textContent = title;
    document.getElementById("confirmDialogMessage").textContent = message;
    pendingConfirmAction = action;
    confirmDialog.showModal();
  }

  function updateZoomLayout() {
    const styles = getComputedStyle(canvasRegion);
    const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availableWidth = Math.max(160, canvasRegion.clientWidth - horizontalPadding);
    const availableHeight = Math.max(160, canvasRegion.clientHeight - verticalPadding);
    baseCanvasSize = Math.min(availableWidth, availableHeight);
    const size = Math.round(baseCanvasSize * zoom);
    canvasWrap.style.width = `${size}px`;
    canvasWrap.style.height = `${size}px`;
    zoomLevel.value = `${Math.round(zoom * 100)}%`;
    zoomLevel.textContent = zoomLevel.value;
    document.getElementById("zoomOutButton").disabled = zoom <= MIN_ZOOM;
  }

  function setZoom(nextZoom, clientX, clientY) {
    const oldRect = canvas.getBoundingClientRect();
    const regionRect = canvasRegion.getBoundingClientRect();
    const anchorX = Number.isFinite(clientX) ? clientX : regionRect.left + canvasRegion.clientWidth / 2;
    const anchorY = Number.isFinite(clientY) ? clientY : regionRect.top + canvasRegion.clientHeight / 2;
    const relativeX = Math.max(0, Math.min(1, (anchorX - oldRect.left) / oldRect.width));
    const relativeY = Math.max(0, Math.min(1, (anchorY - oldRect.top) / oldRect.height));
    if (!Number.isFinite(nextZoom)) return;
    zoom = Math.max(MIN_ZOOM, nextZoom);
    updateZoomLayout();
    const newRect = canvas.getBoundingClientRect();
    canvasRegion.scrollLeft += newRect.left + relativeX * newRect.width - anchorX;
    canvasRegion.scrollTop += newRect.top + relativeY * newRect.height - anchorY;
    renderCanvas();
  }

  function getTouchGestureMetrics() {
    const [first, second] = [...activeTouchPointers.values()];
    if (!first || !second) return null;
    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    };
  }

  function startTouchGesture() {
    const metrics = getTouchGestureMetrics();
    if (!metrics) return;
    if (drawing && dragStartSnapshot) {
      state = JSON.parse(dragStartSnapshot);
      renderAll();
      persist();
    }
    drawing = false;
    draft = null;
    dragOffset = null;
    dragStartSnapshot = null;
    panStart = null;
    canvas.classList.remove("panning");
    suppressTouchDrawing = true;
    touchGesture = {
      initialDistance: Math.max(1, metrics.distance),
      initialZoom: zoom,
      lastMidpoint: metrics.midpoint
    };
    renderCanvas();
  }

  function updateTouchGesture() {
    const metrics = getTouchGestureMetrics();
    if (!touchGesture || !metrics) return;
    const nextZoom = touchGesture.initialZoom * (metrics.distance / touchGesture.initialDistance);
    setZoom(nextZoom, metrics.midpoint.x, metrics.midpoint.y);
    canvasRegion.scrollLeft -= metrics.midpoint.x - touchGesture.lastMidpoint.x;
    canvasRegion.scrollTop -= metrics.midpoint.y - touchGesture.lastMidpoint.y;
    touchGesture.lastMidpoint = metrics.midpoint;
  }

  function handleCanvasTap(tool, point, clientX, clientY, zoomOut = false) {
    if (tool === "erase") {
      const hit = hitObject(point);
      if (hit) {
        currentPlan().objects = currentPlan().objects.filter((item) => item.id !== hit.id);
        pushHistory();
        persist();
        selectedObjectId = null;
        updateEditor();
      }
    } else if (tool === "text") {
      openTextDialog(point);
    } else if (tool === "polygon") {
      polygonPoints.push(point);
      renderCanvas();
    } else if (tool === "zoom") {
      setZoom(zoom * (zoomOut ? 1 / ZOOM_FACTOR : ZOOM_FACTOR), clientX, clientY);
    }
  }

  function renderAll() {
    renderPlans();
    renderForm();
    renderCanvas();
    mapSelect.value = state.currentMapId;
    canvas.setAttribute("aria-label", `Map ${currentMap().name} untuk menggambar strategi`);
    document.querySelectorAll("[data-phase]").forEach((input) => {
      input.checked = Boolean(state.visiblePhases[input.dataset.phase]);
    });
    document.getElementById("activePhase").value = state.activePhase;
    updateEditor();
  }

  function renderPlans() {
    planList.replaceChildren();
    plansForCurrentMap().forEach((plan) => {
      const button = document.createElement("button");
      button.className = `plan-button${plan.id === state.currentPlanId ? " active" : ""}`;
      button.type = "button";
      button.textContent = plan.name;
      button.addEventListener("click", () => {
        if (plan.id === state.currentPlanId) return;
        state.currentPlanId = plan.id;
        selectedObjectId = null;
        renderAll();
        persist();
      });
      planList.append(button);
    });
    currentPlanTitle.textContent = currentPlan().name;
  }

  function renderForm() {
    const plan = currentPlan();
    document.getElementById("squadA").value = plan.squadA;
    document.getElementById("squadB").value = plan.squadB;
    document.getElementById("generalNote").value = plan.note;
  }

  function colorForPhase(phase) {
    return { landing: "#39d4c6", early: "#ffd23f", mid: "#4ea1ff", late: "#ee77d5" }[phase] || "#39d4c6";
  }

  function drawObject(context, item, isSelected = false) {
    context.save();
    context.strokeStyle = item.color || colorForPhase(item.phase);
    context.fillStyle = item.color || colorForPhase(item.phase);
    context.lineWidth = item.width || 5;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (item.type === "pen" || item.type === "line" || item.type === "arrow") {
      if (item.points.length < 2) { context.restore(); return; }
      context.beginPath();
      context.moveTo(item.points[0].x * canvas.width, item.points[0].y * canvas.height);
      for (let i = 1; i < item.points.length; i += 1) {
        context.lineTo(item.points[i].x * canvas.width, item.points[i].y * canvas.height);
      }
      context.stroke();
      if (item.type === "arrow") drawArrowHead(context, item.points);
    } else if (item.type === "circle") {
      context.beginPath();
      context.arc(item.x * canvas.width, item.y * canvas.height, item.radius * canvas.width, 0, Math.PI * 2);
      context.setLineDash([9, 7]);
      context.fillStyle = `${item.color || colorForPhase(item.phase)}22`;
      context.fill();
      context.stroke();
    } else if (item.type === "polygon") {
      if (item.points.length < 3) { context.restore(); return; }
      context.beginPath();
      context.moveTo(item.points[0].x * canvas.width, item.points[0].y * canvas.height);
      item.points.slice(1).forEach((point) => context.lineTo(point.x * canvas.width, point.y * canvas.height));
      context.closePath();
      context.fillStyle = `${item.color || colorForPhase(item.phase)}22`;
      context.fill();
      context.setLineDash([9, 7]);
      context.stroke();
    } else if (item.type === "text") {
      const fontSize = item.fontSize || 20;
      context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      const bounds = textBounds(item, context);
      context.fillStyle = "#ffffff";
      context.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      context.fillStyle = item.color || colorForPhase(item.phase);
      context.fillText(item.text, item.x * canvas.width, textBaselineY(item, context));
    }

    if (isSelected) {
      const bounds = objectBounds(item);
      context.setLineDash([4, 4]);
      context.lineWidth = 1.5;
      context.strokeStyle = "#ffffffcc";
      context.strokeRect(bounds.left - 5, bounds.top - 5, bounds.right - bounds.left + 10, bounds.bottom - bounds.top + 10);
    }
    context.restore();
  }

  function drawArrowHead(context, points) {
    const start = points[points.length - 2];
    const end = points[points.length - 1];
    const x1 = start.x * canvas.width;
    const y1 = start.y * canvas.height;
    const x2 = end.x * canvas.width;
    const y2 = end.y * canvas.height;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const length = Math.max(13, (context.lineWidth || 5) * 3);
    context.beginPath();
    context.moveTo(x2, y2);
    context.lineTo(x2 - length * Math.cos(angle - Math.PI / 6), y2 - length * Math.sin(angle - Math.PI / 6));
    context.lineTo(x2 - length * Math.cos(angle + Math.PI / 6), y2 - length * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }

  function renderCanvas(exporting = false) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (image.complete && image.naturalWidth) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = "#22342d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#d8e2dd";
      ctx.textAlign = "center";
      ctx.font = "18px sans-serif";
      ctx.fillText("Map Bermuda tidak dapat dimuat", canvas.width / 2, canvas.height / 2);
    }
    const objects = currentPlan().objects;
    objects.forEach((item) => {
      if (!state.visiblePhases[item.phase]) return;
      drawObject(ctx, item, !exporting && item.id === selectedObjectId);
    });
    if (draft && state.visiblePhases[draft.phase]) drawObject(ctx, draft);
    if (polygonPoints.length && state.visiblePhases[state.activePhase]) {
      const polygonDraft = { type: "polygon", points: polygonPoints, color: colorForPhase(state.activePhase), phase: state.activePhase, width: 4 };
      drawObject(ctx, polygonDraft);
      const last = polygonPoints[polygonPoints.length - 1];
      ctx.save();
      ctx.fillStyle = "#ffffff";
      polygonPoints.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }

  function objectBounds(item) {
    if (item.type === "circle") {
      const radius = item.radius * canvas.width;
      const x = item.x * canvas.width;
      const y = item.y * canvas.height;
      return { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
    }
    if (item.type === "text") return textBounds(item, ctx);
    const points = item.points || [{ x: item.x, y: item.y }];
    return {
      left: Math.min(...points.map((point) => point.x * canvas.width)),
      right: Math.max(...points.map((point) => point.x * canvas.width)),
      top: Math.min(...points.map((point) => point.y * canvas.height)),
      bottom: Math.max(...points.map((point) => point.y * canvas.height))
    };
  }

  function textBounds(item, context) {
    const fontSize = item.fontSize || 20;
    context.save();
    context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    context.textAlign = "left";
    const metrics = context.measureText(item.text);
    context.restore();
    const padding = Number.isFinite(item.backgroundPadding) ? item.backgroundPadding : 5;
    const x = item.x * canvas.width;
    const y = item.y * canvas.height;
    const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
    const right = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : metrics.width;
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
    const baselineY = y + (ascent - descent) / 2;
    return {
      left: x - left - padding,
      right: x + right + padding,
      top: baselineY - ascent - padding,
      bottom: baselineY + descent + padding
    };
  }

  function textBaselineY(item, context) {
    const fontSize = item.fontSize || 20;
    context.save();
    context.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const metrics = context.measureText(item.text);
    context.restore();
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) && metrics.actualBoundingBoxAscent > 0 ? metrics.actualBoundingBoxAscent : fontSize * 0.8;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : fontSize * 0.2;
    return item.y * canvas.height + (ascent - descent) / 2;
  }

  function pointNearObject(point, item) {
    const px = point.x * canvas.width;
    const py = point.y * canvas.height;
    if (item.type === "circle") {
      const dx = px - item.x * canvas.width;
      const dy = py - item.y * canvas.height;
      return Math.abs(Math.hypot(dx, dy) - item.radius * canvas.width) < 18 || Math.hypot(dx, dy) < item.radius * canvas.width;
    }
    const bounds = objectBounds(item);
    if (px < bounds.left - 12 || px > bounds.right + 12 || py < bounds.top - 12 || py > bounds.bottom + 12) return false;
    if (item.type === "text") return true;
    if (item.type === "polygon") return pointInPolygon(px, py, item.points.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height })));
    const points = item.points || [];
    if (points.length < 2) return false;
    return points.slice(1).some((end, index) => distanceToSegment(px, py,
      points[index].x * canvas.width, points[index].y * canvas.height,
      end.x * canvas.width, end.y * canvas.height) < 14);
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i];
      const b = points[j];
      const intersects = ((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  }

  function createObject(type, pointsOrPosition) {
    const common = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, phase: state.activePhase, color: colorForPhase(state.activePhase), width: 5 };
    if (type === "circle") {
      const end = pointsOrPosition[1];
      return { ...common, x: pointsOrPosition[0].x, y: pointsOrPosition[0].y, radius: Math.max(.012, Math.hypot(end.x - pointsOrPosition[0].x, end.y - pointsOrPosition[0].y)) };
    }
    return { ...common, points: pointsOrPosition };
  }

  function commitObject(item) {
    currentPlan().objects.push(item);
    pushHistory();
    persist();
    renderCanvas();
  }

  function openTextDialog(position, selectedText = null) {
    pendingTextPosition = position;
    editingTextId = selectedText?.id || null;
    document.getElementById("textDialogTitle").textContent = editingTextId ? "Edit label" : "Tambah label";
    textInput.value = selectedText?.text || "";
    textDialog.showModal();
    textInput.focus();
  }

  function hitObject(point) {
    return [...currentPlan().objects].reverse().find((item) => state.visiblePhases[item.phase] && pointNearObject(point, item));
  }

  function setTool(tool) {
    if (polygonPoints.length) finishPolygon();
    activeTool = tool;
    allToolButtons.forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
    canvas.dataset.tool = tool;
    const hints = {
      polygon: "Klik untuk menambah titik; Enter untuk selesai",
      select: "Pilih objek untuk memindahkan atau mengedit",
      pan: "Tarik map untuk menggeser; perbesar map jika belum bisa digeser",
      zoom: "Klik map untuk memperbesar; Shift+klik untuk memperkecil"
    };
    document.getElementById("canvasHint").textContent = hints[tool]
      || `Alat aktif: ${toolButtons.find((button) => button.dataset.tool === tool)?.lastElementChild.textContent || tool}`;
  }

  function finishPolygon() {
    if (polygonPoints.length >= 3) commitObject({ ...createObject("polygon", polygonPoints), points: polygonPoints });
    else if (polygonPoints.length) showToast("Area perlu setidaknya 3 titik.");
    polygonPoints = [];
    renderCanvas();
  }

  function updateEditor() {
    const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
    objectEditor.hidden = !selected;
    objectEditor.dataset.objectType = selected?.type || "";
    if (selected) {
      objectColor.value = selected.color || colorForPhase(selected.phase);
      objectWidth.value = String(selected.width || 5);
      if (selected.type === "text") {
        textSize.value = String(selected.fontSize || 20);
        textPadding.value = String(Number.isFinite(selected.backgroundPadding) ? selected.backgroundPadding : 5);
        document.getElementById("textSizeValue").value = textSize.value;
        document.getElementById("textPaddingValue").value = textPadding.value;
      }
    }
    renderCanvas();
  }

  function updateSelectedTextProperty(property, value) {
    const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
    if (!selected || selected.type !== "text") return;
    selected[property] = value;
    renderCanvas();
  }

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });
  const mobileToolRow = document.getElementById("mobileToolRow");
  toolButtons.forEach((button) => mobileToolRow.append(button.cloneNode(true)));
  const allToolButtons = [...document.querySelectorAll(".tool-button")];
  const mobileUndoButton = document.createElement("button");
  mobileUndoButton.className = "mobile-action-button";
  mobileUndoButton.type = "button";
  mobileUndoButton.textContent = "Undo";
  mobileUndoButton.setAttribute("aria-label", "Undo");
  mobileUndoButton.addEventListener("click", () => restoreHistory(historyIndex - 1));
  const mobileRedoButton = document.createElement("button");
  mobileRedoButton.className = "mobile-action-button";
  mobileRedoButton.type = "button";
  mobileRedoButton.textContent = "Redo";
  mobileRedoButton.setAttribute("aria-label", "Redo");
  mobileRedoButton.addEventListener("click", () => restoreHistory(historyIndex + 1));
  mobileToolRow.prepend(mobileRedoButton);
  mobileToolRow.prepend(mobileUndoButton);
  mobileToolRow.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activeTouchPointers.size === 2) {
        canvas.setPointerCapture(event.pointerId);
        startTouchGesture();
        return;
      }
      if (activeTouchPointers.size > 2) return;
      if (suppressTouchDrawing) return;
    }
    if (appShell.classList.contains("presentation")) {
      canvas.setPointerCapture(event.pointerId);
      panStart = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: canvasRegion.scrollLeft,
        scrollTop: canvasRegion.scrollTop
      };
      canvas.classList.add("panning");
      return;
    }
    const point = getPointerPosition(event);
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch" && ["erase", "text", "polygon", "zoom"].includes(activeTool)) {
      pendingTouchTap = { pointerId: event.pointerId, tool: activeTool, point, clientX: event.clientX, clientY: event.clientY, zoomOut: event.shiftKey };
      return;
    }
    if (activeTool === "pan") {
      panStart = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: canvasRegion.scrollLeft,
        scrollTop: canvasRegion.scrollTop
      };
      canvas.classList.add("panning");
      return;
    }
    if (activeTool === "zoom") {
      handleCanvasTap(activeTool, point, event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (activeTool === "select") {
      const hit = hitObject(point);
      selectedObjectId = hit?.id || null;
      if (hit) {
        dragOffset = { x: point.x - (hit.x ?? hit.points?.[0]?.x ?? 0), y: point.y - (hit.y ?? hit.points?.[0]?.y ?? 0) };
        dragStartSnapshot = snapshot();
      } else dragStartSnapshot = null;
      drawing = Boolean(hit);
      updateEditor();
      return;
    }
    if (activeTool === "erase") {
      handleCanvasTap(activeTool, point);
      return;
    }
    if (activeTool === "text") {
      handleCanvasTap(activeTool, point);
      return;
    }
    if (activeTool === "polygon") {
      handleCanvasTap(activeTool, point);
      return;
    }
    drawing = true;
    if (activeTool === "pen") draft = createObject("pen", [point]);
    else if (activeTool === "circle") draft = { ...createObject("circle", [point, point]), x: point.x, y: point.y, radius: .001 };
    else draft = createObject(activeTool, [point, point]);
    renderCanvas();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
      activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchGesture) {
        updateTouchGesture();
        return;
      }
      if (suppressTouchDrawing) return;
    }
    if (panStart?.pointerId === event.pointerId) {
      canvasRegion.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.x);
      canvasRegion.scrollTop = panStart.scrollTop - (event.clientY - panStart.y);
      return;
    }
    if (!drawing) return;
    const point = getPointerPosition(event);
    if (activeTool === "select" && selectedObjectId && dragOffset) {
      const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
      if (!selected) return;
      if (selected.points) {
        const first = selected.points[0];
        const dx = point.x - dragOffset.x - first.x;
        const dy = point.y - dragOffset.y - first.y;
        selected.points = selected.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else {
        selected.x = point.x - dragOffset.x;
        selected.y = point.y - dragOffset.y;
      }
      dragOffset = { x: point.x - (selected.x ?? selected.points?.[0]?.x ?? 0), y: point.y - (selected.y ?? selected.points?.[0]?.y ?? 0) };
      renderCanvas();
      return;
    }
    if (!draft) return;
    if (draft.type === "pen") draft.points.push(point);
    else if (draft.type === "circle") draft.radius = Math.max(.012, Math.hypot(point.x - draft.x, point.y - draft.y));
    else draft.points[1] = point;
    renderCanvas();
  });

  function endPointer(event) {
    if (event?.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
      if (touchGesture) {
        activeTouchPointers.delete(event.pointerId);
        pendingTouchTap = null;
        if (activeTouchPointers.size < 2) {
          touchGesture = null;
          suppressTouchDrawing = activeTouchPointers.size > 0;
        }
        return;
      }
      activeTouchPointers.delete(event.pointerId);
      if (suppressTouchDrawing) {
        if (activeTouchPointers.size === 0) suppressTouchDrawing = false;
        return;
      }
      if (event.type === "pointerup" && pendingTouchTap?.pointerId === event.pointerId) {
        const { tool, point, clientX, clientY, zoomOut } = pendingTouchTap;
        pendingTouchTap = null;
        handleCanvasTap(tool, point, clientX, clientY, zoomOut);
        return;
      }
      pendingTouchTap = null;
    }
    if (panStart?.pointerId === event.pointerId) {
      panStart = null;
      canvas.classList.remove("panning");
      return;
    }
    if (!drawing) return;
    drawing = false;
    dragOffset = null;
    if (draft) {
      const object = draft;
      draft = null;
      commitObject(object);
      return;
    }
    if (activeTool === "select" && selectedObjectId && dragStartSnapshot !== snapshot()) {
      pushHistory();
      persist();
    }
    dragStartSnapshot = null;
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("dblclick", () => {
    if (appShell.classList.contains("presentation")) return;
    if (activeTool === "polygon") finishPolygon();
    else if (activeTool === "select" && selectedObjectId) {
      const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
      if (selected?.type === "text") openTextDialog(null, selected);
    }
  });

  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) {
      textInput.focus();
      return;
    }
    if (editingTextId) {
      const selected = currentPlan().objects.find((item) => item.id === editingTextId);
      if (selected) selected.text = text;
      selectedObjectId = editingTextId;
    } else if (pendingTextPosition) {
      const item = { ...createObject("text"), x: pendingTextPosition.x, y: pendingTextPosition.y, text, fontSize: 20, backgroundPadding: 5 };
      currentPlan().objects.push(item);
      selectedObjectId = item.id;
    }
    pushHistory();
    persist();
    textDialog.close();
    pendingTextPosition = null;
    editingTextId = null;
    updateEditor();
  });

  textDialog.addEventListener("close", () => {
    pendingTextPosition = null;
    editingTextId = null;
  });
  document.getElementById("cancelTextButton").addEventListener("click", () => textDialog.close());

  objectColor.addEventListener("input", () => {
    const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
    if (!selected) return;
    selected.color = objectColor.value;
    renderCanvas();
  });
  objectColor.addEventListener("change", () => { pushHistory(); persist(); });
  objectWidth.addEventListener("input", () => {
    const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
    if (!selected || selected.type === "text") return;
    selected.width = Number(objectWidth.value);
    renderCanvas();
  });
  objectWidth.addEventListener("change", () => { pushHistory(); persist(); });
  textSize.addEventListener("input", () => {
    const value = Number(textSize.value);
    document.getElementById("textSizeValue").value = String(value);
    updateSelectedTextProperty("fontSize", value);
  });
  textSize.addEventListener("change", () => { pushHistory(); persist(); });
  textPadding.addEventListener("input", () => {
    const value = Number(textPadding.value);
    document.getElementById("textPaddingValue").value = String(value);
    updateSelectedTextProperty("backgroundPadding", value);
  });
  textPadding.addEventListener("change", () => { pushHistory(); persist(); });
  document.getElementById("deleteSelected").addEventListener("click", () => {
    if (!selectedObjectId) return;
    currentPlan().objects = currentPlan().objects.filter((item) => item.id !== selectedObjectId);
    selectedObjectId = null;
    pushHistory();
    persist();
    updateEditor();
  });

  document.querySelectorAll("[data-phase]").forEach((input) => {
    input.addEventListener("change", () => {
      state.visiblePhases[input.dataset.phase] = input.checked;
      const selected = currentPlan().objects.find((item) => item.id === selectedObjectId);
      if (selected && !state.visiblePhases[selected.phase]) selectedObjectId = null;
      persist();
      updateEditor();
    });
  });
  document.getElementById("activePhase").addEventListener("change", (event) => {
    state.activePhase = PHASES.includes(event.target.value) ? event.target.value : "early";
    persist();
  });

  ["squadA", "squadB", "generalNote"].forEach((id) => {
    document.getElementById(id).addEventListener("input", (event) => {
      const key = id === "generalNote" ? "note" : id;
      currentPlan()[key] = event.target.value;
      persist();
    });
  });

  document.getElementById("addPlanButton").addEventListener("click", () => {
    const matchNumber = matchNumberFromName(currentPlan().name) || 1;
    const planLetter = nextPlanLetter(plansForCurrentMap(), matchNumber);
    const plan = createPlan(state.currentMapId, matchNumber, planLetter);
    state.plans.push(plan);
    state.currentPlanId = plan.id;
    selectedObjectId = null;
    pushHistory();
    persist();
    renderAll();
  });

  document.getElementById("addMatchButton").addEventListener("click", () => {
    const matchNumber = Math.max(0, ...plansForCurrentMap().map((plan) => matchNumberFromName(plan.name))) + 1;
    const plan = createPlan(state.currentMapId, matchNumber);
    state.plans.push(plan);
    state.currentPlanId = plan.id;
    selectedObjectId = null;
    pushHistory();
    persist();
    renderAll();
  });

  document.getElementById("deletePlanButton").addEventListener("click", () => {
    const plan = currentPlan();
    if (!plan) return;
    requestConfirmation("Hapus plan?", `Hapus ${plan.name}? Strategi dan catatan plan ini akan dihapus.`, () => {
      state.plans = state.plans.filter((item) => item.id !== plan.id);
      if (!plansForCurrentMap().length) state.plans.push(createPlan(state.currentMapId, 1));
      state.currentPlanId = plansForCurrentMap()[0].id;
      selectedObjectId = null;
      pushHistory();
      persist();
      renderAll();
      showToast(`${plan.name} berhasil dihapus.`);
    });
  });

  document.getElementById("deleteMatchButton").addEventListener("click", () => {
    const matchNumber = matchNumberFromName(currentPlan().name);
    if (!matchNumber) {
      showToast("Match yang dipilih tidak dikenali.");
      return;
    }
    const matchingPlans = plansForCurrentMap().filter((plan) => matchNumberFromName(plan.name) === matchNumber);
    requestConfirmation("Hapus match?", `Hapus Match ${matchNumber} beserta ${matchingPlans.length} plan di dalamnya?`, () => {
      const deletedPlanIds = new Set(matchingPlans.map((plan) => plan.id));
      state.plans = state.plans.filter((plan) => !deletedPlanIds.has(plan.id));
      if (!plansForCurrentMap().length) state.plans.push(createPlan(state.currentMapId, 1));
      state.currentPlanId = plansForCurrentMap()[0].id;
      selectedObjectId = null;
      pushHistory();
      persist();
      renderAll();
      showToast(`Match ${matchNumber} beserta plan-nya berhasil dihapus.`);
    });
  });

  document.getElementById("acceptConfirmButton").addEventListener("click", () => {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    confirmDialog.close();
    action?.();
  });
  document.getElementById("cancelConfirmButton").addEventListener("click", () => {
    pendingConfirmAction = null;
    confirmDialog.close();
  });
  confirmDialog.addEventListener("close", () => {
    pendingConfirmAction = null;
  });

  document.getElementById("undoButton").addEventListener("click", () => restoreHistory(historyIndex - 1));
  document.getElementById("redoButton").addEventListener("click", () => restoreHistory(historyIndex + 1));
  mapSelect.addEventListener("change", () => {
    const nextMap = MAPS.find((map) => map.id === mapSelect.value);
    if (!nextMap || nextMap.id === state.currentMapId) return;
    state.currentMapId = nextMap.id;
    ensureCurrentMapPlan();
    selectedObjectId = null;
    zoom = 1;
    image.src = nextMap.src;
    pushHistory();
    persist();
    renderAll();
    updateZoomLayout();
  });
  document.getElementById("zoomOutButton").addEventListener("click", () => setZoom(zoom / ZOOM_FACTOR));
  document.getElementById("zoomInButton").addEventListener("click", () => setZoom(zoom * ZOOM_FACTOR));
  document.getElementById("zoomResetButton").addEventListener("click", () => setZoom(1));
  canvasRegion.addEventListener("wheel", (event) => {
    if (!canvas.contains(event.target) && !canvasWrap.contains(event.target)) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR), event.clientX, event.clientY);
  }, { passive: false });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (event.key === "Escape" && appShell.classList.contains("fullscreen-fallback")) {
      event.preventDefault();
      if (appShell.classList.contains("presentation")) exitPresentation();
      appShell.classList.remove("fullscreen-fallback");
      document.body.classList.remove("fullscreen-fallback");
      syncFullscreenButton();
      updateZoomLayout();
      return;
    }
    if (appShell.classList.contains("presentation")) {
      if (event.key === "Escape") exitPresentation();
      return;
    }
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      restoreHistory(historyIndex - (event.shiftKey ? -1 : 1));
    } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      restoreHistory(historyIndex + 1);
    } else if (!typing && event.key === "Delete" && selectedObjectId) {
      currentPlan().objects = currentPlan().objects.filter((item) => item.id !== selectedObjectId);
      selectedObjectId = null;
      pushHistory();
      persist();
      updateEditor();
    } else if (!typing && event.key === "Enter" && activeTool === "polygon") finishPolygon();
    else if (!typing && event.key === "Escape") {
      if (appShell.classList.contains("presentation")) {
        exitPresentation();
      } else {
        draft = null;
        polygonPoints = [];
      }
      renderCanvas();
    }
  });

  document.getElementById("presentationButton").addEventListener("click", () => {
    const presenting = appShell.classList.toggle("presentation");
    document.getElementById("presentationButton").textContent = presenting ? "Keluar" : "Presentasi";
    if (presenting) {
      selectedObjectId = null;
      drawing = false;
      draft = null;
      polygonPoints = [];
      panStart = null;
      canvas.classList.remove("panning");
      updateEditor();
    }
    updateZoomLayout();
    renderCanvas();
  });

  function exitPresentation() {
    if (!appShell.classList.contains("presentation")) return;
    appShell.classList.remove("presentation");
    document.getElementById("presentationButton").textContent = "Presentasi";
    updateZoomLayout();
    renderCanvas();
  }

  document.getElementById("presentationBackButton").addEventListener("click", exitPresentation);

  const fullscreenButton = document.getElementById("fullscreenButton");
  function syncFullscreenButton() {
    const isFullscreen = document.fullscreenElement === appShell || appShell.classList.contains("fullscreen-fallback");
    fullscreenButton.setAttribute("aria-label", isFullscreen ? "Keluar dari layar penuh" : "Masuk layar penuh");
    fullscreenButton.title = isFullscreen ? "Keluar dari layar penuh (Esc)" : "Masuk layar penuh";
  }

  function setFullscreenFallback(enabled) {
    appShell.classList.toggle("fullscreen-fallback", enabled);
    document.body.classList.toggle("fullscreen-fallback", enabled);
    syncFullscreenButton();
    updateZoomLayout();
  }

  fullscreenButton.addEventListener("click", async () => {
    const nativeFullscreen = document.fullscreenElement === appShell;
    const fallbackFullscreen = appShell.classList.contains("fullscreen-fallback");
    if (nativeFullscreen || fallbackFullscreen) {
      try {
        if (nativeFullscreen) await document.exitFullscreen();
        if (fallbackFullscreen) setFullscreenFallback(false);
      } catch (error) {
        console.error("Gagal keluar dari mode layar penuh.", error);
        showToast("Tidak bisa keluar dari mode layar penuh. Coba lagi.");
      }
      return;
    }
    if (!document.fullscreenEnabled || typeof appShell.requestFullscreen !== "function") {
      setFullscreenFallback(true);
      showToast("Fullscreen browser tidak tersedia; mode layar penuh aplikasi diaktifkan.");
      return;
    }
    try {
      await appShell.requestFullscreen();
      setFullscreenFallback(false);
    } catch (error) {
      console.error("Gagal mengubah mode layar penuh.", error);
      setFullscreenFallback(true);
      showToast("Fullscreen browser gagal; mode layar penuh aplikasi diaktifkan.");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === appShell) setFullscreenFallback(false);
    syncFullscreenButton();
    updateZoomLayout();
  });
  syncFullscreenButton();

  document.getElementById("exportButton").addEventListener("click", () => {
    const wasFullscreen = document.fullscreenElement === appShell || appShell.classList.contains("fullscreen-fallback");
    renderCanvas(true);
    canvas.toBlob((blob) => {
      if (!blob) {
        showToast("PNG gagal dibuat. Coba lagi.");
        renderCanvas();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = currentPlan().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const safeMapName = currentMap().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      link.href = url;
      link.download = `${safeMapName}-${safeName || "strategi-ff"}.png`;
      link.click();
      if (wasFullscreen && !appShell.classList.contains("fullscreen-fallback")) {
        window.setTimeout(() => {
          if (!document.fullscreenElement && !appShell.classList.contains("fullscreen-fallback")) {
            setFullscreenFallback(true);
          }
        }, 250);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Strategi berhasil diekspor sebagai PNG.");
      renderCanvas();
    }, "image/png");
  });

  image.addEventListener("load", renderCanvas);
  image.addEventListener("error", () => {
    console.error(`Map ${currentMap().name} gagal dimuat dari ${currentMap().src}.`);
    showToast(`Map ${currentMap().name} gagal dimuat.`);
    renderCanvas();
  });

  window.addEventListener("resize", () => {
    updateZoomLayout();
    renderCanvas();
  });
  updateZoomLayout();
  pushHistory();
  renderAll();
})();
