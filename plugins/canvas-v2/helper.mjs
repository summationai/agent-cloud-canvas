// canvas helper: runs on this machine, listens on 127.0.0.1 only. Stop it with Ctrl-C.
//   node canvas-helper.mjs <port of your app> <canvas origin>   your app again, so the canvas can show it in a card
//   node canvas-helper.mjs door <canvas origin>                 the canvas at http://localhost:47777, for Claude's browser
//   node canvas-helper.mjs watch <canvas origin> <key> [canvas] [s.<seat>]  waits for the next ask on your canvas (its chat's cards), prints it, and ends
//   node canvas-helper.mjs up <canvas origin> <key>             LOCAL-13: the door and every app's card, in one quiet process
//                                                               of its own that keeps going; says "canvas up" and returns
//   node canvas-helper.mjs up                                   LOCAL-14: the same, for the canvas and key it remembers
//   node canvas-helper.mjs show <canvas origin> <app address> [name] [agent]   SAME-1: this folder's app on the canvas, from
//                                                               the chat that installed the plugin; prints the canvas's address
//   node canvas-helper.mjs connect <canvas origin> <Connect link> [agent]      SAME-2: opens Connect in this browser, as the
//                                                               same person, so the agent's next chats find the same canvas
//   node canvas-helper.mjs connect <canvas origin> codex [codex]               SAME-4: the same, starting Codex's sign-in
//                                                               itself and keeping it waiting for Connect, up to 10 minutes
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const DOOR = Number(process.env.CANVAS_DOOR_PORT) || 47777, door = 'http://localhost:' + DOOR;
// LOCAL-14: "up" with a canvas and key remembers them here (only this person can read it), so "up" alone, from
// Claude's start, brings the canvas back after a restart.
const HOME = process.env.CANVAS_HOME || path.join(os.homedir(), '.canvas'), CONFIG = path.join(HOME, 'config.json');
// The plugin this helper comes in (LOCAL-24), where a newer copy of it arrives (LOCAL-33).
const PLUGIN = 'canvas-v2';
const remembered = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch (e) { return {}; } }, saved = remembered();
// This file's own fingerprint: an "up" from a newer helper replaces an older one still running.
const VERSION = (() => { try { return createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex').slice(0, 12); } catch (e) { return 'dev'; } })();
// With no canvas named, the one remembered, else canvas-v2's own address (an agent that started an older helper may still pass none).
const mode = process.argv[2], canvas = String(process.argv[3] || saved.canvas || 'https://canvas-v2.ac0.app');
// The key: the one remembered for this canvas, read afresh each time (a later "up" leaves a newer one), else the one given.
const keyOf = () => { const r = remembered(); return String((r.canvas === canvas && r.key) || process.argv[4] || ''); };
// LOCAL-32: every other process running this helper as a daemon (ps, so not on Windows, where the door's quit is all).
const stopOthers = () => {
  if (process.platform === 'win32') return 0;
  const me = new Set([process.argv[1], path.resolve(process.argv[1])]); try { me.add(fs.realpathSync(process.argv[1])); } catch (e) {}
  let list = ''; try { list = execSync('ps -eo pid=,args=', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return 0; }
  let n = 0;
  for (const line of list.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line); if (!m || Number(m[1]) === process.pid) continue;
    if (![...me].some((f) => m[2].includes(' ' + f + ' daemon '))) continue;
    try { process.kill(Number(m[1])); n++; } catch (e) {}
  }
  return n;
};
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
  addEventListener('mousemove', function (e) { if (picking && e.target && e.target !== box && !ui(e.target)) outline(e.target); }, true);
  addEventListener('click', function (e) {
    if (!picking || ui(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, r = el.getBoundingClientRect();
    stop();
    var shot = 'p' + Date.now().toString(36);
    post({ type: 'picked', selector: selOf(el), label: labelOf(el), path: location.pathname + location.hash, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, shot: shot });
    capture(r).then(function (url) { post({ type: 'shot', id: shot, url: url }); }, function () { post({ type: 'shot', id: shot, url: null }); });
  }, true);
  // ASK-18: a screenshot of what the person sees, what they pointed at outlined, for the ask. Drawn from the page itself
  // (html-to-image, loaded only now); a page that won't let it load or draw gets an ask with no picture.
  var lib = null;
  function htmlLib() {
    if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
    if (!lib) lib = new Promise(function (ok, no) {
      var urls = ['https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js', 'https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js'];
      (function next(i) {
        if (i >= urls.length) { lib = null; no(new Error('no screenshot library')); return; }
        var sc = document.createElement('script'); sc.src = urls[i]; sc.setAttribute('data-canvas-ui', '');
        sc.onload = function () { if (window.htmlToImage) ok(window.htmlToImage); else next(i + 1); };
        sc.onerror = function () { next(i + 1); };
        document.head.appendChild(sc);
      })(0);
    });
    return lib;
  }
  function capture(r) {
    var W = innerWidth, H = innerHeight, sx = scrollX, sy = scrollY, de = document.documentElement;
    var bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = getComputedStyle(de).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = '#ffffff';
    return htmlLib().then(function (h) {
      return h.toCanvas(de, { pixelRatio: 1, backgroundColor: bg, width: Math.max(de.scrollWidth, W), height: Math.min(Math.max(de.scrollHeight, H), 16000),
        filter: function (n) { return !(n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-canvas-ui')); } });
    }).then(function (full) {
      var k = Math.min(1, 1400 / Math.max(W, H)), o = document.createElement('canvas'), g;
      o.width = Math.round(W * k); o.height = Math.round(H * k); g = o.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, o.width, o.height);
      g.drawImage(full, sx, sy, W, H, 0, 0, o.width, o.height);
      g.strokeStyle = '#3B82F6'; g.lineWidth = 3; g.strokeRect((r.left - 2) * k, (r.top - 2) * k, (r.width + 4) * k, (r.height + 4) * k);
      return o.toDataURL('image/jpeg', 0.82);
    });
  }
  addEventListener('keydown', function (e) { if (picking && e.key === 'Escape') { stop(); post({ type: 'pick-cancel' }); } }, true);
  var pinsSaid = '';
  function drawPins() {
    pinEls.forEach(function (d) { d.remove(); }); pinEls = [];
    var spots = {};
    pins.forEach(function (p) {
      var el = null; try { el = p.selector ? document.querySelector(p.selector) : null; } catch (x) {}
      if (!el) return;
      var r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
      var d = document.createElement('button');
      d.setAttribute('data-canvas-ui', '');
      d.textContent = p.n; d.title = p.text;
      d.style.cssText = 'position:fixed;z-index:2147483646;left:' + Math.max(2, r.right - 12) + 'px;top:' + Math.max(2, r.top - 12) + 'px;width:22px;height:22px;border-radius:11px 11px 11px 3px;border:2px solid #fff;background:' + (p.done ? '#16A34A' : '#3B82F6') + ';color:#fff;font:600 11px/18px system-ui,sans-serif;padding:0;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25)';
      var at = { x: Math.max(2, r.right - 12), y: Math.max(2, r.top - 12) }; // ASK-23: its thread opens beside it
      spots[p.id] = at;
      d.onclick = function (e) { e.preventDefault(); e.stopPropagation(); post({ type: 'pin', id: p.id, at: at }); };
      document.documentElement.appendChild(d); pinEls.push(d);
    });
    // ASK-23: where the pins are, whenever that changes, so a thread opened from the canvas (not its pin) sits beside it.
    var said = JSON.stringify(spots); if (said !== pinsSaid) { pinsSaid = said; post({ type: 'pinsAt', at: spots }); }
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
    // The canvas's own styles (which version of a part shows, ASK-20) are never part of a copy: its page script draws them.
    var budget = { left: 2400000 } /* raw bytes: as base64 they grow by a third, and a copy must stay under 4 MB */, outside = [], sheets = [].filter.call(document.styleSheets, function (sh) { var o = sh.ownerNode; return !(o && o.hasAttribute && o.hasAttribute('data-canvas-ui')); }).concat([].slice.call(document.adoptedStyleSheets || []));
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
  // DESIGN-2: while Design is on, the page shows this viewer's preview, which is never part of a copy.
  function soon() { if (!live || liveT || dz.on || dz.n) return; liveT = setTimeout(snap, Math.max(1200, lastSnap + 4000 - Date.now())); }
  // What the canvas draws in the app (cursors, pins, the pointer's outline), anywhere inside it: never a change to copy.
  var ui = function (n) { var e = n && (n.nodeType === 1 ? n : n.parentNode); return !!(e && e.closest && e.closest('[data-canvas-ui]')); };
  new MutationObserver(function (rs) {
    if (rs.some(function (r) { return !ui(r.target) && !([].every.call(r.addedNodes, ui) && [].every.call(r.removedNodes, ui) && r.type === 'childList'); })) { soon(); vsoon(); }
    if (dz.on && rs.some(function (r) { return r.type !== 'attributes' && !ui(r.target); })) dzTreeSoon();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  // ASK-20 (docs/asks.md): versions of one part, side by side in the app's own markup: a [data-canvas-part] holding one
  // [data-canvas-v] per version, every one rendered. One shows at a time, and a switch drawn on the part flips them, for
  // this viewer only; its Keep asks the app's maker's agent to keep that one (ASK-21). None of it is part of a copy.
  // Keep is instant here (Emin, 21 Nov: "when say keep as it's don't start streaming and making changes"): the kept
  // version shows and the switch goes at once, for this tab even across reloads, while the agent tidies the code.
  var chosen = {}, bars = {}, kept = {}, vst = null, vT = null, PARTNAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, VNAME = /^[a-z0-9]{1,12}$/;
  var FONT = 'all:initial;box-sizing:border-box;font:500 12px/16px Inter,system-ui,-apple-system,sans-serif;letter-spacing:-.01em;';
  try { kept = JSON.parse(sessionStorage.getItem('canvas-kept') || '{}') || {}; } catch (e) {}
  function sig(p) { return p.name + '|' + p.vs.map(function (c) { return vname(c) + ':' + (c.getAttribute('data-canvas-title') || ''); }).join(','); }
  function vsoon() { if (!vT) vT = setTimeout(function () { vT = null; drawVersions(); }, 120); }
  function vname(c) { return c.getAttribute('data-canvas-v') || ''; }
  function vparts() {
    var out = [];
    [].forEach.call(document.querySelectorAll('[data-canvas-part]'), function (el) {
      var name = el.getAttribute('data-canvas-part') || '';
      if (!PARTNAME.test(name) || ui(el)) return;
      var vs = [].filter.call(el.children, function (c) { return VNAME.test(vname(c)); });
      if (vs.length > 1) out.push({ name: name, el: el, vs: vs });
    });
    return out;
  }
  // A version is a wrapper with display: contents, so it has no box of its own: what it holds has.
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    if (r.width || r.height) return r;
    var l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
    [].forEach.call(el.children, function (c) { var x = rectOf(c); if (!x.width && !x.height) return; l = Math.min(l, x.left); t = Math.min(t, x.top); rt = Math.max(rt, x.right); b = Math.max(b, x.bottom); });
    return l === Infinity ? r : { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t };
  }
  function shownOf(p) {
    var v = kept[sig(p)] || chosen[p.name];
    if (v && p.vs.some(function (c) { return vname(c) === v; })) return v;
    return vname(p.vs.filter(function (c) { return !c.hasAttribute('hidden'); })[0] || p.vs[0]);
  }
  function short(v) { return v === 'now' ? 'Now' : v.toUpperCase(); }
  function keepIt(p, v) {
    var cur = p.vs.filter(function (c) { return vname(c) === v; })[0];
    kept[sig(p)] = v; chosen[p.name] = v; if (armed === p.name) armed = null;
    try { sessionStorage.setItem('canvas-kept', JSON.stringify(kept)); } catch (err) {}
    post({ type: 'keep', part: p.name, v: v, title: (cur && cur.getAttribute('data-canvas-title')) || '', selector: '[data-canvas-part="' + p.name + '"] > [data-canvas-v="' + v + '"]', path: location.pathname + location.hash });
    drawVersions();
  }
  // Esc right after flipping a part's switch discards its takes: the part stays as it was, as Keep as is does (Emin,
  // 21 Nov: "when click esc..just discard it"). Only then, so the app's own Esc (a dialog, a menu) never throws them away.
  var armed = null;
  addEventListener('pointerdown', function (e) { if (armed && !(bars[armed] && bars[armed].contains(e.target))) armed = null; }, true);
  addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !armed) return;
    var p = vparts().filter(function (x) { return x.name === armed; })[0];
    if (!p || !p.vs.some(function (c) { return vname(c) === 'now'; })) { armed = null; return; }
    e.preventDefault(); e.stopPropagation(); keepIt(p, 'now');
  }, true);
  function drawVersions() {
    var css = '', here = {}, placed = [];
    vparts().forEach(function (p) {
      var v = shownOf(p), sel = '[data-canvas-part="' + p.name + '"] > [data-canvas-v';
      css += sel + ']{display:none!important}' + sel + '="' + v + '"]{display:contents!important}\n';
      if (kept[sig(p)] === v) return;
      here[p.name] = 1;
      versionBar(p, v, placed);
    });
    for (var n in bars) if (!here[n]) { bars[n].remove(); delete bars[n]; }
    if (!vst && css) { vst = document.createElement('style'); vst.setAttribute('data-canvas-ui', ''); document.documentElement.appendChild(vst); }
    if (vst && vst.textContent !== css) vst.textContent = css;
  }
  function versionBar(p, v, placed) {
    var el = bars[p.name];
    var key = sig(p) + '#' + v;
    if (!el || el.__key !== key) {
      if (!el) { el = document.createElement('div'); el.setAttribute('data-canvas-ui', ''); el.setAttribute('role', 'toolbar'); document.documentElement.appendChild(el); bars[p.name] = el; }
      el.__key = key; el.innerHTML = '';
      el.setAttribute('aria-label', 'Versions of ' + p.name);
      el.style.cssText = FONT + 'position:fixed;z-index:2147483646;display:flex;align-items:center;gap:6px;padding:4px;border-radius:12px;background:#fff;color:#111;box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 6px 18px rgba(0,0,0,.12);max-width:calc(100vw - 8px)';
      var track = document.createElement('div');
      track.style.cssText = FONT + 'display:flex;flex:none;padding:2px;border-radius:8px;background:rgba(0,0,0,.06)';
      p.vs.forEach(function (c) {
        var id = vname(c), on = id === v, b = document.createElement('button');
        b.type = 'button'; b.textContent = short(id); b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.title = (c.getAttribute('data-canvas-title') || short(id)) + (c.getAttribute('data-canvas-why') ? ' · ' + c.getAttribute('data-canvas-why') : '');
        b.style.cssText = FONT + 'min-width:30px;height:24px;padding:0 8px;border-radius:6px;text-align:center;cursor:pointer;color:' + (on ? '#111' : '#6D6D6D') + ';background:' + (on ? '#fff' : 'transparent') + ';box-shadow:' + (on ? '0 1px 2px rgba(0,0,0,.1),0 0 0 .5px rgba(0,0,0,.06)' : 'none');
        b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); armed = p.name; chosen[p.name] = id; drawVersions(); post({ type: 'version', part: p.name, v: id }); };
        track.appendChild(b);
      });
      el.appendChild(track);
      // Only the letters: a version's name is its button's tooltip, never words on the switch.
      var k = document.createElement('button');
      k.type = 'button';
      k.textContent = v === 'now' ? 'Keep as is' : 'Keep ' + short(v);
      k.style.cssText = FONT + 'flex:none;height:28px;padding:0 12px;border-radius:8px;white-space:nowrap;color:#fff;cursor:pointer;background:#111';
      k.onclick = function (e) { e.preventDefault(); e.stopPropagation(); keepIt(p, v); };
      el.appendChild(k);
    }
    // Above the part's left end, else under it: the versions differ in width, so a switch hung off the right end jumped
    // with every flip (Emin, 21 Nov: "panel position weirdly change"); the left end stays put. Never on top of another
    // part's switch: then the other side of the part, else to the right of the one in the way.
    var r = rectOf(p.el), h = el.offsetHeight || 36, w = el.offsetWidth || 220;
    var above = r.top - h - 8, below = r.bottom + 8, x = Math.max(4, Math.min(innerWidth - w - 4, r.left));
    var y = Math.max(4, above >= 4 ? above : below);
    var hits = function (x, y) { for (var i = 0; i < placed.length; i++) { var o = placed[i]; if (x < o.x + o.w + 6 && x + w + 6 > o.x && y < o.y + o.h + 6 && y + h + 6 > o.y) return o; } return null; };
    var hit = hits(x, y);
    if (hit) { var y2 = y === below ? Math.max(4, above) : below; if (!hits(x, y2)) y = y2; else x = Math.max(4, Math.min(innerWidth - w - 4, hit.x + hit.w + 8)); }
    el.style.display = r.bottom < 0 || r.top > innerHeight ? 'none' : 'flex';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    placed.push({ x: x, y: y, w: w, h: h });
  }
  addEventListener('load', drawVersions);
  addEventListener('scroll', function () { for (var n in bars) { drawVersions(); return; } }, true);
  addEventListener('resize', drawVersions);
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
  setInterval(function () { if (pins.length) drawPins(); drawVersions(); }, 1500);
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
  // FRAME-15 (Emin, 21 Nov): the page this frame is on, its title and its links, for the canvas's page switcher and for the
  // frame to open where it was left; and going to a page the canvas names (a path on this app, never another site).
  var lastPage = '';
  function pageInfo() {
    var seen = {}, links = [];
    [].forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
      var path = u.pathname + u.search, words = (a.getAttribute('aria-label') || a.getAttribute('title') || (a.textContent || '').trim().split('\n')[0] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (u.origin !== location.origin) return;
      if (seen[path]) { if (words && (!seen[path].title || words.length < seen[path].title.length)) seen[path].title = words; return; } // its shortest words
      if (links.length >= 200) return;
      seen[path] = { path: path, title: words };
      links.push(seen[path]);
    });
    lastPage = location.pathname + location.search + location.hash;
    post({ type: 'page', path: lastPage, title: (document.title || '').slice(0, 120), links: links });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', pageInfo); else pageInfo();
  addEventListener('load', pageInfo);
  setInterval(function () { if (location.pathname + location.search + location.hash !== lastPage) pageInfo(); }, 800); // client-side routes
  addEventListener('message', function (e) {
    var d = e.data;
    if (e.source === parent && d && d.canvas === 1 && d.type === 'go' && typeof d.path === 'string' && d.path.charAt(0) === '/' && d.path.charAt(1) !== '/') location.assign(d.path);
  });
  // LOCAL-28 (docs/local.md): a change the agent makes shows on the card, small or open full size, with nobody reloading,
  // in an app that has no live reload of its own (a plain page, a server that serves its files as they are). While the
  // page is open it reads its own page, scripts and styles every 1.5 s, and loads again once one changes. An app that
  // reloads itself (Vite, Next, webpack, livereload) is left to it; a file that differs on every read (a page with the
  // time in it) is left out. Only on the helper's pages: a live copy (live.ts) has the canvas reload it.
  var helped = document.currentScript && /\/__canvas\/point\.js(\?|$)/.test(document.currentScript.src || '');
  function reloads() {
    return [].some.call(document.querySelectorAll('script[src]'), function (s) { return /\/@vite\/client|\/_next\/|webpack|hot-update|livereload|browser-sync|\/@react-refresh/i.test(s.getAttribute('src') || ''); })
      || !!(window.__vite_plugin_react_preamble_installed__ || window.__NEXT_DATA__ || window.webpackHotUpdate || window.LiveReload);
  }
  function hsig(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return t.length + ':' + h; }
  var seen = {}, dropped = {}, looking = false;
  function watched() {
    var urls = [location.href.split('#')[0]];
    [].forEach.call(document.querySelectorAll('script[src], link[rel~="stylesheet"][href]'), function (el) {
      var u = same(el.getAttribute('src') || el.getAttribute('href')); if (u && !/\/__canvas\//.test(u) && urls.indexOf(u) < 0) urls.push(u);
    });
    return urls.slice(0, 24).filter(function (u) { return !dropped[u]; });
  }
  function look() {
    // DESIGN-2: a change the agent makes shows at once, unsaved Design changes or not (the canvas sends the preview back
    // when the page is ready again); it waits only while words are being typed or a handle is being dragged.
    if (looking || document.hidden || dz.editing || dz.rs) return;
    looking = true;
    var urls = watched();
    Promise.all(urls.map(function (u) {
      return fetch(u, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    })).then(function (texts) {
      looking = false;
      var changed = false;
      urls.forEach(function (u, i) {
        if (texts[i] === null) return; // not answering (the app restarting): judged on the next read
        var s = hsig(texts[i]), was = seen[u];
        if (!was) { seen[u] = { s: s, sure: false, moved: false }; return; }
        if (was.s === s) { if (was.moved) changed = true; was.sure = true; was.moved = false; return; }
        if (was.sure) { changed = true; return; }
        // Not yet read the same twice: a change if the next read agrees, and a file that changes by itself if not.
        if (was.moved) { dropped[u] = 1; return; }
        was.s = s; was.moved = true;
      });
      if (changed) location.reload();
    });
  }
  if (helped) addEventListener('load', function () { if (!reloads()) setInterval(look, 1500); });
  // DESIGN-1 to DESIGN-6 (docs/design.md): Design, in a local card's full view. The app holds still: a click selects
  // instead of using it, and every change is a preview on this page only (inline styles and text), drawn from the list
  // the canvas keeps and sends whole (design-apply). Nothing reaches the app's code until the person presses Save there.
  var dz = { on: false, sel: null, selPath: '', multi: [], rs: null, resized: 0, hov: null, els: [], orig: [], texts: new Map(), n: 0, editing: null, show: null, root: null, treeT: null, tick: null };
  var BLUE = '#0D99FF';
  function dzPath(el) {
    var parts = [];
    for (var e = el; e && e.nodeType === 1 && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id) && document.querySelectorAll('#' + e.id).length === 1) { parts.unshift('#' + e.id); return parts.join(' > '); }
      var p = e.parentElement, tag = e.tagName.toLowerCase();
      if (p) tag += ':nth-child(' + ([].indexOf.call(p.children, e) + 1) + ')';
      parts.unshift(tag);
    }
    return parts.length ? 'body > ' + parts.join(' > ') : 'body';
  }
  function dzSkip(el) { return ui(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|HEAD|TITLE|BR)$/.test(el.tagName); }
  function dzPlain(el) { if (!el.childNodes.length) return false; for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType !== 3) return false; return /\S/.test(el.textContent || ''); }
  function dzOwnText(el) { for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3 && /\S/.test(n.data)) return true; } return false; }
  function dzKind(el) {
    var tag = el.tagName.toLowerCase(), cs = getComputedStyle(el);
    if (/^(img|picture|video|canvas|iframe)$/.test(tag)) return 'image';
    if (tag === 'svg') return 'vector';
    if (/flex/.test(cs.display)) return /column/.test(cs.flexDirection) ? 'col' : 'row';
    if (/grid/.test(cs.display)) return 'grid';
    if (dzPlain(el)) return 'text';
    return 'frame';
  }
  var NICE = { main: 'Main', header: 'Header', nav: 'Nav', footer: 'Footer', section: 'Section', aside: 'Aside', form: 'Form', ul: 'List', ol: 'List', li: 'Item', img: 'Image', svg: 'Icon', table: 'Table', textarea: 'Text area', select: 'Select', input: 'Input', article: 'Article', button: 'Button', a: 'Link', label: 'Label', body: 'Page' };
  function dzName(el) {
    var tag = el.tagName.toLowerCase(), k = dzKind(el);
    if (k === 'text') return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    var a = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.getAttribute('title');
    if (a) return a.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (NICE[tag]) return NICE[tag];
    var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0] || '';
    if (cls && cls.length > 2 && !/[:\[\]\/]|^-?(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|flex|grid|gap|w|h|min|max|text|bg|border|rounded|items|justify|space|font|leading|tracking|shadow|relative|absolute|block|inline|hidden|overflow|col|row)(-|$)/.test(cls)) return cls.slice(0, 40);
    return k === 'grid' ? 'Grid' : /^h[1-6]$/.test(tag) ? 'Heading' : k === 'row' || k === 'col' || tag === 'div' ? 'Frame' : tag;
  }
  // What a change says it's about, for the agent and the list: a generic name gets the words inside it.
  function dzDesc(el) {
    var n = dzName(el);
    if (dzKind(el) === 'text' || !/^(Frame|Article|Section|Item|Button|Link|Label|List|Grid|Heading|Main|Header|Footer|Nav|Aside|Form|Page|div|span)$/.test(n)) return n;
    var t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return t ? n + ': ' + t : n;
  }
  function dzTree() {
    dz.els = [];
    // The colours the page already uses, most used first, for the colour picker's swatches.
    var pal = {};
    function col(c) { if (c && c !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(c)) pal[c] = (pal[c] || 0) + 1; }
    function walk(el, depth) {
      if (dz.els.length > 2500) return null;
      var i = dz.els.push(el) - 1, kids = [], k = dzKind(el), cs = getComputedStyle(el);
      col(cs.backgroundColor); if (dzOwnText(el)) col(cs.color); if (num(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') col(cs.borderTopColor);
      if (k !== 'text' && k !== 'vector' && depth < 60) [].forEach.call(el.children, function (c) { if (!dzSkip(c)) { var n = walk(c, depth + 1); if (n) kids.push(n); } });
      var r = el.getBoundingClientRect();
      return { i: i, n: dzName(el), k: k, s: dzPath(el), h: !r.width && !r.height ? 1 : 0, c: kids };
    }
    var tree = walk(document.body, 0);
    post({ type: 'design-tree', tree: tree, palette: Object.keys(pal).sort(function (x, y) { return pal[y] - pal[x]; }).slice(0, 24) });
  }
  function dzTreeSoon() { if (dz.on && !dz.treeT) dz.treeT = setTimeout(function () { dz.treeT = null; if (dz.on) dzTree(); }, 400); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }
  function dzProbe(el, prop, val) { var was = el.getAttribute('style'); el.style.setProperty(prop, val, 'important'); var r = el.getBoundingClientRect(); if (was === null) el.removeAttribute('style'); else el.setAttribute('style', was); return r; }
  function dzInfo(el) {
    var cs = getComputedStyle(el), r = el.getBoundingClientRect(), p = el.parentElement, pcs = p && p !== document.documentElement ? getComputedStyle(p) : null;
    var pflex = !!(pcs && /flex/.test(pcs.display)), prow = pflex && !/column/.test(pcs.flexDirection);
    var abs = cs.position === 'absolute' || cs.position === 'fixed';
    function mode(horiz) {
      if (el === document.body || el.style.getPropertyValue(horiz ? 'width' : 'height') === '100%') return 'fill';
      var inl = el.style.getPropertyValue(horiz ? 'width' : 'height'), auto = inl === '' || inl === 'auto';
      var size = horiz ? r.width : r.height, main = pflex && horiz === prow;
      if (!abs && main && num(cs.flexGrow) > 0) return 'fill';
      if (!abs && pflex && !main && (cs.alignSelf === 'stretch' || (cs.alignSelf === 'auto' || cs.alignSelf === 'normal') && /stretch|normal/.test(pcs.alignItems)) && auto) {
        var fit = dzProbe(el, horiz ? 'width' : 'height', 'fit-content'); if (Math.abs((horiz ? fit.width : fit.height) - size) > 0.5) return 'fill';
      }
      if (!abs && !pflex && horiz && /^(block|flex|grid|table|list-item)$/.test(cs.display) && pcs && !/grid/.test(pcs.display)) {
        var pr = p.getBoundingClientRect(), inner = pr.width - num(pcs.paddingLeft) - num(pcs.paddingRight) - num(pcs.borderLeftWidth) - num(pcs.borderRightWidth);
        if (Math.abs(size + num(cs.marginLeft) + num(cs.marginRight) - inner) < 1 && auto) { var f2 = dzProbe(el, 'width', 'fit-content'); if (Math.abs(f2.width - size) > 0.5) return 'fill'; }
      }
      var hug = dzProbe(el, horiz ? 'width' : 'height', 'fit-content');
      return Math.abs((horiz ? hug.width : hug.height) - size) <= 0.5 ? 'hug' : 'fixed';
    }
    var flex = /flex/.test(cs.display), row = flex && !/column/.test(cs.flexDirection);
    var gap = flex ? num(row ? cs.columnGap : cs.rowGap) : 0;
    var text = dzOwnText(el) || dzKind(el) === 'text';
    var cls = (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join('.');
    return {
      sel: dzPath(el), name: dzName(el), desc: dzDesc(el), kind: dzKind(el), tag: el.tagName.toLowerCase(), cls: cls, body: el === document.body,
      text: dzPlain(el) ? (el.textContent || '').slice(0, 300) : null,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, wMode: mode(true), hMode: mode(false),
      parent: pflex ? (prow ? 'row' : 'col') : pcs && /grid/.test(pcs.display) ? 'grid' : 'block', abs: abs,
      display: cs.display, flex: flex ? { dir: row ? 'row' : 'col', wrap: cs.flexWrap === 'wrap', gap: gap, jc: cs.justifyContent, ai: cs.alignItems } : null,
      pad: [num(cs.paddingTop), num(cs.paddingRight), num(cs.paddingBottom), num(cs.paddingLeft)],
      radius: num(cs.borderTopLeftRadius), opacity: num(cs.opacity), bg: cs.backgroundColor, shadow: cs.boxShadow,
      stroke: { w: num(cs.borderTopWidth), c: cs.borderTopColor, s: cs.borderTopStyle },
      font: text ? { size: num(cs.fontSize), weight: cs.fontWeight, lh: cs.lineHeight === 'normal' ? 'Auto' : num(cs.lineHeight), ls: num(cs.letterSpacing), color: cs.color, align: cs.textAlign, family: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() } : null,
      kids: [].filter.call(el.children, function (c) { return !dzSkip(c); }).length
    };
  }
  function dzSend() {
    if (!dz.on) return;
    dz.multi = dz.multi.filter(function (m) { return m && m.isConnected; });
    if (dz.sel && dz.multi.indexOf(dz.sel) < 0) dz.multi = [dz.sel];
    dz.lastInfo = dz.sel && dz.sel.isConnected ? dzInfo(dz.sel) : null;
    post({ type: 'design-sel', info: dz.lastInfo, infos: dz.multi.length > 1 ? dz.multi.map(dzInfo) : null });
    dzDraw();
  }
  // DESIGN-7: Shift+click adds to the selection or takes away from it; a plain click selects one thing.
  function dzSelect(el, scroll, add) {
    if (dz.editing) dzEndEdit(false);
    if (add && el) {
      if (!dz.multi.length && dz.sel) dz.multi = [dz.sel];
      var at = dz.multi.indexOf(el);
      if (at >= 0) { dz.multi.splice(at, 1); el = dz.multi[dz.multi.length - 1] || null; } else dz.multi.push(el);
    } else dz.multi = el ? [el] : [];
    dz.sel = el; dz.selPath = el ? dzPath(el) : '';
    if (el && scroll) { var r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center' }); }
    dzDraw(); dzSend();
  }
  function dzTarget(t) {
    if (!t || t.nodeType !== 1) t = t && t.parentElement;
    var s = t && t.closest && t.closest('svg'); while (s && s.parentElement && s.parentElement.closest('svg')) s = s.parentElement.closest('svg');
    if (s) t = s;
    if (t === document.documentElement) t = document.body;
    return t;
  }
  function dzRect(r, css) { return '<div style="position:fixed;box-sizing:border-box;left:' + r.left + 'px;top:' + r.top + 'px;width:' + Math.max(0, r.width) + 'px;height:' + Math.max(0, r.height) + 'px;' + css + '"></div>'; }
  var HATCH = 'background:repeating-linear-gradient(-45deg,rgba(242,78,154,.38) 0 1px,rgba(242,78,154,.12) 1px 5px)';
  function dzDraw() {
    if (!dz.root) { dz.root = document.createElement('div'); dz.root.setAttribute('data-canvas-ui', ''); dz.root.style.cssText = 'position:fixed;inset:0;z-index:2147483640;pointer-events:none'; document.documentElement.appendChild(dz.root); }
    if (!dz.on) { dz.root.innerHTML = ''; return; }
    if (dz.sel && !dz.sel.isConnected) { var again = null; try { again = dz.selPath ? document.querySelector(dz.selPath) : null; } catch (e) {} dz.sel = again; }
    var html = '';
    if (dz.hov && dz.hov !== dz.sel && dz.hov.isConnected && !dz.editing) html += dzRect(dz.hov.getBoundingClientRect(), 'outline:1px solid ' + BLUE);
    var el = dz.sel;
    if (el) {
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      var bt = num(cs.borderTopWidth), br = num(cs.borderRightWidth), bb = num(cs.borderBottomWidth), bl = num(cs.borderLeftWidth);
      var pt = num(cs.paddingTop), pr = num(cs.paddingRight), pb = num(cs.paddingBottom), pl = num(cs.paddingLeft);
      if (dz.show === 'pad') {
        html += dzRect({ left: r.left + bl, top: r.top + bt, width: r.width - bl - br, height: pt }, HATCH) + dzRect({ left: r.left + bl, top: r.bottom - bb - pb, width: r.width - bl - br, height: pb }, HATCH)
          + dzRect({ left: r.left + bl, top: r.top + bt + pt, width: pl, height: r.height - bt - bb - pt - pb }, HATCH) + dzRect({ left: r.right - br - pr, top: r.top + bt + pt, width: pr, height: r.height - bt - bb - pt - pb }, HATCH);
      }
      if (dz.show === 'gap' && /flex/.test(cs.display)) {
        var row = !/column/.test(cs.flexDirection), top = r.top + bt + pt, left = r.left + bl + pl, bottom = r.bottom - bb - pb, right = r.right - br - pr;
        var ks = [].filter.call(el.children, function (c) { var s = getComputedStyle(c); return !dzSkip(c) && s.position !== 'absolute' && s.position !== 'fixed' && s.display !== 'none'; })
          .map(function (c) { return c.getBoundingClientRect(); }).sort(function (a, b) { return row ? a.left - b.left : a.top - b.top; });
        for (var i = 1; i < ks.length; i++) {
          var a = ks[i - 1], b = ks[i];
          if (row && b.left > a.right && Math.abs(b.top - a.top) < a.height) html += dzRect({ left: a.right, top: top, width: b.left - a.right, height: bottom - top }, HATCH);
          if (!row && b.top > a.bottom && Math.abs(b.left - a.left) < a.width) html += dzRect({ left: left, top: a.bottom, width: right - left, height: b.top - a.bottom }, HATCH);
        }
      }
      var many = dz.multi.length > 1, u = r;
      if (many) {
        var ul = Infinity, ut = Infinity, ur = -Infinity, ub = -Infinity;
        dz.multi.forEach(function (m) { if (!m.isConnected) return; var q = m.getBoundingClientRect(); html += dzRect(q, 'outline:1px solid ' + BLUE); ul = Math.min(ul, q.left); ut = Math.min(ut, q.top); ur = Math.max(ur, q.right); ub = Math.max(ub, q.bottom); });
        if (ul !== Infinity) u = { left: ul, top: ut, right: ur, bottom: ub, width: ur - ul, height: ub - ut };
      }
      html += dzRect(u, 'outline:' + (many ? '1px' : '1.5px') + ' solid ' + BLUE);
      // DESIGN-8: one thing selected, its edges and corners resize it, as in Figma.
      if (!dz.editing && !many) [['n', r.left + 6, r.top - 4, r.width - 12, 8, 'ns'], ['s', r.left + 6, r.bottom - 4, r.width - 12, 8, 'ns'], ['w', r.left - 4, r.top + 6, 8, r.height - 12, 'ew'], ['e', r.right - 4, r.top + 6, 8, r.height - 12, 'ew']].forEach(function (h) {
        html += '<div data-dz-h="' + h[0] + '" style="position:fixed;left:' + h[1] + 'px;top:' + h[2] + 'px;width:' + Math.max(0, h[3]) + 'px;height:' + Math.max(0, h[4]) + 'px;pointer-events:auto;cursor:' + h[5] + '-resize"></div>';
      });
      if (!dz.editing) [['nw', u.left, u.top], ['ne', u.right, u.top], ['sw', u.left, u.bottom], ['se', u.right, u.bottom]].forEach(function (c) {
        html += '<div ' + (many ? '' : 'data-dz-h="' + c[0] + '" ') + 'style="position:fixed;left:' + (c[1] - 7) + 'px;top:' + (c[2] - 7) + 'px;width:14px;height:14px;' + (many ? '' : 'pointer-events:auto;cursor:' + (c[0] === 'nw' || c[0] === 'se' ? 'nwse' : 'nesw') + '-resize') + '"><i style="position:absolute;left:3px;top:3px;width:8px;height:8px;box-sizing:border-box;background:#fff;border:1px solid ' + BLUE + '"></i></div>';
      });
      var info = !dz.rs && !many && dz.lastInfo && dz.lastInfo.sel === dz.selPath ? dz.lastInfo : null;
      var W = info && info.wMode !== 'fixed' ? info.wMode.charAt(0).toUpperCase() + info.wMode.slice(1) : String(Math.round(u.width * 10) / 10);
      var H = info && info.hMode !== 'fixed' ? info.hMode.charAt(0).toUpperCase() + info.hMode.slice(1) : String(Math.round(u.height * 10) / 10);
      var ly = u.bottom + 6 > innerHeight - 20 ? Math.max(2, u.top - 22) : u.bottom + 8;
      html += '<div style="position:fixed;left:' + (u.left + u.width / 2) + 'px;top:' + ly + 'px;transform:translateX(-50%);padding:0 5px;border-radius:3px;background:' + BLUE + ';color:#fff;font:500 11px/16px Inter,system-ui,sans-serif;white-space:nowrap">' + W + ' × ' + H + '</div>';
    }
    dz.root.innerHTML = html;
  }
  function dzSetText(el, t) {
    var ns = [].filter.call(el.childNodes, function (n) { return n.nodeType === 3; });
    if (!ns.length) { el.appendChild(document.createTextNode(t)); return; }
    ns.forEach(function (n, i) { n.data = i === 0 ? t : ''; });
  }
  function dzApply(list) {
    dz.orig.forEach(function (o) { if (o.style === null) o.el.removeAttribute('style'); else o.el.setAttribute('style', o.style); });
    dz.orig = [];
    dz.texts.forEach(function (t, el) { dzSetText(el, t); });
    dz.texts = new Map();
    (list || []).forEach(function (c) {
      var el = null; try { el = document.querySelector(c.sel); } catch (e) {}
      if (!el || ui(el)) return;
      if (!dz.orig.some(function (o) { return o.el === el; })) dz.orig.push({ el: el, style: el.getAttribute('style') });
      for (var p in c.props || {}) if (typeof c.props[p] === 'string') el.style.setProperty(p, c.props[p], 'important');
      if (typeof c.text === 'string' && dzPlain(el)) { if (!dz.texts.has(el)) dz.texts.set(el, el.textContent); dzSetText(el, c.text); }
    });
    dz.n = (list || []).length;
    dzSend(); dzTreeSoon();
  }
  function dzEdit(el) {
    if (!el || !dzPlain(el)) return;
    if (!dz.texts.has(el)) dz.texts.set(el, el.textContent);
    dz.editing = el; dz.editFrom = el.textContent; dz.editNodes = [].slice.call(el.childNodes);
    el.setAttribute('contenteditable', 'plaintext-only'); if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
    try { var rg = document.createRange(); rg.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(rg); } catch (e) {}
    dzDraw();
  }
  function dzEndEdit(cancel) {
    var el = dz.editing; if (!el) return;
    dz.editing = null;
    var to = el.textContent;
    el.removeAttribute('contenteditable');
    // The app's own text nodes go back in place (a framework keeps them), holding the new words.
    while (el.firstChild) el.removeChild(el.firstChild);
    dz.editNodes.forEach(function (n) { el.appendChild(n); });
    dzSetText(el, cancel ? dz.editFrom : to);
    try { getSelection().removeAllRanges(); } catch (e) {}
    if (!cancel && to !== dz.editFrom) post({ type: 'design-change', sel: dzPath(el), label: dzDesc(el), field: 'text', from: dz.editFrom, to: to, text: to });
    dzDraw();
  }
  function dzKids(p) {
    return [].filter.call(p.children, function (c) { var s = getComputedStyle(c); return !dzSkip(c) && s.position !== 'absolute' && s.position !== 'fixed'; })
      .map(function (c, i) { return { c: c, o: num(getComputedStyle(c).order), i: i }; }).sort(function (a, b) { return a.o - b.o || a.i - b.i; }).map(function (x) { return x.c; });
  }
  function dzMove(dir) {
    var el = dz.sel, p = el && el.parentElement; if (!p || el === document.body) return;
    if (!/flex|grid/.test(getComputedStyle(p).display)) return;
    var ks = dzKids(p), i = ks.indexOf(el), j = i + dir;
    if (i < 0 || j < 0 || j >= ks.length) return;
    ks[i] = ks[j]; ks[j] = el;
    post({ type: 'design-change', sel: dzPath(p), label: dzDesc(p), field: 'order', from: '', to: ks.map(function (c) { return '"' + dzDesc(c) + '"'; }).join(', '),
      batch: ks.map(function (c, n) { return { sel: dzPath(c), props: { order: String(n) } }; }) });
  }
  // Shift+A, as in Figma: auto layout on the selection, its direction and gap read from where its children sit now.
  function dzAuto(el) {
    if (!el) return;
    var ks = dzKids(el).map(function (c) { return c.getBoundingClientRect(); }).filter(function (r) { return r.width || r.height; });
    var row = ks.length > 1 && ks[1].left >= ks[0].right - 1 && Math.abs(ks[1].top - ks[0].top) < ks[0].height, gap = 0;
    for (var i = 1; i < ks.length; i++) { var g = row ? ks[i].left - ks[i - 1].right : ks[i].top - ks[i - 1].bottom; if (g > 0) gap = gap ? Math.min(gap, g) : g; }
    post({ type: 'design-change', sel: dzPath(el), label: dzDesc(el), field: 'auto layout', from: 'none', to: (row ? 'horizontal' : 'vertical') + ', gap ' + Math.round(gap) + 'px',
      set: { display: 'flex', 'flex-direction': row ? 'row' : 'column', gap: Math.round(gap) + 'px' } });
  }
  function dzOn(on) {
    if (on === dz.on) return;
    dz.on = on;
    if (!on) { if (dz.editing) dzEndEdit(true); dzApply([]); dz.sel = dz.hov = null; dz.show = null; clearInterval(dz.tick); dz.tick = null; dzDraw(); return; }
    dz.tick = setInterval(function () { if (dz.on) dzDraw(); }, 400);
    dzTree(); dzDraw();
  }
  // DESIGN-8: dragging a handle sets the size it's dragged to (Fixed, as Figma does), previewed as it moves.
  function dzSizeWord(i, W) { var m = i ? i[W ? 'wMode' : 'hMode'] : 'fixed'; return m === 'fixed' ? Math.round(i ? i[W ? 'w' : 'h'] : 0) + 'px' : m === 'hug' ? 'hug contents (fit-content)' : 'fill the container'; }
  function dzResized(s) {
    var both = s.set.width && s.set.height;
    post({ type: 'design-change', sel: dzPath(s.el), label: dzDesc(s.el), field: both ? 'size' : s.set.width ? 'width' : 'height',
      from: both ? s.fw + ' × ' + s.fh : s.set.width ? s.fw : s.fh, to: both ? s.set.width + ' × ' + s.set.height : s.set.width || s.set.height, set: s.set });
  }
  addEventListener('pointerdown', function (e) {
    var h = dz.on && e.target && e.target.closest ? e.target.closest('[data-dz-h]') : null;
    if (!h || !dz.sel) return;
    e.preventDefault(); e.stopPropagation();
    var el = dz.sel, r = el.getBoundingClientRect(), cs = getComputedStyle(el), p = el.parentElement, pcs = p && p !== document.documentElement ? getComputedStyle(p) : null;
    var pflex = !!(pcs && /flex/.test(pcs.display)), cb = cs.boxSizing !== 'border-box';
    dz.rs = { el: el, dir: h.getAttribute('data-dz-h'), x0: e.clientX, y0: e.clientY, w0: r.width, h0: r.height, set: null, t: 0,
      dw: cb ? num(cs.paddingLeft) + num(cs.paddingRight) + num(cs.borderLeftWidth) + num(cs.borderRightWidth) : 0,
      dh: cb ? num(cs.paddingTop) + num(cs.paddingBottom) + num(cs.borderTopWidth) + num(cs.borderBottomWidth) : 0,
      row: pflex && !/column/.test(pcs.flexDirection), col: pflex && /column/.test(pcs.flexDirection), fw: dzSizeWord(dz.lastInfo, true), fh: dzSizeWord(dz.lastInfo, false) };
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (x) {}
  }, true);
  addEventListener('pointermove', function (e) {
    var s = dz.rs; if (!s) return;
    e.preventDefault(); e.stopPropagation();
    var dx = e.clientX - s.x0, dy = e.clientY - s.y0, set = {}, W = null, H = null;
    if (/e/.test(s.dir)) W = s.w0 + dx; else if (/w/.test(s.dir)) W = s.w0 - dx;
    if (/s/.test(s.dir)) H = s.h0 + dy; else if (/n/.test(s.dir)) H = s.h0 - dy;
    if (e.shiftKey && W !== null && H !== null && s.h0) { var k = Math.max(W / s.w0, H / s.h0); W = s.w0 * k; H = s.h0 * k; }
    if (W !== null) { set.width = Math.max(0, Math.round(W) - s.dw) + 'px'; if (s.row) { set['flex-grow'] = '0'; set['flex-basis'] = 'auto'; } if (s.col) set['align-self'] = 'auto'; }
    if (H !== null) { set.height = Math.max(0, Math.round(H) - s.dh) + 'px'; if (s.col) { set['flex-grow'] = '0'; set['flex-basis'] = 'auto'; } if (s.row) set['align-self'] = 'auto'; }
    for (var p in set) s.el.style.setProperty(p, set[p], 'important');
    s.set = set; dzDraw();
    if (!s.t) s.t = requestAnimationFrame(function () { s.t = 0; if (dz.rs === s && s.set) dzResized(s); });
  }, true);
  function dzResizeEnd(e) {
    var s = dz.rs; if (!s) return;
    dz.rs = null; dz.resized = Date.now();
    if (s.t) cancelAnimationFrame(s.t);
    if (s.set) dzResized(s);
    try { document.documentElement.releasePointerCapture(e.pointerId); } catch (x) {}
    dzDraw();
  }
  addEventListener('pointerup', dzResizeEnd, true); addEventListener('pointercancel', dzResizeEnd, true);
  function dzMine(e) { return !dz.on || picking || ui(e.target) || (dz.editing && dz.editing.contains(e.target)); }
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend', 'mouseover', 'mouseout', 'dragstart'].forEach(function (t) {
    addEventListener(t, function (e) {
      if (dzMine(e)) return;
      e.preventDefault(); e.stopPropagation();
      // Held back, the press would leave the keyboard on the canvas: the app takes it, so Delete, the arrows and Esc reach it.
      if (t === 'pointerdown') try { window.focus(); } catch (x) {}
    }, true);
  });
  addEventListener('mousemove', function (e) {
    if (dzMine(e) || dz.editing || dz.rs) return;
    e.stopPropagation();
    var t = dzTarget(e.target); if (t !== dz.hov) { dz.hov = t; dzDraw(); post({ type: 'design-hover', sel: t ? dzPath(t) : '' }); }
  }, true);
  addEventListener('mouseout', function (e) { if (dz.on && !e.relatedTarget && dz.hov) { dz.hov = null; dzDraw(); } }, true);
  addEventListener('click', function (e) {
    if (dzMine(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - dz.resized < 400) return; // the click that ends a resize selects nothing
    if (dz.editing) dzEndEdit(false);
    dzSelect(dzTarget(e.target), false, e.shiftKey);
  }, true);
  addEventListener('dblclick', function (e) {
    if (dzMine(e)) return;
    e.preventDefault(); e.stopPropagation();
    var t = dzTarget(e.target); if (t && dzPlain(t)) { dzSelect(t); dzEdit(t); }
  }, true);
  addEventListener('keydown', dzKeys, true);
  function dzKeys(e) {
    if (!dz.on || picking) return;
    if (dz.editing) { if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); dzEndEdit(e.key === 'Escape'); } return; }
    var k = e.key, mod = e.metaKey || e.ctrlKey, el = dz.sel;
    e.stopPropagation();
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); post({ type: 'design-key', key: e.shiftKey ? 'redo' : 'undo' }); return; }
    if (mod && (k === 's' || k === 'S')) { e.preventDefault(); post({ type: 'design-key', key: 'save' }); return; }
    if (mod) return;
    if (k === 'Escape') { e.preventDefault(); if (el && el !== document.body && el.parentElement) dzSelect(el.parentElement, true); else dzSelect(null); return; }
    if (!el) return;
    if (k === 'Enter') { e.preventDefault(); if (dzPlain(el)) dzEdit(el); else { var first = dzKids(el)[0]; if (first) dzSelect(first, true); } return; }
    if (k === 'Tab') { e.preventDefault(); var p = el.parentElement; if (!p) return; var ks = dzKids(p), i = ks.indexOf(el), nx = ks[(i + (e.shiftKey ? -1 : 1) + ks.length) % ks.length]; if (nx) dzSelect(nx, true); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); (dz.multi.length > 1 ? dz.multi : [el]).forEach(function (m) { if (m !== document.body) post({ type: 'design-change', sel: dzPath(m), label: dzDesc(m), field: 'remove', from: 'shown', to: 'removed', set: { display: 'none' } }); }); return; }
    if (/^Arrow(Up|Left)$/.test(k)) { e.preventDefault(); if (dz.multi.length < 2) dzMove(-1); return; }
    if (/^Arrow(Down|Right)$/.test(k)) { e.preventDefault(); if (dz.multi.length < 2) dzMove(1); return; }
    if ((k === 'A' || k === 'a') && e.shiftKey) { e.preventDefault(); dzAuto(el); return; }
  }
  addEventListener('scroll', function () { if (dz.on) dzDraw(); }, true);
  addEventListener('resize', function () { if (dz.on) dzDraw(); });
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var d = e.data || {}; if (d.canvas !== 1) return;
    // DESIGN-10: the card on the canvas shows its maker's unsaved changes too, without Design (nothing is selected or held).
    if (d.type === 'design-preview' && !dz.on) dzApply(d.changes || []);
    if (d.type === 'design') { dzOn(!!d.on); if (d.on) { dzApply(d.changes || []); if (d.sel && !dz.sel) { var s = null; try { s = document.querySelector(d.sel); } catch (x) {} if (s) dzSelect(s); } } }
    if (!dz.on) return;
    if (d.type === 'design-apply') dzApply(d.changes || []);
    function bySel(s) { try { return typeof s === 'string' && s ? document.querySelector(s) : null; } catch (x) { return null; } }
    if (d.type === 'design-pick') { var el = typeof d.sel === 'string' ? bySel(d.sel) : dz.els[d.i]; if (el && el.isConnected) dzSelect(el, true, !!d.add); else if (d.i === null) dzSelect(null); }
    if (d.type === 'design-hover') { var h = typeof d.sel === 'string' ? bySel(d.sel) : typeof d.i === 'number' ? dz.els[d.i] : null; dz.hov = h && h.isConnected ? h : null; if (dz.hov && typeof d.sel === 'string') { var hr = dz.hov.getBoundingClientRect(); if (hr.bottom < 0 || hr.top > innerHeight) dz.hov.scrollIntoView({ block: 'center' }); } dzDraw(); }
    if (d.type === 'design-show') { dz.show = d.what === 'pad' || d.what === 'gap' ? d.what : null; dzDraw(); }
    if (d.type === 'design-auto') dzAuto(dz.sel);
    // A key pressed while the keyboard is on the canvas, passed on (Delete, the arrows, Enter, Tab, Esc, Shift+A).
    if (d.type === 'design-keydown' && typeof d.key === 'string') dzKeys({ key: d.key, shiftKey: !!d.shift, metaKey: false, ctrlKey: false, preventDefault: function () {}, stopPropagation: function () {} });
    if (d.type === 'design-parent' && dz.sel && dz.sel !== document.body && dz.sel.parentElement) dzSelect(dz.sel.parentElement, true);
  });
  post({ type: 'ready', path: location.pathname, design: 1 }); // DESIGN-6: this page can do Design
}

