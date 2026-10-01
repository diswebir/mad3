'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');
const modules = require('./modules');
const icon = require('./utils/icons');
const J = require('./utils/jalali');
const F = require('./utils/fa');
const { L, badge } = require('./labels');

// نسخه‌بندی فایل‌های استاتیک برای کش طولانی‌مدت مرورگر
const assetVersion = {};
function ver(file) {
  if (assetVersion[file]) return assetVersion[file];
  try { return (assetVersion[file] = Math.floor(fs.statSync(path.join(config.ROOT, 'public', file)).mtimeMs / 1000).toString(36)); } catch (_) { return '1'; }
}

module.exports = function localsMiddleware(req, res, next) {
  const base = config.load().basePath;
  const app = req.app;
  const l = res.locals;
  l.base = base;
  l.u = (p) => base + p;
  l.asset = (p) => `${base}/assets/${p}?v=${ver(p)}`;
  l.fa = F.toFa; l.money = F.money; l.num = F.number; l.esc = F.esc;
  l.d = (v) => F.toFa(J.isoToJString(v)); l.ld = (v) => F.toFa(J.longDate(v)); l.dt = (v) => F.toFa(J.dateTimeString(v));
  l.PERMS_LIB = require('./permissions'); l.can = (perm) => require('./permissions').can(req.user, perm); l.APP_VERSION = require('./version').VERSION;
  l.icon = icon; l.L = L; l.badges_map = badge; l.J = J;
  l.S = (k) => settings.get(k); l.settingsAll = settings.all();
  l.enabled = (k) => modules.isEnabled(k);
  l.initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('\u200c');
  l.fileUrl = (kind, name) => `${base}/files/${kind}/${name}`;
  l.reqPath = req.path;
  l.currentQuery = req.query;
  l.qs = (over) => {
    const q = { ...req.query, ...over };
    const s = Object.keys(q).filter((k) => q[k] !== '' && q[k] !== undefined && q[k] !== null).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    return s ? '?' + s : '';
  };
  l.pill = (text, color) => `<span class="badge ${color || ''}">${F.esc(text)}</span>`;
  l.isManager = false; l.user = null; l.nav = []; l.activeHref = ''; l.badgeCounts = null; l.flash = [];
  l.title = '';
  l.bare = false;

  // ریدایرکت با در نظر گرفتن مسیر پایه (نصب در زیرپوشه)
  const orig = res.redirect.bind(res);
  res.redirect = (a, b) => {
    let status = 302; let url = a;
    if (typeof a === 'number') { status = a; url = b; }
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) url = base + url;
    return orig(status, url);
  };

  res.view = (name, data = {}, layout = 'layout') => {
    if (layout === 'layout' && !req.user) layout = 'bare';
    (async () => {
      if (req.user && layout === 'layout') {
        const { badgesFor } = require('./middleware');
        const b = await badgesFor(req.user);
        const nav = modules.navFor(req.user.role, b, req.user);
        let best = null;
        for (const s of nav) for (const it of s.items) {
          const hit = it.href === '/' ? req.path === '/' : (req.path === it.href || req.path.startsWith(it.href + '/'));
          if (hit && (!best || it.href.length > best.href.length)) best = it;
        }
        l.nav = nav; l.activeHref = best ? best.href : ''; l.badgeCounts = b;
        l.S = (k) => settings.get(k);
      }
      const merged = { ...l, ...data };
      app.render(name, merged, (err, body) => {
        if (err) return next(err);
        res.render(layout, { ...merged, body });
      });
    })().catch(next);
  };
  next();
};
