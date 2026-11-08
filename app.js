/* ロジックツリー スマホ版（iPhone） 画面と操作 */
'use strict';
const APP_VERSION = '1.0.1';
const {
  esc, clamp, fmtDate, safeName, uid, kids, childMap, descendants, depthOf, placeholder, levelLabel, labelOf,
  newTree, sampleTree, normalizeTree, ops, snapshot, History, computeLayout, treeSVGInner, COLORS, PRIORITY
} = LT;

const $ = s => document.querySelector(s);
const app = $('#app'), overlay = $('#overlay');
const DB = LT.makeDB();
const H = new History(200);
const BACKUP_DAYS = 7;

/* ============ 状態 ============ */
const S = {
  trees: {}, projects: {}, screen: 'list', cur: null, sel: null, view: 'outline',
  editing: null, editNew: false, editOrig: '', editBefore: null, caret: null,
  lastKey: null, lastTime: 0, tempV: false, chipHidden: false,
  zoom: 1, panX: 0, panY: 0, layout: null,
  saveErr: false, update: null, persisted: null, kv: { lastBackup: null, firstRun: null },
  sheet: null, collapsedGroups: {}
};
const T = () => S.trees[S.cur];

function toast(msg){ if (!msg) return; const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2400); }
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isPortrait = () => innerHeight >= innerWidth;
const meta = {
  get(k){ try { return localStorage.getItem('logic-tree-' + k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem('logic-tree-' + k, v); } catch {} }
};

/* ============ 保存 ============ */
const pending = new Set(); let saveTimer = null;
function scheduleSave(t){ pending.add(t.id); clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 350); }
async function flushSave(){
  clearTimeout(saveTimer); saveTimer = null;
  const list = [...pending]; pending.clear();
  try { for (const id of list) if (S.trees[id]) await DB.put(S.trees[id]); if (S.saveErr) { S.saveErr = false; refreshBanners(); } }
  catch (e) { console.error(e); if (!S.saveErr) { S.saveErr = true; toast('保存に失敗しました。バックアップを作成してください'); refreshBanners(); } }
}
function saveProject(p){ DB.put(p, 'projects').catch(e => { console.error(e); toast('保存に失敗しました'); }); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (S.editing) syncEditText(); flushSave(); } });
window.addEventListener('pagehide', () => { if (S.editing) syncEditText(); flushSave(); });

/* ============ 変更と元に戻す（PC版の mutate と同じ考え方） ============ */
// fn がエラーを返したら何も変えずに知らせる。opts.key が同じ連続変更は1.5秒以内なら1回分にまとめる
function mutate(fn, opts = {}){
  const t = T(); if (!t) return null;
  const before = snapshot(t);
  const r = fn(t) || {};
  if (r.error !== undefined) { toast(r.error); return r; }
  if (snapshot(t) === before) return r;
  const now = Date.now();
  const coalesce = opts.key && S.lastKey === opts.key && now - S.lastTime < 1500;
  if (!coalesce) H.push(t.id, before);
  S.lastKey = opts.key || null; S.lastTime = now;
  t.updatedAt = now; scheduleSave(t);
  if (opts.render !== false) renderMain();
  if (opts.sheet) renderSheet();
  return r;
}
function undo(){ const t = T(); if (!t) return; endEdit(); if (!H.back(t)) return toast('これ以上元に戻せません'); afterRestore(t); }
function redo(){ const t = T(); if (!t) return; endEdit(); if (!H.forward(t)) return toast('やり直す操作がありません'); afterRestore(t); }
function afterRestore(t){ S.lastKey = null; if (S.sel && !t.nodes[S.sel]) S.sel = t.rootId; t.updatedAt = Date.now(); scheduleSave(t); closeSheet(); renderMain(); }

/* ============ 画面の切り替え ============ */
function go(screen){ S.screen = screen; closeOverlay(); render(); }
function render(){
  if (S.screen === 'install') return renderInstall();
  if (S.screen === 'editor' && T()) return renderEditor();
  S.screen = 'list'; renderList();
}
function renderMain(){ if (S.screen === 'editor') renderEditorBody(); else renderList(); }

/* ---------- ホーム画面への追加の案内 ---------- */
function renderInstall(){
  app.innerHTML = `<div class="screen"><div class="scroll install">
    <img src="icons/icon-180.png" alt="">
    <h1>ホーム画面に追加してください</h1>
    <div>このアプリは、ホーム画面に追加して使います。追加すると通信のない場所でも使え、データが消えにくくなります。</div>
    <ol>
      <li>画面下の <b>共有ボタン</b>（□に↑のアイコン）を押す</li>
      <li><b>「ホーム画面に追加」</b>を選び、右上の「追加」を押す</li>
      <li>ホーム画面の <b>「ロジックツリー」</b> のアイコンから開く</li>
    </ol>
    <div class="note">Safariで開いた場合とホーム画面から開いた場合では、保存されるデータが別々になります。いつもホーム画面のアイコンから開いてください。</div>
    <button class="later" data-act="try">Safariのまま試す（データは別扱いになります）</button>
  </div></div>`;
  app.querySelector('[data-act=try]').onclick = () => { S.trial = true; go('list'); };
}

/* ---------- お知らせ帯 ---------- */
function bannersHTML(){
  let s = '';
  if (S.update) s += `<div class="banner info"><span>新しいバージョンがあります</span><button class="primary" data-act="update">更新する</button></div>`;
  if (DB.mode === 'memory') s += `<div class="banner err"><span>この環境では保存できません。閉じると内容が消えます。</span></div>`;
  else if (S.saveErr) s += `<div class="banner err"><span>保存に失敗しました。バックアップを作成してください。</span><button data-act="backup">バックアップ</button></div>`;
  if (S.trial) s += `<div class="banner"><span>Safariで開いています。ホーム画面から開いた場合とはデータが別になります。</span></div>`;
  if (needBackupNotice()) s += `<div class="banner"><span>${S.kv.lastBackup ? `最後のバックアップから${Math.floor((Date.now() - S.kv.lastBackup) / 864e5)}日経っています。` : 'まだバックアップを作成していません。'}</span><button data-act="backup">バックアップ</button></div>`;
  return s;
}
function needBackupNotice(){
  if (!Object.keys(S.trees).length) return false;
  const base = S.kv.lastBackup || S.kv.firstRun || Date.now();
  if (Date.now() - base < BACKUP_DAYS * 864e5) return false;
  // バックアップ後に変更がなければ知らせない
  const last = Math.max(...Object.values(S.trees).map(t => t.updatedAt || 0));
  return !S.kv.lastBackup || last > S.kv.lastBackup;
}
function bindBanners(root){
  root.querySelectorAll('[data-act=update]').forEach(b => b.onclick = applyUpdate);
  root.querySelectorAll('[data-act=backup]').forEach(b => b.onclick = doBackup);
}
function refreshBanners(){ const el = app.querySelector('#banners'); if (el) { el.innerHTML = bannersHTML(); bindBanners(el); } }

