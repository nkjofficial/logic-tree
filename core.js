/* ロジックツリー作成ツール 共通処理（PC版から切り出し）
   データ・ツリー操作・元に戻す・レイアウト・SVG描画・画像出力・保存・バックアップ解析。
   画面や状態には依存しない（ツリーを受け取って処理する）。 */
'use strict';
(function (root) {

/* ============ 定数（PC版と同じ） ============ */
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",system-ui,sans-serif';
const L = { colW:220, padX:10, padY:9, line:19, font:13, gapMain:40, gapCross:12, gapV:36, gapCrossV:16, radius:4, hdrH:30, hdrGap:14, ruleGap:18, sideW:130, pad:28 };
const EDGE = '#A6ABB2', NODE_STROKE = '#BFC4CA', TEXT = '#2B2B2B', HDR_FILL = '#EFEEEC', RULE = '#CFCFCF', SEL = '#2F6FB5';
const PRIORITY = { high:'高', mid:'中', low:'低' };
const COLORS = {
  auto:   { label:'なし' },
  red:    { label:'赤',   fill:'#FDECEC', stroke:'#D64545' },
  orange: { label:'橙',   fill:'#FFF0E3', stroke:'#E07B24' },
  yellow: { label:'黄',   fill:'#FFF8D6', stroke:'#C9A200' },
  green:  { label:'緑',   fill:'#E8F6EC', stroke:'#2F9E57' },
  blue:   { label:'青',   fill:'#E8F0FE', stroke:'#3B6FD8' },
  purple: { label:'紫',   fill:'#F1EAFD', stroke:'#7B4FD0' },
  gray:   { label:'灰',   fill:'#F1F2F4', stroke:'#8A9099' }
};

/* ============ ユーティリティ ============ */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = ms => { const d = new Date(ms); return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const safeName = s => (s || '無題').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 80);

/* ============ データ ============ */
function mkNode(id, parentId, order, text = ''){ return { id, parentId, order, text, note:'', link:'', priority:'mid', color:'auto', collapsed:false }; }
function newTree(title, direction, projectId = null){
  const id = uid(), rootId = uid(), now = Date.now();
  return { id, title, direction, projectId, rootId, levelLabels:[], nodes:{ [rootId]: mkNode(rootId, null, 0) }, createdAt:now, updatedAt:now, version:2 };
}
function kids(t, id){ return Object.values(t.nodes).filter(n => n.parentId === id).sort((a, b) => a.order - b.order); }
function childMap(t){ const m = {}; for (const n of Object.values(t.nodes)) { if (n.parentId) (m[n.parentId] ||= []).push(n); } for (const k in m) m[k].sort((a, b) => a.order - b.order); return m; }
function setKids(t, pid, arr){ arr.forEach((n, i) => { n.parentId = pid; n.order = i; }); }
function descendants(t, id){ const cm = childMap(t), out = [], st = [id]; while (st.length) { const c = st.pop(); for (const k of cm[c] || []) { out.push(k.id); st.push(k.id); } } return out; }
function depthOf(t, id){ let d = 0, n = t.nodes[id]; while (n && n.parentId) { n = t.nodes[n.parentId]; d++; } return d; }
function placeholder(t, n){ return n.id === t.rootId ? 'トップイシューを入力' : '入力してください'; }
function levelLabel(t, d){ const v = (t.levelLabels || [])[d]; return v != null && v !== '' ? v : (d === 0 ? 'トップイシュー' : `${d}層目`); }
function labelOf(t, id, max = 24){ const n = t.nodes[id]; const s = (n.text || placeholder(t, n)).replace(/\n/g, ' '); return s.length > max ? s.slice(0, max) + '…' : s; }
function normalizeTree(c){
  c.direction = c.direction === 'v' ? 'v' : 'h';
  if (!Array.isArray(c.levelLabels)) c.levelLabels = [];
  for (const nd of Object.values(c.nodes)) { const base = mkNode(nd.id, nd.parentId, nd.order || 0); for (const k in base) if (nd[k] === undefined) nd[k] = base[k]; delete nd.status; }
  delete c.type;
  if (c.projectId === undefined) c.projectId = null;
  return c;
}
function sampleTree(){
  const t = newTree('サンプル：若手人材の育成', 'h');
  t.nodes[t.rootId].text = '若手人材の育成が上手く進まない';
  const add = (pid, text) => { const id = uid(); t.nodes[id] = mkNode(id, pid, kids(t, pid).length, text); return id; };
  const a = add(t.rootId, '育成の仕組みが整備されていないから');
  add(a, '体系的なカリキュラムが準備されていないから');
  add(a, 'メンター制度のようなフィードバックを得られる環境が整備されていないから');
  add(a, '成長を促進する機会を与えられていないから');
  add(a, '成長した結果の報酬や称賛に関する制度がないから');
  add(t.rootId, '指導者側の育成スキル・マインドが不足しているから');
  add(t.rootId, '若手の成長意欲を喚起しきれていないから');
  return t;
}

/* ============ ツリー操作（PC版の操作から画面処理を除いたもの）
   どれもツリーを書き換え、結果を返す。失敗時は { error } を返す。 ============ */
const ops = {
  addChild(t, pid){ const id = uid(); t.nodes[pid].collapsed = false; t.nodes[id] = mkNode(id, pid, kids(t, pid).length); return { id }; },
  addSibling(t, sid){
    if (sid === t.rootId) return ops.addChild(t, sid);
    const id = uid(), s = t.nodes[sid], ks = kids(t, s.parentId), n = mkNode(id, s.parentId, 0);
    ks.splice(ks.findIndex(k => k.id === sid) + 1, 0, n); t.nodes[id] = n; setKids(t, s.parentId, ks);
    return { id };
  },
  remove(t, id){
    if (id === t.rootId) return { error: 'トップイシューは削除できません' };
    const n = t.nodes[id], sibs = kids(t, n.parentId), i = sibs.findIndex(k => k.id === id);
    const next = (sibs[i + 1] || sibs[i - 1] || { id: n.parentId }).id;
    for (const d of descendants(t, id)) delete t.nodes[d];
    delete t.nodes[id]; setKids(t, n.parentId, kids(t, n.parentId));
    return { next };
  },
  moveSibling(t, id, dir){
    const n = t.nodes[id]; if (!n.parentId) return { error: 'トップイシューは移動できません' };
    const arr = kids(t, n.parentId), i = arr.findIndex(k => k.id === id), j = i + dir;
    if (j < 0 || j >= arr.length) return { error: dir < 0 ? 'これより上には移動できません' : 'これより下には移動できません' };
    [arr[i], arr[j]] = [arr[j], arr[i]]; setKids(t, n.parentId, arr); return {};
  },
  outdent(t, id){
    const n = t.nodes[id]; if (!n.parentId) return { error: 'トップイシューは移動できません' };
    const p = t.nodes[n.parentId]; if (!p.parentId) return { error: 'これ以上、階層を上げられません' };
    setKids(t, p.id, kids(t, p.id).filter(k => k.id !== id));
    const arr = kids(t, p.parentId).filter(k => k.id !== id); arr.splice(arr.findIndex(k => k.id === p.id) + 1, 0, n); setKids(t, p.parentId, arr);
    return {};
  },
  indent(t, id){
    const n = t.nodes[id]; if (!n.parentId) return { error: 'トップイシューは移動できません' };
    const ks = kids(t, n.parentId), i = ks.findIndex(k => k.id === id);
    if (i <= 0) return { error: '上に兄弟ノードがないため、階層を下げられません' };
    const prev = ks[i - 1];
    setKids(t, n.parentId, ks.filter(k => k.id !== id)); prev.collapsed = false;
    const arr = kids(t, prev.id).filter(k => k.id !== id); arr.push(n); setKids(t, prev.id, arr);
    return {};
  },
  // zone: 'child' | 'before' | 'after'
  moveTo(t, id, target, zone){
    if (id === t.rootId) return { error: 'トップイシューは移動できません' };
    if (id === target || descendants(t, id).includes(target)) return { error: '自分の配下には移動できません' };
    if (target === t.rootId && zone !== 'child') zone = 'child';
    const n = t.nodes[id], oldP = n.parentId;
    if (zone === 'child') { const arr = kids(t, target).filter(k => k.id !== id); arr.push(n); t.nodes[target].collapsed = false; setKids(t, target, arr); }
    else { const tg = t.nodes[target]; const arr = kids(t, tg.parentId).filter(k => k.id !== id); const i = arr.findIndex(k => k.id === target); arr.splice(zone === 'before' ? i : i + 1, 0, n); setKids(t, tg.parentId, arr); }
    if (oldP !== n.parentId) setKids(t, oldP, kids(t, oldP));
    return {};
  },
  toggle(t, id){ if (!kids(t, id).length) return { error: '' }; t.nodes[id].collapsed = !t.nodes[id].collapsed; return {}; },
  // k = 1〜4（その階層まで表示）、0 = すべて表示
  setLevel(t, k){ for (const n of Object.values(t.nodes)) { const d = depthOf(t, n.id); n.collapsed = k ? d >= k - 1 : false; } return {}; }
};

/* ============ 元に戻す（PC版と同じ：変更前の状態を丸ごと記録） ============ */
function snapshot(t){ return JSON.stringify({ title:t.title, direction:t.direction, rootId:t.rootId, levelLabels:t.levelLabels || [], nodes:t.nodes }); }
function History(limit = 200){ this.undo = {}; this.redo = {}; this.limit = limit; }
History.prototype.push = function (tid, snap){ const u = (this.undo[tid] ||= []); u.push(snap); if (u.length > this.limit) u.shift(); this.redo[tid] = []; };
History.prototype.canUndo = function (tid){ return !!(this.undo[tid] || []).length; };
History.prototype.canRedo = function (tid){ return !!(this.redo[tid] || []).length; };
History.prototype.back = function (t){ const u = this.undo[t.id]; if (!u || !u.length) return false; (this.redo[t.id] ||= []).push(snapshot(t)); Object.assign(t, JSON.parse(u.pop())); return true; };
History.prototype.forward = function (t){ const r = this.redo[t.id]; if (!r || !r.length) return false; (this.undo[t.id] ||= []).push(snapshot(t)); Object.assign(t, JSON.parse(r.pop())); return true; };
History.prototype.dropLast = function (tid){ const u = this.undo[tid]; return u && u.length ? u.pop() : null; };

/* ============ レイアウト（PC版と同じ） ============ */
let measure = null; // (text, font) => width
function defaultMeasure(){
  if (typeof document !== 'undefined') { const ctx = document.createElement('canvas').getContext('2d'); return (s, font) => { ctx.font = font; return ctx.measureText(s).width; }; }
  // Node.js（テスト）用の概算：全角13px、半角7px
  return (s, font) => { const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)[1]); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 0xff ? fs : fs * 0.55; return w; };
}
function setMeasure(fn){ measure = fn; }
const NOBREAK = new Set(Array.from('、。，．,.)）」』】!！?？ー・：:；;ぁぃぅぇぉっゃゅょァィゥェォッャュョ'));
function wrapLines(text, font, maxW){
  if (!measure) measure = defaultMeasure();
  const out = [];
  for (const para of text.split('\n')) {
    if (para === '') { out.push(''); continue; }
    let line = '';
    for (const ch of Array.from(para)) {
      const test = line + ch;
      if (line !== '' && measure(test, font) > maxW && !NOBREAK.has(ch)) {
        const m = /[A-Za-z0-9]/.test(ch) ? line.match(/^(.*\s)([A-Za-z0-9\-_]+)$/) : null;
        if (m && m[1].trim()) { out.push(m[1].trimEnd()); line = m[2] + ch; }
        else { out.push(line); line = ch; }
      } else line = test;
    }
    out.push(line);
  }
  return out;
}
function nodeBox(t, n, ui){
  const weight = n.priority === 'high' ? 700 : 400;
  const font = `${weight} ${L.font}px ${FONT}`;
  const ph = !n.text;
  const shown = n.text || (ui ? placeholder(t, n) : '');
  const lines = wrapLines(shown || ' ', font, L.colW - 2 * L.padX - 10);
  const h = L.padY * 2 + lines.length * L.line;
  return { w: L.colW, h, lines, font, fs: L.font, weight, ph };
}
// dirOverride: 表示だけ向きを変えるとき 'h' | 'v'
function computeLayout(t, ui, dirOverride){
  const cm = childMap(t), boxes = {}, depth = {}, order = [];
  const visKids = id => t.nodes[id].collapsed ? [] : (cm[id] || []).map(k => k.id);
  const walk = (id, d) => { boxes[id] = nodeBox(t, t.nodes[id], ui); depth[id] = d; order.push(id); for (const k of visKids(id)) walk(k, d + 1); };
  walk(t.rootId, 0);
  const H = (dirOverride || t.direction) !== 'v';
  const mainOf = b => H ? b.w : b.h, crossOf = b => H ? b.h : b.w;
  const gapMain = H ? L.gapMain : L.gapV, gapCross = H ? L.gapCross : L.gapCrossV;
  const maxMain = [];
  for (const id of order) { const d = depth[id]; maxMain[d] = Math.max(maxMain[d] || 0, mainOf(boxes[id])); }
  const mainPos = [0];
  for (let d = 1; d < maxMain.length; d++) mainPos[d] = mainPos[d - 1] + maxMain[d - 1] + gapMain;
  const ext = {};
  const size = id => { const ks = visKids(id); let s = 0; if (ks.length) s = ks.reduce((a, k) => a + size(k), 0) + gapCross * (ks.length - 1); return ext[id] = Math.max(crossOf(boxes[id]), s); };
  size(t.rootId);
  const pos = {};
  const cc = id => H ? pos[id].y + boxes[id].h / 2 : pos[id].x + boxes[id].w / 2;
  const place = (id, start) => {
    const b = boxes[id], e = ext[id], ks = visKids(id), d = depth[id];
    const total = ks.reduce((a, k) => a + ext[k], 0) + gapCross * Math.max(0, ks.length - 1);
    let cs = start + (e - total) / 2;
    for (const k of ks) { place(k, cs); cs += ext[k] + gapCross; }
    const half = crossOf(b) / 2;
    let center = ks.length ? (cc(ks[0]) + cc(ks[ks.length - 1])) / 2 : start + e / 2;
    center = clamp(center, start + half, start + e - half);
    pos[id] = H ? { x: mainPos[d], y: center - b.h / 2 } : { x: center - b.w / 2, y: mainPos[d] };
  };
  place(t.rootId, 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of order) { const p = pos[id], b = boxes[id]; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + b.w); maxY = Math.max(maxY, p.y + b.h); }
  const headers = [];
  let rule;
  if (H) {
    const y = minY - L.ruleGap - L.hdrGap - L.hdrH;
    for (let d = 0; d < maxMain.length; d++) headers.push({ d, x: mainPos[d], y, w: L.colW, h: L.hdrH });
    rule = { x1: minX, y1: minY - L.ruleGap, x2: maxX, y2: minY - L.ruleGap };
    minY = y;
  } else {
    const x = minX - L.ruleGap - L.hdrGap - L.sideW;
    for (let d = 0; d < maxMain.length; d++) headers.push({ d, x, y: mainPos[d] + maxMain[d] / 2 - L.hdrH / 2, w: L.sideW, h: L.hdrH });
    rule = { x1: minX - L.ruleGap, y1: minY, x2: minX - L.ruleGap, y2: maxY };
    minX = x;
  }
  return { boxes, pos, depth, order, mainPos, maxMain, H, gapMain, cc, visKids, headers, rule, bounds:{ minX, minY, maxX, maxY } };
}
function edgeSegments(t, Ly){
  const segs = [];
  for (const id of Ly.order) {
    const ks = Ly.visKids(id); if (!ks.length) continue;
    const p = Ly.pos[id], b = Ly.boxes[id], d = Ly.depth[id];
    const mid = Ly.mainPos[d + 1] - Ly.gapMain / 2;
    if (Ly.H) {
      const y1 = p.y + b.h / 2;
      segs.push({ x1: p.x + b.w, y1, x2: mid, y2: y1 });
      const ys = ks.map(k => Ly.cc(k)).concat([y1]);
      const lo = Math.min(...ys), hi = Math.max(...ys);
      if (hi - lo > 0.5) segs.push({ x1: mid, y1: lo, x2: mid, y2: hi });
      for (const k of ks) { const y = Ly.cc(k); segs.push({ x1: mid, y1: y, x2: Ly.pos[k].x, y2: y }); }
    } else {
      const x1 = p.x + b.w / 2;
      segs.push({ x1, y1: p.y + b.h, x2: x1, y2: mid });
      const xs = ks.map(k => Ly.cc(k)).concat([x1]);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      if (hi - lo > 0.5) segs.push({ x1: lo, y1: mid, x2: hi, y2: mid });
      for (const k of ks) { const x = Ly.cc(k); segs.push({ x1: x, y1: mid, x2: x, y2: Ly.pos[k].y }); }
    }
  }
  return segs;
}
function nodeStyle(t, n){
  let fill = '#FFFFFF', stroke = NODE_STROKE;
  if (n.color && n.color !== 'auto' && COLORS[n.color]) { fill = COLORS[n.color].fill; stroke = COLORS[n.color].stroke; }
  if (n.priority === 'high' && n.color === 'auto') stroke = '#6B7280';
  return { fill, stroke, text: TEXT, sw: n.priority === 'high' ? 2.5 : 1.2, dash: n.priority === 'low' ? '5 4' : '' };
}

