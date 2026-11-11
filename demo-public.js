"use strict";

window.kuherfassungMatch = (() => {
  const width = 64;
  const height = 32;
  const weights = Float32Array.from({ length: width * height }, (_, i) => {
    const x = 2 * (i % width) / (width - 1) - 1;
    const y = 2 * Math.floor(i / width) / (height - 1) - 1;
    return Math.min(1, Math.max(0, 2 * (1.19 - x * x - y * y)));
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < weights.length; i++) weights[i] /= total;

  const limits = { score: 78, gap: 5, oneCow: 85 };

  function smooth(values, w, h) {
    const coefficients = [1, 4, 6, 4, 1];
    const horizontal = new Float32Array(values.length);
    const blurred = new Float32Array(values.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let d = -2; d <= 2; d++) {
          horizontal[y * w + x] += values[y * w + Math.max(0, Math.min(w - 1, x + d))] * coefficients[d + 2] / 16;
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let d = -2; d <= 2; d++) {
          blurred[y * w + x] += horizontal[Math.max(0, Math.min(h - 1, y + d)) * w + x] * coefficients[d + 2] / 16;
        }
      }
    }
    return blurred;
  }

  function cutoff(values, w, h) {
    const histogram = new Uint32Array(256);
    let sum = 0;
    let count = 0;
    for (let y = 9; y < h - 9; y++) {
      for (let x = 10; x < w - 10; x++) {
        const value = Math.round(values[y * w + x]);
        histogram[value]++;
        sum += value;
        count++;
      }
    }
    let threshold = 0, percentile = 0, lowerCount = 0, lowerSum = 0, maximum = 0;
    for (let i = 0; i < histogram.length; i++) {
      lowerCount += histogram[i];
      lowerSum += i * histogram[i];
      if (!percentile && lowerCount >= .8 * count) percentile = i;
      const upperCount = count - lowerCount;
      if (!lowerCount || !upperCount) continue;
      const difference = lowerSum / lowerCount - (sum - lowerSum) / upperCount;
      const variance = lowerCount * upperCount * difference * difference;
      if (variance > maximum) {
        maximum = variance;
        threshold = i;
      }
    }
    return Math.min(225, Math.max(142, threshold, .88 * percentile));
  }

  function statistics(pattern) {
    let mean = 0, squared = 0;
    for (let i = 0; i < weights.length; i++) {
      mean += weights[i] * pattern[i];
      squared += weights[i] * pattern[i] ** 2;
    }
    return { pattern, mean, squared, marking: Math.min(mean, 1 - mean) };
  }

  function fromPixels(rgba) {
    const w = width * 2, h = height * 2;
    const gray = Float32Array.from({ length: w * h }, (_, i) =>
      .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2]);
    const blurred = smooth(gray, w, h);
    const threshold = cutoff(blurred, w, h);
    const tone = value => Math.min(1, Math.max(0, (value - threshold + 15) / 30));
    const pattern = Float32Array.from({ length: width * height }, (_, i) => {
      const j = 2 * (Math.floor(i / width) * w + i % width);
      return (tone(blurred[j]) + tone(blurred[j + 1]) + tone(blurred[j + w]) + tone(blurred[j + w + 1])) / 4;
    });
    return statistics(smooth(pattern, width, height));
  }

  function describe(image) {
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (image.height > image.width) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(image, 0, 0, canvas.height, canvas.width);
    } else {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    return fromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }

  function warp(pattern, angle, sx, sy, dx, dy, reverse) {
    const result = new Float32Array(pattern.length);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    for (let i = 0; i < result.length; i++) {
      const x = i % width - cx - dx;
      const y = Math.floor(i / width) - cy - dy;
      const sign = reverse ? -1 : 1;
      const u = Math.max(0, Math.min(width - 1, cx + sign * (cos * x - sin * y) / sx));
      const v = Math.max(0, Math.min(height - 1, cy + sign * (sin * x + cos * y) / sy));
      const j = Math.floor(u), k = Math.floor(v);
      const j2 = Math.min(width - 1, j + 1), k2 = Math.min(height - 1, k + 1);
      const a = u - j, b = v - k;
      result[i] = (1 - b) * ((1 - a) * pattern[k * width + j] + a * pattern[k * width + j2])
        + b * ((1 - a) * pattern[k2 * width + j] + a * pattern[k2 * width + j2]);
    }
    return statistics(result);
  }

  function alignments(query) {
    const variants = [];
    for (const reverse of [false, true]) {
      for (const [angle, sx, sy] of [[0, 1, 1], [0, .88, 1], [0, 1.12, 1], [0, 1, .87], [0, 1, 1.13], [-7, 1, 1], [7, 1, 1]]) {
        for (const dx of [-5, 0, 5]) {
          for (const dy of [-2, 0, 2]) {
            const variant = warp(query.pattern, angle * Math.PI / 180, sx, sy, dx, dy, reverse);
            const penalty = .91 * (.001 * Math.abs(dx) + .002 * Math.abs(dy) + .0004 * Math.abs(angle)
              + .03 * (Math.abs(1 - sx) + Math.abs(1 - sy)));
            variants.push({ ...variant, penalty });
          }
        }
      }
    }
    return variants;
  }

  function distance(query, reference) {
    let overlap = 0;
    for (let i = 0; i < weights.length; i++) overlap += weights[i] * query.pattern[i] * reference.pattern[i];
    const error = Math.max(0, query.squared + reference.squared - 2 * overlap);
    const covariance = overlap - query.mean * reference.mean;
    const scale = Math.sqrt(Math.max(.004, query.squared - query.mean ** 2) * Math.max(.004, reference.squared - reference.mean ** 2));
    const correlation = Math.min(1, Math.max(-1, covariance / scale));
    return .65 * Math.sqrt(error) + .22 * (1 - correlation)
      + .13 * Math.sqrt(error / (.065 + Math.min(query.marking, reference.marking))) + query.penalty;
  }

  function rank(query, references) {
    const variants = alignments(query);
    const byCow = new Map();
    for (const { cow, features } of references) {
      if (features.marking < .006) continue;
      let best = 0;
      for (const variant of variants) best = Math.max(best, 100 * (1 - distance(variant, features)));
      if (best > (byCow.get(cow) ?? 0)) byCow.set(cow, best);
    }
    return [...byCow].sort((a, b) => b[1] - a[1]);
  }

  function suggest(query, references) {
    if (!references.length || query.marking < .006) return undefined;
    const [best, next] = rank(query, references);
    const gap = limits.gap + (query.marking < .045 ? 3 : 0);
    if (!best || best[1] < (next ? limits.score : limits.oneCow) || (next && best[1] - next[1] < gap)) return undefined;
    return { cow: best[0], score: Math.round(best[1]) };
  }

  return { describe, fromPixels, rank, suggest };
})();

