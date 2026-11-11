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

(() => {
  const data = window.kuherfassungDemo;
  const matcher = window.kuherfassungMatch;
  const input = document.querySelector('#fellfoto');
  const sampleButton = document.querySelector('#prueffoto');
  const preview = document.querySelector('#fellvorschau');
  const image = document.querySelector('#fellbild');
  const result = document.querySelector('#fellergebnis');
  const solution = document.querySelector('#fellloesung');
  let referenceFeatures;
  let previewUrl;
  let revision = 0;
  let sampleIndex = 0;

  function cowLabel(id) {
    const cow = data.tiere.find(animal => animal.id === id);
    return cow ? [cow.tiernummer, cow.name].filter(Boolean).join(' · ') : id;
  }

  function photoBlob(photo) {
    return new Blob([Uint8Array.from(atob(photo.jpeg), byte => byte.charCodeAt(0))], {type: 'image/jpeg'});
  }

  async function describe(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      return matcher.describe(bitmap);
    } finally {
      bitmap.close();
    }
  }

  async function compare(blob, sample) {
    const current = ++revision;
    solution.hidden = true;
    result.hidden = false;
    result.textContent = 'Fellmuster wird verglichen …';
    preview.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (blob.size > 8 * 1024 * 1024) {
      result.textContent = 'Bitte ein Foto bis 8 MB wählen.';
      return;
    }
    previewUrl = URL.createObjectURL(blob);
    image.src = previewUrl;
    try {
      const query = await describe(blob);
      if (current !== revision) return;
      preview.hidden = false;
      referenceFeatures ??= Promise.all(data.fotos.filter(photo => photo.ansicht === 'oben').map(async photo => ({
        cow: photo.kuh,
        features: await describe(photoBlob(photo)),
      }))).catch(error => {
        referenceFeatures = undefined;
        throw error;
      });
      const references = await referenceFeatures;
      if (current !== revision) return;
      const match = matcher.suggest(query, references);
      result.textContent = match
        ? `Vorschlag: ${cowLabel(match.cow)} · ${match.score} Ähnlichkeitspunkte`
        : 'Kein eindeutiger Treffer in der Demoherde.';
      if (sample) {
        solution.textContent = `Das Prüfbild zeigt ${cowLabel(sample.kuh)}.`;
        solution.hidden = false;
      }
    } catch {
      if (current === revision) result.textContent = 'Das Foto konnte nicht geprüft werden. Bitte ein anderes Bild wählen.';
    }
  }

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) compare(file);
    input.value = '';
  });
  sampleButton.disabled = !data.prueffotos.length;
  sampleButton.addEventListener('click', () => {
    const sample = data.prueffotos[sampleIndex++ % data.prueffotos.length];
    sampleButton.textContent = 'Nächstes Prüfbild';
    compare(photoBlob(sample), sample);
  });
})();
