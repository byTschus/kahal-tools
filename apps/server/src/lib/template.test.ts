import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, listVariables, render, slugify } from './template.js';

const vars = {
  event: { title: 'Gottesdienst', date: '2026-03-08T09:30:00Z' },
  people: { Pastor: ['Max Muster', 'Anna Beispiel'], 'Worship Leader': 'Lea' },
  items: { Predigt: { description: '<p>Hallo&nbsp;Welt</p>' } },
};

test('einfache Variablen', () => {
  assert.equal(render('{{event.title}}!', vars), 'Gottesdienst!');
  assert.equal(render('{{ people.Pastor }}', vars), 'Max Muster, Anna Beispiel');
  assert.equal(render('{{people["Worship Leader"]}}', vars), 'Lea');
  assert.equal(render('{{people.worship_leader}}', vars), 'Lea');
  assert.equal(render('{{unbekannt.feld}}', vars), '');
});

test('Filter', () => {
  assert.equal(render('{{event.date | date:"EEEE, dd.MM.yyyy HH:mm"}}', vars, { timeZone: 'Europe/Zurich' }), 'Sonntag, 08.03.2026 10:30');
  assert.equal(render('{{people.Pastor | first | upper}}', vars), 'MAX MUSTER');
  assert.equal(render('{{nix | default:"-"}}', vars), '-');
  assert.equal(render('{{items.Predigt.description | strip_html}}', vars), 'Hallo Welt');
  assert.equal(render('{{event.title | truncate:5}}', vars), 'Gott…');
});

test('Datumsformat mit Text', () => {
  assert.equal(formatDate(new Date('2026-12-24T17:00:00Z'), "d. MMMM yyyy 'um' H 'Uhr'", 'Europe/Zurich'), '24. Dezember 2026 um 18 Uhr');
});

test('Variablenliste und slugify', () => {
  const list = listVariables(vars);
  assert.ok(list.some((v) => v.path === 'people["Worship Leader"]'));
  assert.equal(slugify('2026-03-08 Grüss Gott: Teil 1'), '2026-03-08-gruess-gott-teil-1');
});