"use strict";

const get = id => document.getElementById(id);
const store = window.kuherfassungStore;
const matcher = window.kuherfassungMatch;
const perspectives = window.kuherfassungDemo.ansichten;
const demoSamples = window.kuherfassungDemo.prueffotos;
const fields = ["name", "tiernummer", "ohrmarke", "transponder", "rasse"];
const cameraNumbers = [1, 2];
const cameraStorageKey = "mukams-kuherfassung-kameras";
const herd = get("bestand");
const form = get("cow-form");
const source = get("source");
const file = get("file");
const image = get("camera-image");
const video = get("camera-video");
const canvas = get("crop");
const output = canvas.getContext("2d");
const photoLinks = [];
const referenceCache = new Map();
const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeZone: "UTC" });
let cows = [];
let selected;
let ready = false;
let revision = 0;
let photoRevision = 0;
let sourceRevision = 0;
let cameraStream;
let fileUrl;
let media;
let mediaLabel;
let draft;
let crop = [0, 0, 1, 1];
let anchor;
let saving = false;
let review;
let matchRevision = 0;
let demoPosition = 0;

function node(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function notice(id, text, error = false) {
  get(id).textContent = text;
  get(id).dataset.error = String(error);
}

function cowLabel(cow) {
  return [cow.tiernummer, cow.name].filter(Boolean).join(" · ") || cow.ohrmarke;
}

function photoCount(count) {
  return count === 1 ? "1 Foto" : `${count} Fotos`;
}

function drawCows() {
  const filter = get("cow-search").value.trim().toLowerCase();
  const shown = cows.filter(cow => [cow.name, cow.tiernummer, cow.ohrmarke, cow.transponder].some(
    value => value?.toLowerCase().includes(filter)
  ));
  const list = get("cows");
  list.replaceChildren();
  get("cow-count").textContent = `${cows.length} Kühe · ${cows.filter(cow => cow.fotos).length} mit Fotos`;
  for (const cow of shown) {
    const button = node("button");
    button.type = "button";
    if (cow.id === selected?.id) button.setAttribute("aria-current", "true");
    button.append(node("strong", cowLabel(cow)), node("small", photoCount(cow.fotos)));
    button.addEventListener("click", () => selectCow(cow));
    list.append(button);
  }
  if (!shown.length) list.append(node("p", cows.length ? "Keine passende Kuh gefunden." : "Dieser Bestand ist leer."));
}

function clearPhotoLinks() {
  photoLinks.splice(0).forEach(url => URL.revokeObjectURL(url));
  get("photos").replaceChildren();
}

async function drawPhotos(cow) {
  const current = ++photoRevision;
  clearPhotoLinks();
  const list = get("photos");
  if (!cow) {
    list.append(node("p", "Zuerst eine Kuh wählen."));
    return;
  }
  try {
    const photos = await store.listPhotos(cow);
    if (current !== photoRevision) return;
    for (const photo of photos.sort((a, b) => b.zeit.localeCompare(a.zeit))) {
      const url = URL.createObjectURL(photo.bild);
      photoLinks.push(url);
      const thumb = node("img");
      thumb.src = url;
      thumb.alt = perspectives[photo.ansicht];
      const caption = node("figcaption");
      const link = node("a", "JPEG herunterladen");
      const number = (cow.tiernummer || cow.ohrmarke).replace(/[^\w-]+/g, "_");
      link.href = url;
      link.download = `Kuh_${number}_${photo.ansicht}_${photo.zeit.replace(/[:.]/g, "-")}.jpg`;
      const remove = node("button", "Foto entfernen");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await store.removePhoto(photo);
          await refreshPhotos(cow);
        } catch (error) {
          notice("photo-status", error.message, true);
          remove.disabled = false;
        }
      });
      const date = (photo.original ? dayFormat : dateFormat).format(new Date(photo.zeit));
      caption.append(node("strong", perspectives[photo.ansicht]),
        node("span", `${photo.quelle} · ${date}`), link, remove);
      const figure = node("figure");
      figure.append(thumb, caption);
      list.append(figure);
    }
    if (!photos.length) list.append(node("p", "Für diese Kuh sind noch keine Fotos gespeichert."));
  } catch (error) {
    if (current === photoRevision) list.append(node("p", error.message));
  }
}

