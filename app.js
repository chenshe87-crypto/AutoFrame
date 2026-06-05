const stage = document.querySelector("#stage");
const ctx = stage.getContext("2d");
const LOGICAL_WIDTH = 1200;
const LOGICAL_HEIGHT = 780;
const CANVAS_PADDING = 16;
const MIN_FRAME_SIZE = 80;
const ACCENT_COLOR = "#ff6f6f";
const ACCENT_FILL = "rgba(255, 111, 111, 0.14)";

const ratioPresets = {
  free: null,
  square: 1,
  classic: 4 / 3,
  wide: 16 / 9,
};

let renderScale = 1;

const state = {
  mode: "mosaic",
  fit: "cover",
  tool: "move",
  gap: 0,
  radius: 0,
  showGrid: true,
  blankLimit: 0.1,
  fillAxis: "auto",
  ratioPreset: "free",
  ratioLocked: false,
  lockedRatio: 960 / 560,
  customRatioW: 3,
  customRatioH: 2,
  exportScale: 2,
  backgroundColor: "#f4f6f7",
  randomStep: 0,
  randomMax: 0,
  validRandomSteps: [],
  fillCounts: { auto: 0, vertical: 0, horizontal: 0 },
  nextImageId: 1,
  images: [],
  frame: { x: 120, y: 96, w: 960, h: 560 },
  layouts: [],
  manualSlotOrder: null,
  selectedImageId: null,
  dragGhost: null,
  pointer: null,
  draggingOver: false,
};

const els = {
  moveTool: document.querySelector("#moveTool"),
  imageTool: document.querySelector("#imageTool"),
  ratioLock: document.querySelector("#ratioLock"),
  fileInput: document.querySelector("#fileInput"),
  addButton: document.querySelector("#addButton"),
  demoButton: document.querySelector("#demoButton"),
  exportButton: document.querySelector("#exportButton"),
  reverseButton: document.querySelector("#reverseButton"),
  clearImagesButton: document.querySelector("#clearImagesButton"),
  ratioW: document.querySelector("#ratioW"),
  ratioH: document.querySelector("#ratioH"),
  applyRatio: document.querySelector("#applyRatio"),
  bgColor: document.querySelector("#bgColor"),
  eyedropperButton: document.querySelector("#eyedropperButton"),
  bgR: document.querySelector("#bgR"),
  bgG: document.querySelector("#bgG"),
  bgB: document.querySelector("#bgB"),
  gapRange: document.querySelector("#gapRange"),
  gapValue: document.querySelector("#gapValue"),
  roundRange: document.querySelector("#roundRange"),
  roundValue: document.querySelector("#roundValue"),
  showGrid: document.querySelector("#showGrid"),
  shuffleButton: document.querySelector("#shuffleButton"),
  imageCount: document.querySelector("#imageCount"),
  frameSize: document.querySelector("#frameSize"),
  dropState: document.querySelector("#dropState"),
  thumbList: document.querySelector("#thumbList"),
  modes: [...document.querySelectorAll(".mode-button")],
  fits: [...document.querySelectorAll(".fit-button")],
  blanks: [...document.querySelectorAll(".blank-button")],
  fills: [...document.querySelectorAll(".fill-button")],
  ratios: [...document.querySelectorAll(".ratio-button")],
  qualities: [...document.querySelectorAll(".quality-button")],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function setHighQuality(context) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}

function componentToHex(value) {
  return clamp(Math.round(Number(value) || 0), 0, 255)
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex(r, g, b) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function setBackgroundColor(hex) {
  state.backgroundColor = hex.toLowerCase();
  draw();
}

function updateRangeProgress(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-fill", `${clamp(percent, 0, 100)}%`);
}

async function pickBackgroundColor() {
  if (!("EyeDropper" in window)) {
    els.bgColor.click();
    return;
  }

  try {
    const result = await new EyeDropper().open();
    if (result?.sRGBHex) setBackgroundColor(result.sRGBHex);
  } catch (error) {
    // Canceling the native eyedropper is expected and should leave the color unchanged.
  }
}

function setupCanvasResolution() {
  renderScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  stage.width = Math.round(LOGICAL_WIDTH * renderScale);
  stage.height = Math.round(LOGICAL_HEIGHT * renderScale);
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  setHighQuality(ctx);
}

function hashValue(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function randomValue(salt) {
  if (!state.randomStep) return 0;
  return hashValue(`${state.randomStep}:${salt}`);
}

function randomRank(image, salt) {
  return randomValue(`${image.id}:${salt}`);
}

function aspectOf(image) {
  return image.width / image.height;
}

function aspectBucket(image) {
  const aspect = aspectOf(image);
  if (aspect >= 1.8) return "panorama";
  if (aspect >= 1.18) return "wide";
  if (aspect <= 0.56) return "portrait";
  if (aspect <= 0.85) return "tall";
  return "square";
}

function aspectProfile(images) {
  return images.reduce(
    (profile, image) => {
      profile[aspectBucket(image)] += 1;
      return profile;
    },
    { panorama: 0, wide: 0, square: 0, tall: 0, portrait: 0 },
  );
}

const bucketOrders = [
  ["panorama", "wide", "square", "tall", "portrait"],
  ["portrait", "tall", "square", "wide", "panorama"],
  ["square", "wide", "tall", "panorama", "portrait"],
  ["wide", "panorama", "square", "portrait", "tall"],
  ["tall", "portrait", "square", "wide", "panorama"],
];

function templateOrderedImages(images, salt) {
  const order = bucketOrders[
    Math.min(bucketOrders.length - 1, Math.floor(randomValue(`${salt}-bucket-order`) * bucketOrders.length))
  ];
  const direction = randomValue(`${salt}-inside-direction`) > 0.5 ? 1 : -1;
  const originalIndex = new Map(images.map((image, index) => [image.id, index]));

  return [...images].sort((a, b) => {
    const bucketDelta = order.indexOf(aspectBucket(a)) - order.indexOf(aspectBucket(b));
    if (bucketDelta) return bucketDelta;
    const aspectDelta = (aspectOf(a) - aspectOf(b)) * direction;
    if (Math.abs(aspectDelta) > 0.001) return aspectDelta;
    return originalIndex.get(a.id) - originalIndex.get(b.id);
  });
}

function templateHeroImage(images, salt, axis) {
  const profile = aspectProfile(images);
  const wideFirst = ["panorama", "wide", "square", "tall", "portrait"];
  const tallFirst = ["portrait", "tall", "square", "wide", "panorama"];
  const balanced = ["square", "wide", "tall", "panorama", "portrait"];
  const options = axis === "column"
    ? [tallFirst, balanced, wideFirst]
    : [wideFirst, balanced, tallFirst];
  const order = options[
    Math.min(options.length - 1, Math.floor(randomValue(`${salt}-hero-bucket`) * options.length))
  ];
  const bucket = order.find((item) => profile[item] > 0) || aspectBucket(images[0]);
  const candidates = images.filter((image) => aspectBucket(image) === bucket);
  return [...candidates].sort((a, b) => {
    if (bucket === "panorama" || bucket === "wide") return aspectOf(b) - aspectOf(a);
    if (bucket === "portrait" || bucket === "tall") return aspectOf(a) - aspectOf(b);
    return Math.abs(aspectOf(a) - 1) - Math.abs(aspectOf(b) - 1);
  })[0] || images[0];
}

function aspectOfRect(rect) {
  return rect.w / rect.h;
}

function factorialCapped(value, cap) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
    if (result >= cap) return cap;
  }
  return result;
}

function canvasPoint(event) {
  const rect = stage.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function currentRatio() {
  return state.ratioLocked
    ? state.lockedRatio
    : ratioPresets[state.ratioPreset] || state.frame.w / state.frame.h;
}

function customRatioValue() {
  const width = clamp(Number(state.customRatioW) || 1, 1, 999);
  const height = clamp(Number(state.customRatioH) || 1, 1, 999);
  return width / height;
}

function clampFrameToCanvas(frame) {
  const w = clamp(frame.w, MIN_FRAME_SIZE, LOGICAL_WIDTH - CANVAS_PADDING * 2);
  const h = clamp(frame.h, MIN_FRAME_SIZE, LOGICAL_HEIGHT - CANVAS_PADDING * 2);
  return {
    x: clamp(frame.x, CANVAS_PADDING, LOGICAL_WIDTH - w - CANVAS_PADDING),
    y: clamp(frame.y, CANVAS_PADDING, LOGICAL_HEIGHT - h - CANVAS_PADDING),
    w,
    h,
  };
}

function applyRatioToFrame(ratio) {
  const centerX = state.frame.x + state.frame.w / 2;
  const centerY = state.frame.y + state.frame.h / 2;
  const maxW = LOGICAL_WIDTH - CANVAS_PADDING * 2;
  const maxH = LOGICAL_HEIGHT - CANVAS_PADDING * 2;
  let w = state.frame.w;
  let h = w / ratio;

  if (h > maxH) {
    h = Math.min(state.frame.h, maxH);
    w = h * ratio;
  }
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }

  state.frame = clampFrameToCanvas({
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h,
  });
}

function setRatioPreset(preset) {
  state.ratioPreset = preset;
  state.randomStep = 0;
  if (preset === "free") {
    state.ratioLocked = false;
    state.lockedRatio = state.frame.w / state.frame.h;
  } else if (preset === "custom") {
    state.ratioLocked = true;
    state.lockedRatio = customRatioValue();
    applyRatioToFrame(state.lockedRatio);
  } else {
    state.ratioLocked = true;
    state.lockedRatio = ratioPresets[preset];
    applyRatioToFrame(state.lockedRatio);
  }
  draw();
}

function applyCustomRatio() {
  state.customRatioW = clamp(Number(els.ratioW.value) || 1, 1, 999);
  state.customRatioH = clamp(Number(els.ratioH.value) || 1, 1, 999);
  setRatioPreset("custom");
}

function toggleRatioLock() {
  state.ratioLocked = !state.ratioLocked;
  state.lockedRatio = state.frame.w / state.frame.h;
  if (!state.ratioLocked && state.ratioPreset !== "free") {
    state.ratioPreset = "free";
  }
  draw();
}

function frameCorners(frame = state.frame) {
  const { x, y, w, h } = frame;
  return [
    { handle: "nw", x, y },
    { handle: "ne", x: x + w, y },
    { handle: "se", x: x + w, y: y + h },
    { handle: "sw", x, y: y + h },
  ];
}

