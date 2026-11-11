"use strict";

const get = id => document.getElementById(id);
const store = window.kuherfassungStore;
const perspectives = window.kuherfassungDemo.ansichten;
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
const dateFormat = new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" });
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
      caption.append(node("strong", perspectives[photo.ansicht]),
        node("span", `${photo.quelle} · ${dateFormat.format(new Date(photo.zeit))}`), link, remove);
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
  draft = undefined;
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
  get("take-photo").disabled = !media || !selected;
  get("stop-source").disabled = !media && !cameraStream;
  get("photo-actions").hidden = !draft;
  get("save-photo").disabled = !draft || !selected || saving;
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
  draft = undefined;
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

function takePhoto() {
  if (!selected || !media) return;
  const width = media === image ? image.naturalWidth : video.videoWidth;
  const height = media === image ? image.naturalHeight : video.videoHeight;
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
    context.drawImage(media, 0, 0, frame.width, frame.height);
    context.getImageData(0, 0, 1, 1);
  } catch {
    notice("photo-status", "Das Bild darf nicht übernommen werden. CORS-Freigabe auf dem Kameraserver prüfen.", true);
    return;
  }
  draft = { image: frame, quelle: mediaLabel, zeit: new Date().toISOString() };
  canvas.width = frame.width;
  canvas.height = frame.height;
  crop = [0, 0, 1, 1];
  paintCrop();
  drawPreview();
  notice("photo-status", "Bei Bedarf ein Rechteck um das Fell ziehen und das Referenzfoto speichern.");
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

function photoBlob(frame, rectangle) {
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
  return new Promise((resolve, reject) => result.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(new Error("Das Bild konnte nicht gespeichert werden."));
  }, "image/jpeg", .9));
}

get("new-cow").addEventListener("click", () => {
  selectCow();
  form.elements.namedItem("tiernummer").focus();
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
  draft = undefined;
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
get("reset-crop").addEventListener("click", () => {
  crop = [0, 0, 1, 1];
  paintCrop();
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
  if (next[2] - next[0] > .02 && next[3] - next[1] > .02) crop = next;
  anchor = undefined;
  paintCrop();
});
canvas.addEventListener("pointercancel", () => {
  anchor = undefined;
  if (draft) paintCrop();
});
get("save-photo").addEventListener("click", async () => {
  if (!selected || !draft || saving) return;
  const cow = selected;
  const capture = draft;
  const ansicht = get("perspective").value;
  saving = true;
  drawPreview();
  try {
    const bild = await photoBlob(capture.image, crop);
    await store.addPhoto(cow, { id: crypto.randomUUID(), ansicht, quelle: capture.quelle, zeit: capture.zeit, bild });
    if (selected?.id === cow.id && draft === capture) draft = undefined;
    await refreshPhotos(cow);
    if (selected?.id === cow.id) notice("photo-status", "Referenzfoto gespeichert.");
  } catch (error) {
    if (selected?.id === cow.id) notice("photo-status", error.message, true);
  } finally {
    saving = false;
    drawPreview();
  }
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
