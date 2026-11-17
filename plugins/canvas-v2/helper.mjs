// canvas helper: runs on this machine, listens on 127.0.0.1 only. Stop it with Ctrl-C.
//   node canvas-helper.mjs <port of your app> <canvas origin>   your app again, so the canvas can show it in a card
//   node canvas-helper.mjs door <canvas origin>                 the canvas at http://localhost:47777, for Claude's browser
//   node canvas-helper.mjs watch <canvas origin> <key> [canvas] [s.<seat>]  waits for the next ask on your canvas (its chat's cards), prints it, and ends
//   node canvas-helper.mjs up <canvas origin> <key>             LOCAL-13: the door and every app's card, in one quiet process
//                                                               of its own that keeps going; says "canvas up" and returns
//   node canvas-helper.mjs up                                   LOCAL-14: the same, for the canvas and key it remembers
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DOOR = Number(process.env.CANVAS_DOOR_PORT) || 47777, door = 'http://localhost:' + DOOR;
// LOCAL-14: "up" with a canvas and key remembers them here (only this person can read it), so "up" alone, from
// Claude's start, brings the canvas back after a restart.
const HOME = process.env.CANVAS_HOME || path.join(os.homedir(), '.canvas'), CONFIG = path.join(HOME, 'config.json');
const remembered = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch (e) { return {}; } }, saved = remembered();
// This file's own fingerprint: an "up" from a newer helper replaces an older one still running.
const VERSION = (() => { try { return createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex').slice(0, 12); } catch (e) { return 'dev'; } })();
// With no canvas named, the one remembered, else canvas-v2's own address (an agent that started an older helper may still pass none).
const mode = process.argv[2], canvas = String(process.argv[3] || saved.canvas || 'https://canvas-v2.ac0.app');
// The key: the one remembered for this canvas, read afresh each time (a later "up" leaves a newer one), else the one given.
const keyOf = () => { const r = remembered(); return String((r.canvas === canvas && r.key) || process.argv[4] || ''); };
const usage = () => { console.error('usage: node canvas-helper.mjs up|watch|door|<port of your app> <canvas origin, like https://canvas-v2.ac0.app> [key]'); process.exit(2); };
if (!/^https:\/\/[a-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(canvas)) usage();
// A request this machine's browser makes from one of these pages, or from the page itself, or typed in the address bar;
// anything another website starts is refused.
// A frame's page load passes too: an https canvas sends no Referer to an http page, and only the canvas may show the
// answer in a frame (frame-ancestors, below), so another site's frame stays empty.
const fromAny = (req, origins, framed) => { const site = req.headers['sec-fetch-site'], from = String(req.headers.origin || req.headers.referer || '');
  return !site || site === 'same-origin' || site === 'none' || origins.some((o) => from === o || from.startsWith(o + '/'))
    || (framed && req.method === 'GET' && req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-mode'] === 'navigate'); };

// ASK-4: what the helper adds to the app's pages, and only inside the canvas's frame: point at something (the canvas
// says when), and it tells the canvas what you pointed at; it draws the asks' pins on their elements.
function point() {
  if (window.top === window || window.__canvasPoint) return;
  window.__canvasPoint = 1;
  var picking = false, box = null, pins = [], pinEls = [];
  function post(m) { parent.postMessage(Object.assign({ canvas: 1 }, m), '*'); }
  function esc(v) { return window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  function selOf(el) {
    var parts = [];
    for (var e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 6; e = e.parentElement) {
      if (e.id && document.querySelectorAll('#' + esc(e.id)).length === 1) { parts.unshift('#' + esc(e.id)); break; }
      var tag = e.tagName.toLowerCase(), p = e.parentElement;
      if (p) { var same = [].filter.call(p.children, function (c) { return c.tagName === e.tagName; }); if (same.length > 1) tag += ':nth-of-type(' + (same.indexOf(e) + 1) + ')'; }
      parts.unshift(tag);
    }
    return parts.join(' > ');
  }
  function labelOf(el) {
    var t = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    return (t || el.tagName.toLowerCase()).slice(0, 80);
  }
  function outline(el) {
    if (!box) { box = document.createElement('div'); box.setAttribute('data-canvas-ui', ''); box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #3B82F6;border-radius:4px;background:rgba(59,130,246,.08)'; document.documentElement.appendChild(box); }
    var r = el.getBoundingClientRect();
    box.style.display = 'block'; box.style.left = (r.left - 2) + 'px'; box.style.top = (r.top - 2) + 'px'; box.style.width = (r.width + 4) + 'px'; box.style.height = (r.height + 4) + 'px';
  }
  function stop() { picking = false; if (box) box.style.display = 'none'; document.documentElement.style.cursor = ''; }
  addEventListener('mousemove', function (e) { if (picking && e.target && e.target !== box) outline(e.target); }, true);
  addEventListener('click', function (e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, r = el.getBoundingClientRect();
    stop();
    post({ type: 'picked', selector: selOf(el), label: labelOf(el), path: location.pathname + location.hash, rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }, true);
  addEventListener('keydown', function (e) { if (picking && e.key === 'Escape') { stop(); post({ type: 'pick-cancel' }); } }, true);
  function drawPins() {
    pinEls.forEach(function (d) { d.remove(); }); pinEls = [];
    pins.forEach(function (p) {
      var el = null; try { el = p.selector ? document.querySelector(p.selector) : null; } catch (x) {}
      if (!el) return;
      var r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
      var d = document.createElement('button');
      d.setAttribute('data-canvas-ui', '');
      d.textContent = p.n; d.title = p.text;
      d.style.cssText = 'position:fixed;z-index:2147483646;left:' + Math.max(2, r.right - 12) + 'px;top:' + Math.max(2, r.top - 12) + 'px;width:22px;height:22px;border-radius:11px 11px 11px 3px;border:2px solid #fff;background:' + (p.done ? '#16A34A' : '#3B82F6') + ';color:#fff;font:600 11px/18px system-ui,sans-serif;padding:0;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25)';
      d.onclick = function (e) { e.preventDefault(); e.stopPropagation(); post({ type: 'pin', id: p.id }); };
      document.documentElement.appendChild(d); pinEls.push(d);
    });
  }
  // LIVE-1 (docs/live.md): while the canvas asks for it, a copy of the page as it looks now, whenever it changes, for
  // the people on the canvas whose machines can't reach this app: its styles, pictures and fonts inside it, no scripts.
  var live = false, liveT = null, lastSnap = 0, lastHtml = '';
  function same(u) { try { var x = new URL(u, location.href); return x.origin === location.origin ? x.href : null; } catch (e) { return null; } }
  function dataOf(url, budget) {
    return fetch(url).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
      if (!b || b.size > 400000 || b.size > budget.left) return null;
      budget.left -= b.size;
      return new Promise(function (ok) { var f = new FileReader(); f.onload = function () { ok(f.result); }; f.onerror = function () { ok(null); }; f.readAsDataURL(b); });
    }).catch(function () { return null; });
  }
  function cssOf(text, base, budget) {
    var urls = [], re = /url\(\s*(['"]?)([^'")]+)\s*\)/g, m;
    while ((m = re.exec(text))) { var abs = /^data:/.test(m[2]) ? null : same(new URL(m[2], base).href); if (abs && urls.indexOf(abs) < 0) urls.push(abs); }
    return Promise.all(urls.map(function (u) { return dataOf(u, budget); })).then(function (datas) {
      return text.replace(re, function (all, q, u) {
        if (/^data:/.test(u)) return all;
        var abs = new URL(u, base).href, i = urls.indexOf(same(abs));
        return i >= 0 && datas[i] ? 'url("' + datas[i] + '")' : same(abs) ? 'url("")' : 'url("' + abs + '")';
      });
    });
  }
  function snapshot() {
    var budget = { left: 2400000 } /* raw bytes: as base64 they grow by a third, and a copy must stay under 4 MB */, outside = [], sheets = [].slice.call(document.styleSheets).concat([].slice.call(document.adoptedStyleSheets || []));
    var css = Promise.all(sheets.map(function (sh) {
      try { return cssOf([].map.call(sh.cssRules, function (r) { return r.cssText; }).join('\n'), sh.href || location.href, budget); }
      catch (e) { if (sh.href && !same(sh.href)) outside.push(sh.href); return ''; }
    }));
    var doc = document.documentElement.cloneNode(true), q = function (root, sel) { return [].slice.call(root.querySelectorAll(sel)); };
    // What the person typed and drew, which a copy of the markup leaves out.
    var a = q(document, 'input, textarea, select'), b = q(doc, 'input, textarea, select');
    a.forEach(function (el, i) { var c = b[i]; if (!c) return;
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else if (el.tagName === 'TEXTAREA') c.textContent = el.value;
      else if (el.tagName === 'SELECT') [].forEach.call(c.options, function (o, j) { if (el.options[j] && el.options[j].selected) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
      else if (el.type !== 'password' && el.type !== 'file') c.setAttribute('value', el.value); });
    var ca = q(document, 'canvas'), cb = q(doc, 'canvas');
    // A drawing stays a <canvas>, its picture painted as its background: every rule that sized it (by id, class or tag)
    // still applies, so it keeps the app's size and shape. An <img> in its place lost its id and drew at the canvas's
    // pixel size, twice the app's on a retina screen.
    ca.forEach(function (el, i) { var c = cb[i]; if (!c) return; try { c.style.setProperty('background', 'url("' + el.toDataURL() + '") center / 100% 100% no-repeat', 'important'); } catch (e) {} });
    q(doc, 'script, noscript, style, link, iframe, object, embed, base, meta[http-equiv], [data-canvas-ui]').forEach(function (el) { el.remove(); });
    q(doc, '*').forEach(function (el) { [].slice.call(el.attributes).forEach(function (at) { if (/^on/i.test(at.name) || /^\s*javascript:/i.test(at.value)) el.removeAttribute(at.name); }); });
    var imgs = q(doc, 'img');
    var pics = Promise.all(imgs.map(function (img) {
      img.removeAttribute('srcset'); img.removeAttribute('loading');
      var src = img.getAttribute('src'); if (!src || /^data:/.test(src)) return null;
      var abs = new URL(src, location.href).href;
      if (!same(abs)) { img.setAttribute('src', abs); return null; }
      return dataOf(abs, budget).then(function (d) { if (d) img.setAttribute('src', d); else img.removeAttribute('src'); });
    }));
    return Promise.all([css, pics]).then(function (r) {
      var head = doc.querySelector('head') || doc.insertBefore(document.createElement('head'), doc.firstChild);
      outside.forEach(function (h) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = h; head.appendChild(l); });
      var st = document.createElement('style'); st.textContent = r[0].join('\n'); head.appendChild(st);
      return '<!doctype html>\n' + doc.outerHTML;
    });
  }
  function snap() {
    liveT = null; lastSnap = Date.now();
    snapshot().then(function (html) { if (html !== lastHtml && html.length < 4000000) { lastHtml = html; post({ type: 'snapshot', html: html, path: location.pathname }); } }).catch(function () {});
  }
  function soon() { if (!live || liveT) return; liveT = setTimeout(snap, Math.max(1200, lastSnap + 4000 - Date.now())); }
  // What the canvas draws in the app (cursors, pins, the pointer's outline), anywhere inside it: never a change to copy.
  var ui = function (n) { var e = n && (n.nodeType === 1 ? n : n.parentNode); return !!(e && e.closest && e.closest('[data-canvas-ui]')); };
  new MutationObserver(function (rs) {
    if (rs.some(function (r) { return !ui(r.target) && !([].every.call(r.addedNodes, ui) && [].every.call(r.removedNodes, ui) && r.type === 'childList'); })) soon();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener('load', soon); addEventListener('input', soon, true); addEventListener('scroll', function () {}, true);
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data || {}; if (d.canvas !== 1) return;
    if (d.type === 'live') { var was = live; live = !!d.on; if (live && !was) soon(); }
    if (d.type === 'pick') { picking = !!d.on; document.documentElement.style.cursor = picking ? 'crosshair' : ''; if (!picking) stop(); }
    if (d.type === 'pins') { pins = d.pins || []; drawPins(); }
  });
  addEventListener('scroll', function () { if (pins.length) drawPins(); }, true);
  addEventListener('resize', function () { if (pins.length) drawPins(); });
  setInterval(function () { if (pins.length) drawPins(); }, 1500);
  // CURSOR-1 (docs/cursors.md): where this person's pointer is in the app, for the others' cursors; and theirs, drawn
  // where they point, gliding between the canvas's polls. Neither is ever part of a copy (data-canvas-ui).
  var pt = 0, others = {};
  addEventListener('pointermove', function (e) {
    var t = Date.now(); if (t - pt < 80) return; pt = t;
    var w = Math.max(1, document.documentElement.clientWidth), h = Math.max(1, innerHeight);
    post({ type: 'pointer', x: Math.min(1, Math.max(0, e.clientX / w)), y: Math.round(e.clientY + scrollY), v: Math.min(1, Math.max(0, e.clientY / h)) });
  }, true);
  function cursors(list) {
    var seen = {}, w = document.documentElement.clientWidth;
    (list || []).forEach(function (c) {
      if (!c || typeof c.id !== 'string') return;
      seen[c.id] = 1;
      var el = others[c.id], name = String(c.name || 'Someone') + (c.doing === 'point' ? ' · pointing' : c.doing === 'ask' ? ' · asking' : '');
      var at = 'translate(' + Math.round(Number(c.x) * w) + 'px,' + Math.round(Number(c.y)) + 'px)';
      if (!el) {
        el = document.createElement('div'); el.setAttribute('data-canvas-ui', '');
        el.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483645;pointer-events:none';
        el.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))"><path d="M2 1.5 L2 15 L5.8 11.4 L8.4 17 L10.9 15.9 L8.4 10.4 L13.6 10.4 Z" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg><div style="position:absolute;left:14px;top:16px;padding:2px 8px;border-radius:999px;color:#fff;font:500 12px/16px Inter,system-ui,sans-serif;white-space:nowrap"></div>';
        el.style.transform = at;
        document.documentElement.appendChild(el); others[c.id] = el;
        el.getBoundingClientRect();
        el.style.transition = 'transform .9s linear';
      }
      var color = /^#[0-9A-Fa-f]{3,8}$/.test(c.color) ? c.color : '#3B82F6';
      el.querySelector('path').setAttribute('fill', color);
      var tag = el.lastChild; tag.style.background = color; if (tag.textContent !== name) tag.textContent = name;
      el.style.transform = at;
    });
    for (var id in others) if (!seen[id]) { others[id].remove(); delete others[id]; }
  }
  addEventListener('message', function (e) { if (e.source === parent && e.data && e.data.canvas === 1 && e.data.type === 'cursors') cursors(e.data.list); });
  post({ type: 'ready', path: location.pathname });
}

const POINT = '(' + point.toString() + ')();';
const listen = (server, port, soft) => {
  server.on('error', (e) => { if (soft) return; console.error(e.code === 'EADDRINUSE' ? 'canvas-helper: port ' + port + ' is taken (one may already be running: that is fine)' : String(e)); process.exit(1); });
  server.listen(port, '127.0.0.1', () => { if (!soft) console.log('canvas-helper ready http://localhost:' + port + '/'); });
};

if (mode === 'watch') {
  // ASK-5: wait for the next ask on the person's canvas, print what to do, and end, which wakes their agent. The canvas
  // answers at once, and says when to ask again (Retry-After, 1 to 60 s); without it, 2 s after a 204, and after a
  // failure 5 s, doubling each failure in a row up to a minute.
  // ASK-12: its project's canvas, when named, so it takes only that project's asks.
  const key = keyOf(), only = /^[a-z0-9-]{1,120}$/.test(process.argv[5] || '') ? '&canvas=' + process.argv[5] : '', C = new URL(canvas), lib = C.protocol === 'https:' ? https : http;
  // ASK-13: the seat show_local gave its chat's cards, so this watcher takes those cards' asks and no other chat's.
  const seat = (process.argv.slice(5).find((x) => /^s\.[0-9a-f]{12}$/.test(x)) || '').slice(2);
  // LOCAL-23: this project's name, as its folder is named (the git repository's main folder, as for the fingerprint), for its tile.
  const project = (() => { let d; try { d = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { stdio: 'pipe' }).toString().trim(), '..'); } catch (e) { d = process.cwd(); } return path.basename(d).slice(0, 80); })();
  const once = () => new Promise((done) => {
    const r = lib.get(canvas + '/api/asks/watch?poll=1' + only + (seat ? '&seat=' + seat : '') + (project ? '&project=' + encodeURIComponent(project) : '') + '&k='+ encodeURIComponent(key), (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => done({ status: res.statusCode, body: b, after: Number(res.headers['retry-after']) })); });
    r.setTimeout(45000, () => r.destroy()); r.on('error', () => done({ status: 0, body: '' }));
  });
  (async () => {
    for (let failed = 0; ;) {
      const r = await once();
      if (r.status === 200) { console.log(JSON.parse(r.body).text); process.exit(0); }
      if (r.status === 401) { console.error(JSON.parse(r.body).error.message); process.exit(1); }
      failed = r.status === 204 || r.status === 429 ? 0 : failed + 1;
      const s = r.after > 0 ? Math.min(60, Math.max(1, r.after)) : failed ? Math.min(60, 5 * 2 ** (failed - 1)) : 2;
      await new Promise((f) => setTimeout(f, s * 1000));
    }
  })();
}
function startDoor(soft) {
  // The canvas, passed through: the browser sees http://localhost:47777, the canvas sees its own address.
  const C = new URL(canvas), lib = C.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    if (req.url === '/__canvas/up') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('canvas-helper ' + VERSION + ' ' + canvas); return; }
    // Only an "up" holding the same key may stop it, to start a newer one.
    if (keyOf() && req.url === '/__canvas/quit?k=' + encodeURIComponent(keyOf())) { res.writeHead(200); res.end('bye'); setTimeout(() => process.exit(0), 50); return; }
    door$(req, res);
  });
  const door$ = ((req, res) => {
    // LOCAL-10: a page load in the browser's own window passes too (Keep it comes back here from signing in on the canvas's
    // address, with no Referer): another site can send someone here, but never read what comes back.
    const opened = req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document' && req.headers['sec-fetch-mode'] === 'navigate';
    if (!opened && !fromAny(req, [door])) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Only the canvas can open this.'); return; }
    // LOCAL-19: the door opened bare in a browser that has no canvas session (another browser than the agent's) goes to
    // the person's newest canvas, never to the start page for someone new.
    // A session counts only if the canvas knows it as someone with an account: an old cookie or a guest's goes too.
    if (opened && /^\/(start)?(\?.*)?$/.test(req.url) && keyOf()) {
      const json = (url, headers, done) => {
        const q = lib.get(url, { headers }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (d) => { b += d; }); r.on('end', () => { let v = null; try { v = JSON.parse(b); } catch (e) {} done(r.statusCode, v); }); });
        q.on('error', () => done(0, null)); q.setTimeout(5000, () => q.destroy());
      };
      json(canvas + '/api/me', { cookie: String(req.headers.cookie || '') }, (st, me) => {
        if (st === 200 && me && me.user && !me.user.anonymous) return pass(req, res);
        json(canvas + '/api/helper/home?k=' + encodeURIComponent(keyOf()), {}, (st2, d) => {
          const to = st2 === 200 && d && typeof d.path === 'string' && /^\/c\/[a-z0-9-]+\?k=[A-Za-z0-9._-]+$/.test(d.path) ? d.path : null;
          if (to) { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); res.end(); } else pass(req, res);
        });
      });
      return;
    }
    pass(req, res);
  });
  const pass = (req, res) => {
    const headers = { ...req.headers, host: C.host };
    for (const k of ['origin', 'referer']) if (headers[k]) headers[k] = String(headers[k]).replace(door, canvas);
    delete headers['accept-encoding']; // plain bodies, passed through untouched
    const up = lib.request({ host: C.hostname, port: C.port || (C.protocol === 'https:' ? 443 : 80), method: req.method, path: req.url, headers, servername: C.hostname }, (r) => {
      const h = { ...r.headers };
      if (h.location) h.location = String(h.location).split(canvas).join(door);
      // Its sign-in cookie, kept for this address: the same name and lifetime, without a Domain (none is set today).
      if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map((c) => c.replace(/;\s*domain=[^;]*/gi, ''));
      delete h['strict-transport-security'];
      res.writeHead(r.statusCode || 502, h);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The canvas is not answering. Check your connection, then reload.'); });
    req.pipe(up);
  };
  listen(server, DOOR, soft);
}
function startApp(target, own, soft) {

  let me = 'http://localhost:' + own;
  const frameFree = (csp) => csp.split(';').map((d) => d.trim()).filter((d) => d && !/^frame-ancestors\b/i.test(d)).join('; ');
  const cookie = (c) => c.replace(/;\s*samesite=(lax|strict|none)/gi, '').replace(/;\s*secure\b/gi, '') + '; SameSite=None; Secure';
  const server = http.createServer((req, res) => {
    if (!fromAny(req, [canvas, door], true)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Only the canvas can open this.'); return; }
    if (req.url === '/__canvas/point.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); res.end(POINT); return; }
    const headers = { ...req.headers, host: 'localhost:' + target };
    delete headers.origin; delete headers.referer; delete headers['accept-encoding']; // plain pages, so the pointer can go in
    const up = http.request({ host: 'localhost', port: target, method: req.method, path: req.url, headers }, (r) => {
      const h = { ...r.headers };
      delete h['x-frame-options'];
      for (const k of ['content-security-policy', 'content-security-policy-report-only']) if (h[k]) { const v = frameFree(String(h[k])); if (v) h[k] = v; else delete h[k]; }
      h['content-security-policy'] = (h['content-security-policy'] ? h['content-security-policy'] + '; ' : '') + 'frame-ancestors ' + canvas + ' ' + door; // only the canvas frames it
      if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map(cookie);
      if (h.location) h.location = String(h.location).replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/i, me);
      if (!/text\/html/i.test(String(h['content-type'] || ''))) { res.writeHead(r.statusCode || 502, h); r.pipe(res); return; }
      // ASK-4: a page gets the pointer, first thing in its head.
      delete h['content-length']; delete h['etag']; delete h['last-modified'];
      h['cache-control'] = 'no-cache'; // a change Claude makes shows on the next load, never a cached page
      let page = ''; r.setEncoding('utf8'); r.on('data', (d) => { page += d; });
      r.on('end', () => {
        const tag = '<script src="/__canvas/point.js"></script>', i = page.search(/<head[^>]*>/i);
        res.writeHead(r.statusCode || 502, h);
        res.end(i >= 0 ? page.slice(0, page.indexOf('>', i) + 1) + tag + page.slice(page.indexOf('>', i) + 1) : tag + page);
      });
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Your app at http://localhost:' + target + ' is not answering. Start it, then reload.'); });
    req.pipe(up);
  });
  // Live reload (Vite, Next and the like) talks over a WebSocket: pass it straight through.
  server.on('upgrade', (req, socket, head) => {
    if (!fromAny(req, [canvas, door])) { socket.destroy(); return; }
    const up = net.connect(target, 'localhost', () => {
      up.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + Object.entries({ ...req.headers, host: 'localhost:' + target }).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n');
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
  });
  listen(server, own, soft);
}
const ownOf = (p) => (p < 25000 ? p + 40000 : p - 20000);
if (mode === 'door') startDoor(false);
else if (mode === 'up' || mode === 'daemon') {
  // LOCAL-13: one process, kept going by itself. "up" starts it unless one answers already, and returns at once.
  // A key given to "up" is remembered first; the one running reads it next time it looks, so a fresh key needs no restart.
  if (mode === 'up' && process.argv[4]) { try { fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); fs.writeFileSync(CONFIG, JSON.stringify({ canvas, key: process.argv[4] }), { mode: 0o600 }); } catch (e) {} }
  const key = keyOf();
  if (!key) { console.error('canvas: nothing to bring up yet (run /canvas once in Claude)'); process.exit(0); }
  const get = (url) => new Promise((done) => { const r = http.get(url, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => done(res.statusCode === 200 ? b : null)); }); r.on('error', () => done(null)); r.setTimeout(1500, () => { r.destroy(); done(null); }); });
  if (mode === 'up') {
    (async () => {
      const running = await get(door + '/__canvas/up');
      if (running === 'canvas-helper ' + VERSION + ' ' + canvas) { console.log('canvas already up'); return; }
      if (running) { // an older helper, or another canvas: replace it
        for (const k of new Set([key, saved.key].filter(Boolean))) await get(door + '/__canvas/quit?k=' + encodeURIComponent(k));
        for (let i = 0; i < 20 && await get(door + '/__canvas/up'); i++) await new Promise((f) => setTimeout(f, 100));
      }
      spawn(process.execPath, [process.argv[1], 'daemon', canvas, key], { detached: true, stdio: 'ignore' }).unref();
      console.log('canvas up');
    })();
  } else {
    startDoor(true);
    // Every app on this person's canvases gets its card's helper, as it appears.
    const C = new URL(canvas), lib = C.protocol === 'https:' ? https : http, started = new Set();
    const look = () => {
      const r = lib.get(canvas + '/api/helper/apps?k=' + encodeURIComponent(keyOf()), (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => {
        try { for (const port of JSON.parse(b).ports || []) if (!started.has(port)) { started.add(port); startApp(port, ownOf(port), true); } } catch (e) {}
      }); });
      r.on('error', () => {}); r.setTimeout(10000, () => r.destroy());
    };
    look(); setInterval(look, Number(process.env.CANVAS_LOOK_MS) || 3000);
  }
} else if (mode !== 'watch') { // the watcher, above, is a mode of its own
  const target = Number(mode);
  if (!Number.isInteger(target) || target < 1 || target > 65535) usage();
  startApp(target, Number(process.argv[4]) || ownOf(target), false);
}
