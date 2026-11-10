(() => {
  const { cases, scenes, zone } = window.mukamsDemoData;
  const gates = [
    { id: "tor-nord", name: "Tor Nord", position: "Frontal über dem Zulauf", zone, channel: 0, duration: 1500 },
    { id: "tor-sued", name: "Tor Süd", position: "Seitlich links am Tor", zone: [0.12, 0.22, 0.72, 0.91], channel: 1, duration: 3000 },
  ];
  const records = new Map(gates.map((gate) => [gate.id, {
    selection: "", scene: "", index: -1, started: performance.now(), events: [], pulsed: false, open: false,
  }]));
  const find = (id) => gates.find((gate) => gate.id === id) ?? gates[0];

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
})();
