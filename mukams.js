"use strict";

window.kuherfassungStore = (() => {
  let database;
  const outcome = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  function open() {
    if (!database) {
      const request = indexedDB.open("mukams-kuherfassung", 1);
      request.onupgradeneeded = () => {
        const cows = request.result.createObjectStore("tiere", { keyPath: ["bestand", "id"] });
        cows.createIndex("bestand", "bestand");
        request.result.createObjectStore("fotos", { keyPath: "id" }).createIndex("kuh", ["bestand", "kuh"]);
        for (const cow of window.kuherfassungDemo.tiere) cows.add(cow);
      };
      database = outcome(request).catch(error => {
        database = undefined;
        throw error;
      });
    }
    return database;
  }

  async function access(names, mode, operation) {
    const db = await open();
    const transaction = db.transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("Speichern abgebrochen."));
    });
    try {
      const result = await operation(transaction);
      await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already be closed. */ }
      await done.catch(() => {});
      throw error;
    }
  }

  function listCows(herd) {
    return access("tiere", "readonly", tx => outcome(tx.objectStore("tiere").index("bestand").getAll(herd)));
  }

  function listPhotos(cow) {
    return access("fotos", "readonly", tx => outcome(tx.objectStore("fotos").index("kuh").getAll([cow.bestand, cow.id])));
  }

  function saveCow(cow) {
    return access("tiere", "readwrite", async tx => {
      const store = tx.objectStore("tiere");
      const cows = await outcome(store.index("bestand").getAll(cow.bestand));
      const keys = ["tiernummer", "ohrmarke", "transponder"];
      const duplicate = cows.some(other => other.id !== cow.id && keys.some(key =>
        cow[key] && cow[key].toLowerCase() === other[key]?.toLowerCase()));
      if (duplicate) throw new Error("Tiernummer, Ohrmarke oder Transponder wird bereits verwendet.");
      const saved = { ...cow, fotos: cows.find(other => other.id === cow.id)?.fotos ?? 0 };
      await outcome(store.put(saved));
      return saved;
    });
  }

  function addPhoto(cow, photo) {
    return access(["tiere", "fotos"], "readwrite", async tx => {
      const cows = tx.objectStore("tiere");
      const photos = tx.objectStore("fotos");
      const key = [cow.bestand, cow.id];
      const entry = await outcome(cows.get(key));
      if (!entry) throw new Error("Die Kuh ist nicht im gewählten Bestand vorhanden.");
      const existing = await outcome(photos.index("kuh").getAll(key));
      if (existing.filter(item => item.ansicht === photo.ansicht).length >= 12) {
        throw new Error("Für diese Perspektive sind bereits 12 Bilder gespeichert.");
      }
      await outcome(photos.add({ ...photo, bestand: cow.bestand, kuh: cow.id }));
      await outcome(cows.put({ ...entry, fotos: existing.length + 1 }));
    });
  }

  function removePhoto(photo) {
    return access(["tiere", "fotos"], "readwrite", async tx => {
      const photos = tx.objectStore("fotos");
      const cows = tx.objectStore("tiere");
      const entry = await outcome(photos.get(photo.id));
      if (!entry) return;
      const cow = await outcome(cows.get([entry.bestand, entry.kuh]));
      await outcome(photos.delete(entry.id));
      if (cow) await outcome(cows.put({ ...cow, fotos: Math.max(0, cow.fotos - 1) }));
    });
  }

  return { listCows, listPhotos, saveCow, addPhoto, removePhoto };
})();
