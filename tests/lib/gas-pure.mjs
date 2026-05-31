/** Pure helpers mirrored from gas/Code.js for unit tests — keep in sync when backend changes. */
export const DEFAULT_SERVICE_INTERVAL_KM = 10000;

export function vehicleFormField_(form, key, row, colIndex, fallback) {
  if (form && Object.prototype.hasOwnProperty.call(form, key) && form[key] !== undefined && form[key] !== null && String(form[key]).trim() !== '') {
    return form[key];
  }
  if (row && row[colIndex] !== undefined && row[colIndex] !== null && String(row[colIndex]).trim() !== '') {
    return row[colIndex];
  }
  return fallback;
}

export function parseVehicleServiceHistory_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item === 'object');
  } catch {
    return [];
  }
}

export function normalizeServiceHistoryItem_(item, fallbackIntervalKm) {
  const safeInterval = parseFloat(fallbackIntervalKm) || DEFAULT_SERVICE_INTERVAL_KM;
  return {
    serviceDate: String(item && item.serviceDate ? item.serviceDate : ''),
    serviceKm: parseFloat(item && item.serviceKm) || 0,
    nextDueKm: parseFloat(item && item.nextDueKm) || 0,
    serviceBy: String(item && item.serviceBy ? item.serviceBy : ''),
    intervalKm: parseFloat(item && item.intervalKm) || safeInterval,
    recordedAt: String(item && item.recordedAt ? item.recordedAt : '')
  };
}

/** Mirrors saveVehicle service-history branch in gas/Code.js */
export function applyServiceHistoryUpdate(existingHistoryJson, form) {
  const history = parseVehicleServiceHistory_(existingHistoryJson).map((item) =>
    normalizeServiceHistoryItem_(item, form.serviceIntervalKm)
  );
  const editIndexRaw = Number(form.serviceHistoryEditIndex);
  const hasEditIndex = !Number.isNaN(editIndexRaw) && editIndexRaw >= 0 && editIndexRaw < history.length;
  const editedItem = {
    serviceDate: String(form.serviceLastDate || ''),
    serviceKm: parseFloat(form.serviceLastKm) || 0,
    nextDueKm: parseFloat(form.serviceMile) || 0,
    serviceBy: String(form.serviceLastBy || ''),
    intervalKm: parseFloat(form.serviceIntervalKm) || DEFAULT_SERVICE_INTERVAL_KM,
    recordedAt: form.recordedAt || new Date().toISOString()
  };
  if (hasEditIndex) {
    history[editIndexRaw] = editedItem;
  } else {
    history.unshift(editedItem);
  }
  const latest = history.length > 0 ? normalizeServiceHistoryItem_(history[0], form.serviceIntervalKm) : null;
  return {
    historyJson: JSON.stringify(history.slice(0, 30)),
    latest
  };
}
