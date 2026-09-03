// Pure-data check for the popover's field fallback logic. No DOM, no Electron.
//   node --test test/renderer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { pickField, parsePaceInput, formatPaceInput, paceDot } = createRequire(import.meta.url)('../renderer.js');

test('pickField prefers the BLE key name and falls back to the HID one', () => {
    assert.equal(pickField(['currentPace', 'pace'], { currentPace: 120 }), 'currentPace');
    assert.equal(pickField(['currentPace', 'pace'], { pace: 120 }), 'pace');
});

test('pickField returns undefined when neither transport has reported the field yet', () => {
    assert.equal(pickField(['currentPace', 'pace'], { heartRate: 150 }), undefined);
});

test('parsePaceInput parses "m:ss", rejects garbage and out-of-range seconds', () => {
    assert.equal(parsePaceInput('2:00'), 120);
    assert.equal(parsePaceInput('0:45'), 45);
    assert.equal(parsePaceInput('12:05'), 725);
    assert.equal(parsePaceInput(''), null);
    assert.equal(parsePaceInput('nope'), null);
    assert.equal(parsePaceInput('2:99'), null); // seconds must be 0-59
});

test('formatPaceInput round-trips through parsePaceInput', () => {
    assert.equal(formatPaceInput(120), '2:00');
    assert.equal(formatPaceInput(725), '12:05');
    assert.equal(parsePaceInput(formatPaceInput(125)), 125);
});

test('paceDot: a smaller (faster) raw value than the minimum is green, slower is red', () => {
    assert.equal(paceDot(115, 120), '🟢 '); // faster than target
    assert.equal(paceDot(120, 120), '🟢 '); // exactly on target counts as met
    assert.equal(paceDot(125, 120), '🔴 '); // slower than target
});

test('paceDot: no threshold set means no color', () => {
    assert.equal(paceDot(125, null), '');
});