/* ============ 一覧画面 ============ */
const sortedProjects = () => Object.values(S.projects).sort((a, b) => a.createdAt - b.createdAt);
function renderList(){
  closeSheet(true);
  const trees = Object.values(S.trees).sort((a, b) => b.updatedAt - a.updatedAt);
  const groups = sortedProjects().map(p => ({ id: p.id, name: p.name, collapsed: !!p.collapsed, items: trees.filter(t => t.projectId === p.id) }));
  const un = trees.filter(t => !t.projectId || !S.projects[t.projectId]);
  if (un.length || !groups.length) groups.push({ id: '', name: '未分類', collapsed: meta.get('unc-collapsed') === '1', items: un, unc: true });
  const card = t => `<div class="card" data-open="${t.id}"><div class="body"><div class="t">${esc(t.title || '無題')}</div><div class="m">${Object.keys(t.nodes).length}ノード・${fmtDate(t.updatedAt)}</div></div><button class="ghost icon" data-tmenu="${t.id}" aria-label="メニュー">⋯</button></div>`;
  app.innerHTML = `<div class="screen">
    <div class="bar"><h1>ロジックツリー</h1><button class="ghost" data-act="newproj">＋ テーマ</button><button class="ghost icon" data-act="settings" aria-label="設定">⚙︎</button></div>
    <div class="scroll"><div id="banners">${bannersHTML()}</div><div class="list">
    ${groups.map(g => `<div class="grp">
      <div class="grp-h" data-gh="${g.id}"><span class="caret">${g.collapsed ? '▶' : '▼'}</span><span class="gname">${esc(g.name)}</span><span class="cnt">${g.items.length}</span>${g.unc ? '' : `<button class="ghost icon" data-pmenu="${g.id}" aria-label="テーマのメニュー">⋯</button>`}</div>
      ${g.collapsed ? '' : `<div class="cards">${g.items.length ? g.items.map(card).join('') : `<div class="empty">ツリーはまだありません</div>`}</div>`}
    </div>`).join('')}
    </div></div>
    <button class="primary fab" data-act="new">＋ 新しいツリー</button>
  </div>`;
  bindBanners(app);
  app.querySelector('[data-act=new]').onclick = () => showNew();
  app.querySelector('[data-act=newproj]').onclick = newProject;
  app.querySelector('[data-act=settings]').onclick = showSettings;
  app.querySelector('.list').addEventListener('click', e => {
    const tm = e.target.closest('[data-tmenu]'); if (tm) return treeMenu(tm.dataset.tmenu);
    const pm = e.target.closest('[data-pmenu]'); if (pm) return projectMenu(pm.dataset.pmenu);
    const gh = e.target.closest('[data-gh]');
    if (gh) { const pid = gh.dataset.gh; if (pid) { const p = S.projects[pid]; p.collapsed = !p.collapsed; saveProject(p); } else meta.set('unc-collapsed', meta.get('unc-collapsed') === '1' ? '0' : '1'); return renderList(); }
    const c = e.target.closest('[data-open]'); if (c) openTree(c.dataset.open);
  });
}
function openTree(id){
  S.cur = id; const t = T(); S.sel = null; S.lastKey = null; S.tempV = false; S.chipHidden = false;
  S.view = isPortrait() ? (meta.get('view') || 'outline') : 'tree';
  S.fitPending = true;
  meta.set('current', id);
  go('editor');
}
function newProject(){
  promptModal('新しいテーマ', '', 'テーマ名', v => { const p = { id: uid(), name: v, collapsed: false, createdAt: Date.now() }; S.projects[p.id] = p; saveProject(p); renderList(); });
}
function treeMenu(tid){
  const t = S.trees[tid];
  actionSheet(t.title || '無題', [
    { label: '開く', onClick: () => openTree(tid) },
    { label: '名前を変更', onClick: () => promptModal('ツリー名', t.title, 'ツリー名', v => { t.title = v; t.updatedAt = Date.now(); scheduleSave(t); renderList(); }) },
    { label: '複製', onClick: () => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.title = t.title + 'のコピー'; c.createdAt = c.updatedAt = Date.now(); S.trees[c.id] = c; scheduleSave(c); renderList(); toast('複製しました'); } },
    { label: 'テーマに移動', onClick: () => moveTreeMenu(tid) },
    { label: '削除', danger: true, onClick: () => confirmModal('ツリーを削除', `「${esc(t.title || '無題')}」を削除します。この操作は元に戻せません。`, async () => { delete S.trees[tid]; delete H.undo[tid]; delete H.redo[tid]; pending.delete(tid); try { await DB.del(tid); } catch (e) { console.error(e); } renderList(); toast('削除しました'); }, { ok: '削除する', danger: true }) }
  ]);
}
function moveTreeMenu(tid){
  const t = S.trees[tid], cur = t.projectId || '';
  const items = sortedProjects().map(p => ({ label: p.name, on: cur === p.id, onClick: () => moveTree(tid, p.id) }));
  items.push({ label: '未分類', on: cur === '', onClick: () => moveTree(tid, null) });
  items.push({ label: '＋ 新しいテーマを作って移動', onClick: () => promptModal('新しいテーマ', '', 'テーマ名', v => { const p = { id: uid(), name: v, collapsed: false, createdAt: Date.now() }; S.projects[p.id] = p; saveProject(p); moveTree(tid, p.id); }) });
  actionSheet('移動先のテーマ', items);
}
function moveTree(tid, pid){
  const t = S.trees[tid]; if ((t.projectId || null) === (pid || null)) return;
  t.projectId = pid || null; t.updatedAt = Date.now(); scheduleSave(t);
  if (pid && S.projects[pid].collapsed) { S.projects[pid].collapsed = false; saveProject(S.projects[pid]); }
  renderList(); toast(pid ? `「${S.projects[pid].name}」に移動しました` : '未分類に移動しました');
}
function projectMenu(pid){
  const p = S.projects[pid];
  actionSheet(p.name, [
    { label: 'このテーマに新しいツリー', onClick: () => showNew(pid) },
    { label: '名前を変更', onClick: () => promptModal('テーマ名', p.name, 'テーマ名', v => { p.name = v; saveProject(p); renderList(); }) },
    { label: 'テーマを削除', danger: true, onClick: () => {
      const ts = Object.values(S.trees).filter(t => t.projectId === pid);
      confirmModal('テーマを削除', `テーマ「${esc(p.name)}」を削除します。${ts.length ? `中の <b>${ts.length}件</b> のツリーは削除されず「未分類」に移ります。` : ''}`, () => {
        for (const t of ts) { t.projectId = null; scheduleSave(t); }
        delete S.projects[pid]; DB.del(pid, 'projects').catch(console.error); renderList(); toast('テーマを削除しました');
      }, { ok: '削除する', danger: true });
    } }
  ]);
}
function showNew(pid){
  const opts = [`<option value="">未分類</option>`].concat(sortedProjects().map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`)).join('');
  openModal(`<h2>新しいツリー</h2>
    <div class="field"><label for="nName">ツリー名</label><input type="text" id="nName" value="無題のツリー" enterkeyhint="done"></div>
    <div class="field"><label for="nProj">テーマ</label><select id="nProj" style="width:100%;min-height:44px;border:1px solid var(--line2);border-radius:10px;padding:0 10px;background:#fff;font-size:16px">${opts}</select></div>
    <div class="field"><span class="lbl">向き</span><div class="radios"><label><input type="radio" name="nDir" value="h" checked>左→右</label><label><input type="radio" name="nDir" value="v">上→下</label></div></div>
    <div class="btns end"><button data-x>キャンセル</button><button data-ok class="primary">作成</button></div>`, m => {
    const name = m.querySelector('#nName');
    const create = () => {
      const proj = m.querySelector('#nProj').value || null;
      const t = newTree(name.value.trim() || '無題のツリー', m.querySelector('input[name=nDir]:checked').value, proj);
      if (proj && S.projects[proj].collapsed) { S.projects[proj].collapsed = false; saveProject(S.projects[proj]); }
      S.trees[t.id] = t; scheduleSave(t);
      openTree(t.id); S.view = 'outline';
      render(); startEdit(t.rootId);
    };
    m.querySelector('[data-ok]').onclick = create;
    name.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); create(); } });
  });
}

/* ============ 編集画面 ============ */
function renderEditor(){
  const t = T();
  app.innerHTML = `<div class="screen" id="editor">
    <div class="bar">
      <button class="ghost icon" data-act="back" aria-label="一覧に戻る">‹</button>
      <button class="ttl" data-act="rename">${esc(t.title || '無題')}</button>
      <button class="ghost icon" data-act="undo" aria-label="元に戻す">↶</button>
      <button class="ghost icon" data-act="redo" aria-label="やり直し">↷</button>
      <button class="ghost icon" data-act="menu" aria-label="メニュー">⋯</button>
    </div>
    <div id="banners">${bannersHTML()}</div>
    <div class="seg"><button data-view="outline">アウトライン</button><button data-view="tree">ツリー図</button></div>
    <div id="body" style="flex:1;display:flex;flex-direction:column;min-height:0;position:relative"></div>
    <div id="toolbar"></div>
  </div>`;
  bindBanners(app);
  const bar = app.querySelector('.bar');
  bar.querySelector('[data-act=back]').onclick = () => { endEdit(); flushSave(); S.cur = null; go('list'); };
  bar.querySelector('[data-act=rename]').onclick = () => { endEdit(); promptModal('ツリー名', T().title, 'ツリー名', v => { mutate(t => { t.title = v; }); renderEditor(); }); };
  bar.querySelector('[data-act=undo]').onclick = undo;
  bar.querySelector('[data-act=redo]').onclick = redo;
  bar.querySelector('[data-act=menu]').onclick = editorMenu;
  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { if (S.view === b.dataset.view) return; endEdit(); S.view = b.dataset.view; meta.set('view', S.view); S.fitPending = true; renderEditorBody(); });
  renderEditorBody();
}
function renderEditorBody(){
  const t = T(); if (!t) return;
  if (S.sel && !t.nodes[S.sel]) S.sel = null;
  app.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
  const ttl = app.querySelector('.bar .ttl'); if (ttl) ttl.textContent = t.title || '無題';
  app.querySelector('[data-act=undo]').disabled = !H.canUndo(t.id);
  app.querySelector('[data-act=redo]').disabled = !H.canRedo(t.id);
  if (S.view === 'tree') renderTree(); else renderOutline();
  renderToolbar();
}
function editorMenu(){
  endEdit();
  const t = T();
  const items = [{ head: '表示する階層' }];
  for (const k of [1, 2, 3, 4, 0]) items.push({ label: k ? `${k}層まで` : 'すべて', onClick: () => { mutate(t => ops.setLevel(t, k)); if (S.sel && !visibleIds(T()).includes(S.sel)) S.sel = null; S.fitPending = true; renderEditorBody(); } });
  items.push({ head: 'ツリー' });
  items.push({ label: `向き：${t.direction === 'v' ? '上→下' : '左→右'}（切り替える）`, onClick: () => { mutate(t => { t.direction = t.direction === 'v' ? 'h' : 'v'; }); S.tempV = false; S.fitPending = true; renderEditorBody(); } });
  items.push({ label: '階層見出しの名前', onClick: showLevelLabels });
  items.push({ label: '画像を出力', onClick: showExport });
  actionSheet(t.title || '無題', items);
}
function visibleIds(t){ const cm = childMap(t), out = []; const walk = id => { out.push(id); if (!t.nodes[id].collapsed) for (const k of cm[id] || []) walk(k.id); }; walk(t.rootId); return out; }

/* ---------- アウトライン表示 ---------- */
function renderOutline(){
  const t = T(), body = $('#body'), cm = childMap(t);
  const prevScroll = body.querySelector('.scroll') ? body.querySelector('.scroll').scrollTop : null;
  let rows = '';
  const walk = (id, d) => {
    const n = t.nodes[id], ks = cm[id] || [], c = COLORS[n.color] || COLORS.auto;
    const ind = Math.min(d, 8) * 18;
    const editing = S.editing === id;
    const txtCls = ['txt', n.text ? '' : 'ph', n.priority === 'high' ? 'high' : '', n.priority === 'low' ? 'low' : ''].join(' ');
    rows += `<div class="row ${S.sel === id ? 'sel' : ''} ${id === t.rootId ? 'root-row' : ''}" data-id="${id}" style="--ind:${ind}px">`
      + (d > 8 ? `<span class="lv">${d}</span>` : '')
      + `<button class="caret ${ks.length ? '' : 'none'}" data-caret="${id}" aria-label="${n.collapsed ? '展開' : '折りたたむ'}">${n.collapsed ? '▶' : '▼'}</button>`
      + `<span class="mark" style="${c.stroke ? `background:${c.stroke}` : n.priority === 'high' ? 'background:#6B7280' : ''}${n.priority === 'low' && !c.stroke ? ';border:1.5px dashed #9AA3AF;background:transparent' : ''}"></span>`
      + (editing ? `<textarea class="ed" rows="1" enterkeyhint="next" placeholder="${esc(placeholder(t, n))}">${esc(n.text)}</textarea>`
                 : `<div class="${txtCls}">${esc(n.text || placeholder(t, n))}${n.collapsed && ks.length ? ` <span style="color:var(--accent);font-size:12px;font-weight:700">（${descendants(t, id).length}）</span>` : ''}</div>`)
      + (n.note || n.link ? `<span class="memo" title="メモあり"></span>` : '')
      + `</div>`;
    if (!n.collapsed) for (const k of ks) walk(k.id, d + 1);
  };
  walk(t.rootId, 0);
  body.innerHTML = `<div class="scroll" id="outScroll"><div class="outline" id="outline">${rows}</div></div>`;
  const sc = body.querySelector('.scroll');
  if (prevScroll != null) sc.scrollTop = prevScroll;
  bindOutline(sc);
  if (S.editing) focusEditor();
}
function rowEl(id){ return app.querySelector(`.row[data-id="${CSS.escape(id)}"]`); }
function scrollRowIntoView(id){
  const el = rowEl(id), sc = $('#outScroll'); if (!el || !sc) return;
  const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  const bottom = sr.bottom - kbHeight() - 80;
  if (r.top < sr.top + 8) sc.scrollTop -= sr.top + 8 - r.top;
  else if (r.bottom > bottom) sc.scrollTop += r.bottom - bottom;
}
function select(id){
  if (S.editing && S.editing !== id) commitEdit();
  S.sel = id;
  if (S.view === 'outline') {
    app.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel'));
    const el = rowEl(id); if (el) el.classList.add('sel');
    renderToolbar(); scrollRowIntoView(id);
  } else { renderTree(); renderToolbar(); }
}

/* 文言の編集（アウトラインの行の中で直接） */
function startEdit(id, opts = {}){
  const t = T(); if (!t || !t.nodes[id]) return;
  if (S.editing && S.editing !== id) commitEdit({ render: false });
  S.sel = id; S.editing = id; S.editNew = !!opts.isNew;
  if (S.view === 'tree') S.treeEditStart = true;
  S.editOrig = t.nodes[id].text; S.editBefore = opts.isNew ? null : snapshot(t);
  S.caret = null;
  renderEditorBody();
}
function editorEl(){ return app.querySelector('textarea.ed'); }
function autosize(ta){ ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function focusEditor(){
  const ta = editorEl(); if (!ta) return;
  const inTree = ta.classList.contains('ted');
  if (!inTree) autosize(ta);
  if (document.activeElement !== ta) {
    ta.focus({ preventScroll: true });
    const p = S.caret == null ? ta.value.length : S.caret;
    try { ta.setSelectionRange(p, p); } catch {}
  }
  if (!ta._bound) {
    ta._bound = true;
    ta.addEventListener('input', () => { syncEditText(); if (inTree) redrawTreeSoon(); else autosize(ta); });
    ta.addEventListener('keydown', editorKey);
    ta.addEventListener('blur', () => { if (S.keepFocus) return; setTimeout(() => { if (S.editing && document.activeElement !== editorEl()) { commitEdit(); } }, 0); });
  }
  requestAnimationFrame(() => inTree ? ensureTreeEditVisible() : scrollRowIntoView(S.editing));
}
function syncEditText(){
  const t = T(), ta = editorEl(); if (!t || !S.editing || !ta || !t.nodes[S.editing]) return;
  if (t.nodes[S.editing].text !== ta.value) { t.nodes[S.editing].text = ta.value; t.updatedAt = Date.now(); scheduleSave(t); }
  S.caret = ta.selectionStart;
}
// 確定する。opts.render=false なら描き直さない
function commitEdit(opts = {}){
  if (!S.editing) return;
  syncEditText();
  const t = T(), id = S.editing;
  S.editing = null; S.caret = null;
  if (t && t.nodes[id]) {
    const val = t.nodes[id].text.replace(/\s+$/, '');
    t.nodes[id].text = val;
    if (val !== S.editOrig) { if (!S.editNew && S.editBefore) H.push(t.id, S.editBefore); t.updatedAt = Date.now(); scheduleSave(t); }
  }
  S.editNew = false; S.editBefore = null; S.lastKey = null;
  if (opts.render !== false && S.screen === 'editor') renderEditorBody();
}
function endEdit(){ if (S.editing) { commitEdit({ render: false }); const ta = editorEl(); if (ta) ta.blur(); } }
function editorKey(e){
  if (e.isComposing || e.keyCode === 229) return;
  const t = T(), id = S.editing;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const ta = editorEl(), empty = !ta.value.trim();
    if (empty && S.editNew && id !== t.rootId) {
      // 空のまま改行：追加したノードを取り消して編集を終える
      S.editing = null; const back = H.dropLast(t.id);
      if (back) Object.assign(t, JSON.parse(back));
      S.sel = t.nodes[id] ? id : (S.selBeforeNew && t.nodes[S.selBeforeNew] ? S.selBeforeNew : t.rootId);
      S.editNew = false; scheduleSave(t); ta.blur(); renderEditorBody(); return;
    }
    if (empty) { commitEdit(); ta.blur(); return; }
    // 確定して、続けて次のノードを追加（トップイシューなら子、それ以外は兄弟）
    commitEdit({ render: false });
    addNode(id === t.rootId ? 'child' : 'sibling', id);
  } else if (e.key === 'Backspace' && editorEl().value === '' && id !== t.rootId && !kids(t, id).length) {
    e.preventDefault();
    const vis = visibleIds(t), prev = vis[vis.indexOf(id) - 1] || t.rootId;
    S.editing = null; S.editNew = false;
    mutate(t => ops.remove(t, id), { render: false });
    S.sel = prev; startEdit(prev);
  } else if (e.key === 'Escape') { e.preventDefault(); commitEdit(); }
}

/* アウトラインのタッチ操作：タップ・左右スワイプ・長押しドラッグ */
function bindOutline(sc){
  const ol = sc.querySelector('.outline');
  ol.addEventListener('click', e => {
    if (S.suppressClick) { S.suppressClick = false; return; }
    const cr = e.target.closest('[data-caret]');
    if (cr) { const id = cr.dataset.caret; endEdit(); mutate(t => ops.toggle(t, id)); return; }
    if (e.target.closest('textarea')) return;
    const row = e.target.closest('.row'); if (!row) return;
    const id = row.dataset.id;
    if (S.sel === id && S.editing !== id) startEdit(id);
    else if (S.editing !== id) select(id);
  });
  let g = null;
  const start = (x, y, target) => {
    const row = target.closest('.row'); if (!row || target.closest('textarea') || target.closest('[data-caret]')) return;
    g = { id: row.dataset.id, row, x0: x, y0: y, x, y, mode: 'pending' };
    g.timer = setTimeout(() => { if (g && g.mode === 'pending' && g.id !== T().rootId) beginDrag(g); }, 450);
  };
  const move = (x, y, ev) => {
    if (!g) return;
    g.x = x; g.y = y;
    const dx = x - g.x0, dy = y - g.y0;
    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) > 8) clearTimeout(g.timer);
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && g.id !== T().rootId && !S.editing) g.mode = 'swipe';
      else if (Math.abs(dy) > 10) { clearTimeout(g.timer); g = null; return; }
    }
    if (g.mode === 'swipe') { ev && ev.cancelable && ev.preventDefault(); g.row.style.transform = `translateX(${clamp(dx, -70, 70)}px)`; g.row.style.transition = 'none'; }
    else if (g.mode === 'drag') { ev && ev.cancelable && ev.preventDefault(); dragMove(g, x, y); }
  };
  const end = cancel => {
    if (!g) return;
    clearTimeout(g.timer);
    const dx = g.x - g.x0;
    if (g.mode === 'swipe') {
      g.row.style.transition = 'transform .15s'; g.row.style.transform = '';
      S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 400);
      if (!cancel && Math.abs(dx) > 50) { const id = g.id; S.sel = id; mutate(t => dx > 0 ? ops.indent(t, id) : ops.outdent(t, id)); }
    } else if (g.mode === 'drag') { S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 400); endDrag(g, cancel); }
    g = null;
  };
  ol.addEventListener('touchstart', e => { if (e.touches.length > 1) { if (g) end(true); return; } const p = e.touches[0]; start(p.clientX, p.clientY, e.target); }, { passive: true });
  ol.addEventListener('touchmove', e => { const p = e.touches[0]; move(p.clientX, p.clientY, e); }, { passive: false });
  ol.addEventListener('touchend', () => end(false));
  ol.addEventListener('touchcancel', () => end(true));
  // パソコンでの確認用（マウス）
  ol.addEventListener('mousedown', e => { if (e.button === 0) start(e.clientX, e.clientY, e.target); });
  window.onmousemove = e => { if (g) move(e.clientX, e.clientY, null); };
  window.onmouseup = () => end(false);
  ol.addEventListener('contextmenu', e => e.preventDefault());
}
function beginDrag(g){
  endEdit();
  g.mode = 'drag'; g.row.classList.add('dragging');
  S.sel = g.id; app.querySelectorAll('.row.sel').forEach(r => r.classList.remove('sel')); g.row.classList.add('sel');
  renderToolbar();
  const gh = $('#ghost'); gh.textContent = labelOf(T(), g.id, 30); gh.style.display = 'block';
  dragMove(g, g.x, g.y);
}
function dragMove(g, x, y){
  const gh = $('#ghost'); gh.style.left = (x + 12) + 'px'; gh.style.top = (y - 40) + 'px';
  app.querySelectorAll('.drop-child,.drop-before,.drop-after').forEach(r => r.classList.remove('drop-child', 'drop-before', 'drop-after'));
  g.drop = null;
  const el = document.elementFromPoint(20, y), row = el && el.closest('.row');
  const t = T();
  if (row && row.dataset.id !== g.id && !descendants(t, g.id).includes(row.dataset.id)) {
    const r = row.getBoundingClientRect(), rel = (y - r.top) / r.height;
    let zone = rel < 0.3 ? 'before' : rel > 0.7 ? 'after' : 'child';
    if (row.dataset.id === t.rootId) zone = 'child';
    row.classList.add('drop-' + zone); g.drop = { target: row.dataset.id, zone };
  }
  // 端に近づいたら自動でスクロール（指を動かし始めてから。下端はツールバーの上）
  const sc = $('#outScroll'), sr = sc.getBoundingClientRect(), tb = $('#toolbar .toolbar');
  const bottom = tb ? tb.getBoundingClientRect().top : sr.bottom;
  clearInterval(g.auto);
  if (Math.abs(y - g.y0) < 20) return;
  const edge = y < sr.top + 40 && y < g.y0 ? -10 : y > bottom - 40 && y > g.y0 ? 10 : 0;
  if (edge) g.auto = setInterval(() => { sc.scrollTop += edge; }, 30);
}
function endDrag(g, cancel){
  clearInterval(g.auto);
  $('#ghost').style.display = 'none';
  g.row.classList.remove('dragging');
  app.querySelectorAll('.drop-child,.drop-before,.drop-after').forEach(r => r.classList.remove('drop-child', 'drop-before', 'drop-after'));
  if (!cancel && g.drop) { const { target, zone } = g.drop, id = g.id; mutate(t => ops.moveTo(t, id, target, zone)); }
}

/* ---------- ツリー図表示（PC版と同じ図。ピンチで拡大縮小、ドラッグで移動） ---------- */
const ZMIN = 0.3, ZMAX = 3;
function dirShown(t){ return S.tempV ? 'v' : t.direction; }
function renderTree(){
  const t = T(), body = $('#body');
  let wrap = body.querySelector('.treewrap');
  if (!wrap) {
    body.innerHTML = `<div class="treewrap" id="treewrap"><svg xmlns="http://www.w3.org/2000/svg"><g id="vp"></g></svg><div class="chips" id="chips"></div><div class="zoombox"><button data-z="fit">全体</button></div></div>`;
    wrap = body.querySelector('.treewrap');
    bindTree(wrap);
    wrap.querySelector('[data-z=fit]').onclick = () => { fitTree(); applyView(); };
  }
  const Ly = S.layout = computeLayout(t, true, dirShown(t));
  wrap.querySelector('#vp').innerHTML = treeSVGInner(t, Ly, { ui: true, sel: S.sel });
  // 縦持ちで左→右のツリーを見るときは、上→下での表示を提案する（データの向きは変えない）
  const chips = wrap.querySelector('#chips');
  let c = '';
  if (S.tempV) c = `<button class="chip" data-chip="orig">元の向き（左→右）に戻す</button>`;
  else if (t.direction === 'h' && isPortrait() && !S.chipHidden) c = `<button class="chip" data-chip="v">上→下で表示する</button><button class="chip" data-chip="hide" aria-label="閉じる">×</button>`;
  chips.innerHTML = c;
  chips.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => {
    const k = b.dataset.chip;
    if (k === 'v') { S.tempV = true; S.fitPending = true; } else if (k === 'orig') { S.tempV = false; S.fitPending = true; } else S.chipHidden = true;
    renderTree();
  });
  wrap.style.setProperty('--tb', S.sel ? '64px' : '0px');
  if (S.fitPending) { S.fitPending = false; fitTree(true); }
  // 編集を始めたときは、文字が読める大きさ（16px以上）まで拡大する
  if (S.treeEditStart && S.editing && S.layout.pos[S.editing]) {
    S.treeEditStart = false;
    if (S.zoom < EDIT_ZOOM) {
      const p = S.layout.pos[S.editing], b = S.layout.boxes[S.editing];
      zoomAt(EDIT_ZOOM, S.panX + (p.x + b.w / 2) * S.zoom, S.panY + (p.y + b.h / 2) * S.zoom);
    }
  }
  applyView();
  syncTreeEditor();
  if (S.editing) focusEditor();
}
const EDIT_ZOOM = 16 / 13; // 入力欄の文字を16pxにする倍率（iPhoneが入力時に勝手に拡大しない大きさ）
function applyView(){ const vp = $('#vp'); if (vp) vp.setAttribute('transform', `translate(${S.panX} ${S.panY}) scale(${S.zoom})`); positionTreeEditor(); }
// 編集中のノードの枠の上に、同じ大きさ・同じ文字組みの入力欄を置く
function syncTreeEditor(){
  const wrap = $('#treewrap'); if (!wrap) return;
  let ta = wrap.querySelector('textarea.ted');
  const t = T();
  if (!S.editing || S.view !== 'tree' || !t || !t.nodes[S.editing] || !S.layout.pos[S.editing]) { if (ta) ta.remove(); return; }
  const n = t.nodes[S.editing];
  if (!ta || ta.dataset.id !== S.editing) {
    if (ta) ta.remove();
    ta = document.createElement('textarea');
    ta.className = 'ed ted'; ta.rows = 1; ta.dataset.id = S.editing;
    ta.setAttribute('enterkeyhint', 'next'); ta.setAttribute('aria-label', 'ノードの文言');
    ta.placeholder = placeholder(t, n); ta.value = n.text;
    wrap.appendChild(ta);
  }
  positionTreeEditor();
}
function positionTreeEditor(){
  const ta = document.querySelector('#treewrap textarea.ted'); if (!ta || !S.layout) return;
  const id = ta.dataset.id, p = S.layout.pos[id], b = S.layout.boxes[id], n = T() && T().nodes[id];
  if (!p || !n) return;
  const z = S.zoom, L = LT.L, st = LT.nodeStyle(T(), n);
  Object.assign(ta.style, {
    left: (S.panX + p.x * z) + 'px', top: (S.panY + p.y * z) + 'px', width: (b.w * z) + 'px', height: (b.h * z) + 'px',
    fontSize: (L.font * z) + 'px', lineHeight: (L.line * z) + 'px', fontWeight: b.weight,
    // 枠線（2px）の分だけ内側の余白を減らし、改行位置を図と揃える
    padding: `${L.padY * z - 2}px ${(L.padX + 10) * z - 2}px ${L.padY * z - 2}px ${L.padX * z - 2}px`,
    borderRadius: (L.radius * z) + 'px', background: st.fill
  });
}
// 入力のたびに図を描き直す（枠の高さや周りのノードの位置が変わるため）
function redrawTreeSoon(){
  if (redrawTreeSoon.f) return;
  redrawTreeSoon.f = requestAnimationFrame(() => {
    redrawTreeSoon.f = 0;
    const t = T(), vp = $('#vp'); if (!t || !vp || S.view !== 'tree') return;
    S.layout = computeLayout(t, true, dirShown(t));
    vp.innerHTML = treeSVGInner(t, S.layout, { ui: true, sel: S.sel });
    positionTreeEditor(); ensureTreeEditVisible();
  });
}
// 編集中のノードが画面（キーボードとツールバーの上）に見えるように動かす
function ensureTreeEditVisible(){
  const wrap = $('#treewrap'); if (!wrap || !S.editing || !S.layout) return;
  const p = S.layout.pos[S.editing], b = S.layout.boxes[S.editing]; if (!p) return;
  const r = wrap.getBoundingClientRect(), z = S.zoom, vv = window.visualViewport;
  const visBottom = Math.min(r.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - 70;
  const top = r.top + S.panY + p.y * z, bottom = top + b.h * z, left = r.left + S.panX + p.x * z, right = left + b.w * z;
  let dx = 0, dy = 0;
  if (bottom > visBottom) dy = visBottom - bottom;
  if (top + dy < r.top + 12) dy = r.top + 12 - top;
  if (right > r.right - 12) dx = r.right - 12 - right;
  if (left + dx < r.left + 12) dx = r.left + 12 - left;
  if (dx || dy) { S.panX += dx; S.panY += dy; applyView(); }
}
// soft=true のときは、全体が小さくなりすぎる場合にトップイシューを左上（上端）に合わせる
function fitTree(soft){
  const wrap = $('#treewrap'), Ly = S.layout; if (!wrap || !Ly) return;
  const W = wrap.clientWidth, Hh = wrap.clientHeight - (S.sel ? 64 : 0), bd = Ly.bounds, pad = 20;
  const bw = bd.maxX - bd.minX, bh = bd.maxY - bd.minY;
  let z = Math.min((W - pad * 2) / bw, (Hh - pad * 2 - 40) / bh, 1.25);
  if (soft && z < 0.6) {
    z = 0.8;
    const r = Ly.pos[T().rootId], rb = Ly.boxes[T().rootId];
    S.zoom = z;
    if (Ly.H) {
      S.panX = pad - bd.minX * z; S.panY = pad + 44 - bd.minY * z;
      const rootY = (r.y + rb.h / 2) * z + S.panY;
      if (rootY > Hh * 0.7) S.panY -= rootY - Hh / 2;
    }
    else { S.panY = pad + 40 - bd.minY * z; S.panX = W / 2 - (r.x + rb.w / 2) * z; }
    return;
  }
  z = clamp(z, ZMIN, 1.25);
  S.zoom = z;
  S.panX = (W - bw * z) / 2 - bd.minX * z;
  S.panY = Math.max(pad + 40, (Hh - bh * z) / 2) - bd.minY * z;
}
function zoomAt(z, cx, cy){
  z = clamp(z, ZMIN, ZMAX);
  const wx = (cx - S.panX) / S.zoom, wy = (cy - S.panY) / S.zoom;
  S.zoom = z; S.panX = cx - wx * z; S.panY = cy - wy * z;
}
function treeTap(x, y, target){
  const wrap = $('#treewrap'), r = wrap.getBoundingClientRect();
  const tg = target.closest && target.closest('[data-toggle]');
  if (tg) { const id = tg.dataset.toggle; mutate(t => ops.toggle(t, id)); return; }
  const hd = target.closest && target.closest('[data-hdr]');
  if (hd) return editLevelLabel(+hd.dataset.hdr);
  const nd = target.closest && target.closest('[data-id]');
  if (nd) {
    const id = nd.dataset.id;
    if (S.editing === id) return;
    if (S.sel === id && !S.editing) return startEdit(id);
    if (S.editing) commitEdit({ render: false });
    S.sel = id; renderTree(); renderToolbar(); return;
  }
  if (S.editing) { commitEdit(); return; }
  if (S.sel) { S.sel = null; renderTree(); renderToolbar(); }
}
function bindTree(wrap){
  let g = null, lastTap = 0, lastXY = null;
  const rect = () => wrap.getBoundingClientRect();
  const onButton = e => e.target.closest && e.target.closest('button,textarea');
  wrap.addEventListener('touchstart', e => {
    if (onButton(e)) { g = null; return; }
    e.preventDefault();
    const r = rect();
    if (e.touches.length === 1) { const p = e.touches[0]; g = { mode: 'pan', x0: p.clientX, y0: p.clientY, px: S.panX, py: S.panY, moved: false, target: e.target, t0: Date.now() }; }
    else if (e.touches.length === 2) {
      const [a, b] = e.touches;
      g = { mode: 'pinch', d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: S.zoom, cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, px: S.panX, py: S.panY, moved: true };
    }
  }, { passive: false });
  wrap.addEventListener('touchmove', e => {
    if (!g) return; e.preventDefault();
    const r = rect();
    if (g.mode === 'pan' && e.touches.length === 1) {
      const p = e.touches[0], dx = p.clientX - g.x0, dy = p.clientY - g.y0;
      if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (g.moved) { S.panX = g.px + dx; S.panY = g.py + dy; applyView(); }
    } else if (g.mode === 'pinch' && e.touches.length === 2) {
      const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
      const z = clamp(g.z0 * d / g.d0, ZMIN, ZMAX);
      const wx = (g.cx - g.px) / g.z0, wy = (g.cy - g.py) / g.z0;
      S.zoom = z; S.panX = cx - wx * z; S.panY = cy - wy * z; applyView();
    }
  }, { passive: false });
  wrap.addEventListener('touchend', e => {
    if (!g) return;
    e.preventDefault();
    if (e.touches.length) { if (g.mode === 'pinch' && e.touches.length === 1) { const p = e.touches[0]; g = { mode: 'pan', x0: p.clientX, y0: p.clientY, px: S.panX, py: S.panY, moved: true }; } return; }
    if (g.mode === 'pan' && !g.moved && Date.now() - g.t0 < 500) {
      const now = Date.now(), r = rect();
      const p = e.changedTouches[0];
      const onNode = g.target.closest && g.target.closest('[data-id],[data-toggle],[data-hdr]');
      if (onNode) { lastTap = 0; treeTap(p.clientX, p.clientY, g.target); }
      else if (now - lastTap < 300 && lastXY && Math.hypot(p.clientX - lastXY[0], p.clientY - lastXY[1]) < 30) {
        // ダブルタップ：その場所を中心に拡大（拡大済みなら全体表示）
        lastTap = 0;
        if (S.zoom >= 1.4) fitTree(); else zoomAt(Math.max(1.5, S.zoom * 1.6), p.clientX - r.left, p.clientY - r.top);
        applyView();
      } else { lastTap = now; lastXY = [p.clientX, p.clientY]; treeTap(p.clientX, p.clientY, g.target); }
    }
    g = null;
  }, { passive: false });
  wrap.addEventListener('touchcancel', () => { g = null; });
  // パソコンでの確認用（マウス・ホイール）
  wrap.addEventListener('mousedown', e => { if (onButton(e)) return; g = { mode: 'pan', x0: e.clientX, y0: e.clientY, px: S.panX, py: S.panY, moved: false, target: e.target, mouse: true }; });
  wrap.addEventListener('mousemove', e => { if (!g || !g.mouse) return; const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.hypot(dx, dy) > 4) g.moved = true; if (g.moved) { S.panX = g.px + dx; S.panY = g.py + dy; applyView(); } });
  wrap.addEventListener('mouseup', e => { if (g && g.mouse && !g.moved) treeTap(e.clientX, e.clientY, g.target); g = null; });
  wrap.addEventListener('wheel', e => { e.preventDefault(); const r = rect(); zoomAt(S.zoom * Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top); applyView(); }, { passive: false });
}
// Safari標準の画面拡大（ピンチ）を止める
document.addEventListener('gesturestart', e => e.preventDefault());

/* ---------- 下部ツールバー ---------- */
function renderToolbar(){
  const el = $('#toolbar'); if (!el) return;
  const t = T();
  if (S.editing) {
    const isRoot = S.editing === t.rootId;
    el.innerHTML = `<div class="toolbar kb">
      <button data-tb="nl">⏎<small>改行</small></button>
      <button data-tb="out" ${isRoot ? 'disabled' : ''}>←<small>上げる</small></button>
      <button data-tb="in" ${isRoot ? 'disabled' : ''}>→<small>下げる</small></button>
      <button data-tb="child">＋<small>子</small></button>
      <button data-tb="done" style="font-weight:700;color:var(--accent);font-size:15px">完了</button>
    </div>`;
  } else if (S.sel && t.nodes[S.sel]) {
    const isRoot = S.sel === t.rootId;
    el.innerHTML = `<div class="toolbar">
      <button data-tb="child">＋<small>子</small></button>
      <button data-tb="sib" ${isRoot ? 'disabled' : ''}>＋<small>兄弟</small></button>
      <button data-tb="out" ${isRoot ? 'disabled' : ''}>←<small>上げる</small></button>
      <button data-tb="in" ${isRoot ? 'disabled' : ''}>→<small>下げる</small></button>
      <button data-tb="up" ${isRoot ? 'disabled' : ''}>↑<small>上へ</small></button>
      <button data-tb="down" ${isRoot ? 'disabled' : ''}>↓<small>下へ</small></button>
      <button data-tb="detail">≡<small>詳細</small></button>
    </div>`;
  } else { el.innerHTML = ''; return; }
  const bar = el.firstElementChild;
  // 編集中はボタンを押してもキーボードを閉じない
  bar.addEventListener('mousedown', e => { if (S.editing) e.preventDefault(); });
  bar.addEventListener('touchstart', () => { if (S.editing) S.keepFocus = true; }, { passive: true });
  bar.addEventListener('touchend', e => { if (S.editing) { const b = e.target.closest('button'); e.preventDefault(); S.keepFocus = false; if (b && !b.disabled) toolbarAction(b.dataset.tb); } }, { passive: false });
  bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) toolbarAction(b.dataset.tb); });
}
function toolbarAction(k){
  const t = T(); if (!t) return;
  const id = S.editing || S.sel; if (!id || !t.nodes[id]) return;
  if (S.editing) {
    if (k === 'nl') { const ta = editorEl(); ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end'); syncEditText(); autosize(ta); ta.focus(); return; }
    if (k === 'done') { commitEdit(); const ta = editorEl(); if (ta) ta.blur(); document.activeElement && document.activeElement.blur(); return; }
    syncEditText(); S.caret = editorEl().selectionStart;
    if (k === 'child') { commitEdit({ render: false }); return addNode('child', id); }
    // 編集を続けたまま階層を変える。ここまでの文言の変更は別の「元に戻す」単位にする
    if (!S.editNew && S.editBefore && t.nodes[id].text !== S.editOrig) H.push(t.id, S.editBefore);
    const r = mutate(t => k === 'in' ? ops.indent(t, id) : ops.outdent(t, id), { render: false });
    S.editNew = false; S.editOrig = t.nodes[id].text; S.editBefore = snapshot(t);
    renderEditorBody(); return r;
  }
  if (k === 'child') return addNode('child', id);
  if (k === 'sib') return addNode('sibling', id);
  if (k === 'in' || k === 'out') return mutate(t => k === 'in' ? ops.indent(t, id) : ops.outdent(t, id));
  if (k === 'up' || k === 'down') { mutate(t => ops.moveSibling(t, id, k === 'up' ? -1 : 1)); if (S.view === 'outline') scrollRowIntoView(id); return; }
  if (k === 'detail') return openSheet(id);
}
// 追加して、すぐ入力を始める
function addNode(kind, from){
  const t = T(); S.selBeforeNew = from;
  const r = mutate(t => kind === 'child' ? ops.addChild(t, from) : ops.addSibling(t, from), { render: false });
  if (!r || !r.id) return;
  startEdit(r.id, { isNew: true });
}

/* ---------- ノード詳細（下から出るシート） ---------- */
function openSheet(id, opts = {}){ endEdit(); S.sheet = { id, focusText: !!opts.focusText }; renderSheet(); }
function closeSheet(silent){ if (!S.sheet) return; S.sheet = null; if (overlay.firstChild && overlay.firstChild.dataset.kind === 'sheet') overlay.innerHTML = ''; if (!silent) renderMain(); }
function renderSheet(){
  const t = T(); if (!S.sheet || !t || !t.nodes[S.sheet.id]) { if (S.sheet) closeSheet(true); return; }
  const n = t.nodes[S.sheet.id], id = n.id, isRoot = id === t.rootId;
  const kc = kids(t, id).length, dc = descendants(t, id).length;
  const safeLink = /^https?:\/\//i.test(n.link) ? n.link : '';
  const keepScroll = overlay.querySelector('.sheet') ? overlay.querySelector('.sheet').scrollTop : 0;
  overlay.innerHTML = `<div class="backdrop" data-kind="sheet"><div class="sheet" role="dialog" aria-modal="true">
    <div class="grab"></div>
    <h2><span>${esc(levelLabel(t, depthOf(t, id)))}</span><button class="ghost icon" data-x aria-label="閉じる">×</button></h2>
    <div class="field"><label for="pText">文言</label><textarea id="pText" rows="3" placeholder="${esc(placeholder(t, n))}">${esc(n.text)}</textarea></div>
    <div class="field"><label>重要度</label><div class="opts">${Object.entries(PRIORITY).map(([k, v]) => `<button data-priority="${k}" class="${n.priority === k ? 'on' : ''}">${v}${k === 'high' ? '（太字・太枠）' : k === 'low' ? '（点線）' : ''}</button>`).join('')}</div></div>
    <div class="field"><label>色</label><div class="swatches">${Object.entries(COLORS).map(([k, v]) => `<button class="sw ${k === 'auto' ? 'auto' : ''} ${n.color === k ? 'on' : ''}" data-color="${k}" aria-label="${v.label}" style="${v.fill ? `background:${v.fill};border-color:${v.stroke}` : ''}"></button>`).join('')}</div></div>
    <div class="field"><label for="pNote">メモ・根拠</label><textarea id="pNote" rows="4" placeholder="検証方法、データの出典など（図には表示されません）">${esc(n.note)}</textarea></div>
    <div class="field"><label for="pLink">根拠リンク</label><input id="pLink" type="url" inputmode="url" autocapitalize="off" placeholder="https://..." value="${esc(n.link)}">${safeLink ? `<div style="margin-top:8px"><a href="${esc(safeLink)}" target="_blank" rel="noopener">リンクを開く ↗</a></div>` : ''}</div>
    <div class="meta" style="margin-bottom:12px">子ノード：${kc}件　配下の合計：${dc}件</div>
    <div class="btns"><button data-s="child">＋ 子を追加</button>${isRoot ? '' : `<button data-s="sib">＋ 兄弟を追加</button><button data-s="move">移動先を選ぶ</button><button data-s="del" class="danger">削除</button>`}</div>
  </div></div>`;
  const bd = overlay.firstChild, sh = bd.firstChild;
  sh.scrollTop = keepScroll;
  bd.addEventListener('click', e => { if (e.target === bd) closeSheet(); });
  sh.querySelector('[data-x]').onclick = () => closeSheet();
  const bindText = (sel, field) => {
    const f = sh.querySelector(sel);
    f.addEventListener('input', () => mutate(t => { t.nodes[id][field] = f.value; }, { key: `${field}-${id}` }));
    f.addEventListener('blur', () => { S.lastKey = null; if (field === 'link') renderSheet(); });
  };
  bindText('#pText', 'text'); bindText('#pNote', 'note'); bindText('#pLink', 'link');
  sh.querySelectorAll('[data-priority]').forEach(b => b.onclick = () => mutate(t => { t.nodes[id].priority = b.dataset.priority; }, { sheet: true }));
  sh.querySelectorAll('[data-color]').forEach(b => b.onclick = () => mutate(t => { t.nodes[id].color = b.dataset.color; }, { sheet: true }));
  sh.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    const k = b.dataset.s;
    if (k === 'child' || k === 'sib') { closeSheet(true); return addNode(k === 'child' ? 'child' : 'sibling', id); }
    if (k === 'move') return showMovePicker(id);
    if (k === 'del') return deleteNode(id);
  });
  if (S.sheet.focusText) { S.sheet.focusText = false; const f = sh.querySelector('#pText'); f.focus(); }
}
function deleteNode(id){
  const t = T(), dc = descendants(t, id).length;
  const go = () => { const r = mutate(t => ops.remove(t, id), { render: false }); if (r && r.next) S.sel = r.next; closeSheet(true); renderEditorBody(); };
  if (dc) confirmModal('ノードを削除', `「${esc(labelOf(t, id))}」と、配下の <b>${dc}件</b> のノードを削除します。`, go, { ok: '削除する', danger: true });
  else go();
}
function showMovePicker(id){
  const t = T(), bad = new Set([id, ...descendants(t, id)]), cm = childMap(t);
  let list = '';
  const walk = (nid, d) => { list += `<button class="pick" data-to="${nid}" ${bad.has(nid) || t.nodes[id].parentId === nid ? 'disabled' : ''} style="padding-left:${12 + Math.min(d, 8) * 16}px">${esc(labelOf(t, nid, 40))}</button>`; for (const k of cm[nid] || []) walk(k.id, d + 1); };
  walk(t.rootId, 0);
  openModal(`<h2>移動先を選ぶ</h2><p class="hint" style="margin-top:-6px">選んだノードの子（いちばん下）に移動します。</p><div style="margin:8px -20px">${list}</div><div class="btns end"><button data-x>キャンセル</button></div>`, m => {
    m.querySelectorAll('[data-to]').forEach(b => b.onclick = () => { const to = b.dataset.to; closeOverlay(); S.sheet = null; mutate(t => ops.moveTo(t, id, to, 'child'), { render: false }); S.sel = id; renderEditorBody(); toast('移動しました'); });
  });
}
function editLevelLabel(d){ const t = T(); promptModal(`見出し（${d === 0 ? 'トップイシュー' : d + '層目'}）`, levelLabel(t, d), '空にすると既定の名前に戻ります', v => setLevelLabel(d, v), { allowEmpty: true }); }
function setLevelLabel(d, v){ mutate(t => { const arr = (t.levelLabels || []).slice(); while (arr.length <= d) arr.push(''); arr[d] = v; t.levelLabels = arr; }); }
function showLevelLabels(){
  const t = T(), maxD = Math.max(...Object.keys(t.nodes).map(id => depthOf(t, id)));
  let rows = '';
  for (let d = 0; d <= maxD; d++) rows += `<div class="field"><label for="lv${d}">${d === 0 ? 'トップイシュー（0層目）' : d + '層目'}</label><input type="text" id="lv${d}" value="${esc((t.levelLabels || [])[d] || '')}" placeholder="${esc(d === 0 ? 'トップイシュー' : d + '層目')}"></div>`;
  openModal(`<h2>階層見出しの名前</h2><p class="hint" style="margin-top:-6px">ツリー図と画像の上に表示されます。空にすると既定の名前になります。</p>${rows}<div class="btns end"><button data-x>キャンセル</button><button data-ok class="primary">保存</button></div>`, m => {
    m.querySelector('[data-ok]').onclick = () => { const arr = []; for (let d = 0; d <= maxD; d++) arr.push(m.querySelector('#lv' + d).value.trim()); while (arr.length && !arr[arr.length - 1]) arr.pop(); closeOverlay(); mutate(t => { t.levelLabels = arr; }); };
  });
}

/* ============ 画像出力・共有 ============ */
function showExport(){
  const t = T(); endEdit();
  const anyCollapsed = Object.values(t.nodes).some(n => n.collapsed && kids(t, n.id).length);
  openModal(`<h2>画像を出力</h2>
    <div class="field"><span class="lbl">形式</span><div class="radios"><label><input type="radio" name="xf" value="png" checked>PNG</label><label><input type="radio" name="xf" value="svg">SVG</label></div></div>
    <div class="field" data-for="png"><span class="lbl">解像度</span><div class="radios"><label><input type="radio" name="xr" value="2" checked>2倍</label><label><input type="radio" name="xr" value="3">3倍</label><label><input type="radio" name="xr" value="4">4倍</label></div></div>
    <label class="check"><input type="checkbox" id="xHdr" checked>階層見出しを含める</label>
    <label class="check"><input type="checkbox" id="xTrans">背景を透過する</label>
    ${anyCollapsed ? '<p class="hint">折りたたんだノードの配下は出力されません。すべて出力するには、メニューの表示する階層で「すべて」を選んでください。</p>' : ''}
    <div id="xOut"></div>
    <div class="btns end"><button data-x>閉じる</button><button data-ok class="primary">作成</button></div>`, m => {
    const sync = () => { const f = m.querySelector('input[name=xf]:checked').value; m.querySelectorAll('[data-for]').forEach(r => r.style.display = r.dataset.for === f ? '' : 'none'); m.querySelector('#xOut').innerHTML = ''; };
    m.querySelectorAll('input').forEach(r => r.addEventListener('change', sync)); sync();
    const ok = m.querySelector('[data-ok]');
    ok.onclick = async () => {
      const f = m.querySelector('input[name=xf]:checked').value, trans = m.querySelector('#xTrans').checked, hdr = m.querySelector('#xHdr').checked;
      ok.disabled = true; ok.textContent = '作成中…';
      try {
        const base = safeName(t.title);
        let file, note = '';
        if (f === 'png') {
          const want = +m.querySelector('input[name=xr]:checked').value;
          const { blob, scale } = await LT.exportPNG(t, want, trans, hdr);
          file = new File([blob], base + '.png', { type: 'image/png' });
          if (scale < want) note = `図が大きいため、${scale}倍で作成しました。`;
        } else file = new File([LT.buildExportSVG(t, trans, hdr).svg], base + '.svg', { type: 'image/svg+xml' });
        const url = URL.createObjectURL(file);
        // 共有はタップの直後に呼ぶ必要があるため、作成と共有のボタンを分ける
        m.querySelector('#xOut').innerHTML = `<img class="preview" src="${url}" alt="プレビュー">${note ? `<p class="hint">${note}</p>` : ''}<button class="primary" data-share style="width:100%">共有・保存（${(file.size / 1024).toFixed(0)}KB）</button>`;
        m.querySelector('[data-share]').onclick = () => shareFile(file);
      } catch (e) { console.error(e); toast('作成に失敗しました：' + (e.message || e)); }
      ok.disabled = false; ok.textContent = '作り直す';
    };
  });
}
// 共有シートで渡す。使えない環境ではダウンロード。戻り値：渡せたら true
async function shareFile(file){
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return false; console.warn(e); }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('ファイルを書き出しました');
  return true;
}

/* ============ バックアップ・復元・設定 ============ */
async function doBackup(){
  // 共有シートはタップの直後に呼ぶ必要があるため、保存の完了は待たない
  endEdit(); flushSave();
  const trees = Object.values(S.trees); if (!trees.length) return toast('バックアップするツリーがありません');
  const file = new File([LT.buildBackup(Object.values(S.projects), trees)], LT.backupName(), { type: 'application/json' });
  const ok = await shareFile(file);
  if (ok) { S.kv.lastBackup = Date.now(); DB.kvSet('lastBackup', S.kv.lastBackup).catch(console.error); refreshBanners(); const el = overlay.querySelector('#lastBk'); if (el) el.textContent = fmtDate(S.kv.lastBackup); }
}
function pickRestore(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let data;
    try { data = LT.parseBackup(await f.text()); } catch (e) { return toast('読み込めませんでした：' + e.message); }
    const newP = data.projects.filter(p => !S.projects[p.id]).length, dup = data.trees.filter(t => S.trees[t.id]).length;
    confirmModal('バックアップから復元', `ツリー <b>${data.trees.length}件</b>、テーマ <b>${newP}件</b> を追加します。${dup ? `<br>すでにある ${dup}件 のツリーは、上書きせず「（読み込み）」を付けて別に追加します。` : ''}`, () => {
      for (const p of data.projects) if (!S.projects[p.id]) { S.projects[p.id] = p; saveProject(p); }
      for (const t of data.trees) {
        if (S.trees[t.id]) { t.id = uid(); t.title = (t.title || '無題') + '（読み込み）'; }
        if (t.projectId && !S.projects[t.projectId]) t.projectId = null;
        t.createdAt ||= Date.now(); t.updatedAt = Date.now();
        S.trees[t.id] = t; scheduleSave(t);
      }
      flushSave(); closeOverlay(); S.cur = null; go('list'); toast(`${data.trees.length}件のツリーを読み込みました`);
    }, { ok: '復元する' });
  };
  inp.click();
}
async function showSettings(){
  if (navigator.storage && navigator.storage.persisted) { try { S.persisted = await navigator.storage.persisted(); } catch {} }
  const mode = { idb: 'このiPhoneの中（IndexedDB）', ls: 'このiPhoneの中（localStorage）', memory: '保存できません（閉じると消えます）' }[DB.mode];
  const nT = Object.keys(S.trees).length, nN = Object.values(S.trees).reduce((a, t) => a + Object.keys(t.nodes).length, 0);
  openModal(`<h2>設定・データ</h2>
    <div class="meta">
      <div>保存先：<b>${mode}</b></div>
      <div>消えにくい保存：${S.persisted == null ? '—' : S.persisted ? '<b>有効</b>' : '無効（ホーム画面に追加すると有効になりやすくなります）'}</div>
      <div>ツリー：${nT}件（ノード ${nN}件）</div>
      <div>最終バックアップ：<span id="lastBk">${S.kv.lastBackup ? fmtDate(S.kv.lastBackup) : 'まだありません'}</span></div>
    </div>
    <p class="hint">データはこのiPhoneの中だけに保存され、外部には送信されません。アプリを削除したり、Safariのデータを消去したりすると消えるため、定期的にバックアップしてください。</p>
    <div class="btns" style="margin-top:14px;flex-direction:column"><button class="primary" data-a="bk">バックアップを作成（共有・保存）</button><button data-a="rs">バックアップから復元</button></div>
    <p class="hint">バックアップはPC版の「すべてバックアップ」と同じ形式です。</p>
    <div class="meta" style="margin-top:14px">バージョン：${APP_VERSION}${S.update ? '（新しいバージョンがあります）' : ''}</div>
    <div class="btns end">${S.update ? '<button data-a="up" class="primary">更新する</button>' : ''}<button data-x>閉じる</button></div>`, m => {
    m.querySelector('[data-a=bk]').onclick = doBackup;
    m.querySelector('[data-a=rs]').onclick = pickRestore;
    const up = m.querySelector('[data-a=up]'); if (up) up.onclick = applyUpdate;
  });
}

/* ============ 部品：モーダル・アクションシート・入力 ============ */
function closeOverlay(){ overlay.innerHTML = ''; S.sheet = null; }
function openModal(html, onMount){
  overlay.innerHTML = `<div class="backdrop center" data-kind="modal"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const bd = overlay.firstChild, m = bd.firstChild;
  bd.addEventListener('click', e => { if (e.target === bd) closeOverlay(); });
  m.querySelectorAll('[data-x]').forEach(b => b.onclick = closeOverlay);
  onMount && onMount(m);
}
function confirmModal(title, msg, onOk, opts = {}){
  openModal(`<h2>${esc(title)}</h2><div style="line-height:1.7">${msg}</div><div class="btns end"><button data-x>キャンセル</button><button data-ok class="${opts.danger ? 'danger solid' : 'primary'}">${esc(opts.ok || 'OK')}</button></div>`, m => {
    m.querySelector('[data-ok]').onclick = () => { closeOverlay(); onOk(); };
  });
}
function promptModal(title, value, hint, onOk, opts = {}){
  openModal(`<h2>${esc(title)}</h2><div class="field"><input type="text" id="pmIn" value="${esc(value || '')}" placeholder="${esc(hint || '')}" enterkeyhint="done"></div><div class="btns end"><button data-x>キャンセル</button><button data-ok class="primary">OK</button></div>`, m => {
    const inp = m.querySelector('#pmIn');
    const ok = () => { const v = inp.value.trim(); if (!v && !opts.allowEmpty) return toast('名前を入力してください'); closeOverlay(); onOk(v); };
    m.querySelector('[data-ok]').onclick = ok;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); ok(); } });
    inp.focus(); inp.select();
  });
}
function actionSheet(title, items){
  overlay.innerHTML = `<div class="backdrop" data-kind="actions"><div class="actwrap"><div class="actions">${title ? `<div class="ah">${esc(title)}</div>` : ''}${items.map((it, i) => it.head ? `<div class="ah" style="border-top:1px solid var(--line)">${esc(it.head)}</div>` : `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}">${it.on ? '✓ ' : ''}${esc(it.label)}</button>`).join('')}</div><button class="cancel" data-x>キャンセル</button></div></div>`;
  const bd = overlay.firstChild;
  bd.addEventListener('click', e => {
    if (e.target === bd || e.target.closest('[data-x]')) return closeOverlay();
    const b = e.target.closest('[data-i]'); if (b) { closeOverlay(); items[+b.dataset.i].onClick(); }
  });
}