async function refreshPhotos(cow) {
  const updated = await store.listCows(cow.bestand);
  if (herd.value !== cow.bestand) return;
  cows = updated;
  if (selected?.id === cow.id) {
    selected = cows.find(item => item.id === cow.id);
    await drawPhotos(selected);
  }
  drawCows();
}

function selectCow(cow) {
  selected = cow;
  get("delete-cow").disabled = !ready || !cow;
  discardDraft();
  for (const name of fields) form.elements.namedItem(name).value = cow?.[name] || "";
  get("cow-heading").textContent = cow ? cowLabel(cow) : "Neue Kuh";
  get("camera-target").textContent = cow ? `Aufnahme für ${cowLabel(cow)}` : "Zuerst die Kuh speichern.";
  notice("cow-status", "");
  notice("photo-status", "");
  drawCows();
  drawPhotos(cow);
  drawPreview();
}

async function loadHerd() {
  const key = herd.value;
  const current = ++revision;
  ready = false;
  get("cow-fields").disabled = true;
  get("save-cow").disabled = true;
  get("new-cow").disabled = true;
  cows = [];
  selectCow();
  try {
    const list = await store.listCows(key);
    if (current !== revision) return;
    cows = list;
    ready = true;
    get("cow-fields").disabled = false;
    get("save-cow").disabled = false;
    get("new-cow").disabled = false;
    selectCow(cows[0]);
  } catch (error) {
    if (current === revision) notice("cow-status", "Der Browserspeicher ist nicht verfügbar. " + error.message, true);
  }
}