const POINT = '(' + point.toString() + ')();';
const listen = (server, port, soft) => {
  server.on('error', (e) => { if (typeof soft === 'function') return soft(e, () => server.listen(port, '127.0.0.1')); if (soft) return; console.error(e.code === 'EADDRINUSE' ? 'canvas-helper: port ' + port + ' is taken (one may already be running: that is fine)' : String(e)); process.exit(1); });
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
    // HANDOFF-7: the sign-in page beside the chat opens its /auth/go/<code> link in the person's usual browser, so they
    // never copy it. Only the door's own page may ask, and only for that one kind of link.
    if (req.method === 'POST' && req.url === '/__canvas/open') {
      if (!fromAny(req, [door])) { res.writeHead(403); res.end(); return; }
      let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { if (b.length < 2000) b += d; });
      req.on('end', () => {
        let to = ''; try { to = String(JSON.parse(b).url || ''); } catch (e) {}
        if (!/^https:\/\/[a-z0-9.-]+\/auth\/go\/[A-Z0-9-]{4,12}$/.test(to)) { res.writeHead(400); res.end(); return; }
        const [cmd, args] = process.platform === 'darwin' ? ['open', [to]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', to]] : ['xdg-open', [to]];
        let sent = false; const done = (ok) => { if (sent) return; sent = true; res.writeHead(ok ? 200 : 502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ opened: ok })); };
        const o = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        const t = setTimeout(() => { o.unref(); done(true); }, 3000);
        o.on('error', () => { clearTimeout(t); done(false); });
        o.on('exit', (code) => { clearTimeout(t); done(code === 0); });
      });
      return;
    }
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
// LOCAL-25: what a card shows in place of a sign-in page that won't be framed. Sign in opens it in a window of its own;
// back from it, that window goes to /__canvas/promote, which hands the frame the app's cookies and closes it.
const SIGNIN = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title>'
  + '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,-apple-system,sans-serif;color:#111;background:#fff}'
  + 'main{max-width:340px;padding:24px;text-align:center}h1{font-size:18px;margin:0}p{color:#555;margin:8px 0 18px}'
  + 'button{font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}button:focus-visible{outline:2px solid #3B82F6;outline-offset:2px}</style>'
  + '<main><h1>Sign in to see this app</h1><p id="say" role="status">Sign-in opens in a window of its own.</p><button id="go" type="button">Sign in</button></main>'
  + '<script>(function () {'
  + 'var to = __TO__, back = __BACK__, w = null, step = 0, go = document.getElementById("go"), say = document.getElementById("say");'
  + 'function promote() { if (w && !w.closed) w.location.href = location.origin + "/__canvas/promote"; else w = window.open("/__canvas/promote", "canvas-signin", "popup,width=480,height=360"); }'
  + 'go.onclick = function () {'
  + '  if (step) return promote();'
  + '  w = window.open(to, "canvas-signin", "popup,width=480,height=720");'
  + '  if (!w) { say.textContent = "Your browser blocked the window. Allow pop-ups here, then try again."; return; }'
  + '  step = 1; go.textContent = "I’ve signed in"; say.textContent = "Finish signing in in the new window, then come back here.";'
  + '};'
  + 'addEventListener("message", function (e) { if (e.origin === location.origin && e.data && e.data.canvasSignedIn) location.replace(back); });'
  + '})();</script></html>';