/* ============ 画面上のキーボードへの追従 ============ */
function kbHeight(){ const vv = window.visualViewport; if (!vv) return 0; return Math.max(0, innerHeight - vv.height - vv.offsetTop); }
if (window.visualViewport) {
  const onVV = () => { const h = kbHeight(); document.documentElement.style.setProperty('--kb', (h > 80 ? h : 0) + 'px'); if (h > 80) window.scrollTo(0, 0); if (S.editing && S.view === 'tree') ensureTreeEditVisible(); };
  visualViewport.addEventListener('resize', onVV); visualViewport.addEventListener('scroll', onVV);
}
window.addEventListener('resize', () => { if (S.screen === 'editor' && S.view === 'tree') { if (S.editing) { positionTreeEditor(); ensureTreeEditVisible(); } else renderTree(); } });
window.addEventListener('orientationchange', () => setTimeout(() => { if (S.screen === 'editor' && !S.editing) { if (!isPortrait()) S.view = 'tree'; S.fitPending = true; renderEditorBody(); } }, 300));

/* ============ アプリの更新（Service Worker） ============ */
let swReg = null;
async function registerSW(){
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    const check = () => { if (swReg.waiting && navigator.serviceWorker.controller) { S.update = swReg.waiting; refreshBanners(); } };
    check();
    swReg.addEventListener('updatefound', () => { const w = swReg.installing; if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') check(); }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') swReg.update().catch(() => {}); });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updating && !reloading) { reloading = true; location.reload(); } });
  } catch (e) { console.warn('Service Worker を登録できませんでした', e); }
}
async function applyUpdate(){
  if (!S.update) return;
  endEdit(); await flushSave();
  S.updating = true; S.update.postMessage('skipWaiting');
}

/* ============ 起動 ============ */
(async function init(){
  await DB.init();
  try { for (const p of await DB.all('projects')) if (p && p.id) S.projects[p.id] = p; } catch (e) { console.error(e); }
  try { for (const t of await DB.all()) if (t && t.id && t.nodes && t.rootId && t.nodes[t.rootId]) S.trees[t.id] = normalizeTree(t); } catch (e) { console.error(e); }
  try { S.kv.lastBackup = await DB.kvGet('lastBackup'); S.kv.firstRun = await DB.kvGet('firstRun'); } catch (e) { console.error(e); }
  if (!S.kv.firstRun) { S.kv.firstRun = Date.now(); DB.kvSet('firstRun', S.kv.firstRun).catch(() => {}); }
  if (!Object.keys(S.trees).length && !meta.get('sample-done')) { const s = sampleTree(); S.trees[s.id] = s; scheduleSave(s); meta.set('sample-done', '1'); }
  const standalone = isStandalone() || new URLSearchParams(location.search).has('standalone');
  if (standalone && navigator.storage && navigator.storage.persist) { try { S.persisted = await navigator.storage.persist(); } catch {} }
  S.screen = standalone ? 'list' : 'install';
  render();
  registerSW();
})();