function drawPreview() {
  image.hidden = media !== image || Boolean(draft);
  video.hidden = media !== video || Boolean(draft);
  canvas.hidden = !draft;
  get("preview-empty").hidden = Boolean(media || draft);
  get("take-photo").disabled = !media || !selected || saving;
  get("stop-source").disabled = !media && !cameraStream;
  get("photo-actions").hidden = !draft;
  get("next-demo-photo").hidden = herd.value !== "demo" || !demoSamples.length;
  get("next-demo-photo").disabled = !selected || saving;
  get("demo-photo-source").hidden = herd.value !== "demo" || !window.kuherfassungDemo.fotos.length;
  drawReview();
}

function discardDraft() {
  draft = undefined;
  review = undefined;
  anchor = undefined;
  matchRevision += 1;
}

function drawReview() {
  const proposed = review?.state === "proposal";
  const manual = review?.state === "manual";
  get("photo-review").hidden = !draft;
  get("match-status").textContent = review?.message ?? "";
  get("match-actions").hidden = !draft || !proposed;
  get("manual-actions").hidden = !draft || !manual;
  get("confirm-match").disabled = !proposed || saving;
  get("reject-match").disabled = !proposed || saving;
  get("save-photo").disabled = !manual || !cows.length || saving;
  const select = get("manual-cow");
  select.disabled = saving;
  if (manual) {
    const previous = select.value;
    select.replaceChildren(...cows.map(cow => {
      const option = node("option", cowLabel(cow));
      option.value = cow.id;
      return option;
    }));
    select.value = cows.some(cow => cow.id === previous) ? previous : selected?.id ?? cows[0]?.id ?? "";
  } else {
    select.replaceChildren();
  }
}

function referenceFeatures(photo) {
  if (!referenceCache.has(photo.id)) {
    if (referenceCache.size >= 256) referenceCache.delete(referenceCache.keys().next().value);
    referenceCache.set(photo.id, createImageBitmap(photo.bild).then(bitmap => {
      try {
        return { cow: photo.kuh, features: matcher.describe(bitmap) };
      } finally {
        bitmap.close();
      }
    }).catch(() => undefined));
  }
  return referenceCache.get(photo.id);
}

async function checkPhoto() {
  if (!draft || saving) return;
  const current = ++matchRevision;
  const capture = draft;
  const perspective = get("perspective").value;
  const bounds = crop;
  review = { state: "checking", message: "Fellmuster wird verglichen …" };
  drawReview();
  try {
    const photos = await store.listReferences(herd.value, perspective);
    const refs = (await Promise.all(photos.map(referenceFeatures))).filter(Boolean);
    if (current !== matchRevision) return;
    const hit = refs.length ? matcher.suggest(matcher.describe(cropCanvas(capture.image, bounds)), refs) : undefined;
    const cow = hit && cows.find(item => item.id === hit.cow);
    if (cow) {
      review = { state: "proposal", cow, message: `Vorschlag · ${cowLabel(cow)} · ${hit.score} Ähnlichkeitspunkte` };
    } else {
      review = { state: "manual", message: refs.length ? "Kein eindeutiger Treffer. Bei Bedarf eine Kuh auswählen."
        : "Für diese Perspektive fehlt ein Referenzfoto. Eine Kuh auswählen und das erste Foto speichern." };
    }
  } catch (error) {
    if (current !== matchRevision) return;
    review = { state: "manual", message: error.message };
  }
  drawReview();
}

function closeSource() {
  sourceRevision += 1;
  media = undefined;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = undefined;
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
  video.load();
  image.removeAttribute("src");
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = undefined;
  drawPreview();
}

function httpsAddress(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Eine vollständige Kameraadresse eingeben."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Eine HTTPS-Adresse ohne Benutzername oder Passwort verwenden.");
  }
  return url.href;
}

function loadCameraSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(cameraStorageKey));
    for (const number of cameraNumbers) {
      const setting = saved?.[number];
      if (!setting) continue;
      get(`camera-${number}`).value = setting.address ? httpsAddress(setting.address) : "";
      get(`format-${number}`).value = setting.format === "video" ? "video" : "image";
    }
  } catch {
    notice("camera-settings-status", "Gespeicherte Kameraadressen konnten nicht geladen werden.", true);
  }
}