function startApp(target, own, soft) {

  let me = 'http://localhost:' + own;
  const frameFree = (csp) => csp.split(';').map((d) => d.trim()).filter((d) => d && !/^frame-ancestors\b/i.test(d)).join('; ');
  const cookie = (c) => c.replace(/;\s*samesite=(lax|strict|none)/gi, '').replace(/;\s*secure\b/gi, '') + '; SameSite=None; Secure';
  const own$ = 'frame-ancestors ' + canvas + ' ' + door;
  const server = http.createServer((req, res) => {
    if (!fromAny(req, [canvas, door], true)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Only the canvas can open this.'); return; }
    if (req.url === '/__canvas/point.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); res.end(POINT); return; }
    // LOCAL-25: back from signing in, in the sign-in window (a page of its own, so its Lax cookies come with it): the
    // app's cookies again, now SameSite=None, so the card's frame gets them too; then the card reloads.
    if (req.url === '/__canvas/promote' && req.method === 'GET') {
      const jar = String(req.headers.cookie || '').split(';').map((c) => c.trim()).filter((c) => /^[^=\s;]+=/.test(c));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': own$,
        'set-cookie': jar.map((c) => c + '; Path=/; Max-Age=86400; SameSite=None; Secure') });
      res.end('<!doctype html><meta charset="utf-8"><title>Signed in</title><p style="font:15px system-ui,sans-serif;text-align:center;margin-top:40vh">Signed in. You can close this window.</p>'
        + '<script>try { opener && opener.postMessage({ canvasSignedIn: 1 }, location.origin); } catch (e) {} setTimeout(function () { window.close(); }, 300);</script>');
      return;
    }
    const headers = { ...req.headers, host: 'localhost:' + target };
    delete headers.origin; delete headers.referer; delete headers['accept-encoding']; // plain pages, so the pointer can go in
    const up = http.request({ host: 'localhost', port: target, method: req.method, path: req.url, headers }, (r) => {
      const h = { ...r.headers };
      delete h['x-frame-options'];
      for (const k of ['content-security-policy', 'content-security-policy-report-only']) if (h[k]) { const v = frameFree(String(h[k])); if (v) h[k] = v; else delete h[k]; }
      h['content-security-policy'] = (h['content-security-policy'] ? h['content-security-policy'] + '; ' : '') + 'frame-ancestors ' + canvas + ' ' + door; // only the canvas frames it
      if (h['set-cookie']) h['set-cookie'] = [].concat(h['set-cookie']).map(cookie);
      if (h.location) h.location = String(h.location).replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/i, me);
      // LOCAL-25: sign-in sends the frame off this machine (agent.cloud, Google), and those pages refuse to show in a
      // frame. The card says so instead and opens it in a window of its own; its cookies (the sign-in's state) still go.
      const st = r.statusCode || 0, to = String(h.location || '');
      if (st >= 300 && st < 400 && req.headers['sec-fetch-dest'] === 'iframe' && /^https?:\/\//i.test(to) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(to)) {
        r.resume();
        let back = '/'; try { const u = new URL(String(req.headers.referer || '')); if (u.port === String(own) && u.pathname !== req.url.split('?')[0]) back = u.pathname + u.search; } catch (e) {}
        const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
        const out = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': own$ };
        if (h['set-cookie']) out['set-cookie'] = h['set-cookie'];
        res.writeHead(200, out);
        res.end(SIGNIN.replace('__TO__', () => js(to)).replace('__BACK__', () => js(back)));
        return;
      }
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
      // LOCAL-32: and any other daemon of this helper still running: one that held another key (it wouldn't quit), and
      // those an older helper left behind, still holding apps' ports with older code. Emin, 21 Nov: 71 of them, since 18 Nov.
      if (stopOthers()) for (let i = 0; i < 30 && await get(door + '/__canvas/up'); i++) await new Promise((f) => setTimeout(f, 100));
      spawn(process.execPath, [process.argv[1], 'daemon', canvas, key], { detached: true, stdio: 'ignore' }).unref();
      console.log('canvas up');
    })();
  } else {
    // LOCAL-32: the door marks the one process. A daemon that can't take it (another holds it, and didn't give way in
    // 5 s) ends, instead of staying on to grab the apps' ports with what may be older code.
    let tries = 0;
    startDoor((e, again) => { if (e.code === 'EADDRINUSE' && ++tries < 25) setTimeout(again, 200); else process.exit(0); });
    // Every app on this person's canvases gets its card's helper, as it appears.
    const C = new URL(canvas), lib = C.protocol === 'https:' ? https : http, started = new Set();
    const look = () => {
      const r = lib.get(canvas + '/api/helper/apps?k=' + encodeURIComponent(keyOf()), (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => {
        try { for (const port of JSON.parse(b).ports || []) if (!started.has(port)) { started.add(port); startApp(port, ownOf(port), true); } } catch (e) {}
      }); });
      r.on('error', () => {}); r.setTimeout(10000, () => r.destroy());
    };
    look(); setInterval(look, Number(process.env.CANVAS_LOOK_MS) || 3000);
    // LOCAL-33 (Emin, 22 Nov: "we need some sort of maybe update or something when new update come"): when the person's
    // plugin brings a newer copy of this helper, the running one moves to it by itself, with nothing to click and nothing
    // downloaded: the newest copy the plugin installed (as LOCAL-24 picks it) replaces this file, and its own "up" takes
    // over (an older helper answering at the door gives way, LOCAL-13). Never onto an older copy, and never when this
    // file is itself a plugin's.
    const self = process.argv[1], roots = [path.join(os.homedir(), '.claude', 'plugins'), path.join(os.homedir(), '.codex', 'plugins', 'cache'), path.join(os.homedir(), '.codex', '.tmp', 'marketplaces')];
    const quote = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
    let looked = '';
    const update = () => {
      if (process.platform === 'win32' || /[\\/]\.(claude|codex)[\\/]/.test(self)) return;
      let out = '';
      try { out = execSync('find ' + roots.map(quote).join(' ') + " -path '*/" + PLUGIN + "/*' -name helper.mjs -type f", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }); } catch (e) { out = String(e.stdout || ''); }
      let best = null;
      for (const f of out.split('\n').filter(Boolean)) { try { const t = fs.statSync(f).mtimeMs; if (!best || t > best.t) best = { f, t }; } catch (e) {} }
      let mine = 0; try { mine = fs.statSync(self).mtimeMs; } catch (e) { return; }
      if (!best || best.t <= mine || looked === best.f + ':' + best.t) return;
      looked = best.f + ':' + best.t;
      let text; try { text = fs.readFileSync(best.f); } catch (e) { return; }
      if (createHash('sha256').update(text).digest('hex').slice(0, 12) === VERSION) return; // the same helper, only newer on disk
      const next = path.join(path.dirname(self), 'helper-next.mjs');
      try {
        fs.writeFileSync(next, text);
        if (spawnSync(process.execPath, ['--check', next], { stdio: 'ignore' }).status !== 0) { fs.unlinkSync(next); return; }
        fs.renameSync(next, self);
      } catch (e) { try { fs.unlinkSync(next); } catch (x) {} return; }
      spawn(process.execPath, [self, 'up', canvas], { detached: true, stdio: 'ignore' }).unref();
    };
    setTimeout(update, Number(process.env.CANVAS_UPDATE_FIRST_MS) || 20000);
    setInterval(update, Number(process.env.CANVAS_UPDATE_MS) || 300000);
  }
} else if (mode === 'codex-login') {
  // SAME-4: Codex's sign-in, kept waiting. "codex mcp login --no-browser" listens for Connect's answer, but also reads a
  // pasted address and gives up when its input closes, and Codex ends a command's process when its turn ends. So this
  // process of its own holds its input open, writes what it prints to a file, and stops it after 10 minutes.
  const log = fs.openSync(process.argv[5], 'a');
  const c = spawn(process.argv[4], ['mcp', 'login', 'canvas', '--no-browser'], { stdio: ['pipe', log, log] });
  const stop = setTimeout(() => c.kill(), 600000);
  c.on('error', (e) => { fs.writeSync(log, 'codex did not start: ' + e.message + '\n'); process.exit(1); });
  c.on('exit', (code) => { clearTimeout(stop); fs.writeSync(log, '\ncodex login ended: ' + code + '\n'); process.exit(0); });
} else if (mode === 'show' || mode === 'connect') {
  // SAME-1, SAME-2 (docs/same-chat.md): this computer's own key, the one the plugin's key script keeps (Claude sends it
  // with every call), made here the first time. The agent's next chats are the same person, so they find the same canvas.
  const C = new URL(canvas), lib = C.protocol === 'https:' ? https : http;
  const keyFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'usecanvas', canvas.replace(/^[a-z]*:\/\//, '').replace(/[^A-Za-z0-9.-]/g, '_') + '.key');
  const viaCodex = mode === 'connect' && process.argv[4] === 'codex';
  const agent = viaCodex ? 'Codex' : String(process.argv[mode === 'show' ? 6 : 5] || 'Your agent').slice(0, 80);
  const call = (method, p, body, key) => new Promise((done) => {
    const data = JSON.stringify(body || {});
    const r = lib.request(canvas + p, { method, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, key ? { authorization: 'Bearer ' + key } : {}) }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (e) {} done({ status: res.statusCode, json: j }); });
    });
    r.on('error', () => done({ status: 0, json: null })); r.setTimeout(30000, () => r.destroy()); r.end(data);
  });
  const said = (r, fallback) => (r.json && r.json.error && r.json.error.message) || fallback;
  const deviceKey = async () => {
    try { const k = fs.readFileSync(keyFile, 'utf8').trim(); if (k) return k; } catch (e) {}
    const r = await call('POST', '/api/device', { client: agent });
    if (!r.json || !r.json.key) { console.error('canvas: ' + said(r, 'the canvas could not be reached. Try again in a moment.')); process.exit(1); }
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyFile + '.' + process.pid, r.json.key, { mode: 0o600 }); fs.renameSync(keyFile + '.' + process.pid, keyFile);
    return r.json.key;
  };
  (async () => {
    const key = await deviceKey();
    if (mode === 'show') {
      // The project's fingerprint and name, as show_local takes them (LOCAL-15, LOCAL-23): the canvas never learns the path.
      let d; try { d = path.resolve(execSync('git rev-parse --path-format=absolute --git-common-dir', { stdio: 'pipe' }).toString().trim(), '..'); } catch (e) { d = process.cwd(); }
      const name = path.basename(d).slice(0, 80);
      // LOCAL-28: a tool beside the app (Storybook, a database studio) is never the project's app.
      const tool = await new Promise((done) => {
        let u; try { u = new URL(String(process.argv[4] || '')); } catch (e) { return done(''); }
        const q = (u.protocol === 'https:' ? https : http).get(u, { timeout: 3000 }, (res) => {
          let b = ''; res.setEncoding('utf8');
          res.on('data', (d) => { b += d; if (b.length > 65536) res.destroy(); });
          res.on('close', () => { const t = (/<title[^>]*>([^<]*)/i.exec(b) || [])[1] || ''; const m = /storybook|prisma studio|drizzle studio|vitest|playwright|mailpit|mailhog/i.exec(t + (/storybook/i.test(b.slice(0, 4096)) ? ' storybook' : '')); done(m ? m[0] : ''); });
        });
        q.on('error', () => done('')); q.on('timeout', () => { q.destroy(); done(''); });
      });
      if (tool) { console.error('canvas: ' + process.argv[4] + ' is ' + tool.replace(/^./, (c) => c.toUpperCase()) + ', not the project\'s app. Run show again with the address of the app its dev script serves (start it if it isn\'t running).'); process.exit(1); }
      const r = await call('POST', '/api/local/show', { url: String(process.argv[4] || ''), name: String(process.argv[5] || name).slice(0, 120), project: createHash('sha256').update(d).digest('base64url').slice(0, 22), project_name: name }, key);
      if (r.status !== 200 || !r.json || !r.json.link) { console.error('canvas: ' + said(r, 'the app could not be put on the canvas.')); process.exit(1); }
      // LOCAL-13: the helper keeps going by itself, as show_local's first step starts it.
      const up = spawnSync(process.execPath, [process.argv[1], 'up', canvas, r.json.watch], { encoding: 'utf8' });
      if (up.status !== 0) { console.error('canvas: the helper did not start. ' + String(up.stderr || '').trim()); process.exit(1); }
      console.log('on the canvas: ' + r.json.link);
      console.log('open beside the chat: ' + r.json.door);
      return;
    }
    // connect: only the Connect link of this canvas, as the agent's login printed it, or (SAME-4) as Codex's sign-in,
    // started here, prints it.
    let link = String(process.argv[4] || '');
    if (viaCodex) {
      const app = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
      const bin = process.argv[5] || (fs.existsSync(app) ? app : 'codex');
      fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
      const logFile = path.join(HOME, 'codex-login.log'); fs.writeFileSync(logFile, '', { mode: 0o600 });
      spawn(process.execPath, [process.argv[1], 'codex-login', canvas, bin, logFile], { detached: true, stdio: 'ignore' }).unref();
      link = '';
      for (let i = 0; i < 80 && !link; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const out = fs.readFileSync(logFile, 'utf8');
        if (/codex (did not start|login ended)/.test(out)) { console.error('canvas: Codex’s sign-in did not start. ' + out.trim().split('\n').pop()); process.exit(1); }
        link = (out.match(/https?:\/\/\S+\/oauth\/authorize\S*/) || [''])[0];
      }
      if (!link) { console.error('canvas: Codex’s sign-in printed no Connect link.'); process.exit(1); }
    }
    let u = null; try { u = new URL(link); } catch (e) {}
    if (!u || u.origin !== C.origin || u.pathname !== '/oauth/authorize') { console.error('canvas: give the Connect link the login printed, on ' + canvas); process.exit(2); }
    const r = await call('POST', '/api/device/link', {}, key);
    const to = r.json && r.json.code ? canvas + '/device/link?code=' + encodeURIComponent(r.json.code) + '&next=' + encodeURIComponent(u.pathname + u.search) : u.href;
    const [cmd, args] = process.platform === 'darwin' ? ['open', [to]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', to]] : ['xdg-open', [to]];
    // Say it's open only once the browser took it; otherwise print the link for the person.
    const opened = await new Promise((done) => {
      const o = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      const t = setTimeout(() => { o.unref(); done(true); }, 5000);
      o.on('error', () => { clearTimeout(t); done(false); });
      o.on('exit', (code) => { clearTimeout(t); done(code === 0); });
    });
    console.log(opened ? 'Connect is open in the browser' + (viaCodex ? '; Codex waits 10 minutes for it' : '') : 'open this link to connect: ' + to);
  })();
} else if (mode !== 'watch') { // the watcher, above, is a mode of its own
  const target = Number(mode);
  if (!Number.isInteger(target) || target < 1 || target > 65535) usage();
  startApp(target, Number(process.argv[4]) || ownOf(target), false);
}
