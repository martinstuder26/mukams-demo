const byId = (id) => document.getElementById(id);
const svgNamespace = "http://www.w3.org/2000/svg";
const timeFormat = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const video = byId("live-image");
const demoControls = byId("demo-controls");
const demoCase = byId("demo-case");
const gateSelect = byId("dashboard-gate");
const publicDemo = window.mukamsDemo;
let selectedGate = new URLSearchParams(location.search).get("tor") ?? "";
let scenarioGate;
let lastState;
let showPreview = true;
let imageUrl;
let selectingDemo = false;
let demoError = "";

function gateUrl(path, gate = selectedGate) {
  return gate ? `${path}?tor=${encodeURIComponent(gate)}` : path;
}

function selectGate(gate) {
  selectedGate = gate;
  const url = new URL(location.href);
  if (gate) url.searchParams.set("tor", gate);
  else url.searchParams.delete("tor");
  history.replaceState(null, "", url);
  lastState = null;
  demoError = "";
  clearImage();
  drawStatus(null);
  byId("events").replaceChildren(listItem("Warte auf Meldungen dieses Tors"));
}

function drawGatePicker(state) {
  if (!state?.tore) return;
  const entries = state.tore;
  const matches = entries.length === gateSelect.options.length && entries.every(
    ({ id, name }, index) => gateSelect.options[index].value === id && gateSelect.options[index].text === name
  );
  if (!matches) gateSelect.replaceChildren(...entries.map(({ id, name }) => new Option(name, id)));
  gateSelect.value = state.tor.id;
  byId("gate-picker").hidden = entries.length < 2;
}

function drawDemoControls(state) {
  const cases = state?.demo_cases;
  demoControls.hidden = !cases || (!publicDemo && location.hostname !== "127.0.0.1");
  if (demoControls.hidden) return;
  if (demoCase.options.length === 1) {
    for (const scene of cases) demoCase.add(new Option(scene, scene));
  }
  if (scenarioGate !== state.tor.id) {
    demoCase.value = state.demo_selected;
    scenarioGate = state.tor.id;
  }
  const count = state.demo_pulses;
  text("demo-result", demoError || (selectingDemo ? "Startet …" : `Freigaben in diesem Szenario: ${count}`));
  byId("demo-result").dataset.tone = demoError ? "amber" : count ? "green" : "neutral";
}

function text(id, value) {
  const element = byId(id);
  if (element.textContent !== String(value)) element.textContent = value;
}

function svg(name, attributes, content) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (content) element.textContent = content;
  return element;
}

function drawScene(state) {
  const [left, top, right, bottom] = state.zone;
  const zone = byId("zone");
  zone.setAttribute("x", left * 800);
  zone.setAttribute("y", top * 450);
  zone.setAttribute("width", (right - left) * 800);
  zone.setAttribute("height", (bottom - top) * 450);
  byId("zone-label").setAttribute("x", left * 800 + 6);
  byId("zone-label").setAttribute("y", top * 450 - 7);
  byId("gate-open").setAttribute("visibility", state.gate === "offen" ? "visible" : "hidden");
  byId("gate-closed").setAttribute("visibility", state.gate === "geschlossen" ? "visible" : "hidden");

  const layer = byId("animals");
  layer.replaceChildren();
  for (const { kind, label, score, box } of state.detections) {
    const [x, y, x2, y2] = box.map((value, index) => value * (index % 2 ? 450 : 800));
    const color = kind === "kuh" && score >= 85 ? "#b7efbf" : "#f2c98e";
    const name = `${label} · ${score} %`;
    layer.append(
      svg("use", { href: kind === "andere" ? "#person" : "#cattle", x, y: y + 13, width: x2 - x, height: y2 - y - 13, class: kind === "kalb" ? "calf-shape" : "cow-shape" }),
      svg("rect", { x, y, width: x2 - x, height: y2 - y, rx: 3, fill: "none", stroke: color, "stroke-width": 2 }),
      svg("rect", { x, y, width: name.length * 7.5 + 10, height: 22, rx: 3, fill: color }),
      svg("text", { x: x + 6, y: y + 16, fill: "#18332d", "font-size": 13, "font-weight": 750 }, name),
    );
  }
}

function clearImage() {
  video.hidden = true;
  video.removeAttribute("src");
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = undefined;
}