/* ============ SVG描画（PC版と同じ。画面用は opts.ui / opts.sel） ============ */
function textSVG(b, x, y, fill){
  let s = `<text font-family='${FONT}' font-size="${b.fs}" font-weight="${b.weight}" fill="${fill}">`;
  b.lines.forEach((ln, i) => { s += `<tspan x="${x + L.padX}" y="${y + L.padY + i * L.line + (L.line + b.fs * 0.72) / 2}">${esc(ln) || ' '}</tspan>`; });
  return s + `</text>`;
}
function headerSVG(t, Ly){
  let s = `<line x1="${Ly.rule.x1}" y1="${Ly.rule.y1}" x2="${Ly.rule.x2}" y2="${Ly.rule.y2}" stroke="${RULE}" stroke-width="1.5"/>`;
  for (const h of Ly.headers) {
    s += `<g class="hdr" data-hdr="${h.d}"><rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="6" fill="${HDR_FILL}"/>`;
    s += `<text x="${h.x + h.w / 2}" y="${h.y + h.h / 2 + 4.5}" text-anchor="middle" font-family='${FONT}' font-size="13" font-weight="700" fill="#333333">${esc(levelLabel(t, h.d))}</text></g>`;
  }
  return s;
}
function treeSVGInner(t, Ly, opts = {}){
  const ui = !!opts.ui, withHeaders = opts.headers !== false;
  let s = withHeaders ? headerSVG(t, Ly) : '';
  s += `<g fill="none" stroke="${EDGE}" stroke-width="1.5">`;
  for (const g of edgeSegments(t, Ly)) s += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
  s += `</g>`;
  const cm = ui ? childMap(t) : null;
  for (const id of Ly.order) {
    const n = t.nodes[id], b = Ly.boxes[id], p = Ly.pos[id], st = nodeStyle(t, n);
    const sel = ui && id === opts.sel;
    s += `<g class="nodeg" data-id="${id}">`;
    if (sel) s += `<rect x="${p.x - 3}" y="${p.y - 3}" width="${b.w + 6}" height="${b.h + 6}" rx="${L.radius + 3}" fill="none" stroke="${SEL}" stroke-opacity="0.22" stroke-width="4"/>`;
    s += `<rect x="${p.x}" y="${p.y}" width="${b.w}" height="${b.h}" rx="${L.radius}" fill="${st.fill}" stroke="${sel ? SEL : st.stroke}" stroke-width="${sel ? Math.max(1.5, st.sw) : st.sw}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`;
    s += textSVG(b, p.x, p.y, (ui && b.ph) ? '#A3A9B1' : st.text);
    if (ui && (n.note || n.link)) s += `<circle cx="${p.x + b.w - 7}" cy="${p.y + 7}" r="3" fill="#E07B24"/>`;
    s += `</g>`;
    if (ui && (cm[id] || []).length) {
      const cx = Ly.H ? p.x + b.w + 10 : p.x + b.w / 2, cy = Ly.H ? p.y + b.h / 2 : p.y + b.h + 10;
      // スマホでは押しやすいよう、見えない当たり判定を広げる
      s += `<g class="tg" data-toggle="${id}"><circle cx="${cx}" cy="${cy}" r="16" fill="transparent"/>`;
      if (n.collapsed) {
        const cnt = descendants(t, id).length, label = cnt > 99 ? '99+' : String(cnt), w = Math.max(20, label.length * 7 + 10);
        s += `<rect x="${cx - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="9" fill="${SEL}"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" font-family='${FONT}'>${label}</text>`;
      } else {
        s += `<circle cx="${cx}" cy="${cy}" r="7" fill="#fff" stroke="${EDGE}" stroke-width="1.2"/><path d="M${cx - 3.5} ${cy}H${cx + 3.5}" stroke="#5B636E" stroke-width="1.4"/>`;
      }
      s += `</g>`;
    }
  }
  return s;
}

