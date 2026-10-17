import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJson } from '../js/utils.js';

// Podvržený fetch: postupně vrací zadané odpovědi a počítá volání.
function fakeFetch(...bodies) {
  let n = 0;
  globalThis.fetch = async () => { const b = bodies[Math.min(n++, bodies.length - 1)]; return { status: 200, text: async () => b }; };
  return () => n;
}

test('postJson: HTML chybová stránka z GAS se zkusí znovu', async () => {
  const calls = fakeFetch('<!DOCTYPE html><title>Error</title>', '{"success":true,"updated":8}');
  const d = await postJson({ action: 'refreshNav' }, { tries: 3, delayMs: 0 });
  assert.equal(d.updated, 8);
  assert.equal(calls(), 2);
});

test('postJson: bez opakování (tries 1) vrátí srozumitelnou chybu místo "Unexpected token"', async () => {
  fakeFetch('<html>Server error</html>');
  await assert.rejects(postJson({ action: 'uploadDocument' }, { tries: 1, delayMs: 0 }), /Apps Script vrátil HTML/);
});

test('postJson: chyba v JSON ({error}) se neopakuje a propadne', async () => {
  const calls = fakeFetch('{"error":"Dokument nenalezen"}');
  await assert.rejects(postJson({ action: 'x' }, { tries: 3, delayMs: 0 }), /Dokument nenalezen/);
  assert.equal(calls(), 1);
});
