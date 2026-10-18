import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml, jsArg, safeUrl } from '../js/html.js';

test('safeUrl: jen https, javascript:/data:/http → prázdné', () => {
  assert.equal(safeUrl('https://drive.google.com/x?a=1&b=2'), 'https://drive.google.com/x?a=1&amp;b=2');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl(' JAVASCRIPT:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('http://x'), '');
  assert.equal(safeUrl(undefined), '');
});

test('escHtml/jsArg: payload z popisu transakce se nespustí', () => {
  const p = '<img src=x onerror=alert(1)>';
  assert.ok(!escHtml(p).includes('<'));
  assert.ok(!jsArg("x');alert(1)//").includes("'"));
});
