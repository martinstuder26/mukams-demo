(() => {
  const { cases, scenes, zone } = window.mukamsDemoData;
  const defaultGates = [
    { id: "tor-nord", name: "Tor Nord", position: "Frontal über dem Zulauf", zone, channel: 0, duration: 1500 },
    { id: "tor-sued", name: "Tor Süd", position: "Seitlich links am Tor", zone: [0.12, 0.22, 0.72, 0.91], channel: 1, duration: 3000 },
  ];
  const storageKey = "mukams-demo-tore-v1";
  const maxGates = 20;
  const durations = [1500, 3000, 4500, 6000];
  const gates = loadGates();
  const records = new Map(gates.map((gate) => [gate.id, newRecord()]));
  const find = (id) => gates.find((gate) => gate.id === id) ?? gates[0];

  function newRecord() {
    return {
      selection: "", scene: "", index: -1, started: performance.now(), events: [], pulsed: false, open: false,
    };
  }

  function validZone(bounds) {
    return Array.isArray(bounds) && bounds.length === 4 &&
      bounds.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
      bounds[0] < bounds[2] && bounds[1] < bounds[3];
  }

  function loadGates() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= maxGates &&
          new Set(saved.map((gate) => gate.id)).size === saved.length && saved.every((gate) =>
            typeof gate.id === "string" && typeof gate.name === "string" && typeof gate.position === "string" &&
            Number.isInteger(gate.channel) && gate.channel >= 0 && gate.channel < 6 &&
            durations.includes(gate.duration) && validZone(gate.zone))) return saved;
    } catch {
      // The demo also works when the browser blocks storage.
    }
    return defaultGates;
  }

  function note(record, title, detail, fault = false) {
    record.events.unshift({ time: new Date().toISOString(), title, detail, fault });
    record.events.length = Math.min(record.events.length, 12);
  }

  function select(id, scene) {
    if (scene && !cases.includes(scene)) throw new Error("Unbekanntes Demo-Szenario");
    const record = records.get(find(id).id);
    record.selection = scene;
    record.started = performance.now();
    record.index = -1;
    record.pulsed = false;
    record.open = false;
  }

  function snapshot(id) {
    const gate = find(id);
    const record = records.get(gate.id);
    const elapsed = performance.now() - record.started;
    const index = record.selection ? 0 : Math.floor(elapsed / 10000);
    const sceneTime = record.selection ? elapsed : elapsed % 10000;
    if (index !== record.index) {
      record.index = index;
      record.pulsed = false;
    }
    const target = record.selection || cases[index % cases.length];
    const scene = sceneTime < 1500 ? "Leerer Durchgang" : target;
    const fault = { Kameraausfall: "Kamerabild fehlt", Torstörung: "Torrückmeldung fehlt" }[scene] ?? null;
    const confirmed = scene === "Einzelne Kuh" ? Math.min(4, 1 + Math.floor((sceneTime - 1500) / 300)) : 0;
    const count = confirmed === 4 ? 1 : 0;
    const opened = count === 1 && sceneTime < 2400 + gate.duration;
    const reason = fault ?? {
      "Leerer Durchgang": "Keine Erkennung in der Prüfzone.",
      "Kuh und Kalb": "Kalb in der Prüfzone.",
      "Kalb": "Kalb in der Prüfzone.",
      "Zwei Kühe": "Mehrere Erkennungen in der Prüfzone.",
      "Unsichere Kuh": "Keine ausreichend sicher erkannte Kuh.",
      "Andere Erkennung": "Andere oder unbekannte Erkennung in der Prüfzone.",
      "Einzelne Kuh": count ? "Einzelne Kuh über mehrere Bilder bestätigt." : "Die Kuh wird über mehrere Bilder geprüft.",
    }[scene];
    if (record.scene !== scene) note(record, fault || scene, reason, Boolean(fault));
    if (count && !record.pulsed) note(record, "Automatische Demo-Freigabe", "Simulierter Schaltimpuls.");
    if (record.open && !opened) note(record, "Demoimpuls beendet", "Simulierter Ausgang wieder in Ruhe.");
    Object.assign(record, { scene, pulsed: record.pulsed || Boolean(count), open: opened });

    const detections = (scenes[scene] ?? []).map((detection) => ({
      ...detection,
      box: detection.box.map((value, index) => {
        const axis = index % 2;
        return gate.zone[axis] + (value - zone[axis]) * (gate.zone[axis + 2] - gate.zone[axis]) / (zone[axis + 2] - zone[axis]);
      }),
    }));
    return {
      tor: { id: gate.id, name: gate.name }, tore: gates.map(({ id, name }) => ({ id, name })),
      kamera_position: gate.position, mode: "demo", time: new Date().toISOString(),
      camera: scene === "Kameraausfall" ? "offline" : "aktiv",
      gate: scene === "Torstörung" ? "unbekannt" : opened ? "offen" : "geschlossen",
      demo_cases: cases, demo_selected: record.selection, demo_pulses: count,
      scene, reason, confirmed, required: 4, zone: gate.zone, detections, fault, events: record.events.slice(),
      relais: { art: "demo", kanal: gate.channel, dauer_ms: gate.duration, zustand: opened ? "impuls" : count ? "beendet" : "bereit" },
    };
  }

  window.mukamsDemo = { select, snapshot };

  const form = document.getElementById("demo-settings");
  if (form) setupSettings(form);

  function setupSettings(form) {
    const fields = form.elements;
    const zoneFields = [fields.left, fields.top, fields.right, fields.bottom];
    const picker = fields.gate;
    const add = document.getElementById("demo-add-gate");
    const pulse = document.getElementById("demo-relay-pulse");
    const pulseMessage = document.getElementById("demo-relay-message");
    const message = document.getElementById("demo-settings-message");
    const overview = document.getElementById("uebersicht");
    const settings = document.getElementById("einstellungen");
    const overviewLink = document.querySelector('.top-nav a[href="#uebersicht"]');
    const settingsLink = document.querySelector('.top-nav a[href="#einstellungen"]');
    const outputs = Array.from({ length: 6 }, (_, index) => `RLY-0${index}`);
    let draft;
    let pulseTimer;

    fields.channel.replaceChildren(...outputs.map((label, index) => new Option(label, index)));

    function edit(gate, isNew = false) {
      draft = gate;
      picker.replaceChildren(...gates.map(({ id, name }) => new Option(name, id)));
      if (isNew) picker.add(new Option(gate.name, gate.id));
      picker.value = gate.id;
      fields.gateName.value = gate.name;
      fields.position.value = gate.position;
      fields.channel.value = gate.channel;
      fields.duration.value = gate.duration;
      zoneFields.forEach((field, index) => { field.value = Math.round(gate.zone[index] * 100); });
      add.disabled = isNew || gates.length >= maxGates;
      window.clearTimeout(pulseTimer);
      pulse.disabled = false;
      pulseMessage.textContent = "Bereit";
      message.textContent = isNew ? "Speichere das neue Tor für die Übersicht." : "Änderungen gelten für diese Demo.";
    }

    function showPage() {
      const showSettings = location.hash === "#einstellungen";
      overview.hidden = showSettings;
      settings.hidden = !showSettings;
      document.title = `MUKAMS · ${showSettings ? "Einstellungen" : "Stallübersicht"}`;
      const active = showSettings ? settingsLink : overviewLink;
      const inactive = showSettings ? overviewLink : settingsLink;
      active.setAttribute("aria-current", "page");
      inactive.removeAttribute("aria-current");
      if (showSettings) edit(find(new URLSearchParams(location.search).get("tor")));
    }

    picker.addEventListener("change", () => edit(find(picker.value)));
    add.addEventListener("click", () => {
      const next = gates.length + 1;
      edit({ id: `tor-${crypto.randomUUID()}`, name: `Tor ${next}`, position: "Am Zulauf", zone,
        channel: next <= outputs.length ? next - 1 : 0, duration: 1500 }, true);
      fields.gateName.focus();
      fields.gateName.select();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = fields.gateName.value.trim();
      const position = fields.position.value.trim();
      const bounds = zoneFields.map((field) => field.valueAsNumber / 100);
      if (!name || !position || !validZone(bounds)) {
        message.textContent = !name || !position ? "Torname und Kameraposition eingeben."
          : "Die Prüfzone braucht einen linken und oberen Startpunkt vor dem rechten und unteren Rand.";
        return;
      }
      Object.assign(draft, { name, position, zone: bounds, channel: Number(fields.channel.value), duration: Number(fields.duration.value) });
      if (!records.has(draft.id)) {
        gates.push(draft);
        records.set(draft.id, newRecord());
      }
      edit(draft);
      try {
        localStorage.setItem(storageKey, JSON.stringify(gates));
        message.textContent = "In diesem Browser gespeichert.";
      } catch {
        message.textContent = "Für diese Sitzung übernommen. Der Browser blockiert dauerhaftes Speichern.";
      }
    });

    pulse.addEventListener("click", () => {
      const output = outputs[Number(fields.channel.value)];
      pulse.disabled = true;
      pulseMessage.textContent = `${output} · Simulierter Impuls aktiv`;
      pulseTimer = window.setTimeout(() => {
        pulseMessage.textContent = `${output} · Impuls beendet`;
        pulse.disabled = false;
      }, Number(fields.duration.value));
    });

    window.addEventListener("hashchange", showPage);
    showPage();
  }
})();
