import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVehicleServiceHistory_,
  normalizeServiceHistoryItem_,
  vehicleFormField_,
  applyServiceHistoryUpdate
} from './lib/gas-pure.mjs';

describe('parseVehicleServiceHistory_', () => {
  it('returns empty for null/invalid JSON', () => {
    assert.deepEqual(parseVehicleServiceHistory_(null), []);
    assert.deepEqual(parseVehicleServiceHistory_('not-json'), []);
    assert.deepEqual(parseVehicleServiceHistory_('{}'), []);
  });

  it('parses valid JSON array', () => {
    const raw = '[{"serviceDate":"2026-01-01","serviceKm":1000,"nextDueKm":11000}]';
    const out = parseVehicleServiceHistory_(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].serviceKm, 1000);
  });
});

describe('applyServiceHistoryUpdate', () => {
  const baseForm = {
    serviceLastDate: '2026-05-01',
    serviceLastKm: 30000,
    serviceMile: 40000,
    serviceLastBy: 'Tester',
    serviceIntervalKm: 10000,
    recordedAt: '2026-05-01T00:00:00.000Z'
  };

  it('prepends new record when not editing', () => {
    const existing = JSON.stringify([{
      serviceDate: '2026-01-01',
      serviceKm: 20000,
      nextDueKm: 30000,
      serviceBy: 'A',
      intervalKm: 10000,
      recordedAt: '2026-01-01T00:00:00.000Z'
    }]);
    const { historyJson, latest } = applyServiceHistoryUpdate(existing, baseForm);
    const history = parseVehicleServiceHistory_(historyJson);
    assert.equal(history.length, 2);
    assert.equal(history[0].serviceKm, 30000);
    assert.equal(latest.serviceKm, 30000);
    assert.equal(latest.nextDueKm, 40000);
  });

  it('updates existing index when serviceHistoryEditIndex is set', () => {
    const existing = JSON.stringify([
      { serviceDate: '2026-05-01', serviceKm: 31000, nextDueKm: 41000, serviceBy: 'New', intervalKm: 10000, recordedAt: 'x' },
      { serviceDate: '2026-01-01', serviceKm: 20000, nextDueKm: 30000, serviceBy: 'Old', intervalKm: 10000, recordedAt: 'y' }
    ]);
    const { historyJson } = applyServiceHistoryUpdate(existing, {
      ...baseForm,
      serviceLastKm: 30500,
      serviceHistoryEditIndex: '1'
    });
    const history = parseVehicleServiceHistory_(historyJson);
    assert.equal(history.length, 2);
    assert.equal(history[1].serviceKm, 30500);
    assert.equal(history[0].serviceKm, 31000);
  });
});

describe('vehicleFormField_', () => {
  it('prefers form value over row', () => {
    assert.equal(vehicleFormField_({ plate: 'ABC' }, 'plate', ['id', 'OLD'], 1, ''), 'ABC');
    assert.equal(vehicleFormField_({}, 'plate', ['id', 'OLD'], 1, ''), 'OLD');
  });
});

describe('normalizeServiceHistoryItem_', () => {
  it('fills defaults for missing fields', () => {
    const item = normalizeServiceHistoryItem_({ serviceDate: '2026-01-01' }, 12000);
    assert.equal(item.intervalKm, 12000);
    assert.equal(item.serviceKm, 0);
  });
});