function hitFrameHandle(point) {
  const hitRadius = 22;
  return frameCorners().find((corner) => {
    const dx = point.x - corner.x;
    const dy = point.y - corner.y;
    return Math.hypot(dx, dy) <= hitRadius;
  })?.handle;
}

function resizeFrameFromHandle(original, handle, point) {
  if (state.ratioLocked) {
    return resizeFrameWithAspect(original, handle, point);
  }

  let left = original.x;
  let top = original.y;
  let right = original.x + original.w;
  let bottom = original.y + original.h;

  if (handle.includes("w")) left = clamp(point.x, CANVAS_PADDING, right - MIN_FRAME_SIZE);
  if (handle.includes("e")) right = clamp(point.x, left + MIN_FRAME_SIZE, LOGICAL_WIDTH - CANVAS_PADDING);
  if (handle.includes("n")) top = clamp(point.y, CANVAS_PADDING, bottom - MIN_FRAME_SIZE);
  if (handle.includes("s")) bottom = clamp(point.y, top + MIN_FRAME_SIZE, LOGICAL_HEIGHT - CANVAS_PADDING);

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function resizeFrameWithAspect(original, handle, point) {
  const ratio = currentRatio();
  const fixedX = handle.includes("e") ? original.x : original.x + original.w;
  const fixedY = handle.includes("s") ? original.y : original.y + original.h;
  const growsRight = handle.includes("e");
  const growsDown = handle.includes("s");

  const maxW = growsRight
    ? LOGICAL_WIDTH - CANVAS_PADDING - fixedX
    : fixedX - CANVAS_PADDING;
  const maxH = growsDown
    ? LOGICAL_HEIGHT - CANVAS_PADDING - fixedY
    : fixedY - CANVAS_PADDING;
  const maxWidthByBounds = Math.max(MIN_FRAME_SIZE, Math.min(maxW, maxH * ratio));

  let rawW = Math.abs(point.x - fixedX);
  let rawH = Math.abs(point.y - fixedY);
  if (rawW / Math.max(rawH, 1) > ratio) {
    rawW = rawH * ratio;
  }

  const w = clamp(rawW, MIN_FRAME_SIZE, maxWidthByBounds);
  const h = w / ratio;

  return {
    x: growsRight ? fixedX : fixedX - w,
    y: growsDown ? fixedY : fixedY - h,
    w,
    h,
  };
}

function updateCanvasCursor(event) {
  if (state.pointer) return;
  const point = canvasPoint(event);
  const handle = hitFrameHandle(point);
  const cursors = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
  };
  if (handle) {
    stage.style.cursor = cursors[handle];
    return;
  }

  const inside =
    point.x >= state.frame.x &&
    point.x <= state.frame.x + state.frame.w &&
    point.y >= state.frame.y &&
    point.y <= state.frame.y + state.frame.h;
  if (state.tool === "image") {
    stage.style.cursor = hitLayoutImage(point) ? "grab" : "default";
    return;
  }
  stage.style.cursor = inside ? "move" : "crosshair";
}

function roundedRect(context, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function drawGrid(context) {
  if (!state.showGrid) return;
  context.save();
  context.strokeStyle = "rgba(111, 125, 140, 0.16)";
  context.lineWidth = 1;
  for (let x = 0; x <= LOGICAL_WIDTH; x += 40) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, LOGICAL_HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= LOGICAL_HEIGHT; y += 40) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(LOGICAL_WIDTH, y + 0.5);
    context.stroke();
  }
  context.restore();
}

function computeLayouts() {
  if (!state.images.length) {
    state.layouts = [];
    state.randomMax = 0;
    state.randomStep = 0;
    state.validRandomSteps = [];
    state.manualSlotOrder = null;
    state.selectedImageId = null;
    state.dragGhost = null;
    return;
  }
  if (state.manualSlotOrder && state.manualSlotOrder.length !== state.images.length) {
    state.manualSlotOrder = null;
  }

  state.fillCounts = fillVariantCounts();
  state.validRandomSteps = validRandomStepsForAxis(state.fillAxis);
  state.randomMax = state.validRandomSteps.length;
  if (state.randomStep && !state.validRandomSteps.includes(state.randomStep)) {
    state.randomStep = 0;
  }

  state.layouts = generateCurrentLayout();
}

function generateCurrentLayout() {
  let layouts;
  const images = orderedImagesForLayout();
  if (state.mode === "grid") {
    layouts = state.randomStep ? randomGridLayout(images) : gridLayout(images);
  } else if (state.mode === "rows") {
    layouts = state.fit === "contain"
      ? randomAwareContainRowsLayout(images)
      : state.randomStep
        ? randomRowsLayout(images)
        : rowsLayout(images);
  } else if (state.fit === "contain") {
    layouts = state.randomStep
      ? randomContainMosaicLayout(images)
      : containMosaicLayout(images);
  } else {
    layouts = state.randomStep ? randomCoverMosaicLayout(images) : mosaicLayout(images);
  }
  return state.fit === "cover" ? applyManualSlotOrder(layouts) : layouts;
}

function orderedImagesForLayout() {
  if (!state.manualSlotOrder || state.manualSlotOrder.length !== state.images.length) {
    return state.images;
  }

  const imageById = new Map(state.images.map((image) => [image.id, image]));
  const ordered = state.manualSlotOrder.map((id) => imageById.get(id)).filter(Boolean);
  return ordered.length === state.images.length ? ordered : state.images;
}

function applyManualSlotOrder(layouts) {
  if (!state.manualSlotOrder || state.manualSlotOrder.length !== layouts.length) {
    return layouts;
  }

  const imageById = new Map(state.images.map((image) => [image.id, image]));
  const used = new Set();
  return layouts.map((layout, index) => {
    const image = imageById.get(state.manualSlotOrder[index]);
    if (!image || used.has(image.id)) return layout;
    used.add(image.id);
    return { ...layout, image };
  });
}

function hitLayoutImage(point) {
  for (let index = state.layouts.length - 1; index >= 0; index -= 1) {
    const rect = state.layouts[index];
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.w &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.h
    ) {
      return rect;
    }
  }
  return null;
}

function setTool(tool) {
  state.tool = tool;
  state.pointer = null;
  state.dragGhost = null;
  draw();
}

