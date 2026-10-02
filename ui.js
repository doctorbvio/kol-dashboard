/* KOL 看板 · 交互层：编辑器 / 拖拽 / CSV / 启动 */
(function () {
  'use strict';
  const { FIELDS, STAGES, CHECKLIST, state, $, el, isBlank, stageIdx } = window.KB;
  const R = window.KB_RENDER;

  /* ---------------- 编辑抽屉 ---------------- */
  let editingId = null;

  function fieldNode(f, value) {
    const wrap = el('div', 'field');
    wrap.appendChild(el('label', '', f.label + (f.required ? ' *' : '')));
    let input;
    if (f.type === 'bool') {
      input = el('input'); input.type = 'checkbox'; input.checked = !!value;
    } else if (f.type === 'select') {
      input = el('select');
      f.options.forEach(o => input.appendChild(new Option((f.optionLabels && f.optionLabels[o]) || o, o)));
      input.value = isBlank(value) ? f.options[0] : value;
    } else if (f.type === 'textarea') {
      input = el('textarea'); input.rows = 2; input.value = value || '';
    } else {
      input = el('input');
      input.type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
      input.value = value === undefined || value === null ? '' : value;
    }
    input.name = f.key;
    input.id = 'f_' + f.key;
    wrap.appendChild(input);
    if (f.hint) wrap.appendChild(el('div', 'hint', f.hint));
    return wrap;
  }

  function openDrawer(id) {
    const kol = (state.data.kols || []).find(k => k.id === id);
    if (!kol) return;
    editingId = id;
    $('#drawerTitle').textContent = '编辑 · ' + (kol.name || '未命名');
    const form = $('#form');
    form.replaceChildren();
    FIELDS.forEach(f => form.appendChild(fieldNode(f, kol[f.key])));
    const actions = el('div', 'form-actions');
    const del = el('button', 'danger', '删除该 KOL');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (!confirm('确认删除「' + (kol.name || '未命名') + '」？')) return;
      state.data.kols = state.data.kols.filter(x => x.id !== id);
      closeDrawer(); window.KB.touch();
    });
    const cancel = el('button', '', '取消'); cancel.type = 'button'; cancel.addEventListener('click', closeDrawer);
    const ok = el('button', 'primary', '应用改动'); ok.type = 'button';
    ok.addEventListener('click', () => {
      const patch = {};
      FIELDS.forEach(f => {
        const node = form.querySelector('#f_' + f.key);
        if (!node) return;
        if (f.type === 'bool') patch[f.key] = node.checked;
        else if (f.type === 'number') patch[f.key] = node.value === '' ? 0 : Number(node.value);
        else patch[f.key] = node.value.trim();
      });
      if (isBlank(patch.name)) { alert('KOL / 频道名不能为空'); return; }
      const idx = state.data.kols.findIndex(x => x.id === id);
      state.data.kols[idx] = Object.assign({}, state.data.kols[idx], patch);
      closeDrawer(); window.KB.touch();
    });
    actions.appendChild(del); actions.appendChild(cancel); actions.appendChild(ok);
    form.appendChild(actions);
    $('#drawer').hidden = false;
  }

  function closeDrawer() { editingId = null; $('#drawer').hidden = true; }

  function addKol() {
    const id = 'k' + Date.now().toString(36);
    const base = { id, name: '新 KOL（待命名）', platform: 'YouTube', country: '', wave: 'Wave 1', stage: 'outreach', checklist: 'not_started', nda_signed: false, need_splitter: false, followers: 0, avg_views_30d: 0 };
    state.data.kols.unshift(base);
    window.KB.touch();
    openDrawer(id);
  }

  /* ---------------- CSV ---------------- */
  const CSV_COLS = ['id', 'name', 'platform', 'url', 'followers', 'avg_views_30d', 'content_type', 'country', 'city', 'wave', 'timezone', 'receiving_language', 'computer', 'displays', 'need_splitter', 'nda_signed', 'nda_ref', 'serial', 'stage', 'checklist', 'deliverable_url', 'owner', 'next_action', 'next_due', 'notes'];

  function toCsv(list) {
    const esc = v => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [CSV_COLS.join(',')];
    list.forEach(k => lines.push(CSV_COLS.map(c => esc(k[c])).join(',')));
    return '\ufeff' + lines.join('\n') + '\n';
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', inQ = false;
    const src = text.replace(/^\ufeff/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { alert('CSV 至少要有表头 + 一行数据'); return; }
    const head = rows[0].map(h => h.trim());
    const unknown = head.filter(h => !CSV_COLS.includes(h));
    const records = rows.slice(1).map((r, i) => {
      const o = { id: 'k' + Date.now().toString(36) + i };
      head.forEach((h, j) => { if (CSV_COLS.includes(h)) o[h] = (r[j] || '').trim(); });
      ['followers', 'avg_views_30d'].forEach(k => { o[k] = Number(o[k] || 0) || 0; });
      ['need_splitter', 'nda_signed'].forEach(k => { o[k] = ['1', 'true', '是', 'yes', 'Y'].includes(String(o[k]).toLowerCase()); });
      o.stage = STAGES.some(s => s.key === o.stage) ? o.stage : 'outreach';
      o.checklist = CHECKLIST.some(c => c.key === o.checklist) ? o.checklist : 'not_started';
      o.name = o.name || '（未命名）';
      return o;
    });
    const mode = confirm('导入 ' + records.length + ' 行。\n\n确定 = 替换现有全部记录\n取消 = 追加到现有记录之后' + (unknown.length ? '\n\n（忽略未知列：' + unknown.join(', ') + '）' : ''));
    state.data.kols = mode ? records : (state.data.kols || []).concat(records);
    state.data.meta = state.data.meta || {};
    state.data.meta.data_state = 'live';
    state.data.meta.data_state_note = '真实名单已导入（' + new Date().toLocaleString('zh-CN') + '）';
    window.KB.touch();
    alert('已导入 ' + records.length + ' 行。别忘了点「保存」。');
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------------- 拖拽改阶段 ---------------- */
  function wireDnd() {
    document.addEventListener('dragstart', e => {
      const card = e.target.closest && e.target.closest('.card');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    document.addEventListener('dragover', e => {
      const body = e.target.closest && e.target.closest('.col-body');
      if (!body) return;
      e.preventDefault();
      document.querySelectorAll('.drop-hi').forEach(n => n.classList.remove('drop-hi'));
      body.classList.add('drop-hi');
    });
    document.addEventListener('drop', e => {
      const body = e.target.closest && e.target.closest('.col-body');
      if (!body) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const kol = (state.data.kols || []).find(k => k.id === id);
      document.querySelectorAll('.drop-hi').forEach(n => n.classList.remove('drop-hi'));
      if (!kol || kol.stage === body.dataset.stage) return;
      kol.stage = body.dataset.stage;
      kol.updated_at = new Date().toISOString();
      window.KB.touch();
    });
  }

  /* ---------------- 工具栏与启动 ---------------- */
  function wireToolbar() {
    document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === btn));
      R.renderAll();
    }));
    $('#q').addEventListener('input', e => { state.filters.q = e.target.value; R.renderAll(); });
    ['#fPlatform:platform', '#fWave:wave', '#fStage:stage'].forEach(pair => {
      const [sel, key] = pair.split(':');
      $(sel).addEventListener('change', e => { state.filters[key] = e.target.value; R.renderAll(); });
    });
    $('#fBlocked').addEventListener('change', e => { state.filters.blocked = e.target.checked; R.renderAll(); });
    $('#btnAdd').addEventListener('click', addKol);
    $('#btnExport').addEventListener('click', () => {
      download('kol-board-' + new Date().toISOString().slice(0, 10) + '.csv', toCsv(state.data.kols || []));
    });
    $('#btnImport').addEventListener('click', () => $('#fileCsv').click());
    $('#fileCsv').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { importCsv(String(fr.result)); e.target.value = ''; };
      fr.readAsText(f, 'utf-8');
    });
    $('#btnSave').addEventListener('click', async () => {
      try { await window.KB.saveToDisk(); }
      catch (err) { alert(err.message); window.KB.setSaveState('保存失败', 'dirty'); }
    });
    $('#btnReload').addEventListener('click', () => {
      if (state.dirty && !confirm('尚未保存的改动会丢失，确定重置为线上数据？')) return;
      window.KB.resetToPublished();
    });
    $('#btnCloseDrawer').addEventListener('click', closeDrawer);
    document.querySelectorAll('#tbl th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      R.renderAll();
    }));
    window.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  async function boot() {
    wireToolbar(); wireDnd();
    try {
      await window.KB.loadFromDisk();
      window.KB.setSaveState('已载入线上数据', 'saved');
    } catch (err) {
      $('#dataStateBanner').hidden = false;
      $('#dataStateBanner').className = 'banner example';
      $('#dataStateBanner').textContent = '数据载入失败：' + err.message;
    }
  }

  window.KB_UI = { openDrawer, closeDrawer, toCsv, parseCsv, download };
  document.addEventListener('DOMContentLoaded', boot);
})();