function showPicture(state) {
  const cameraActive = state?.camera === "aktiv";
  const sceneVisible = showPreview && cameraActive && state.mode === "demo";
  byId("scene").toggleAttribute("hidden", !sceneVisible);
  const previewEnabled = state?.preview_enabled !== false;
  video.hidden = !(showPreview && previewEnabled && cameraActive && state.mode !== "demo" && imageUrl);
  const placeholder = byId("picture-message");
  placeholder.hidden = sceneVisible || !video.hidden;
  placeholder.textContent = !showPreview ? "Vorschau ausgeblendet" : !state ? "Keine Verbindung zu MUKAMS" :
    !previewEnabled ? "Vorschau in den Einstellungen deaktiviert" :
    state.camera === "inaktiv" ? "IP-Kamera noch nicht eingerichtet" :
    state.camera === "offline" ? "Kein Kamerabild verfügbar" : "Warte auf ein Kamerabild …";
}

function listItem(message) {
  const item = document.createElement("li");
  item.className = "muted";
  item.textContent = message;
  return item;
}

function drawEvents() {
  const list = byId("events");
  const events = (lastState?.events ?? []).filter((event) => !byId("fault-filter").checked || event.fault);
  if (!events.length) {
    list.replaceChildren(listItem("Keine passenden Meldungen"));
    return;
  }
  list.replaceChildren(...events.map((event) => {
    const item = document.createElement("li");
    item.dataset.fault = event.fault;
    const time = document.createElement("time");
    time.dateTime = event.time;
    time.textContent = timeFormat.format(new Date(event.time));
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("small");
    detail.textContent = event.detail;
    body.append(title, detail);
    item.append(time, body);
    return item;
  }));
}

function drawStatus(state) {
  const production = (state ?? lastState)?.mode === "betrieb";
  drawGatePicker(state);
  byId("connection").dataset.tone = state ? "green" : "amber";
  text("connection-text", publicDemo ? "Öffentliche Demo" : state ? "Mit MUKAMS verbunden" : "Verbindung unterbrochen");
  const gate = state?.gate;
  const gateTone = gate === "offen" ? "green" : gate === "geschlossen" ? "neutral" : "amber";
  byId("gate-summary").dataset.tone = byId("gate-tile").dataset.tone = gateTone;
  const gateLabel = { offen: "Offen", geschlossen: "Geschlossen" }[gate] ?? "Unbekannt";
  text("gate-state", gateLabel);
  text("gate-overview", gateLabel);
  text("gate-overview-name", state?.tor?.name ?? "Tor");
  text("gate-name", state?.tor?.name ?? "Gewähltes Tor");
  text("camera-position", state?.kamera_position || "Kamera am Durchgang");
  text("reason", state?.reason ?? "Der aktuelle Torzustand ist nicht abrufbar.");
  text("frame-count", state ? `${state.confirmed} / ${state.required}` : "—");
  const progress = byId("frame-progress");
  progress.max = state?.required ?? 4;
  progress.value = state?.confirmed ?? 0;
  text("scenario", state?.scene ?? "—");
  text("camera-state", { aktiv: "Bild verfügbar", offline: "Bild fehlt", startet: "Startet", inaktiv: "Nicht eingerichtet" }[state?.camera] ?? "Unbekannt");
  byId("camera-tile").dataset.tone = state?.camera === "aktiv" ? "green" : !state || state.camera === "offline" ? "amber" : "neutral";
  const relay = state?.relais;
  const relayFault = ["störung", "unbekannt"].includes(relay?.zustand) ? relay.meldung : null;
  const fault = [state?.fault, relayFault].filter(Boolean).join(" · ");
  byId("fault-tile").dataset.tone = !state || fault ? "amber" : "green";
  text("fault-message", state ? fault || "Keine aktive Störung" : "Verbindung unterbrochen");
  const outputState = { bereit: "Bereit", prüfung: "Prüft", impuls: "Impuls aktiv", beendet: "In Ruhe", störung: "Störung", unbekannt: "Unbekannt" };
  const duration = relay ? (relay.dauer_ms / 1000).toLocaleString("de-CH") : "";
  text("relay-output", relay ? `${relay.art === "demo" ? "Demo" : "Moxa"} · RLY-${String(relay.kanal).padStart(2, "0")} · ${duration} s · ${outputState[relay.zustand]}` : "—");
  text("gate-automation", state?.mode === "demo" ? "Simuliert" : relay?.automatik ? "Aktiv · Moxa" : relayFault ? "Gesperrt" : "Aus");
  drawDemoControls(state);
  text("updated", state ? timeFormat.format(new Date(state.time)) : "—");
  text("mode", production ? "Inbetriebnahme" : state?.mode === "kamera" ? "IP-Kamera" : "Demo");
  const settingsLink = byId("settings-link");
  const settingsPort = (state ?? lastState)?.settings_port;
  settingsLink.hidden = Boolean(publicDemo) || location.hostname !== "127.0.0.1" || !settingsPort;
  if (!settingsLink.hidden) {
    const settingsUrl = new URL(`http://127.0.0.1:${settingsPort}/`);
    const gate = (state ?? lastState)?.tor?.id;
    if (gate) settingsUrl.searchParams.set("tor", gate);
    settingsLink.href = settingsUrl.href;
  }
  text("gate-source", production ? (state?.sps === "Nicht eingerichtet" ? "Ohne Torrückmeldung" : "SPS · Lesend") : "Simuliert");
  text("footer-mode", publicDemo ? "Beispieldaten · Torfreigabe simuliert"
    : production ? "Lokales Dashboard · Nur Beobachtung" : "Lokales Dashboard · Torfreigabe simuliert");
  byId("sps-row").hidden = !production;
  text("sps-state", state?.sps ?? "Unbekannt");
  text("frame-caption", production || state?.mode === "kamera" ? "Kamerabild · ca. 1 Bild/s" : "Simuliertes Kamerabild");
  byId("toggle-preview").disabled = state?.preview_enabled === false;
  const detections = (state?.detections ?? []).map(({ kind, label, score }) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "detection-name";
    name.dataset.kind = kind;
    const dot = document.createElement("span");
    dot.className = "dot";
    name.append(dot, label);
    const value = document.createElement("strong");
    value.textContent = `${score} %`;
    item.append(name, value);
    return item;
  });
  byId("detections").replaceChildren(...(detections.length ? detections : [listItem(state ? "Keine Erkennungen" : "Keine aktuellen Daten")]));
  if (state?.mode === "demo" && state.camera === "aktiv") drawScene(state);
  showPicture(state);
}