function swapImagesById(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const slotOrder = state.layouts.map((layout) => layout.image.id);
  const sourceSlot = slotOrder.indexOf(sourceId);
  const targetSlot = slotOrder.indexOf(targetId);
  if (sourceSlot >= 0 && targetSlot >= 0) {
    [slotOrder[sourceSlot], slotOrder[targetSlot]] = [slotOrder[targetSlot], slotOrder[sourceSlot]];
  }

  const imageById = new Map(state.images.map((image) => [image.id, image]));
  const ordered = slotOrder.map((id) => imageById.get(id)).filter(Boolean);
  if (ordered.length === state.images.length) {
    state.images = ordered;
    state.manualSlotOrder = slotOrder;
  } else {
    const sourceIndex = state.images.findIndex((image) => image.id === sourceId);
    const targetIndex = state.images.findIndex((image) => image.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    [state.images[sourceIndex], state.images[targetIndex]] = [
      state.images[targetIndex],
      state.images[sourceIndex],
    ];
    state.manualSlotOrder = null;
  }

  if (state.fit === "contain") {
    state.randomStep = 0;
  }
  state.selectedImageId = sourceId;
  state.dragGhost = null;
  renderThumbs();
  draw();
}

function applyRandomToFixedLayout(layouts) {
  if (!state.randomStep || layouts.length < 2 || !state.randomMax) return layouts;

  const next = layouts.map((layout) => ({ ...layout }));
  if (state.fit === "contain") {
    containShuffleGroups(next).forEach((group, groupIndex) => {
      const images = group
        .map((index) => next[index].image)
        .sort(
          (a, b) =>
            randomRank(a, `contain-${groupIndex}`) -
            randomRank(b, `contain-${groupIndex}`),
        );

      group.forEach((slotIndex, imageIndex) => {
        next[slotIndex].image = images[imageIndex];
      });
    });
    return normalizeContainRows(next);
  }

  const offset = state.randomStep % layouts.length;
  const sortedSlots = next
    .map((layout, index) => ({ index, aspect: aspectOfRect(layout) }))
    .sort((a, b) => a.aspect - b.aspect);
  const images = next
    .map((layout) => layout.image)
    .sort((a, b) => randomRank(a, "cover-slot") - randomRank(b, "cover-slot"));

  sortedSlots.forEach((slot, index) => {
    next[slot.index].image = images[(index + offset) % images.length];
  });

  return next;
}

function containShuffleGroups(layouts) {
  const threshold = state.mode === "grid" ? 0.1 : 0.12;
  const rows = layoutRows(layouts);
  const groups = [];

  rows.forEach((row, rowIndex) => {
    if (row.length < 2) return;
    const slots = row
      .map((index) => ({
        index,
        imageAspect: aspectOf(layouts[index].image),
      }))
      .sort((a, b) => a.imageAspect - b.imageAspect);
    let current = [];
    let anchor = null;

    slots.forEach((slot) => {
      const closeToAnchor =
        anchor === null || Math.abs(Math.log(slot.imageAspect / anchor)) <= threshold;

      if (current.length && !closeToAnchor) {
        if (current.length > 1) {
          groups.push(current.map((item) => item.index));
        }
        current = [];
        anchor = null;
      }

      current.push(slot);
      if (anchor === null) anchor = slot.imageAspect;
    });

    if (current.length > 1) {
      groups.push(current.map((item) => item.index));
    }

    if (state.mode !== "grid" && !groups.some((group) => group.some((index) => row.includes(index)))) {
      const ordered = row
        .slice()
        .sort((a, b) => layouts[a].x - layouts[b].x);
      const adjacent = [];
      for (let index = 1; index < ordered.length; index += 1) {
        const left = layouts[ordered[index - 1]];
        const right = layouts[ordered[index]];
        const close =
          Math.abs(Math.log(aspectOf(left.image) / aspectOf(right.image))) <=
          threshold * 1.7;
        if (close) adjacent.push(ordered[index - 1], ordered[index]);
      }
      const unique = [...new Set(adjacent)];
      if (unique.length > 1) groups.push(unique);
    }
  });

  return groups;
}

function layoutRows(layouts) {
  const rows = [];
  layouts
    .map((layout, index) => ({ ...layout, index }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .forEach((layout) => {
      const row = rows.find((item) => {
        const reference = layouts[item[0]];
        return Math.abs(layout.y - reference.y) <= Math.max(4, Math.min(layout.h, reference.h) * 0.25);
      });

      if (row) {
        row.push(layout.index);
      } else {
        rows.push([layout.index]);
      }
    });

  rows.forEach((row) => row.sort((a, b) => layouts[a].x - layouts[b].x));
  return rows;
}

function normalizeContainRows(layouts) {
  const normalized = layouts.map((layout) => ({ ...layout }));
  const { x, w } = state.frame;
  const gap = state.gap;

  layoutRows(normalized).forEach((row) => {
    const rowRects = row.map((index) => normalized[index]);
    const rowTop = Math.min(...rowRects.map((rect) => rect.y));
    const rowBottom = Math.max(...rowRects.map((rect) => rect.y + rect.h));
    const rowBandHeight = rowBottom - rowTop;
    const aspectTotal = row.reduce(
      (total, index) => total + aspectOf(normalized[index].image),
      0,
    );
    const availableWidth = w - gap * (row.length - 1);
    const rowHeight = Math.min(rowBandHeight, availableWidth / aspectTotal);
    const rowWidth = rowHeight * aspectTotal + gap * (row.length - 1);
    let cursorX = x + Math.max(0, w - rowWidth) / 2;
    const cursorY = rowTop + Math.max(0, rowBandHeight - rowHeight) / 2;

    row.forEach((index) => {
      const rect = normalized[index];
      rect.x = cursorX;
      rect.y = cursorY;
      rect.w = rowHeight * aspectOf(rect.image);
      rect.h = rowHeight;
      cursorX += rect.w + gap;
    });
  });

  return normalized;
}

function randomVariantMax(layouts) {
  if (layouts.length < 2) return 0;

  if (state.fit === "contain") {
    const groups = containShuffleGroups(layouts);
    const capByMode = {
      grid: 6,
      rows: 10,
      mosaic: 12,
    };
    const cap = capByMode[state.mode] || 12;
    const variants = groups.reduce(
      (total, group) => total * factorialCapped(group.length, cap + 1),
      1,
    );
    return Math.max(0, Math.min(cap, variants - 1));
  }

  const byMode = {
    grid: 10,
    rows: 14,
    mosaic: 18,
  };
  return Math.min(byMode[state.mode] || 12, Math.max(0, layouts.length * 2));
}

function randomVariantMaxForCurrent() {
  const count = state.images.length;
  if (count < 2) return 0;

  if (state.fit === "contain") {
    const byMode = {
      grid: Math.min(10, count + 2),
      rows: Math.min(16, count * 2),
      mosaic: Math.min(60, count * 8),
    };
    return byMode[state.mode] || Math.min(12, count * 2);
  }

  const byMode = {
    grid: Math.min(12, count + 4),
    rows: Math.min(18, count * 2),
    mosaic: Math.min(32, count * 4),
  };
  return byMode[state.mode] || Math.min(16, count * 2);
}

function validRandomStepsForAxis(axis) {
  const rawMax = randomVariantMaxForCurrent();
  if (!rawMax) return [];

  const originalStep = state.randomStep;
  const originalAxis = state.fillAxis;
  const candidates = [];
  const seenStyles = new Set();
  state.fillAxis = axis;

  for (let step = 1; step <= rawMax; step += 1) {
    state.randomStep = step;
    const layouts = generateCurrentLayout();
    const blankRatio = layoutBlankRatio(layouts);
    const styleSignature = layoutStyleSignature(layouts);
    if (
      !seenStyles.has(styleSignature) &&
      (state.fit !== "contain" || blankRatio <= effectiveBlankLimit()) &&
      respectsFillAxis(layouts, state.frame)
    ) {
      seenStyles.add(styleSignature);
      candidates.push(step);
    }
  }

  state.randomStep = originalStep;
  state.fillAxis = originalAxis;
  return candidates;
}

function layoutStyleSignature(layouts) {
  if (!layouts.length) return "empty";
  const precision = 24;
  return layouts
    .map((rect) => ({
      x: Math.round(((rect.x - state.frame.x) / state.frame.w) * precision),
      y: Math.round(((rect.y - state.frame.y) / state.frame.h) * precision),
      w: Math.round((rect.w / state.frame.w) * precision),
      h: Math.round((rect.h / state.frame.h) * precision),
      bucket: aspectBucket(rect.image),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.bucket.localeCompare(b.bucket))
    .map((rect) => `${rect.x},${rect.y},${rect.w},${rect.h},${rect.bucket}`)
    .join("|");
}

function fillVariantCounts() {
  if (state.fit !== "contain" || state.images.length < 2) {
    return { auto: 0, vertical: 0, horizontal: 0 };
  }

  return {
    auto: validRandomStepsForAxis("auto").length,
    vertical: validRandomStepsForAxis("vertical").length,
    horizontal: validRandomStepsForAxis("horizontal").length,
  };
}

function effectiveBlankLimit() {
  return state.blankLimit <= 0 ? 0.005 : state.blankLimit;
}

function layoutBlankRatio(layouts) {
  return layoutBlankRatioInFrame(layouts, state.frame);
}

function layoutBlankRatioInFrame(layouts, frame) {
  const frameArea = frame.w * frame.h;
  if (!frameArea || !layouts.length) return 1;
  const usedArea = layouts.reduce((total, rect) => total + drawnImageArea(rect), 0);
  return clamp(1 - Math.min(usedArea, frameArea) / frameArea, 0, 1);
}

function drawnImageArea(rect) {
  if (state.fit !== "contain") return rect.w * rect.h;
  const source = rect.image.el;
  const scale = Math.min(rect.w / source.naturalWidth, rect.h / source.naturalHeight);
  return source.naturalWidth * scale * source.naturalHeight * scale;
}

function respectsFillAxis(layouts, frame) {
  if (state.fit !== "contain" || state.fillAxis === "auto") return true;
  if (!layouts.length) return false;

  const { horizontalGap, verticalGap } = axisCoverage(layouts, frame);
  const tolerance = Math.max(0.006, state.gap / Math.max(frame.w, frame.h));

  if (state.fillAxis === "vertical") {
    return verticalGap <= tolerance;
  }
  if (state.fillAxis === "horizontal") {
    return horizontalGap <= tolerance;
  }
  return true;
}

function gridLayout(images) {
  const { x, y, w, h } = state.frame;
  const gap = state.gap;
  const n = images.length;
  const avgAspect =
    images.reduce((total, item) => total + aspectOf(item), 0) / n;

  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    const score =
      Math.abs(Math.log(Math.max(0.01, cellW / cellH) / avgAspect)) +
      (cols * rows - n) * 0.08;
    if (score < best.score) best = { cols, rows, score };
  }

  const layouts = [];
  let index = 0;
  for (let row = 0; row < best.rows; row += 1) {
    const remaining = n - index;
    const rowCount = Math.min(best.cols, remaining);
    const cellW = (w - gap * (rowCount - 1)) / rowCount;
    const cellH = (h - gap * (best.rows - 1)) / best.rows;
    for (let col = 0; col < rowCount; col += 1) {
      layouts.push({
        image: images[index],
        x: x + col * (cellW + gap),
        y: y + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
      index += 1;
    }
  }
  return layouts;
}

function randomGridLayout(images) {
  const { x, y, w, h } = state.frame;
  const gap = state.gap;
  const n = images.length;
  const avgAspect =
    images.reduce((total, item) => total + aspectOf(item), 0) / n;
  const candidates = [];

  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    const score =
      Math.abs(Math.log(Math.max(0.01, cellW / cellH) / avgAspect)) +
      (cols * rows - n) * 0.08;
    candidates.push({ cols, rows, score });
  }

  candidates.sort((a, b) => a.score - b.score);
  const candidateCount = Math.min(4, candidates.length);
  const chosen = candidates[
    Math.min(candidateCount - 1, Math.floor(randomValue("grid-template") * candidateCount))
  ];
  const ordered = randomOrderedImages(images, "grid");
  const layouts = [];
  let index = 0;

  for (let row = 0; row < chosen.rows; row += 1) {
    const remaining = n - index;
    const rowCount = Math.min(chosen.cols, remaining);
    const cellW = (w - gap * (rowCount - 1)) / rowCount;
    const cellH = (h - gap * (chosen.rows - 1)) / chosen.rows;
    for (let col = 0; col < rowCount; col += 1) {
      layouts.push({
        image: ordered[index],
        x: x + col * (cellW + gap),
        y: y + row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
      index += 1;
    }
  }

  return layouts;
}

function rowsLayout(images) {
  const { x, y, w, h } = state.frame;
  const gap = state.gap;
  const n = images.length;
  const frameAspect = w / h;
  const targetRows = clamp(Math.round(Math.sqrt(n / frameAspect)), 1, n);
  const rows = Array.from({ length: targetRows }, () => []);
  images.forEach((image, index) => rows[index % targetRows].push(image));

  const usableHeight = h - gap * (targetRows - 1);
  const weights = rows.map((row) =>
    row.reduce((sum, image) => sum + image.height / image.width, 0),
  );
  const weightTotal = weights.reduce((sum, item) => sum + item, 0) || 1;

  const layouts = [];
  let cy = y;
  rows.forEach((row, rowIndex) => {
    const rowH = rowIndex === rows.length - 1
      ? y + h - cy
      : Math.max(24, usableHeight * (weights[rowIndex] / weightTotal));
    const usableWidth = w - gap * (row.length - 1);
    const ratioTotal =
      row.reduce((sum, image) => sum + image.width / image.height, 0) || 1;
    let cx = x;
    row.forEach((image, imageIndex) => {
      const cellW = imageIndex === row.length - 1
        ? x + w - cx
        : usableWidth * ((image.width / image.height) / ratioTotal);
      layouts.push({ image, x: cx, y: cy, w: cellW, h: rowH });
      cx += cellW + gap;
    });
    cy += rowH + gap;
  });

  return layouts;
}

function randomRowsLayout(images) {
  const ordered = randomOrderedImages(images, "rows-cover");
  return rowsLayout(ordered);
}

function randomOrderedImages(images, salt) {
  return [...images].sort(
    (a, b) => randomRank(a, salt) - randomRank(b, salt),
  );
}

function containMosaicOrder(images) {
  const sorted = [...images].sort((a, b) => aspectOf(b) - aspectOf(a));
  const ordered = [];
  sorted.forEach((image, index) => {
    if (index % 2 === 0) {
      ordered.push(image);
    } else {
      ordered.unshift(image);
    }
  });
  return ordered;
}

function splitAspectRows(sequence, rowCount) {
  const targetAspect =
    sequence.reduce((total, image) => total + aspectOf(image), 0) / rowCount;
  const rows = [];
  let row = [];
  let rowAspect = 0;

  sequence.forEach((image, index) => {
    const imageAspect = aspectOf(image);
    const remainingImages = sequence.length - index;
    const remainingRows = rowCount - rows.length;
    const mustKeepSpace = remainingImages <= remainingRows;
    const shouldBreak =
      row.length &&
      rows.length < rowCount - 1 &&
      !mustKeepSpace &&
      Math.abs(rowAspect - targetAspect) <
        Math.abs(rowAspect + imageAspect - targetAspect);

    if (shouldBreak) {
      rows.push(row);
      row = [];
      rowAspect = 0;
    }

    row.push(image);
    rowAspect += imageAspect;
  });

  if (row.length) rows.push(row);

  while (rows.length < rowCount) {
    const donorIndex = rows.reduce(
      (best, item, index) => (item.length > rows[best].length ? index : best),
      0,
    );
    const donor = rows[donorIndex];
    if (donor.length < 2) break;
    rows.splice(donorIndex + 1, 0, donor.splice(Math.ceil(donor.length / 2)));
  }

  return rows.filter((item) => item.length);
}

function measureContainRows(rows, frame = state.frame) {
  const { w, h } = frame;
  const gap = state.gap;
  const naturalHeights = rows.map((row) => {
    const rowAspect = row.reduce((total, image) => total + aspectOf(image), 0);
    return (w - gap * (row.length - 1)) / rowAspect;
  });
  const naturalHeightTotal =
    naturalHeights.reduce((total, item) => total + item, 0) || 1;
  const availableHeight = Math.max(40, h - gap * (rows.length - 1));
  const scale = Math.min(1, availableHeight / naturalHeightTotal);
  const heights = naturalHeights.map((item) => item * scale);
  const totalHeight =
    heights.reduce((total, item) => total + item, 0) + gap * (rows.length - 1);
  const averageHeight =
    heights.reduce((total, item) => total + item, 0) / Math.max(1, heights.length);
  const variance =
    heights.reduce((total, item) => total + Math.abs(item - averageHeight), 0) /
    Math.max(1, heights.length);
  const singleRows = rows.filter((row) => row.length === 1).length;
  const tallest = Math.max(...heights);
  const shortest = Math.min(...heights);
  const unevenness = tallest - shortest;

  return {
    heights,
    scale,
    totalHeight,
    score:
      Math.abs(h - totalHeight) +
      (1 - scale) * h * 1.6 +
      variance * 0.65 +
      unevenness * 0.55 +
      singleRows * h * 0.18,
  };
}

function containRowsLayout(images, sequence = images, frame = state.frame, options = {}) {
  if (!options.axisResolved) {
    if (state.fillAxis === "vertical") {
      return containColumnsLayout(images, sequence, frame, {
        ...options,
        axisResolved: true,
      });
    }
    if (state.fillAxis === "auto") {
      const rowLayouts = containRowsLayout(images, sequence, frame, {
        ...options,
        axisResolved: true,
      });
      const columnLayouts = containColumnsLayout(images, sequence, frame, {
        ...options,
        axisResolved: true,
      });
      return layoutBlankRatioInFrame(columnLayouts, frame) <
        layoutBlankRatioInFrame(rowLayouts, frame)
        ? columnLayouts
        : rowLayouts;
    }
  }

  const { x, y, w, h } = frame;
  const gap = state.gap;
  let best = null;
  const minRows = options.rowCount || 1;
  const maxRows = options.rowCount || sequence.length;

  for (let rowCount = minRows; rowCount <= maxRows; rowCount += 1) {
    const rows = splitAspectRows(sequence, rowCount);
    const measurement = measureContainRows(rows, frame);
    if (!best || measurement.score < best.measurement.score) {
      best = { rows, measurement };
    }
  }

  const layouts = [];
  let cy = y + Math.max(0, h - best.measurement.totalHeight) / 2;

  best.rows.forEach((row, rowIndex) => {
    const rowHeight = best.measurement.heights[rowIndex];
    const rowWidth =
      row.reduce((total, image) => total + rowHeight * aspectOf(image), 0) +
      gap * (row.length - 1);
    let cx = x + Math.max(0, w - rowWidth) / 2;

    row.forEach((image) => {
      const cellWidth = rowHeight * aspectOf(image);
      layouts.push({ image, x: cx, y: cy, w: cellWidth, h: rowHeight });
      cx += cellWidth + gap;
    });

    cy += rowHeight + gap;
  });

  return layouts;
}

function splitAspectColumns(sequence, columnCount) {
  const targetInverse =
    sequence.reduce((total, image) => total + 1 / aspectOf(image), 0) /
    columnCount;
  const columns = [];
  let column = [];
  let columnInverse = 0;

  sequence.forEach((image, index) => {
    const imageInverse = 1 / aspectOf(image);
    const remainingImages = sequence.length - index;
    const remainingColumns = columnCount - columns.length;
    const mustKeepSpace = remainingImages <= remainingColumns;
    const shouldBreak =
      column.length &&
      columns.length < columnCount - 1 &&
      !mustKeepSpace &&
      Math.abs(columnInverse - targetInverse) <
        Math.abs(columnInverse + imageInverse - targetInverse);

    if (shouldBreak) {
      columns.push(column);
      column = [];
      columnInverse = 0;
    }

    column.push(image);
    columnInverse += imageInverse;
  });

  if (column.length) columns.push(column);

  while (columns.length < columnCount) {
    const donorIndex = columns.reduce(
      (best, item, index) => (item.length > columns[best].length ? index : best),
      0,
    );
    const donor = columns[donorIndex];
    if (donor.length < 2) break;
    columns.splice(donorIndex + 1, 0, donor.splice(Math.ceil(donor.length / 2)));
  }

  return columns.filter((item) => item.length);
}

function measureContainColumns(columns, frame = state.frame) {
  const { w, h } = frame;
  const gap = state.gap;
  const naturalWidths = columns.map((column) => {
    const columnInverse = column.reduce(
      (total, image) => total + 1 / aspectOf(image),
      0,
    );
    return (h - gap * (column.length - 1)) / columnInverse;
  });
  const naturalWidthTotal =
    naturalWidths.reduce((total, item) => total + item, 0) || 1;
  const availableWidth = Math.max(40, w - gap * (columns.length - 1));
  const scale = Math.min(1, availableWidth / naturalWidthTotal);
  const widths = naturalWidths.map((item) => item * scale);
  const totalWidth =
    widths.reduce((total, item) => total + item, 0) + gap * (columns.length - 1);
  const averageWidth =
    widths.reduce((total, item) => total + item, 0) / Math.max(1, widths.length);
  const variance =
    widths.reduce((total, item) => total + Math.abs(item - averageWidth), 0) /
    Math.max(1, widths.length);
  const singleColumns = columns.filter((column) => column.length === 1).length;
  const widest = Math.max(...widths);
  const narrowest = Math.min(...widths);

  return {
    widths,
    scale,
    totalWidth,
    score:
      Math.abs(w - totalWidth) +
      (1 - scale) * w * 1.6 +
      variance * 0.65 +
      (widest - narrowest) * 0.55 +
      singleColumns * w * 0.18,
  };
}

function containColumnsLayout(images, sequence = images, frame = state.frame, options = {}) {
  const { x, y, w, h } = frame;
  const gap = state.gap;
  let best = null;
  const minColumns = options.rowCount || 1;
  const maxColumns = options.rowCount || sequence.length;

  for (let columnCount = minColumns; columnCount <= maxColumns; columnCount += 1) {
    const columns = splitAspectColumns(sequence, columnCount);
    const measurement = measureContainColumns(columns, frame);
    if (state.fillAxis === "vertical" && measurement.scale < 0.998) {
      measurement.score += frame.w * 4;
    }
    if (!best || measurement.score < best.measurement.score) {
      best = { columns, measurement };
    }
  }

  const layouts = [];
  let cx = x + Math.max(0, w - best.measurement.totalWidth) / 2;

  best.columns.forEach((column, columnIndex) => {
    const columnWidth = best.measurement.widths[columnIndex];
    const columnHeight =
      column.reduce((total, image) => total + columnWidth / aspectOf(image), 0) +
      gap * (column.length - 1);
    let cy = y + Math.max(0, h - columnHeight) / 2;

    column.forEach((image) => {
      const cellHeight = columnWidth / aspectOf(image);
      layouts.push({ image, x: cx, y: cy, w: columnWidth, h: cellHeight });
      cy += cellHeight + gap;
    });

    cx += columnWidth + gap;
  });

  return layouts;
}

function containMosaicLayout(images) {
  return containRowsLayout(
    images,
    state.manualSlotOrder ? images : containMosaicOrder(images),
  );
}

function randomContainMosaicLayout(images) {
  if (images.length < 3) return randomAwareContainRowsLayout(images);

  if (state.fillAxis === "vertical") {
    return randomContainMosaicColumnLayout(images);
  }
  if (state.fillAxis === "auto") {
    const rowLayouts = randomContainMosaicRowLayout(images);
    const columnLayouts = randomContainMosaicColumnLayout(images);
    return layoutBlankRatioInFrame(columnLayouts, state.frame) <
      layoutBlankRatioInFrame(rowLayouts, state.frame)
      ? columnLayouts
      : rowLayouts;
  }

  return randomContainMosaicRowLayout(images);
}

function randomContainMosaicRowLayout(images) {
  const frameAspect = state.frame.w / state.frame.h;
  const hero = templateHeroImage(images, "row", "row");
  const rest = images.filter((image) => image !== hero);
  const rowCount = clamp(
    2 + Math.floor(randomValue("board-row-count") * 3),
    2,
    Math.min(4, images.length),
  );
  const heroSlot = Math.min(
    rowCount - 1,
    Math.floor(randomValue("hero-row") * rowCount),
  );
  const groups = Array.from({ length: rowCount }, () => []);
  groups[heroSlot].push(hero);
  const ordered = templateOrderedImages(rest, "board-rest-row");
  const targetRowAspect =
    state.frame.w / Math.max(1, (state.frame.h - state.gap * (rowCount - 1)) / rowCount);

  ordered.forEach((image) => {
    let bestRow = 0;
    let bestScore = Infinity;

    groups.forEach((group, rowIndex) => {
      const currentAspect = group.reduce((total, item) => total + aspectOf(item), 0);
      const nextAspect = currentAspect + aspectOf(image);
      const heroPenalty = rowIndex === heroSlot
        ? 1.4 + group.length * (aspectOf(hero) > frameAspect ? 1.25 : 0.85)
        : 0;
      const emptyPenalty = group.length ? 0 : 0.18;
      const score =
        Math.abs(nextAspect - targetRowAspect) +
        heroPenalty +
        emptyPenalty +
        randomValue(`row-choice-${aspectBucket(image)}-${rowIndex}`) * 0.22;

      if (score < bestScore) {
        bestScore = score;
        bestRow = rowIndex;
      }
    });

    groups[bestRow].push(image);
  });

  const compactGroups = groups.filter((group) => group.length);
  const layouts = layoutContainGroups(compactGroups, state.frame);

  if (!layouts.length) {
    return randomAwareContainRowsLayout(images);
  }

  return layouts;
}

function randomContainMosaicColumnLayout(images) {
  const searched = searchVerticalFillLayout(images);
  if (searched) return searched;

  const hero = templateHeroImage(images, "column", "column");
  const rest = images.filter((image) => image !== hero);
  const columnCount = clamp(
    2 + Math.floor(randomValue("board-column-count") * 3),
    2,
    Math.min(4, images.length),
  );
  const heroSlot = Math.min(
    columnCount - 1,
    Math.floor(randomValue("hero-column") * columnCount),
  );
  const groups = Array.from({ length: columnCount }, () => []);
  groups[heroSlot].push(hero);
  const ordered = templateOrderedImages(rest, "board-rest-column");
  const targetColumnInverse =
    state.frame.h /
    Math.max(1, (state.frame.w - state.gap * (columnCount - 1)) / columnCount);

  ordered.forEach((image) => {
    let bestColumn = 0;
    let bestScore = Infinity;

    groups.forEach((group, columnIndex) => {
      const currentInverse = group.reduce(
        (total, item) => total + 1 / aspectOf(item),
        0,
      );
      const nextInverse = currentInverse + 1 / aspectOf(image);
      const heroPenalty =
        columnIndex === heroSlot
          ? 1.2 + group.length * (aspectOf(hero) < 1 ? 1.1 : 0.75)
          : 0;
      const emptyPenalty = group.length ? 0 : 0.18;
      const score =
        Math.abs(nextInverse - targetColumnInverse) +
        heroPenalty +
        emptyPenalty +
        randomValue(`column-choice-${aspectBucket(image)}-${columnIndex}`) * 0.22;

      if (score < bestScore) {
        bestScore = score;
        bestColumn = columnIndex;
      }
    });

    groups[bestColumn].push(image);
  });

  const compactGroups = groups.filter((group) => group.length);
  const layouts = layoutContainColumnGroups(compactGroups, state.frame);

  if (!layouts.length) {
    return containColumnsLayout(images, randomOrderedImages(images, "column-fallback"));
  }

  return layouts;
}

function searchVerticalFillLayout(images) {
  const maxColumns = Math.min(images.length, 6);
  const sequences = [
    randomOrderedImages(images, "vertical-search-a"),
    randomOrderedImages(images, "vertical-search-b").sort(
      (a, b) => 1 / aspectOf(b) - 1 / aspectOf(a),
    ),
    randomOrderedImages(images, "vertical-search-c").sort(
      (a, b) => 1 / aspectOf(a) - 1 / aspectOf(b),
    ),
  ];
  let best = null;

  sequences.forEach((sequence, sequenceIndex) => {
    for (let columnCount = 1; columnCount <= maxColumns; columnCount += 1) {
      const groups = splitAspectColumns(sequence, columnCount);
      const layouts = layoutContainColumnGroups(groups, state.frame);
      const inside = layoutsInsideFrame(layouts, state.frame);
      if (!inside) continue;

      const verticalOk = axisCoverage(layouts, state.frame).verticalGap <=
        Math.max(0.006, state.gap / Math.max(state.frame.w, state.frame.h));
      if (!verticalOk) continue;

      const blankRatio = layoutBlankRatioInFrame(layouts, state.frame);
      const score =
        blankRatio +
        columnCount * 0.004 +
        sequenceIndex * 0.002 +
        randomValue(`vertical-search-score-${sequenceIndex}-${columnCount}`) * 0.006;

      if (!best || score < best.score) {
        best = { layouts, score };
      }
    }
  });

  return best?.layouts || null;
}

function layoutsInsideFrame(layouts, frame) {
  const boundsTolerance = 1.5;
  return layouts.every(
    (rect) =>
      rect.x >= frame.x - boundsTolerance &&
      rect.y >= frame.y - boundsTolerance &&
      rect.x + rect.w <= frame.x + frame.w + boundsTolerance &&
      rect.y + rect.h <= frame.y + frame.h + boundsTolerance,
  );
}

function axisCoverage(layouts, frame) {
  const minX = Math.min(...layouts.map((rect) => rect.x));
  const maxX = Math.max(...layouts.map((rect) => rect.x + rect.w));
  const minY = Math.min(...layouts.map((rect) => rect.y));
  const maxY = Math.max(...layouts.map((rect) => rect.y + rect.h));
  return {
    horizontalGap: 1 - clamp((maxX - minX) / frame.w, 0, 1),
    verticalGap: 1 - clamp((maxY - minY) / frame.h, 0, 1),
  };
}

function layoutContainGroups(groups, frame) {
  if (state.fillAxis === "vertical") {
    return layoutContainColumnGroups(groups, frame);
  }
  if (state.fillAxis === "auto") {
    const rowLayouts = layoutContainRowGroups(groups, frame);
    const columnLayouts = layoutContainColumnGroups(groups, frame);
    return layoutBlankRatioInFrame(columnLayouts, frame) <
      layoutBlankRatioInFrame(rowLayouts, frame)
      ? columnLayouts
      : rowLayouts;
  }
  return layoutContainRowGroups(groups, frame);
}

function layoutContainRowGroups(groups, frame) {
  const gap = state.gap;
  const rowAspects = groups.map((group) =>
    group.reduce((total, image) => total + aspectOf(image), 0),
  );
  const naturalHeights = rowAspects.map((aspect, index) => {
    const imageWidth = Math.max(1, frame.w - gap * (groups[index].length - 1));
    return imageWidth / aspect;
  });
  const availableImageHeight = Math.max(1, frame.h - gap * (groups.length - 1));
  const scale = Math.min(
    1,
    availableImageHeight /
      (naturalHeights.reduce((total, height) => total + height, 0) || 1),
  );
  const heights = naturalHeights.map((height) => height * scale);
  const totalHeight =
    heights.reduce((total, height) => total + height, 0) +
    gap * (groups.length - 1);
  let y = frame.y + Math.max(0, frame.h - totalHeight) / 2;
  const layouts = [];

  groups.forEach((group, rowIndex) => {
    const rowHeight = heights[rowIndex];
    const rowWidth =
      rowAspects[rowIndex] * rowHeight +
      gap * (group.length - 1);
    let x = frame.x + Math.max(0, frame.w - rowWidth) / 2;

    group.forEach((image) => {
      const width = rowHeight * aspectOf(image);
      layouts.push({ image, x, y, w: width, h: rowHeight });
      x += width + gap;
    });

    y += rowHeight + gap;
  });

  return layouts;
}

function layoutContainColumnGroups(groups, frame) {
  const gap = state.gap;
  const columnInverses = groups.map((group) =>
    group.reduce((total, image) => total + 1 / aspectOf(image), 0),
  );
  const naturalWidths = columnInverses.map((inverse, index) => {
    const imageHeight = Math.max(1, frame.h - gap * (groups[index].length - 1));
    return imageHeight / inverse;
  });
  const availableImageWidth = Math.max(1, frame.w - gap * (groups.length - 1));
  const naturalTotal = naturalWidths.reduce((total, width) => total + width, 0) || 1;
  const scale = Math.min(1, availableImageWidth / naturalTotal);
  const widths = naturalWidths.map((width) => width * scale);
  const totalWidth =
    widths.reduce((total, width) => total + width, 0) +
    gap * (groups.length - 1);
  let x = frame.x + Math.max(0, frame.w - totalWidth) / 2;
  const layouts = [];

  groups.forEach((group, columnIndex) => {
    const columnWidth = widths[columnIndex];
    const columnHeight =
      group.reduce((total, image) => total + columnWidth / aspectOf(image), 0) +
      gap * (group.length - 1);
    let y = frame.y + Math.max(0, frame.h - columnHeight) / 2;

    group.forEach((image) => {
      const height = columnWidth / aspectOf(image);
      layouts.push({ image, x, y, w: columnWidth, h: height });
      y += height + gap;
    });

    x += columnWidth + gap;
  });

  return layouts;
}

function heroLayoutInFrame(hero, rest, frame, position, scale) {
  const gap = state.gap;
  const minRest = 90;
  const aspect = aspectOf(hero);
  const layouts = [];
  let heroRect = null;
  let areas = [];

  if (position === "top" || position === "bottom") {
    let heroH = clamp(frame.h * scale, 80, frame.h - minRest - gap);
    let heroW = Math.min(frame.w, heroH * aspect);
    heroH = heroW / aspect;
    const heroX = frame.x + (frame.w - heroW) / 2;
    const heroY = position === "top" ? frame.y : frame.y + frame.h - heroH;
    heroRect = { image: hero, x: heroX, y: heroY, w: heroW, h: heroH };
    areas = [
      position === "top"
        ? { x: frame.x, y: frame.y + heroH + gap, w: frame.w, h: frame.h - heroH - gap }
        : { x: frame.x, y: frame.y, w: frame.w, h: frame.h - heroH - gap },
    ];
  } else if (position === "left" || position === "right") {
    let heroW = clamp(frame.w * scale, 80, frame.w - minRest - gap);
    let heroH = Math.min(frame.h, heroW / aspect);
    heroW = heroH * aspect;
    const heroX = position === "left" ? frame.x : frame.x + frame.w - heroW;
    const heroY = frame.y + (frame.h - heroH) / 2;
    heroRect = { image: hero, x: heroX, y: heroY, w: heroW, h: heroH };
    areas = [
      position === "left"
        ? { x: frame.x + heroW + gap, y: frame.y, w: frame.w - heroW - gap, h: frame.h }
        : { x: frame.x, y: frame.y, w: frame.w - heroW - gap, h: frame.h },
    ];
  } else {
    let heroH = clamp(frame.h * scale, 80, frame.h * 0.58);
    let heroW = Math.min(frame.w, heroH * aspect);
    heroH = heroW / aspect;
    const spareH = frame.h - heroH - gap * 2;
    if (spareH < minRest) return null;
    const topH = spareH * (0.28 + randomValue("middle-top") * 0.44);
    const bottomH = spareH - topH;
    heroRect = {
      image: hero,
      x: frame.x + (frame.w - heroW) / 2,
      y: frame.y + topH + gap,
      w: heroW,
      h: heroH,
    };
    areas = [
      { x: frame.x, y: frame.y, w: frame.w, h: topH },
      { x: frame.x, y: heroRect.y + heroH + gap, w: frame.w, h: bottomH },
    ];
  }

  const usableAreas = areas.filter((area) => area.w >= 80 && area.h >= 80);
  if (!heroRect || !usableAreas.length) return null;
  layouts.push(heroRect);
  layouts.push(...layoutImagesInAreas(rest, usableAreas));
  return layouts;
}

function layoutImagesInAreas(images, areas) {
  if (!images.length) return [];
  if (images.length === 1) {
    const area = [...areas].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return containRowsLayout(images, images, area);
  }
  const ordered = randomOrderedImages(images, "area-order").sort((a, b) => {
    const direction = randomValue("area-aspect-direction") > 0.5 ? 1 : -1;
    return (aspectOf(a) - aspectOf(b)) * direction +
      (randomRank(a, "area-jitter") - randomRank(b, "area-jitter")) * 0.2;
  });

  if (areas.length === 1) {
    return containRowsLayout(ordered, ordered, areas[0]);
  }

  const totalArea = areas.reduce((total, area) => total + area.w * area.h, 0);
  const firstCount = clamp(
    Math.round(ordered.length * ((areas[0].w * areas[0].h) / totalArea)),
    1,
    ordered.length - 1,
  );
  const first = ordered.slice(0, firstCount);
  const second = ordered.slice(firstCount);

  return [
    ...containRowsLayout(first, first, areas[0]),
    ...(second.length ? containRowsLayout(second, second, areas[1]) : []),
  ];
}

function randomAwareContainRowsLayout(images) {
  if (!state.randomStep) return containRowsLayout(images);
  const baseRows = Math.max(
    1,
    Math.round(Math.sqrt(images.length / (state.frame.w / state.frame.h))),
  );
  const rowShift = Math.floor(randomValue("contain-row-shift") * 3) - 1;
  const rowCount = clamp(baseRows + rowShift, 1, images.length);
  const sequence = templateOrderedImages(images, "contain-rows");
  return containRowsLayout(images, sequence, state.frame, { rowCount });
}

function mosaicLayout(images) {
  const gap = state.gap;
  const sorted = [...images].sort((a, b) => aspectOf(b) - aspectOf(a));

  function split(items, rect, depth = 0) {
    if (items.length === 1) return [{ image: items[0], ...rect }];
    if (rect.w <= gap * 2 || rect.h <= gap * 2) {
      return items.map((image) => ({ image, ...rect }));
    }

    const total = items.reduce((sum, image) => sum + image.width / image.height, 0);
    let bestIndex = 1;
    let bestScore = Infinity;
    let running = 0;

    for (let index = 1; index < items.length; index += 1) {
      running += items[index - 1].width / items[index - 1].height;
      const score = Math.abs(running / total - 0.5);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const first = items.slice(0, bestIndex);
    const second = items.slice(bestIndex);
    const firstWeight = first.reduce(
      (sum, image) => sum + image.width / image.height,
      0,
    );
    const secondWeight = total - firstWeight || 1;
    const splitVertical = rect.w >= rect.h;

    if (splitVertical) {
      const firstW = clamp(
        (rect.w - gap) * (firstWeight / (firstWeight + secondWeight)),
        Math.min(rect.w - gap, 42),
        Math.max(42, rect.w - gap - 42),
      );
      return [
        ...split(first, { x: rect.x, y: rect.y, w: firstW, h: rect.h }, depth + 1),
        ...split(second, {
          x: rect.x + firstW + gap,
          y: rect.y,
          w: rect.w - firstW - gap,
          h: rect.h,
        }, depth + 1),
      ];
    }

    const firstH = clamp(
      (rect.h - gap) * (secondWeight / (firstWeight + secondWeight)),
      Math.min(rect.h - gap, 42),
      Math.max(42, rect.h - gap - 42),
    );
    return [
      ...split(first, { x: rect.x, y: rect.y, w: rect.w, h: firstH }, depth + 1),
      ...split(second, {
        x: rect.x,
        y: rect.y + firstH + gap,
        w: rect.w,
        h: rect.h - firstH - gap,
      }, depth + 1),
    ];
  }

  return split(sorted, { ...state.frame });
}

function randomCoverMosaicLayout(images) {
  const gap = state.gap;
  const ordered = [...images].sort((a, b) => {
    const aspectWeight = 0.25 + randomValue("cover-aspect-weight") * 0.55;
    const aspectScore = (aspectOf(b) - aspectOf(a)) * aspectWeight;
    const randomScore =
      randomRank(a, "cover-mosaic-order") - randomRank(b, "cover-mosaic-order");
    return aspectScore + randomScore;
  });

  function split(items, rect, depth = 0) {
    if (items.length === 1) return [{ image: items[0], ...rect }];
    if (rect.w <= gap * 2 || rect.h <= gap * 2) {
      return items.map((image) => ({ image, ...rect }));
    }

    const total = items.reduce((sum, image) => sum + aspectOf(image), 0);
    let bestIndex = 1;
    let bestScore = Infinity;
    let running = 0;
    const target = 0.32 + randomValue(`cover-target-${depth}-${items.length}`) * 0.36;

    for (let index = 1; index < items.length; index += 1) {
      running += aspectOf(items[index - 1]);
      const score = Math.abs(running / total - target);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    let first = items.slice(0, bestIndex);
    let second = items.slice(bestIndex);
    if (randomValue(`cover-swap-${depth}-${items.length}`) > 0.5) {
      [first, second] = [second, first];
    }

    const firstWeight = first.reduce((sum, image) => sum + aspectOf(image), 0);
    const secondWeight = second.reduce((sum, image) => sum + aspectOf(image), 0) || 1;
    const splitVertical =
      rect.w / rect.h > 1.35 ||
      (rect.w > rect.h * 0.85 && randomValue(`cover-axis-${depth}`) > 0.35);

    if (splitVertical) {
      const firstW = clamp(
        (rect.w - gap) * (firstWeight / (firstWeight + secondWeight)),
        Math.min(rect.w - gap, 54),
        Math.max(54, rect.w - gap - 54),
      );
      return [
        ...split(first, { x: rect.x, y: rect.y, w: firstW, h: rect.h }, depth + 1),
        ...split(second, {
          x: rect.x + firstW + gap,
          y: rect.y,
          w: rect.w - firstW - gap,
          h: rect.h,
        }, depth + 1),
      ];
    }

    const firstH = clamp(
      (rect.h - gap) * (secondWeight / (firstWeight + secondWeight)),
      Math.min(rect.h - gap, 54),
      Math.max(54, rect.h - gap - 54),
    );
    return [
      ...split(first, { x: rect.x, y: rect.y, w: rect.w, h: firstH }, depth + 1),
      ...split(second, {
        x: rect.x,
        y: rect.y + firstH + gap,
        w: rect.w,
        h: rect.h - firstH - gap,
      }, depth + 1),
    ];
  }

  return split(ordered, { ...state.frame });
}

function drawImageCover(context, image, rect) {
  const source = image.el;
  const scale = Math.max(rect.w / source.naturalWidth, rect.h / source.naturalHeight);
  const sw = rect.w / scale;
  const sh = rect.h / scale;
  const sx = (source.naturalWidth - sw) / 2;
  const sy = (source.naturalHeight - sh) / 2;

  context.save();
  setHighQuality(context);
  roundedRect(context, rect.x, rect.y, rect.w, rect.h, state.radius);
  context.clip();
  context.drawImage(source, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
  context.restore();
}

function drawImageContain(context, image, rect) {
  const source = image.el;
  const scale = Math.min(rect.w / source.naturalWidth, rect.h / source.naturalHeight);
  const dw = source.naturalWidth * scale;
  const dh = source.naturalHeight * scale;
  const dx = rect.x + (rect.w - dw) / 2;
  const dy = rect.y + (rect.h - dh) / 2;

  context.save();
  setHighQuality(context);
  roundedRect(context, rect.x, rect.y, rect.w, rect.h, state.radius);
  context.clip();
  context.fillStyle = state.backgroundColor;
  context.fillRect(rect.x, rect.y, rect.w, rect.h);
  context.drawImage(source, dx, dy, dw, dh);
  context.restore();
}

function drawLayoutImage(context, image, rect) {
  if (state.fit === "contain") {
    drawImageContain(context, image, rect);
  } else {
    drawImageCover(context, image, rect);
  }
}

function drawFrame(context, fillBackground = true) {
  const { x, y, w, h } = state.frame;
  context.save();
  if (fillBackground) {
    context.shadowColor = "rgba(24, 32, 43, 0.16)";
    context.shadowBlur = 24;
    context.shadowOffsetY = 12;
    context.fillStyle = state.backgroundColor;
    roundedRect(context, x, y, w, h, state.radius);
    context.fill();
    context.shadowColor = "transparent";
  }
  context.strokeStyle = ACCENT_COLOR;
  context.lineWidth = 2;
  context.setLineDash([8, 7]);
  roundedRect(context, x, y, w, h, state.radius);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = ACCENT_COLOR;
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ].forEach(([cx, cy]) => {
    context.beginPath();
    context.arc(cx, cy, 5, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawEmptyState(context) {
  const { x, y, w, h } = state.frame;
  context.save();
  context.fillStyle = "#66707e";
  context.font = "700 20px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("图片区", x + w / 2, y + h / 2 - 12);
  context.fillStyle = "rgba(102, 112, 126, 0.76)";
  context.font = "14px system-ui, sans-serif";
  context.fillText("0 张", x + w / 2, y + h / 2 + 18);
  context.restore();
}

function drawDropOverlay(context) {
  if (!state.draggingOver) return;
  context.save();
  context.fillStyle = ACCENT_FILL;
  context.strokeStyle = ACCENT_COLOR;
  context.lineWidth = 3;
  roundedRect(context, state.frame.x, state.frame.y, state.frame.w, state.frame.h, Math.max(8, state.radius));
  context.fill();
  context.stroke();
  context.restore();
}

function drawSwapOverlay(context) {
  if (state.tool !== "image" && state.pointer?.action !== "swap-image") return;
  const selectedRect = state.layouts.find(
    (rect) => rect.image.id === state.selectedImageId,
  );
  if (!selectedRect && state.pointer?.action !== "swap-image") return;

  const sourceRect = state.layouts.find(
    (rect) => rect.image.id === state.pointer?.sourceImageId,
  );
  const targetRect = state.layouts.find(
    (rect) => rect.image.id === state.pointer?.targetImageId,
  );

  context.save();
  if (selectedRect) {
    context.lineWidth = 3;
    context.strokeStyle = ACCENT_COLOR;
    context.setLineDash([]);
    roundedRect(context, selectedRect.x, selectedRect.y, selectedRect.w, selectedRect.h, state.radius + 3);
    context.stroke();
  }
  context.lineWidth = 4;
  if (sourceRect && state.pointer?.action === "swap-image") {
    context.strokeStyle = "#e85f4c";
    context.setLineDash([10, 8]);
    roundedRect(context, sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, state.radius + 2);
    context.stroke();
  }
  if (targetRect && state.pointer?.action === "swap-image") {
    context.strokeStyle = "#f4b64a";
    context.setLineDash([]);
    roundedRect(context, targetRect.x, targetRect.y, targetRect.w, targetRect.h, state.radius + 2);
    context.stroke();
  }
  context.restore();

  drawDragGhost(context);
}

function drawDragGhost(context) {
  if (!state.dragGhost) return;
  const image = state.images.find((item) => item.id === state.dragGhost.imageId);
  if (!image) return;
  const maxW = 150;
  const maxH = 110;
  const imageAspect = aspectOf(image);
  let w = maxW;
  let h = w / imageAspect;
  if (h > maxH) {
    h = maxH;
    w = h * imageAspect;
  }
  const x = state.dragGhost.x - w / 2;
  const y = state.dragGhost.y - h / 2;

  context.save();
  context.globalAlpha = 0.82;
  context.shadowColor = "rgba(24, 32, 43, 0.28)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  drawImageCover(context, image, { x, y, w, h });
  context.shadowColor = "transparent";
  context.globalAlpha = 1;
  context.lineWidth = 2;
  context.strokeStyle = ACCENT_COLOR;
  roundedRect(context, x, y, w, h, state.radius);
  context.stroke();
  context.restore();
}

function draw() {
  computeLayouts();
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  ctx.fillStyle = "#f4f7f9";
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  drawGrid(ctx);
  drawFrame(ctx);
  if (state.layouts.length) {
    ctx.save();
    roundedRect(ctx, state.frame.x, state.frame.y, state.frame.w, state.frame.h, state.radius);
    ctx.clip();
    state.layouts.forEach((rect) => drawLayoutImage(ctx, rect.image, rect));
    ctx.restore();
    drawFrame(ctx, false);
    drawSwapOverlay(ctx);
  } else {
    drawEmptyState(ctx);
  }
  drawDropOverlay(ctx);
  syncUi();
}

function syncUi() {
  els.imageCount.textContent = `${state.images.length} 张图片`;
  els.frameSize.textContent = `${Math.round(state.frame.w)} × ${Math.round(state.frame.h)}`;
  els.clearImagesButton.disabled = state.images.length === 0;
  stage.dataset.insideFrame = String(layoutsInsideFrame(state.layouts, state.frame));
  stage.dataset.backgroundColor = state.backgroundColor;
  stage.dataset.layoutCount = String(state.layouts.length);
  els.gapValue.textContent = state.gap;
  els.roundValue.textContent = state.radius;
  els.gapRange.value = state.gap;
  els.roundRange.value = state.radius;
  updateRangeProgress(els.gapRange);
  updateRangeProgress(els.roundRange);
  els.dropState.textContent = state.draggingOver ? "释放图片" : "本地处理";
  els.moveTool.classList.toggle("active", state.tool === "move");
  els.imageTool.classList.toggle("active", state.tool === "image");
  els.ratioLock.classList.toggle("active", state.ratioLocked);
  els.ratioLock.textContent = state.ratioLocked ? "比例已锁定" : "锁定当前比例";
  els.ratios.forEach((button) => {
    button.classList.toggle("active", button.dataset.ratio === state.ratioPreset);
  });
  if (document.activeElement !== els.ratioW) els.ratioW.value = state.customRatioW;
  if (document.activeElement !== els.ratioH) els.ratioH.value = state.customRatioH;
  els.qualities.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.scale) === state.exportScale);
  });
  const { r, g, b } = hexToRgb(state.backgroundColor);
  if (document.activeElement !== els.bgColor) els.bgColor.value = state.backgroundColor;
  if (document.activeElement !== els.bgR) els.bgR.value = r;
  if (document.activeElement !== els.bgG) els.bgG.value = g;
  if (document.activeElement !== els.bgB) els.bgB.value = b;
  els.shuffleButton.classList.toggle("active", state.randomStep > 0);
  els.shuffleButton.disabled = state.randomMax === 0;
  const displayStep = state.randomStep
    ? state.validRandomSteps.indexOf(state.randomStep) + 1
    : 0;
  els.shuffleButton.textContent = state.randomMax
    ? `随机板式 ${displayStep}/${state.randomMax}`
    : "随机板式";
  syncFillLabels();
}

function syncFillLabels() {
  const labels = {
    auto: "自动",
    vertical: "上下",
    horizontal: "左右",
  };
  els.fills.forEach((button) => {
    const key = button.dataset.fill;
    const count = state.fillCounts[key] || 0;
    button.textContent =
      state.fit === "contain" && state.images.length ? `${labels[key]} ${count}` : labels[key];
  });
}

function renderThumbs() {
  els.thumbList.innerHTML = "";
  if (!state.images.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "暂无图片";
    els.thumbList.append(empty);
    return;
  }

  state.images.forEach((image, index) => {
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.draggable = true;
    item.dataset.index = index;

    const img = document.createElement("img");
    img.src = image.src;
    img.alt = image.name;

    const meta = document.createElement("div");
    meta.className = "thumb-meta";
    meta.innerHTML = `<span class="thumb-name"></span><span class="thumb-size">${image.width} × ${image.height}</span>`;
    meta.querySelector(".thumb-name").textContent = image.name;

    const remove = document.createElement("button");
    remove.className = "remove-thumb";
    remove.type = "button";
    remove.title = "移除";
    remove.setAttribute("aria-label", "移除");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(image.src);
      state.images.splice(index, 1);
      state.randomStep = 0;
      state.manualSlotOrder = null;
      if (state.selectedImageId === image.id) state.selectedImageId = null;
      renderThumbs();
      draw();
    });

    item.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", String(index));
    });
    item.addEventListener("dragover", (event) => event.preventDefault());
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      const to = Number(item.dataset.index);
      if (Number.isNaN(from) || from === to) return;
      const [moved] = state.images.splice(from, 1);
      state.images.splice(to, 0, moved);
      state.randomStep = 0;
      state.manualSlotOrder = null;
      renderThumbs();
      draw();
    });

    item.append(img, meta, remove);
    els.thumbList.append(item);
  });
}

async function addFiles(files) {
  const imageFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const loaded = await Promise.all(
    imageFiles.map(
      (file) =>
        new Promise((resolve) => {
          const src = URL.createObjectURL(file);
          const image = new Image();
          image.onload = () =>
            resolve({
              el: image,
              src,
              name: file.name,
              width: image.naturalWidth,
              height: image.naturalHeight,
              id: state.nextImageId++,
            });
          image.onerror = () => {
            URL.revokeObjectURL(src);
            resolve(null);
          };
          image.src = src;
        }),
    ),
  );

  state.images.push(...loaded.filter(Boolean));
  state.randomStep = 0;
  state.manualSlotOrder = null;
  renderThumbs();
  draw();
}

function makeDemoImage(index) {
  const sizes = [
    [900, 620],
    [560, 820],
    [1100, 620],
    [760, 760],
    [620, 980],
    [1180, 720],
    [720, 1080],
    [980, 680],
  ];
  const palettes = [
    ["#ff9863", "#ff6f6f", "#ffffff"],
    ["#e85f4c", "#25364a", "#ffffff"],
    ["#3c4652", "#ff7a6b", "#f7f3ea"],
    ["#8a4fff", "#00a6a6", "#fff4d6"],
    ["#e9c46a", "#d9573f", "#18324a"],
    ["#3a86ff", "#ffbe0b", "#fff"],
    ["#0b6e4f", "#e6aace", "#f8fafc"],
    ["#5c677d", "#ff7a59", "#ffffff"],
  ];

  const [width, height] = sizes[index % sizes.length];
  const [a, b, c] = palettes[index % palettes.length];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  const gradient = g.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, a);
  gradient.addColorStop(1, b);
  g.fillStyle = gradient;
  g.fillRect(0, 0, width, height);
  g.globalAlpha = 0.22;
  g.fillStyle = c;
  for (let step = 0; step < 7; step += 1) {
    const radius = Math.min(width, height) * (0.1 + step * 0.035);
    g.beginPath();
    g.arc(width * (0.18 + step * 0.12), height * (0.22 + (step % 3) * 0.24), radius, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = "rgba(255, 255, 255, 0.88)";
  g.font = `800 ${Math.round(Math.min(width, height) * 0.16)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(index + 1).padStart(2, "0"), width / 2, height / 2);

  const src = canvas.toDataURL("image/png");
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        el: image,
        src,
        name: `demo-${index + 1}.png`,
        width,
        height,
        id: state.nextImageId++,
      });
    image.src = src;
  });
}

async function addDemoImages() {
  state.images.forEach((image) => {
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
  });
  state.images = await Promise.all(
    Array.from({ length: 8 }, (_, index) => makeDemoImage(index)),
  );
  state.randomStep = 0;
  state.manualSlotOrder = null;
  renderThumbs();
  draw();
}

function fitFrameToCanvas() {
  state.frame = {
    x: 90,
    y: 80,
    w: LOGICAL_WIDTH - 180,
    h: LOGICAL_HEIGHT - 160,
  };
  draw();
}

function exportPng() {
  computeLayouts();
  const output = document.createElement("canvas");
  const scale = state.exportScale;
  output.width = Math.round(state.frame.w * scale);
  output.height = Math.round(state.frame.h * scale);
  const outputCtx = output.getContext("2d");
  outputCtx.setTransform(scale, 0, 0, scale, 0, 0);
  setHighQuality(outputCtx);
  outputCtx.fillStyle = state.backgroundColor;
  outputCtx.fillRect(0, 0, state.frame.w, state.frame.h);

  outputCtx.save();
  roundedRect(outputCtx, 0, 0, state.frame.w, state.frame.h, 10);
  outputCtx.clip();
  state.layouts.forEach((rect) => {
    drawLayoutImage(outputCtx, rect.image, {
      x: rect.x - state.frame.x,
      y: rect.y - state.frame.y,
      w: rect.w,
      h: rect.h,
    });
  });
  outputCtx.restore();

  const link = document.createElement("a");
  link.download = `autoframe-${Date.now()}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

els.moveTool.addEventListener("click", () => setTool("move"));
els.imageTool.addEventListener("click", () => setTool("image"));
els.ratioLock.addEventListener("click", toggleRatioLock);
els.applyRatio.addEventListener("click", applyCustomRatio);
[els.ratioW, els.ratioH].forEach((input) => {
  input.addEventListener("input", () => {
    state.customRatioW = clamp(Number(els.ratioW.value) || 1, 1, 999);
    state.customRatioH = clamp(Number(els.ratioH.value) || 1, 1, 999);
    if (state.ratioPreset === "custom") {
      state.ratioLocked = true;
      state.lockedRatio = customRatioValue();
      applyRatioToFrame(state.lockedRatio);
      draw();
    }
  });
});
els.bgColor.addEventListener("input", (event) => {
  setBackgroundColor(event.target.value);
});
els.eyedropperButton.addEventListener("click", pickBackgroundColor);
[els.bgR, els.bgG, els.bgB].forEach((input) => {
  input.addEventListener("input", () => {
    setBackgroundColor(rgbToHex(els.bgR.value, els.bgG.value, els.bgB.value));
  });
});
els.addButton.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
els.demoButton.addEventListener("click", addDemoImages);
els.exportButton.addEventListener("click", exportPng);
els.clearImagesButton.addEventListener("click", () => {
  state.images.forEach((image) => URL.revokeObjectURL(image.src));
  state.images = [];
  state.randomStep = 0;
  state.manualSlotOrder = null;
  state.selectedImageId = null;
  renderThumbs();
  draw();
});
els.reverseButton.addEventListener("click", () => {
  state.images.reverse();
  state.randomStep = 0;
  state.manualSlotOrder = null;
  renderThumbs();
  draw();
});
els.gapRange.addEventListener("input", (event) => {
  state.gap = Number(event.target.value);
  draw();
});
els.roundRange.addEventListener("input", (event) => {
  state.radius = Number(event.target.value);
  draw();
});
els.showGrid.addEventListener("change", (event) => {
  state.showGrid = event.target.checked;
  draw();
});
els.shuffleButton.addEventListener("click", () => {
  if (!state.randomMax) return;
  const currentIndex = state.validRandomSteps.indexOf(state.randomStep);
  const nextIndex = currentIndex >= state.validRandomSteps.length - 1 ? -1 : currentIndex + 1;
  state.randomStep = nextIndex === -1 ? 0 : state.validRandomSteps[nextIndex];
  state.manualSlotOrder = null;
  draw();
});
els.modes.forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    state.randomStep = 0;
    state.manualSlotOrder = null;
    els.modes.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    draw();
  });
});
els.fits.forEach((button) => {
  button.addEventListener("click", () => {
    state.fit = button.dataset.fit;
    state.randomStep = 0;
    state.manualSlotOrder = null;
    els.fits.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    draw();
  });
});
els.blanks.forEach((button) => {
  button.addEventListener("click", () => {
    state.blankLimit = Number(button.dataset.blank);
    state.randomStep = 0;
    state.manualSlotOrder = null;
    els.blanks.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    draw();
  });
});
els.fills.forEach((button) => {
  button.addEventListener("click", () => {
    state.fillAxis = button.dataset.fill;
    state.randomStep = 0;
    state.manualSlotOrder = null;
    els.fills.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    draw();
  });
});
els.ratios.forEach((button) => {
  button.addEventListener("click", () => {
    setRatioPreset(button.dataset.ratio);
  });
});
els.qualities.forEach((button) => {
  button.addEventListener("click", () => {
    state.exportScale = Number(button.dataset.scale);
    draw();
  });
});

stage.addEventListener("pointerdown", (event) => {
  const point = canvasPoint(event);
  const handle = hitFrameHandle(point);
  const imageRect = state.tool === "image" ? hitLayoutImage(point) : null;
  const inside =
    point.x >= state.frame.x &&
    point.x <= state.frame.x + state.frame.w &&
    point.y >= state.frame.y &&
    point.y <= state.frame.y + state.frame.h;
  const action = handle
    ? "resize"
    : imageRect
      ? "swap-image"
      : state.tool === "move"
        ? inside
          ? "move"
          : "draw"
        : null;

  if (!action) return;
  if (action === "swap-image") {
    state.selectedImageId = imageRect.image.id;
    state.dragGhost = null;
  }

  state.pointer = {
    start: point,
    original: { ...state.frame },
    action,
    handle,
    sourceImageId: imageRect?.image.id || null,
    targetImageId: null,
    moved: false,
  };
  stage.style.cursor = action === "swap-image" ? "grabbing" : stage.style.cursor;
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener("pointermove", (event) => {
  if (!state.pointer) {
    updateCanvasCursor(event);
    return;
  }
  const point = canvasPoint(event);
  const { start, original, action, handle } = state.pointer;

  if (action === "resize") {
    state.frame = resizeFrameFromHandle(original, handle, point);
  } else if (action === "move") {
    state.frame.x = clamp(original.x + point.x - start.x, CANVAS_PADDING, LOGICAL_WIDTH - original.w - CANVAS_PADDING);
    state.frame.y = clamp(original.y + point.y - start.y, CANVAS_PADDING, LOGICAL_HEIGHT - original.h - CANVAS_PADDING);
  } else if (action === "swap-image") {
    const target = hitLayoutImage(point);
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    state.pointer.moved = distance > 5;
    state.dragGhost = state.pointer.moved
      ? { imageId: state.pointer.sourceImageId, x: point.x, y: point.y }
      : null;
    state.pointer.targetImageId =
      state.pointer.moved && target && target.image.id !== state.pointer.sourceImageId
        ? target.image.id
        : null;
  } else {
    const x = clamp(Math.min(start.x, point.x), CANVAS_PADDING, LOGICAL_WIDTH - CANVAS_PADDING);
    const y = clamp(Math.min(start.y, point.y), CANVAS_PADDING, LOGICAL_HEIGHT - CANVAS_PADDING);
    let w = clamp(Math.abs(point.x - start.x), MIN_FRAME_SIZE, LOGICAL_WIDTH - x - CANVAS_PADDING);
    let h = clamp(Math.abs(point.y - start.y), MIN_FRAME_SIZE, LOGICAL_HEIGHT - y - CANVAS_PADDING);
    if (state.ratioLocked) {
      const ratio = currentRatio();
      if (w / Math.max(h, 1) > ratio) {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
    }
    state.frame = clampFrameToCanvas({ x, y, w, h });
  }
  draw();
});

stage.addEventListener("pointerup", (event) => {
  if (
    state.pointer?.action === "swap-image" &&
    state.pointer.moved &&
    state.pointer.targetImageId
  ) {
    swapImagesById(state.pointer.sourceImageId, state.pointer.targetImageId);
  }
  state.dragGhost = null;
  state.pointer = null;
  updateCanvasCursor(event);
  stage.releasePointerCapture(event.pointerId);
  draw();
});

stage.addEventListener("pointercancel", () => {
  state.pointer = null;
  state.dragGhost = null;
  stage.style.cursor = "crosshair";
  draw();
});

["dragenter", "dragover"].forEach((name) => {
  window.addEventListener(name, (event) => {
    event.preventDefault();
    state.draggingOver = true;
    draw();
  });
});

["dragleave", "drop"].forEach((name) => {
  window.addEventListener(name, (event) => {
    event.preventDefault();
    state.draggingOver = false;
    draw();
  });
});

window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
});

window.addEventListener("resize", () => {
  setupCanvasResolution();
  draw();
});

setupCanvasResolution();
renderThumbs();
draw();

window.autoframeDebug = () => ({
  state: {
    mode: state.mode,
    fit: state.fit,
    fillAxis: state.fillAxis,
    blankLimit: state.blankLimit,
    randomStep: state.randomStep,
    randomMax: state.randomMax,
    validRandomSteps: state.validRandomSteps,
    imageCount: state.images.length,
    layoutCount: state.layouts.length,
    backgroundColor: state.backgroundColor,
    aspectProfile: aspectProfile(state.images),
  },
  insideFrame: layoutsInsideFrame(state.layouts, state.frame),
  layoutBounds: state.layouts.length
    ? {
        left: Math.min(...state.layouts.map((rect) => rect.x)),
        top: Math.min(...state.layouts.map((rect) => rect.y)),
        right: Math.max(...state.layouts.map((rect) => rect.x + rect.w)),
        bottom: Math.max(...state.layouts.map((rect) => rect.y + rect.h)),
      }
    : null,
  frame: { ...state.frame },
  limitRatio: layoutBlankRatio(state.layouts),
  blankRatio: layoutBlankRatio(state.layouts),
  respectsFillAxis: respectsFillAxis(state.layouts, state.frame),
  coverage: state.layouts.length ? axisCoverage(state.layouts, state.frame) : null,
});