function saveCameraSettings(event) {
  event.preventDefault();
  const settings = {};
  for (const number of cameraNumbers) {
    const field = get(`camera-${number}`);
    const address = field.value.trim();
    try {
      settings[number] = {
        address: address ? httpsAddress(address) : "",
        format: get(`format-${number}`).value,
      };
    } catch (error) {
      field.focus();
      notice("camera-settings-status", `Kamera ${number}: ${error.message}`, true);
      return;
    }
  }
  try {
    localStorage.setItem(cameraStorageKey, JSON.stringify(settings));
    for (const number of cameraNumbers) get(`camera-${number}`).value = settings[number].address;
    notice("camera-settings-status", "Kameraeinstellungen in diesem Browser gespeichert.");
  } catch {
    notice("camera-settings-status", "Der Browserspeicher ist nicht verfügbar. Die Kameraeinstellungen wurden nicht gespeichert.", true);
  }
}

function loadMedia(target, url, label, remote, current) {
  const isVideo = target === video;
  const event = isVideo ? "onloadeddata" : "onload";
  target.removeAttribute("crossorigin");
  if (remote) target.crossOrigin = "anonymous";
  target[event] = () => {
    if (current !== sourceRevision) return;
    media = target;
    mediaLabel = label;
    if (isVideo) video.play().catch(() => {});
    notice("photo-status", label + " geöffnet.");
    drawPreview();
  };
  target.onerror = () => {
    if (current !== sourceRevision || !target.hasAttribute("src")) return;
    media = undefined;
    notice("photo-status", remote
      ? "Kamera konnte nicht geöffnet werden. Direkte Adresse, Format und CORS-Freigabe prüfen."
      : "Die Bilddatei konnte nicht gelesen werden.", true);
    drawPreview();
  };
  target.src = url;
}

async function openSource() {
  closeSource();
  discardDraft();
  drawPreview();
  const current = sourceRevision;
  try {
    if (source.value === "file") {
      const blob = file.files[0];
      if (!blob) throw new Error("Zuerst eine Bilddatei wählen.");
      if (blob.size > 8 * 1024 * 1024) throw new Error("Ein Foto bis 8 MB wählen.");
      fileUrl = URL.createObjectURL(blob);
      loadMedia(image, fileUrl, "Bilddatei", false, current);
    } else if (source.value === "device") {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Die Gerätekamera ist in diesem Browser nicht verfügbar.");
      notice("photo-status", "Gerätekamera wird geöffnet …");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (current !== sourceRevision) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = stream;
      video.onerror = null;
      video.removeAttribute("crossorigin");
      video.onloadeddata = () => {
        if (current !== sourceRevision) return;
        media = video;
        mediaLabel = "Gerätekamera";
        notice("photo-status", "Gerätekamera geöffnet.");
        drawPreview();
      };
      video.srcObject = stream;
      drawPreview();
      await video.play();
    } else {
      const number = source.value;
      const field = get(`camera-${number}`);
      if (!field.value.trim()) {
        get("camera-settings").open = true;
        field.focus();
        throw new Error(`Adresse von Kamera ${number} eingeben.`);
      }
      const url = httpsAddress(field.value);
      const target = get(`format-${number}`).value === "video" ? video : image;
      notice("photo-status", `Kamera ${number} wird geöffnet …`);
      loadMedia(target, url, `Kamera ${number}`, true, current);
    }
  } catch (error) {
    if (current === sourceRevision) notice("photo-status", error.message, true);
  }
}

function paintCrop(rectangle = crop) {
  const [x0, y0, x1, y1] = rectangle;
  output.drawImage(draft.image, 0, 0);
  output.strokeStyle = "#ffda65";
  output.lineWidth = 3;
  output.strokeRect(x0 * canvas.width, y0 * canvas.height, (x1 - x0) * canvas.width, (y1 - y0) * canvas.height);
}

function freezeFrame(input, width, height, label, sample) {
  if (!width || !height) {
    notice("photo-status", "Warten, bis ein Kamerabild sichtbar ist.", true);
    return;
  }
  const frame = node("canvas");
  const scale = Math.min(1, 1800 / Math.max(width, height));
  frame.width = Math.round(width * scale);
  frame.height = Math.round(height * scale);
  try {
    const context = frame.getContext("2d");
    context.drawImage(input, 0, 0, frame.width, frame.height);
    context.getImageData(0, 0, 1, 1);
  } catch {
    notice("photo-status", "Das Bild darf nicht übernommen werden. CORS-Freigabe auf dem Kameraserver prüfen.", true);
    return;
  }
  draft = { image: frame, quelle: label, zeit: sample?.zeit ?? new Date().toISOString(), sample };
  canvas.width = frame.width;
  canvas.height = frame.height;
  crop = [0, 0, 1, 1];
  paintCrop();
  checkPhoto();
  drawPreview();
  notice("photo-status", "Bei Bedarf ein Rechteck um das Fell ziehen.");
}

