'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'icons');
const cache = {};
function icon(name, size = 18) {
  const key = name + size;
  if (cache[key]) return cache[key];
  let inner = '';
  try {
    const svg = fs.readFileSync(path.join(dir, name + '.svg'), 'utf8');
    inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  } catch (_) { inner = '<circle cx="12" cy="12" r="9"/>'; }
  return (cache[key] = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
}
module.exports = icon;
