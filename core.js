/* KOL 看板 · 核心：常量、状态、规则引擎、读写磁盘 */
(function () {
  'use strict';

  const STAGES = [
    { key: 'outreach', label: '1 初筛/联系' },
    { key: 'negotiating', label: '2 已回复/谈定' },
    { key: 'legal', label: '3 签 NDA/授权' },
    { key: 'intake', label: '4 采地址与机型' },
    { key: 'preship', label: '5 寄出前自检' },
    { key: 'shipped', label: '6 已寄出/在途' },
    { key: 'delivered', label: '7 已收机' },
    { key: 'filming', label: '8 素材拍摄' },
    { key: 'live', label: '9 成片已上线' },
    { key: 'review', label: '10 复盘/结算' }
  ];
  const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
  const CHECKLIST = [
    { key: 'not_started', label: '未开始' },
    { key: 'in_progress', label: '进行中' },
    { key: 'passed', label: '全部通过' },
    { key: 'failed', label: '有不通过项' }
  ];

  // 中国出口/寄件波次的国家归属（依据自检表 §0.1 与 §7.4）
  const WAVE1 = ['美国', '加拿大', '澳大利亚', '新西兰', '新加坡', '中国香港', '香港'];
  const WAVE2 = ['英国', '德国', '法国', '意大利', '西班牙', '荷兰', '瑞士', '挪威', '瑞典', '比利时', '奥地利', '爱尔兰', '丹麦', '芬兰', '波兰', '葡萄牙'];
  const FCC_COUNTRIES = ['美国'];

  const FIELDS = [
    { key: 'name', label: 'KOL / 频道名', required: true },
    { key: 'platform', label: '主力平台', type: 'select', options: ['YouTube', 'Instagram', 'TikTok', 'Bilibili', 'X', '小红书', '其他'] },
    { key: 'url', label: '主页/频道链接' },
    { key: 'followers', label: '粉丝/订阅量', type: 'number' },
    { key: 'avg_views_30d', label: '近 30 天平均播放', type: 'number' },
    { key: 'content_type', label: '内容形式', type: 'select', options: ['长评测', '短视频', '直播', '图文', '其他'] },
    { key: 'country', label: '所在国家', hint: '决定发货波次与认证前提' },
    { key: 'city', label: '城市' },
    { key: 'wave', label: '发货波次', type: 'select', options: ['Wave 1', 'Wave 2', '其他'] },
    { key: 'timezone', label: '时区' },
    { key: 'receiving_language', label: '收件语言', type: 'select', options: ['中文', '英文', '其他'], hint: '随箱指南当前只有中文版' },
    { key: 'computer', label: '主力电脑', hint: 'macOS / Windows / Linux + 机型、内存' },
    { key: 'displays', label: '显示器与接口', hint: '几块屏、分辨率、HDMI 还是 USB-C' },
    { key: 'need_splitter', label: '需要分线器附件', type: 'bool' },
    { key: 'nda_signed', label: 'NDA / 素材授权已签', type: 'bool' },
    { key: 'nda_ref', label: 'NDA 文号 + 签署日' },
    { key: 'serial', label: '设备序列号' },
    { key: 'stage', label: '当前阶段', type: 'select', options: STAGES.map(s => s.key), optionLabels: Object.fromEntries(STAGES.map(s => [s.key, s.label])), required: true },
    { key: 'checklist', label: '寄出前自检（§3/§4 全表）', type: 'select', options: CHECKLIST.map(c => c.key), optionLabels: Object.fromEntries(CHECKLIST.map(c => [c.key, c.label])) },
    { key: 'deliverable_url', label: '成片/素材链接' },
    { key: 'owner', label: '内部负责人' },
    { key: 'next_action', label: '下一步动作', type: 'textarea' },
    { key: 'next_due', label: '下一步截止', type: 'date' },
    { key: 'notes', label: '备注', type: 'textarea' }
  ];

  const state = { data: null, dirty: false, view: 'board', sort: { key: 'name', dir: 1 }, filters: {} };

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }
  function stageIdx(k) { return STAGE_INDEX[k] === undefined ? -1 : STAGE_INDEX[k]; }

  /* ---------- 规则引擎：把自检表的硬约束翻译成阻断项 ---------- */
  function blockersFor(kol, meta) {
    const b = [];
    const batch = (meta && meta.batch) || {};
    const idx = stageIdx(kol.stage);
    const shipIdx = stageIdx('shipped');
    const moveIdx = stageIdx('intake'); // 进入地址/寄件准备就得过的关
    const isEU = WAVE2.includes(kol.country);

    if (kol.wave === 'Wave 2' || isEU) {
      if (batch.cert_ce !== 'passed') b.push({ code: 'ce_pending', level: 'danger', text: 'Wave 2 国家 CE（含 EN 18031）未通过：不得寄出' });
    }
    if (FCC_COUNTRIES.includes(kol.country) && batch.cert_fcc !== 'passed' && idx >= moveIdx) {
      b.push({ code: 'fcc_pending', level: 'warn', text: '美国市场 FCC 未取得：寄出前确认认证状态' });
    }
    if (isBlank(batch.embargo_date) && idx >= moveIdx) {
      b.push({ code: 'embargo_unset', level: 'warn', text: '对外发布口径日未定：自检表 §7.3 要求先定口径日再寄' });
    }
    if (!kol.nda_signed && idx >= stageIdx('legal')) {
      b.push({ code: 'nda_missing', level: 'danger', text: 'NDA / 素材授权未签：授权链不完整，不能寄件' });
    }
    if (idx >= moveIdx && (isBlank(kol.city) || isBlank(kol.computer) || isBlank(kol.displays))) {
      b.push({ code: 'profile_incomplete', level: 'warn', text: '单台档案未齐（城市 / 电脑 / 显示器接口）：收件与适配都依赖它' });
    }
    if (kol.checklist === 'failed') {
      b.push({ code: 'checklist_failed', level: 'danger', text: '寄出前自检有不通过项：修好再寄' });
    }
    if (idx >= shipIdx && kol.checklist !== 'passed') {
      b.push({ code: 'checklist_not_passed', level: 'warn', text: '已寄出但自检未标记「全部通过」：补记录或追回' });
    }
    if (idx >= shipIdx && isBlank(kol.serial)) {
      b.push({ code: 'serial_missing', level: 'warn', text: '缺设备序列号：无法把成片与机器对上' });
    }
    if (!isBlank(kol.receiving_language) && kol.receiving_language !== '中文') {
      b.push({ code: 'guide_language', level: 'warn', text: '随箱指南当前只有中文版：非中文收件人需另备说明' });
    }
    return b;
  }

  function decorate(kol, meta) {
    const blockers = blockersFor(kol, meta);
    return Object.assign({}, kol, {
      _blockers: blockers,
      _blocked: blockers.some(x => x.level === 'danger'),
      _warned: blockers.some(x => x.level === 'warn')
    });
  }

  function rows() { return (state.data.kols || []).map(k => decorate(k, state.data.meta)); }

  /* ---------- 读写磁盘 ---------- */
  function rerender() { if (window.KB_RENDER) window.KB_RENDER.renderAll(); }

  /* ---------- 静态版读写：localStorage（无后端） ---------- */
  const LS_KEY = 'kb.kol-board.published.v1';

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  async function loadFromDisk() {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        state.data = JSON.parse(raw);
        setDirty(false);
        rerender();
        setSaveState('已载入本机浏览器里的改动', 'saved');
        return;
      } catch (e) {
        localStorage.removeItem(LS_KEY);
      }
    }
    state.data = clone(window.__KB_DATA__ || { kols: [], meta: {} });
    setDirty(false);
    rerender();
  }

  async function saveToDisk() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state.data));
    } catch (e) {
      throw new Error('本浏览器存储不可用（隐私模式或已满）：' + e.message);
    }
    setDirty(false);
    setSaveState('已存到本机浏览器 · ' + new Date().toLocaleTimeString('zh-CN'), 'saved');
    return { ok: true };
  }

  function resetToPublished() {
    localStorage.removeItem(LS_KEY);
    state.data = clone(window.__KB_DATA__ || { kols: [], meta: {} });
    setDirty(false);
    rerender();
    setSaveState('已重置为线上数据', 'saved');
  }

  function setDirty(v) { state.dirty = v; if (v) setSaveState('未保存改动', 'dirty'); }
  function setSaveState(text, cls) {
    const n = $('#saveState');
    n.textContent = text;
    n.className = 'save-state' + (cls ? ' ' + cls : '');
  }

  function touch() { setDirty(true); rerender(); }

  window.KB = { STAGES, CHECKLIST, FIELDS, WAVES: { WAVE1, WAVE2 }, state, $, el, isBlank,
    stageIdx, blockersFor, decorate, rows, loadFromDisk, saveToDisk, resetToPublished,
    setDirty, setSaveState, touch };
})();