function takePhoto() {
  if (!selected || !media || saving) return;
  const width = media === image ? image.naturalWidth : video.videoWidth;
  const height = media === image ? image.naturalHeight : video.videoHeight;
  freezeFrame(media, width, height, mediaLabel);
}

async function nextDemoPhoto() {
  if (!selected || saving || herd.value !== "demo") return;
  closeSource();
  discardDraft();
  drawPreview();
  const current = sourceRevision;
  const index = demoPosition++ % demoSamples.length;
  const sample = demoSamples[index];
  try {
    const bitmap = await createImageBitmap(store.demoBlob(sample.jpeg));
    try {
      if (current !== sourceRevision || herd.value !== "demo") return;
      get("perspective").value = sample.ansicht;
      freezeFrame(bitmap, bitmap.width, bitmap.height, sample.quelle, sample);
      notice("photo-status", `Prüffoto ${index + 1} von ${demoSamples.length}`);
    } finally {
      bitmap.close();
    }
  } catch {
    if (current === sourceRevision) notice("photo-status", "Das Prüffoto konnte nicht geöffnet werden.", true);
  }
}

function pointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = canvas.width / canvas.height;
  const width = Math.min(bounds.width, bounds.height * ratio);
  const height = width / ratio;
  const x = (event.clientX - bounds.left - (bounds.width - width) / 2) / width;
  const y = (event.clientY - bounds.top - (bounds.height - height) / 2) / height;
  return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
}

function rectangle(event) {
  const [x, y] = pointer(event);
  return [Math.min(x, anchor[0]), Math.min(y, anchor[1]), Math.max(x, anchor[0]), Math.max(y, anchor[1])];
}

function cropCanvas(frame, rectangle) {
  const [x0, y0, x1, y1] = rectangle;
  const width = Math.round((x1 - x0) * frame.width);
  const height = Math.round((y1 - y0) * frame.height);
  const scale = Math.min(1, 960 / Math.max(width, height));
  const result = node("canvas");
  result.width = Math.round(width * scale);
  result.height = Math.round(height * scale);
  if (Math.min(result.width, result.height) < 96) throw new Error("Der Ausschnitt braucht mindestens 96 × 96 Pixel.");
  result.getContext("2d").drawImage(frame, Math.round(x0 * frame.width), Math.round(y0 * frame.height), width, height,
    0, 0, result.width, result.height);
  return result;
}

function photoBlob(frame, rectangle) {
  const cropped = cropCanvas(frame, rectangle);
  return new Promise((resolve, reject) => cropped.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error("Das Bild konnte nicht gespeichert werden."));
  }, "image/jpeg", .9));
}

