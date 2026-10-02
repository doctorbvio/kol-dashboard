/* KOL 看板 · 渲染层：批次条 / KPI / 环境 / 看板 / 表格 */
(function () {
  'use strict';
  const { STAGES, CHECKLIST, state, $, el, isBlank, stageIdx, rows } = window.KB;

  function stageLabel(k) { const s = STAGES.find(x => x.key === k); return s ? s.label : (k || '未设阶段'); }
  function checklistLabel(k) { const c = CHECKLIST.find(x => x.key === k); return c ? c.label : '未填'; }
  function platformLabel(k) { return isBlank(k.platform) ? '—' : k.platform; }

  function renderBanner() {
    const meta = state.data.meta || {};
    const box = $('#dataStateBanner');
    if (meta.data_state === 'example') {
      box.className = 'banner example';
      box.textContent = '示例数据：' + (meta.data_state_note || '') ;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function renderBatch() {
    const b = (state.data.meta && state.data.meta.batch) || {};
    const items = [
      ['批次号', b.code], ['计划寄出日', b.plan_ship_date], ['承运商/渠道', b.carrier],
      ['本批台数', b.units || ''], ['批次负责人', b.owner], ['口径日 (embargo)', b.embargo_date],
      ['CE（含 EN 18031）', b.cert_ce], ['FCC', b.cert_fcc], ['随箱指南版本', b.guide_version]
    ];
    const host = $('#batchGrid');
    host.replaceChildren();
    items.forEach(([k, v]) => {
      const wrap = el('div', 'batch-item');
      wrap.appendChild(el('span', 'k', k));
      const val = el('span', 'v' + (isBlank(v) ? ' empty' : ''), isBlank(v) ? '待填' : String(v));
      wrap.appendChild(val);
      host.appendChild(wrap);
    });
  }

  function renderKpis() {
    const list = rows();
    const idx = stageIdx;
    const shippedStages = ['shipped', 'delivered', 'filming', 'live', 'review'];
    const defs = [
      ['KOL 总数', list.length, false],
      ['已寄出/在途', list.filter(k => shippedStages.includes(k.stage)).length, false],
      ['已收机', list.filter(k => idx(k.stage) >= idx('delivered')).length, false],
      ['成片已上线', list.filter(k => idx(k.stage) >= idx('live')).length, false],
      ['有阻断项', list.filter(k => k._blocked).length, true],
      ['有风险提示', list.filter(k => !k._blocked && k._warned).length, false],
      ['NDA 未签', list.filter(k => !k.nda_signed).length, false],
      ['Wave 2 待认证', list.filter(k => k.wave === 'Wave 2').length, false],
      ['自检未通过', list.filter(k => k.checklist !== 'passed').length, false]
    ];
    const host = $('#kpis');
    host.replaceChildren();
    defs.forEach(([label, n, alarm]) => {
      const box = el('div', 'kpi' + (alarm && n > 0 ? ' alarm' : ''));
      box.appendChild(el('div', 'n', n));
      box.appendChild(el('div', 'l', label));
      host.appendChild(box);
    });
  }

  function renderEnv() {
    const meta = state.data.meta || {};
    const host = $('#envTable');
    host.replaceChildren();
    host.appendChild(el('div', 'h', '项'));
    host.appendChild(el('div', 'h', '当前状态'));
    host.appendChild(el('div', 'h', '对寄件的直接含义'));
    (meta.env || []).forEach(row => {
      host.appendChild(el('div', '', row.label));
      host.appendChild(el('div', '', row.value));
      host.appendChild(el('div', '', row.impact));
    });
    $('#envSource').textContent = meta.env_source ? ('来源：' + meta.env_source) : '';
  }

  function filt(list) {
    const f = state.filters;
    const q = (f.q || '').trim().toLowerCase();
    return list.filter(k => {
      if (f.platform && k.platform !== f.platform) return false;
      if (f.wave && k.wave !== f.wave) return false;
      if (f.stage && k.stage !== f.stage) return false;
      if (f.blocked && !(k._blocked || k._warned)) return false;
      if (q) {
        const hay = [k.name, k.platform, k.country, k.city, k.notes, k.next_action, k.content_type, k.owner]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderBoard(list) {
    const host = $('#board');
    host.replaceChildren();
    STAGES.forEach(stage => {
      const items = list.filter(k => k.stage === stage.key);
      const col = el('section', 'col');
      col.dataset.stage = stage.key;
      const head = el('div', 'col-head');
      head.appendChild(el('span', '', stage.label));
      head.appendChild(el('span', 'cnt', String(items.length)));
      col.appendChild(head);
      const body = el('div', 'col-body');
      body.dataset.stage = stage.key;
      items.forEach(k => {
        const card = el('article', 'card' + (k._blocked ? ' blocked' : ''));
        card.draggable = true;
        card.dataset.id = k.id;
        card.appendChild(el('div', 'nm', k.name || '（未命名）'));
        const bits = [platformLabel(k), k.country, k.wave, k.checklist === 'passed' ? null : '自检:' + checklistLabel(k.checklist)]
          .filter(Boolean);
        card.appendChild(el('div', 'mt', bits.join(' · ')));
        if (k._blockers.length) {
          const bs = el('div', 'badges');
          k._blockers.slice(0, 3).forEach(b => bs.appendChild(el('span', 'badge ' + b.level, b.text.split('：')[0])));
          if (k._blockers.length > 3) bs.appendChild(el('span', 'badge', '+' + (k._blockers.length - 3)));
          card.appendChild(bs);
        }
        card.addEventListener('click', () => window.KB_UI.openDrawer(k.id));
        body.appendChild(card);
      });
      col.appendChild(body);
      host.appendChild(col);
    });
  }

  function renderTable(list) {
    const tb = $('#tbody');
    tb.replaceChildren();
    const s = state.sort;
    const sorted = list.slice().sort((a, b) => {
      let va = a[s.key], vb = b[s.key];
      if (s.key === 'stage') { va = stageIdx(a.stage); vb = stageIdx(b.stage); }
      if (typeof va === 'number' || typeof vb === 'number') { va = Number(va) || 0; vb = Number(vb) || 0; return (va - vb) * s.dir; }
      return String(va || '').localeCompare(String(vb || ''), 'zh') * s.dir;
    });
    sorted.forEach(k => {
      const tr = el('tr', k._blocked ? 'blocked' : '');
      tr.appendChild(el('td', '', k.name || ''));
      tr.appendChild(el('td', '', platformLabel(k)));
      tr.appendChild(el('td', 'num', k.followers ? k.followers.toLocaleString() : '—'));
      tr.appendChild(el('td', 'num', k.avg_views_30d ? k.avg_views_30d.toLocaleString() : '—'));
      tr.appendChild(el('td', '', k.country || '—'));
      tr.appendChild(el('td', '', k.wave || '—'));
      tr.appendChild(el('td', '', stageLabel(k.stage)));
      const bd = el('td', '');
      if (!k._blockers.length) { bd.appendChild(el('span', 'badge ok', '无')); }
      else k._blockers.forEach(b => bd.appendChild(el('span', 'badge ' + b.level, b.text)));
      tr.appendChild(bd);
      tr.appendChild(el('td', '', k.nda_signed ? '已签' : '未签'));
      tr.appendChild(el('td', '', k.next_action || '—'));
      const ops = el('td', 'ops');
      const open = el('button', '', '编辑'); open.addEventListener('click', () => window.KB_UI.openDrawer(k.id));
      const del = el('button', '', '删除');
      del.addEventListener('click', () => {
        if (!confirm('确认删除「' + (k.name || '未命名') + '」这一行？')) return;
        state.data.kols = state.data.kols.filter(x => x.id !== k.id);
        window.KB.touch();
      });
      ops.appendChild(open); ops.appendChild(del);
      tr.appendChild(ops);
      tb.appendChild(tr);
    });
    if (!sorted.length) {
      const tr = el('tr');
      const td = el('td', 'empty-cell', '没有符合筛选条件的 KOL');
      td.colSpan = 11; tr.appendChild(td); tb.appendChild(tr);
    }
  }

  function fillFilterOptions() {
    const list = rows();
    const set = (sel, key, all) => {
      const node = $(sel), cur = node.value;
      node.replaceChildren();
      node.appendChild(new Option(all, ''));
      [...new Set(list.map(k => k[key]).filter(v => !isBlank(v)))].sort().forEach(v => node.appendChild(new Option(v, v)));
      node.value = cur;
    };
    set('#fPlatform', 'platform', '全部平台');
    set('#fWave', 'wave', '全部波次');
    set('#fStage', 'stage', '全部阶段');
    const stage = $('#fStage');
    [...stage.options].forEach(o => { if (o.value) o.textContent = stageLabel(o.value); });
  }

  function renderAll() {
    if (!state.data) return;
    renderBanner(); renderBatch(); renderKpis(); renderEnv(); fillFilterOptions();
    const list = filt(rows());
    renderBoard(list);
    renderTable(list);
    $('#board').hidden = state.view !== 'board';
    $('#tableWrap').hidden = state.view !== 'table';
    const kols = state.data.kols || [];
    $('#foot').textContent = '共 ' + kols.length + ' 条记录（当前筛选后 ' + list.length +
      ' 条）· 阶段与阻断规则来自 01_内部_设备寄出前自检表_v2.0 §2/§7 · 数据文件 data/kol_data.json · 每次保存自动备份到 data/_backup/';
  }

  window.KB_RENDER = { renderAll, renderBanner, stageLabel, checklistLabel, filt };
})();