/* ============ 画像出力（PC版と同じ） ============ */
function exportBounds(Ly, hdr){
  if (hdr) return Ly.bounds;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of Ly.order) { const p = Ly.pos[id], b = Ly.boxes[id]; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + b.w); maxY = Math.max(maxY, p.y + b.h); }
  return { minX, minY, maxX, maxY };
}
function buildExportSVG(t, transparent, hdr){
  const Ly = computeLayout(t, false), bd = exportBounds(Ly, hdr), pad = 24;
  const w = Math.ceil(bd.maxX - bd.minX + pad * 2), h = Math.ceil(bd.maxY - bd.minY + pad * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${transparent ? '' : `<rect width="${w}" height="${h}" fill="#FFFFFF"/>`}<g transform="translate(${pad - bd.minX} ${pad - bd.minY})">${treeSVGInner(t, Ly, { headers: hdr })}</g></svg>`;
  return { svg, w, h };
}
// iPhoneのSafariは大きなキャンバスを作れない（約1,670万画素まで）ため、超える場合は倍率を下げる
const MAX_PIXELS = 16000000;
async function exportPNG(t, scale, transparent, hdr){
  const { svg, w, h } = buildExportSVG(t, transparent, hdr);
  let s = scale; while (s > 1 && w * h * s * s > MAX_PIXELS) s -= 0.5;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d'); ctx.scale(s, s); ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('PNGを作成できませんでした')), 'image/png'));
  return { blob, scale: s };
}

/* ============ バックアップ（PC版の「すべてバックアップ」と同じ形式） ============ */
function buildBackup(projects, trees){ return JSON.stringify({ app: 'logic-tree-tool', version: 3, projects, trees }, null, 2); }
function backupName(d = new Date()){ return `logic-tree-backup-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`; }
// 全件バックアップだけを受け付ける。戻り値 { projects, trees }（ツリーは正規化済み）
function parseBackup(text){
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSONとして読み込めません'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.trees)) throw new Error('全件バックアップのファイルではありません');
  const projects = Array.isArray(data.projects) ? data.projects.filter(p => p && p.id && p.name).map(p => ({ id: p.id, name: p.name, collapsed: !!p.collapsed, createdAt: p.createdAt || Date.now() })) : [];
  const trees = data.trees.filter(t => t && t.id && t.nodes && t.rootId && t.nodes[t.rootId]).map(t => normalizeTree(JSON.parse(JSON.stringify(t))));
  if (!trees.length) throw new Error('ツリーのデータが見つかりません');
  return { projects, trees };
}
// 内容が同じかどうか（PC版と同じ比較）
function canon(projects, trees){
  const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const ps = [...projects].sort(byId).map(p => [p.id, p.name || '']);
  const ts = [...trees].map(t => normalizeTree(JSON.parse(JSON.stringify(t)))).sort(byId).map(t => [t.id, t.title || '', t.projectId || null, t.direction, t.levelLabels || [], t.rootId,
    Object.values(t.nodes).sort(byId).map(n => [n.id, n.parentId, n.order, n.text, n.note, n.link, n.priority, n.color, !!n.collapsed])]);
  return JSON.stringify([ps, ts]);
}

/* ============ 保存（IndexedDB → localStorage → メモリ。PC版と同じ構成） ============ */
function makeDB(){
  const DB = {
    db: null, mode: 'memory', cache: { trees: {}, projects: {} },
    async init(){
      try {
        if (!root.indexedDB) throw new Error('no idb');
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open('logic-tree-tool', 3);
          r.onupgradeneeded = () => { const db = r.result; for (const st of ['trees', 'projects']) if (!db.objectStoreNames.contains(st)) db.createObjectStore(st, { keyPath: 'id' }); if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
          setTimeout(() => rej(new Error('timeout')), 4000);
        });
        this.mode = 'idb';
      } catch (e) {
        try { localStorage.setItem('__lt', '1'); localStorage.removeItem('__lt'); this.mode = 'ls'; } catch (e2) { this.mode = 'memory'; }
      }
    },
    async all(store = 'trees'){
      if (this.mode === 'idb') return new Promise((res, rej) => { const r = this.db.transaction(store, 'readonly').objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
      if (this.mode === 'ls') { try { return JSON.parse(localStorage.getItem('logic-tree-' + store) || '[]'); } catch { return []; } }
      return Object.values(this.cache[store]);
    },
    async put(obj, store = 'trees'){
      this.cache[store][obj.id] = obj;
      if (this.mode === 'idb') return new Promise((res, rej) => { const tx = this.db.transaction(store, 'readwrite'); tx.objectStore(store).put(JSON.parse(JSON.stringify(obj))); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      if (this.mode === 'ls') localStorage.setItem('logic-tree-' + store, JSON.stringify(Object.values(this.cache[store])));
    },
    async del(id, store = 'trees'){
      delete this.cache[store][id];
      if (this.mode === 'idb') return new Promise((res, rej) => { const tx = this.db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      if (this.mode === 'ls') localStorage.setItem('logic-tree-' + store, JSON.stringify(Object.values(this.cache[store])));
    },
    async kvGet(k){
      if (this.mode === 'idb') return new Promise((res, rej) => { const r = this.db.transaction('kv', 'readonly').objectStore('kv').get(k); r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error); });
      try { const v = localStorage.getItem('logic-tree-kv-' + k); return v == null ? null : JSON.parse(v); } catch { return null; }
    },
    async kvSet(k, v){
      if (this.mode === 'idb') return new Promise((res, rej) => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      try { localStorage.setItem('logic-tree-kv-' + k, JSON.stringify(v)); } catch {}
    }
  };
  // localStorage 保存時は、キャッシュに全件が必要
  const origAll = DB.all.bind(DB);
  DB.all = async function (store = 'trees'){ const list = await origAll(store); for (const o of list) if (o && o.id) this.cache[store][o.id] = o; return list; };
  return DB;
}

root.LT = {
  FONT, L, EDGE, SEL, PRIORITY, COLORS,
  uid, esc, clamp, fmtDate, safeName, pad2,
  mkNode, newTree, kids, childMap, setKids, descendants, depthOf, placeholder, levelLabel, labelOf, normalizeTree, sampleTree,
  ops, snapshot, History,
  setMeasure, wrapLines, nodeBox, computeLayout, edgeSegments, nodeStyle, treeSVGInner,
  buildExportSVG, exportPNG, buildBackup, backupName, parseBackup, canon, makeDB
};
if (typeof module !== 'undefined' && module.exports) module.exports = root.LT;
})(typeof window !== 'undefined' ? window : globalThis);
