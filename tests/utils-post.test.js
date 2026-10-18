import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJson, setTokenProvider, fetchSheet } from '../js/utils.js';

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

test('postJson: přiloží token přihlášeného (setTokenProvider), bez něj nic', async () => {
  let sent;
  globalThis.fetch = async (_u, o) => { sent = JSON.parse(o.body); return { status: 200, text: async () => '{"ok":1}' }; };
  await postJson({ action: 'x' });
  assert.equal(sent.idToken, undefined);
  setTokenProvider(async () => 'TOKEN123');
  await postJson({ action: 'x' });
  assert.equal(sent.idToken, 'TOKEN123');
  setTokenProvider(async () => '');
});

test('fetchSheet: čte přes POST read; starý GAS bez read → GET', async () => {
  const calls = [];
  globalThis.fetch = async (u, o) => { calls.push(o ? 'POST' : 'GET');
    return { status: 200, text: async () => (o ? '{"sheets":{"Mzdy":{"values":[["a"]]}}}' : '{}') }; };
  assert.deepEqual(await fetchSheet('x?sheet=Mzdy'), { values: [['a']] });
  assert.deepEqual(calls, ['POST']);
  calls.length = 0;
  globalThis.fetch = async (u, o) => { calls.push(o ? 'POST' : 'GET');
    return { status: 200, text: async () => (o ? '{"success":true}' : '{"values":[["g"]]}') }; };
  assert.deepEqual(await fetchSheet('x?sheet=Mzdy'), { values: [['g']] });
  assert.deepEqual(calls, ['POST', 'GET']);
});