async function updatePreview(state, gate) {
  if (!showPreview || state.preview_enabled === false || state.mode === "demo" || state.camera !== "aktiv") {
    clearImage();
    return;
  }
  try {
    const response = await fetch(gateUrl("/preview.jpg", gate), { signal: AbortSignal.timeout(2400) });
    if (!response.ok) throw new Error("Vorschaubild fehlt");
    const image = await response.blob();
    if (!showPreview || gate !== selectedGate) return;
    const previous = imageUrl;
    imageUrl = URL.createObjectURL(image);
    video.src = imageUrl;
    if (previous) URL.revokeObjectURL(previous);
  } catch {
    if (gate === selectedGate) clearImage();
  }
  if (gate === selectedGate) showPicture(state);
}

async function poll() {
  const gate = selectedGate;
  try {
    let state;
    if (publicDemo) {
      state = publicDemo.snapshot(gate);
    } else {
      const response = await fetch(gateUrl("/api/status", gate), { signal: AbortSignal.timeout(2400) });
      if (response.status === 404 && gate && gate === selectedGate) {
        selectGate("");
        return;
      }
      if (!response.ok) throw new Error("Status fehlt");
      state = await response.json();
    }
    if (gate !== selectedGate) return;
    const eventsChanged = !lastState || state.events[0]?.time !== lastState.events[0]?.time;
    lastState = state;
    drawStatus(state);
    if (eventsChanged) drawEvents();
    await updatePreview(state, gate);
  } catch {
    if (gate === selectedGate) {
      clearImage();
      drawStatus(null);
    }
  } finally {
    window.setTimeout(poll, 900);
  }
}

byId("toggle-preview").addEventListener("click", () => {
  showPreview = !showPreview;
  text("toggle-preview", showPreview ? "Bild ausblenden" : "Bild anzeigen");
  byId("toggle-preview").setAttribute("aria-pressed", String(showPreview));
  if (!showPreview) clearImage();
  showPicture(byId("connection").dataset.tone === "green" ? lastState : null);
});
byId("fault-filter").addEventListener("change", drawEvents);
gateSelect.addEventListener("change", () => selectGate(gateSelect.value));
demoControls.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = demoControls.querySelector("button");
  const gate = selectedGate;
  selectingDemo = button.disabled = true;
  demoError = "";
  drawDemoControls(lastState);
  try {
    if (publicDemo) {
      publicDemo.select(gate, demoCase.value);
    } else {
      const response = await fetch(gateUrl("/api/demo/szenario", gate), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demoCase.value), signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error("Szenario konnte nicht gestartet werden.");
    }
  } catch {
    if (gate === selectedGate) demoError = "Szenario konnte nicht gestartet werden.";
  } finally {
    selectingDemo = button.disabled = false;
    drawDemoControls(lastState);
  }
});

poll();
