'use strict';
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const db = require('./db');
const settings = require('./settings');
const modules = require('./modules');
const localsMiddleware = require('./locals');
const mw = require('./middleware');
const installer = require('./installer');

const state = { main: null, timers: [] };

async function bootMain() {
  const cfg = config.load();
  db.init(cfg.db);
  await settings.load();
  await modules.load();
  await require('./migrate').run();
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 10000 }));
  r.use((req, res, next) => { if (req.body && typeof req.body === 'object') req.body = mw.noPassNormalize(req.body); next(); });
  // با چند پردازش (Passenger) تنظیمات/ماژول‌ها را هر چند ثانیه از پایگاه داده تازه می‌کنیم
  let lastRefresh = Date.now();
  r.use((req, res, next) => {
    if (Date.now() - lastRefresh < 10000) return next();
    lastRefresh = Date.now();
    Promise.all([settings.load(), modules.load()]).then(() => next(), next);
  });
  r.use(mw.sessionMiddleware(cfg));
  r.use(mw.flash);
  r.use((req, res, next) => mw.loadUser(req, res, next).catch(next));
  r.use(mw.csrfProtect);
  require('./routes')(r);
  r.use((req, res) => res.status(404).view('error', { code: 404, title: 'صفحه یافت نشد', message: 'نشانی درخواستی وجود ندارد.' }, req.user ? 'layout' : 'bare'));
  state.main = r;
  startJobs();
}

function startJobs() {
  state.timers.forEach(clearInterval); state.timers = [];
  const jobs = require('./jobs');
  jobs.run();
  const t = setInterval(jobs.run, 30 * 60 * 1000); t.unref && t.unref();
  state.timers.push(t);
}

async function createApp() {
  config.ensureDirs();
  const app = express();
  const cfg = config.load();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.ROOT, 'views'));
  if (process.env.NODE_ENV === 'production') app.enable('view cache');
  app.set('etag', 'strong');

  const root = express.Router();
  root.use(compression());
  root.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'self'"], upgradeInsecureRequests: null } },
    crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' }, hsts: false,
  }));
  root.use('/assets', express.static(path.join(config.ROOT, 'public'), { maxAge: '30d', index: false }));
  root.get('/healthz', (req, res) => res.json({ ok: true, installed: !!state.main, uptime: Math.round(process.uptime()) }));
  root.use(localsMiddleware);
  const installerRouter = installer.createRouter(async () => { await bootMain(); });
  root.use((req, res, next) => {
    if (state.main) return state.main(req, res, next);
    if (config.isInstalled()) { // نصب قبلاً انجام شده ولی پردازش تازه بالا آمده
      return bootMain().then(() => state.main(req, res, next)).catch(next);
    }
    return installerRouter(req, res, next);
  });
  app.use(cfg.basePath || '/', root);
  if (cfg.basePath) app.use((req, res) => res.status(404).send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', req.method, req.originalUrl, err && err.stack || err);
    if (res.headersSent) return;
    const dev = process.env.NODE_ENV !== 'production';
    const payload = { code: 500, title: 'خطای سرور', message: dev ? String(err && err.message) : 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' };
    if (typeof res.view === 'function') return res.status(500).view('error', payload, req.user ? 'layout' : 'bare');
    res.status(500).send('Server error');
  });

  if (config.isInstalled()) await bootMain();
  return app;
}
module.exports = { createApp, state };