get("new-cow").addEventListener("click", () => {
  selectCow();
  form.elements.namedItem("tiernummer").focus();
});
get("delete-cow").addEventListener("click", async () => {
  const cow = selected;
  if (!cow || !confirm(`${cowLabel(cow)} endgültig löschen? Alle ihre Fotos in diesem Browser werden ebenfalls gelöscht.`)) return;
  get("delete-cow").disabled = true;
  try {
    await store.removeCow(cow);
    referenceCache.clear();
    const updated = await store.listCows(cow.bestand);
    if (herd.value !== cow.bestand) return;
    cows = updated;
    selectCow(cows[0]);
    notice("cow-status", "Kuh und ihre Fotos wurden gelöscht.");
  } catch (error) {
    notice("cow-status", error.message, true);
    get("delete-cow").disabled = !selected;
  }
});
get("cow-search").addEventListener("input", drawCows);
herd.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("bestand", herd.value);
  history.replaceState(null, "", url);
  loadHerd();
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!ready || get("save-cow").disabled) return;
  const key = herd.value;
  const current = revision;
  const values = Object.fromEntries(fields.map(name => [name, form.elements.namedItem(name).value.trim()]));
  if (!values.tiernummer && !values.ohrmarke) {
    notice("cow-status", "Tiernummer oder Ohrmarke eingeben.", true);
    return;
  }
  get("save-cow").disabled = true;
  try {
    const cow = await store.saveCow({ ...values, id: selected?.id || crypto.randomUUID(), bestand: key });
    const list = await store.listCows(key);
    if (current !== revision) return;
    cows = list;
    selectCow(cow);
    notice("cow-status", "Kuh gespeichert.");
  } catch (error) {
    if (current === revision) notice("cow-status", error.message, true);
  } finally {
    if (current === revision) get("save-cow").disabled = false;
  }
});
source.addEventListener("change", () => {
  discardDraft();
  closeSource();
  get("file-label").hidden = source.value !== "file";
  notice("photo-status", "");
});
get("open-source").addEventListener("click", openSource);
get("stop-source").addEventListener("click", () => {
  closeSource();
  notice("photo-status", "Quelle geschlossen.");
});
get("take-photo").addEventListener("click", takePhoto);
get("next-demo-photo").addEventListener("click", nextDemoPhoto);
get("perspective").addEventListener("change", checkPhoto);
get("reset-crop").addEventListener("click", () => {
  crop = [0, 0, 1, 1];
  paintCrop();
  checkPhoto();
});
canvas.addEventListener("pointerdown", event => {
  if (!draft || !event.isPrimary || event.button !== 0) return;
  anchor = pointer(event);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", event => {
  if (draft && anchor && event.isPrimary) paintCrop(rectangle(event));
});
canvas.addEventListener("pointerup", event => {
  if (!draft || !anchor || !event.isPrimary) return;
  const next = rectangle(event);
  if (next[2] - next[0] > .02 && next[3] - next[1] > .02) {
    crop = next;
    checkPhoto();
  }
  anchor = undefined;
  paintCrop();
});
canvas.addEventListener("pointercancel", () => {
  anchor = undefined;
  if (draft) paintCrop();
});
function demoAnswer(capture) {
  const actual = capture.sample && cows.find(cow => cow.id === capture.sample.kuh);
  return actual ? ` Das Prüffoto gehört zu ${cowLabel(actual)}.` : "";
}

async function saveAssignment(cow) {
  if (!cow || !draft || saving || cow.bestand !== herd.value) return;
  const capture = draft;
  const ansicht = get("perspective").value;
  saving = true;
  drawPreview();
  try {
    const bild = await photoBlob(capture.image, crop);
    const photo = { id: capture.sample?.id ?? crypto.randomUUID(), ansicht, quelle: capture.quelle, zeit: capture.zeit, bild };
    if (capture.sample) photo.original = capture.sample.original;
    await store.addPhoto(cow, photo);
    if (draft === capture && herd.value === cow.bestand) {
      cows = await store.listCows(cow.bestand);
      if (draft === capture && herd.value === cow.bestand) {
        selectCow(cows.find(item => item.id === cow.id));
        notice("photo-status", `Referenzfoto für ${cowLabel(cow)} gespeichert.` + demoAnswer(capture));
      }
    } else {
      await refreshPhotos(cow);
    }
  } catch (error) {
    if (draft === capture) notice("photo-status", error.message, true);
  } finally {
    saving = false;
    drawPreview();
  }
}

get("confirm-match").addEventListener("click", () => {
  if (review?.state === "proposal") saveAssignment(review.cow);
});
get("reject-match").addEventListener("click", () => {
  if (review?.state !== "proposal" || !draft || saving) return;
  review = { state: "manual", message: "Vorschlag abgelehnt. Bei Bedarf die richtige Kuh auswählen." + demoAnswer(draft) };
  drawReview();
});
get("save-photo").addEventListener("click", () => {
  if (review?.state === "manual") saveAssignment(cows.find(cow => cow.id === get("manual-cow").value));
});
window.addEventListener("pagehide", closeSource);
get("camera-form").addEventListener("submit", saveCameraSettings);
loadCameraSettings();

for (const [key, label] of Object.entries(perspectives)) {
  const option = node("option", label);
  option.value = key;
  get("perspective").append(option);
}
get("perspective").value = "oben";
herd.value = new URLSearchParams(location.search).get("bestand") === "betrieb" ? "betrieb" : "demo";
loadHerd();
