/**
 * 入口与流程编排（docs/01 §5）
 *
 * 本文件把各模块接起来，自身不含业务常量 —— 一切都从 CONFIG 读。
 */

import { CONFIG, assertConfigSanity, configSummary } from './config.js';
import { setLocale, getLocale, t } from './i18n.js';
import { Storage } from './storage.js';
import { openSession } from './session.js';
import { GraphRenderer } from './render.js';
import { Recorder, installAntiCheat, systemInfo } from './record.js';
import { TaskController, promptFor, scoreT1, scoreT2, scoreT4, practiceFeedback } from './tasks.js';
import { loadConsentText, renderConsent, routeDeclined, pickConsentDoc } from './consent.js';
import {
  loadCodes, lookupCode, normalizeCode, renderCodeEntry, renderMissingCodes,
} from './entry.js';
import { buildTrialPlan, buildPracticePlan, hashString } from './randomize.js';
import {
  demographics, literacy, perTrialEase, nasaTlx, previs, preference,
} from './survey.js';
import {
  ProgressBar, BreakScreen, renderWelcome, renderInstructions, renderDone, renderError,
} from './flow.js';

const $ = (id) => document.getElementById(id);
const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 切到「非图屏」：清空 + 显示 + 给出节点。试次结束后 #screen 是隐藏的。 */
function showScreen() {
  const s = $('screen');
  s.replaceChildren();
  s.hidden = false;
  return s;
}

// ─────────────────────────── 启动 ───────────────────────────

async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  // 语言要在任何界面渲染之前定下来
  //   ?lang=zh / ?lang=en 可临时覆盖 config（方便测试与现场切换）
  const urlLang = new URLSearchParams(location.search).get('lang');
  setLocale(urlLang || CONFIG.locale);
  document.title = t('welcome.title');
  const { problems, enabled } = assertConfigSanity();
  console.info('[config] 生效配置摘要', configSummary());
  for (const p of problems) console.warn('[config] ' + p);

  const app = $('app');
  if (problems.length && CONFIG.strictConfig) {
    renderError(app, t('errors.configProblem'), problems.join('\n'));
    return;
  }

  let stimuli, practiceStimuli, examples, literacyDoc, consentDoc;
  try {
    const base = CONFIG.storage.stimPath;
    [stimuli, practiceStimuli, examples, literacyDoc, consentDoc] = await Promise.all([
      fetchJSON(`${base}/stimuli.json`).then((d) => d.stimuli),
      fetchJSON(`${base}/practice.json`).then((d) => d.stimuli),
      fetchJSON(`${base}/examples.json`).then((d) => d.stimuli),
      CONFIG.survey.literacy ? fetchJSON(`${base}/literacy.json`) : Promise.resolve(null),
      loadConsentText(CONFIG),
    ]);
  } catch (e) {
    // 直接 file:// 打开会走到这里 —— 给出明确的修复指引，而不是白屏
    renderError(app, t('errors.noData'), String(e));
    return;
  }

  const store = new Storage(CONFIG);

  // ── 研究员用：批量导出本机所有被试的数据 ──
  //   http://localhost:8000/src/?export=all
  //   实验室场景下数据都在 localStorage 里；一个个点「下载」太容易漏，
  //   所以提供一个一次性打包导出（含未完成的会话，便于排查）。
  const params = new URLSearchParams(location.search);
  if (params.get('export') === 'all') {
    exportAllSessions();
    return;
  }
  // 研究员用：重置实验（重新从 L001 开始）
  //   http://localhost:8000/src/?reset=lab
  if (params.get('reset') === 'lab') {
    renderResetPage();
    return;
  }

  // ── 入口编号（entryMode === 'code' 时必需）──
  //   ?mode=auto 可临时退回自动编号（实验室省事用）
  const urlMode = new URLSearchParams(location.search).get('mode');
  const entryMode = urlMode || CONFIG.entryMode;
  let entry = null;

  if (entryMode === 'code') {
    let codesDoc = null;
    try {
      codesDoc = await loadCodes(CONFIG);
    } catch (e) {
      renderMissingCodes(app, String(e));
      return;
    }
    // 优先级：网址 ?code= → 本标签页已输入的编号 → 让被试现场输入
    const urlCode = new URLSearchParams(location.search).get('code');
    const stored = sessionStorage.getItem('vrrgl.entryCode');
    const candidate = urlCode || stored;
    entry = candidate ? lookupCode(codesDoc, candidate) : null;

    if (!entry) {
      const badInput = Boolean(candidate);   // 带了编号但无效 → 表单里提示
      // ⚠️ 必须渲染到 #screen，不能渲染到 #app ——
      //    #app 里还有 #trialroot 和 #progressbar，清空整棵树会让后续流程拿到 null
      entry = await renderCodeEntry($('screen'), {
        codesDoc,
        prefill: candidate ? normalizeCode(candidate) : '',
        message: badInput ? t('entry.invalid') : '',
      });
    }
    try { sessionStorage.setItem('vrrgl.entryCode', entry.code); } catch { /* ignore */ }
    console.info(`[entry] code=${entry.code} offset=${entry.offset} group=${entry.group}`);
  }

  let session, participantIndex, resumed = false, assignedOffset = null;
  try {
    ({ session, participantIndex, resumed, assignedOffset } = openSession(CONFIG, {
      getItem: (k) => store._get(k), setItem: (k, v) => store._set(k, v),
    }, entry));
  } catch (e) {
    if (e.code === 'NO_PID') {
      renderError(app, t('errors.noPid'), t('errors.noPidDetail'));
    } else if (e.code === 'ALREADY_DONE') {
      renderError(app, e.message, t('errors.alreadyDone'));
    } else {
      renderError(app, t('errors.couldNotStart'), String(e));
    }
    return;
  }

  const save = () => { if (CONFIG.storage.autosaveEveryTrial) store.save(session); };
  save();

  const recorder = new Recorder(CONFIG);
  installAntiCheat();

  // 最小视口宽度守卫（docs/06 §2 要点 5：桌面设备做成筛除分支）。
  // 画布设计尺寸 900px，加上左侧 ID 面板与页边距，窗口窄于此值就会被迫缩小画布，
  // 节点半径随之小于规格要求的 5px。与其静默降级，不如明确挡掉。
  const MIN_W = 1180;
  if (window.innerWidth < MIN_W) {
    renderError(app, t('errors.tooNarrowTitle'),
      t('errors.tooNarrowBody', { min: MIN_W, w: window.innerWidth }));
    return;
  }

  // ── 分派（只在首次建立时固定下来，刷新也不变）──
  if (!session.assignment) {
    const graphIds = [...new Set(stimuli.map((s) => s.graph_id))].sort();
    const plan = buildTrialPlan({
      stimuli, graphIds, layouts: CONFIG.layouts, pid: session.participant_id,
      participantIndex, offset: assignedOffset, cfg: CONFIG,
    });
    session.assignment = {
      offset: plan.offset,
      mapping: plan.mapping,
      nTrials: plan.trials.length,
      // 只把分派结果存下来，trial 列表每次重建（避免旧版本污染）
    };
    save();
  }

  const graphIds = [...new Set(stimuli.map((s) => s.graph_id))].sort();
  const plan = buildTrialPlan({
    stimuli, graphIds, layouts: CONFIG.layouts, pid: session.participant_id,
    participantIndex, offset: assignedOffset, cfg: CONFIG,
  });

  console.info(`[flow] offset=${plan.offset}  trial 总数=${plan.trials.length}` +
    `（每任务 ${graphIds.length}，任务 ${enabled.filter((t) => t !== 'ATTENTION')}）`);

  await run({ app, session, save, store, recorder, plan, practiceStimuli,
              examples, literacyDoc, consentDoc, enabled });
}

// ─────────────────────────── 批量导出（研究员用）───────────────────────────

/** 收集本机全部被试（按编号排序）。 */
function collectSessions() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('vrrgl.data.'));
  const sessions = keys.map((k) => {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return { _corrupt: k }; }
  }).filter(Boolean);
  sessions.sort((a, b) => String(a.participant_id).localeCompare(String(b.participant_id)));
  return sessions;
}

/** 下载全部被试为**一个** JSON。 */
function downloadAllSessions(sessions) {
  const payload = {
    exported_at: new Date().toISOString(),
    count: sessions.length,
    completed: sessions.filter((s) => s.completed).length,
    sessions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vrrgl_all_sessions_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

function exportAllSessions() {
  const sessions = collectSessions();
  const payload = downloadAllSessions(sessions);

  // 顺带在页面上给出摘要 —— 免得研究员不知道导出了几个人
  const app = $('app');
  app.replaceChildren();
  const w = h('div', 'screen done');
  w.append(h('h1', null, '导出完成 / Export complete'));
  for (const s of sessions) {
    w.append(h('p', 'hint',
      `${s.participant_id} — ${s.completed ? '✅ 已完成' : '⏳ 未完成'} — `
      + `${(s.trials || []).filter((x) => x.phase === 'main').length} trials`));
  }
  w.append(h('p', null, `共 ${sessions.length} 位被试（其中 ${payload.completed} 位已完成）`));
  if (!sessions.length) w.append(h('p', 'error', '本机没有任何被试数据。'));
  app.append(w);
}

/** 重置实验：清空编号 / 清空数据。用于「pilot 跑完，正式实验从 L001 重新开始」。 */
function renderResetPage() {
  const sessions = collectSessions();
  const app = $('app');
  app.replaceChildren();
  const w = h('div', 'screen done');
  w.append(h('h1', null, '重置实验 / Reset study'));

  w.append(h('p', null, `本机当前有 ${sessions.length} 位被试的数据：`));
  for (const s of sessions) {
    w.append(h('p', 'hint',
      `${s.participant_id} — ${s.completed ? '✅ 已完成' : '⏳ 未完成'} — `
      + `${(s.trials || []).filter((x) => x.phase === 'main').length} trials`));
  }

  if (!sessions.length) {
    w.append(h('p', 'hint', '（没有数据）'));
  }

  const row = h('div', 'consent-actions');
  row.style.justifyContent = 'center';

  // ① 先导出（推荐）
  const dl = h('button', 'btn primary', '① 先下载全部数据（推荐）');
  dl.addEventListener('click', () => {
    const p = downloadAllSessions(sessions);
    alert(`已下载 ${p.count} 位被试的数据。
文件在「下载」文件夹。

请先确认文件已保存到安全位置。`);
  });

  // （原「仅重置编号、保留数据」已移除 —— 新编号会与旧数据撞号，见 resetCounters 注释）

  // ② 清空全部（双重确认）
  const wipe = h('button', 'btn', '② 清空全部数据，从 L001 重新开始');
  wipe.style.color = '#e53935';
  wipe.style.borderColor = '#e53935';
  wipe.addEventListener('click', () => {
    if (!sessions.length) { resetCounters(); location.href = location.pathname; return; }
    if (!confirm(`将永久删除 ${sessions.length} 位被试的数据，且无法恢复。

建议先点「① 先下载全部数据」。

确定清空？`)) return;
    if (!confirm('再确认一次：真的要清空全部数据吗？')) return;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('vrrgl.')) localStorage.removeItem(k);
    }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    location.href = location.pathname;
  });

  row.append(dl, wipe);
  w.append(row);

  w.append(h('p', 'hint',
    '说明：① 只下载，不动任何数据（可重复点）；② 删除本机全部被试数据并把编号重置到 L001。\n'
    + '如果要「保留 pilot 数据、正式实验重新从 01 开始」：先点 ① 保存文件，再点 ②。'));
  app.append(w);
}

/** 只清编号相关状态，保留 vrrgl.data.*。 */
function resetCounters() {
  for (const k of ['vrrgl.labCounter', 'vrrgl.pidIndex', 'vrrgl.counter']) {
    localStorage.removeItem(k);
  }
  try { sessionStorage.removeItem('vrrgl.tabPid'); } catch { /* ignore */ }
}

// ─────────────────────────── 流程 ───────────────────────────

async function run(ctx) {
  const { app, session, save, store, recorder, plan, practiceStimuli,
          examples, literacyDoc, consentDoc } = ctx;

  // 断点续传：已完成到哪一步
  const done = session.trials.length;
  const resumeAt = done;

  $('progressbar').style.display = CONFIG.showProgressBar ? '' : 'none';
  const progress = new ProgressBar($('progressbar'));

  // ① 欢迎
  if (!resumeAt && !session.consent) {
    await new Promise((r) => renderWelcome(showScreen(), r, session.participant_id, session.group));
    if (CONFIG.fullscreenRequired) {
      try { await document.documentElement.requestFullscreen(); } catch { /* 可被拒 */ }
    }
  }

  // ② 知情同意（docs/06）
  if (!session.consent) {
    const verdict = await new Promise((resolve) => {
      renderConsent(showScreen(), pickConsentDoc(consentDoc, CONFIG.consent.condition, getLocale()), CONFIG, resolve);
    });
    session.consent = verdict;
    save();
    if (!verdict.agreed) {
      const msg = routeDeclined(CONFIG);
      renderError(app, t('errors.declinedTitle'), msg);
      return;
    }
    if (verdict.failedScreening > 0) {
      // 资格自述未通过 —— 按筛除处理（docs/06 §2 要点 5）
      const msg = routeDeclined(CONFIG);
      renderError(app, t('errors.screenedOutTitle'),
        t('errors.screenedOutBody', { n: verdict.failedScreening }) + ' ' + msg);
      return;
    }
  }

  // ③ 人口学
  if (CONFIG.survey.demographics && !session.demographics) {
    $('progressbar').style.display = 'none';
    session.demographics = await demographics(showScreen(), CONFIG);
    save();
  }

  // ④ 图素养前测
  if (CONFIG.survey.literacy && literacyDoc && !session.literacy) {
    session.literacy = await literacy(showScreen(), literacyDoc.items);
    save();
  }

  // ⑤ 说明 + 练习
  const practice = buildPracticePlan({ practiceStimuli, pid: session.participant_id, cfg: CONFIG });
  const totalPractice = practice.length;
  const totalMain = plan.trials.length;

  if (resumeAt === 0) {
    await new Promise((r) => renderInstructions(showScreen(), {
      enabledTasks: CONFIG.tasks && Object.entries(CONFIG.tasks)
        .filter(([, t]) => t.enabled).map(([k]) => k),
      examples: examples || [],
      onStart: r,
    }));
  }

  if (totalPractice) {
    $('progressbar').style.display = CONFIG.showProgressBar ? '' : 'none';
    for (let i = 0; i < totalPractice; i++) {
      if (session.trials.filter((t) => t.phase === 'practice').length > i) continue;  // 已做
      progress.set(i, totalPractice, `${t('common.continue') === '继续' ? '练习' : 'Practice'} ${i + 1} / ${totalPractice}`);
      await runTrial(ctx, practice[i], { index: i, isPractice: true });
    }
    progress.show(!resumeAt);
  }

  // ⑥ 正式试次
  progress.show(true);
  const breakScreen = new BreakScreen($('screen'), CONFIG);
  let mainDone = session.trials.filter((t) => t.phase === 'main' || t.phase === 'attention').length;

  for (let i = mainDone; i < plan.trials.length; i++) {
    const trial = plan.trials[i];
    progress.set(i, totalMain, `${i + 1} / ${totalMain}`);
    await runTrial(ctx, trial, { index: i, isPractice: false });
    mainDone = i + 1;

    // 强制休息（docs/03 §7.3）
    const n = CONFIG.breakEveryNTrials;
    if (n > 0 && mainDone % n === 0 && mainDone < plan.trials.length) {
      await breakScreen.run(mainDone, totalMain);
    }
  }

  // ⑦ 问卷
  $('progressbar').style.display = 'none';
  if (CONFIG.survey.nasaTlx && !session.nasa_tlx) {
    session.nasa_tlx = await nasaTlx(showScreen(), CONFIG);
    save();
  }
  if (CONFIG.survey.prevIs && !session.previs) {
    session.previs = await previs(showScreen(), CONFIG);
    save();
  }
  if (CONFIG.survey.preference && !session.preference) {
    // 界面上只用位置指代；布局顺序本身是随机的（用 pid 派生，保证两处一致）
    const order = shuffleDeterministic(CONFIG.layouts);
    session.preference = await preference(showScreen(), order);
    save();
  }

  // ⑧ 结束
  session.completed = true;
  session.finished_at = new Date().toISOString();
  save();
  renderDone(showScreen(), {
    session, cfg: CONFIG,
    onExport: () => store.download(session),
  });
}

function shuffleDeterministic(arr) {
  const pid = location.search;
  return arr.slice().sort((a, b) =>
    hashString(pid + a) - hashString(pid + b));
}

// ─────────────────────────── 单个 trial ───────────────────────────

async function runTrial(ctx, trial, { index, isPractice }) {
  const { session, save, recorder, store } = ctx;
  const root = $('trialroot');
  const screen = $('screen');

  root.hidden = false;
  // 切到试次屏时**立刻清掉**上一屏 —— 只 hidden 不 clear 会留下残留 DOM，
  // 自动化/屏幕阅读器仍能命中那些元素，也会在极慢的机器上闪一下。
  screen.hidden = true;
  screen.replaceChildren();
  root.replaceChildren();

  // 左侧 ID 面板（GVRRI 做法）
  const idPanel = h('aside', 'idpanel');
  if (CONFIG.showIdPanel) root.append(idPanel);

  const canvas = h('div', 'canvas-area');
  const promptEl = h('div', 'prompt', '');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'graph';
  canvas.append(promptEl, svg);
  root.append(canvas);

  const controls = h('div', 'controls');
  root.append(controls);

  // ── attention check ──
  if (trial.task === 'ATTENTION') {
    return runAttention(ctx, root, index);
  }

  const stim = trial.stimulus;
  promptEl.textContent = promptFor(trial.task, CONFIG);

  const renderer = new GraphRenderer(svg, CONFIG);
  const controller = new TaskController({
    renderer, cfg: CONFIG,
    onSubmit: (response) => { pending.resolve(response); },
  });
  let pending = {};
  const responsePromise = new Promise((res) => { pending.resolve = res; });

  // 目标 / 初始选中
  const targets = trial.task === 'T4' ? stim.targets : [stim.targets[0]];
  controller.mount(trial.task, stim);

  // 作答控件
  const submitBtn = h('button', 'btn primary', t('common.submit'));
  submitBtn.disabled = trial.task === 'T1';
  const noteEl = h('p', 'hint', '');

  function refreshPanel() {
    if (!CONFIG.showIdPanel) return;
    idPanel.replaceChildren();
    idPanel.append(h('h3', null, t('trial.selectedNodes')));
    const sel = [...renderer.selected].sort((a, b) => labelNum(stim, a) - labelNum(stim, b));
    if (!sel.length) idPanel.append(h('p', 'hint', t('trial.none')));
    for (const id of sel) {
      const row = h('div', 'idrow');
      // ⚠️ 显示的是【展示标签】而非原始 n-index ——
      //    docs/02 §5 要求匿名化顺序（度数降序）不得在渲染中体现，
      //    而 docs/01 §2.3 要求把已选节点 ID 列出来。用每图固定的打乱标签同时满足两者。
      row.append(h("span", "idlabel", displayLabel(stim, id)));
      const trash = h('button', 'trash', '✕');
      trash.title = t('trial.remove');
      trash.addEventListener('click', () => {
        renderer.selected.delete(id);
        renderer._paintSelection();
        refreshPanel();
        syncSubmit();
      });
      row.append(trash);
      idPanel.append(row);
    }
    syncSubmit();
  }
  function syncSubmit() {
    if (trial.task === 'T1') {
      submitBtn.disabled = renderer.selected.size === 0;
      noteEl.textContent = renderer.selected.size === 0 ? t('trial.selectAtLeastOne') : '';
    }
  }
  controller._onSelectionChange = refreshPanel;

  if (trial.task === 'T1') {
    controls.append(noteEl, submitBtn);
    submitBtn.addEventListener('click', () => controller.submitForm());
  } else if (trial.task === 'T2') {
    const num = document.createElement('input');
    num.type = 'number'; num.min = '0'; num.className = 'num';
    num.placeholder = t('trial.typeNumberPlaceholder');
    controls.append(num, submitBtn);
    submitBtn.disabled = false;
    const submitT2 = () => {
      if (!controller.submitForm(num.value)) noteEl.textContent = t('trial.typeNumber');
    };
    submitBtn.addEventListener('click', submitT2);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitT2(); } });
    controls.append(noteEl);
    setTimeout(() => num.focus(), 50);
  } else if (trial.task === 'T4') {
    controls.append(h('p', 'hint', t('trial.clickOneTarget')));
  }

  refreshPanel();

  // ── 计时：从【图渲染完成】开始 ──
  // 先让浏览器把 SVG 画完（下一帧），再起表
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  recorder.startTrial();

  // 题干 0.5s 后淡出（docs/03 §8）
  setTimeout(() => promptEl.classList.add('faded'), CONFIG.stimulusFadeMs);

  const response = await responsePromise;
  const timing = recorder.stopTrial();

  // ── 判分 ──
  let result, truth = null;
  if (trial.task === 'T1') {
    truth = stim.ground_truth[stim.targets[0]];
    result = scoreT1(response.selected, truth);
  } else if (trial.task === 'T4') {
    result = scoreT4(response.clicked, stim);
    truth = result.answer;
  } else {
    result = scoreT2(response.answer, stim);
    truth = result.truth;
  }

  const record = {
    trial_index: index,
    phase: isPractice ? 'practice' : 'main',
    stimulus_id: stim.stimulus_id,
    task: trial.task,
    graph_id: stim.graph_id,
    layout: stim.layout,
    degree_level: stim.degree_level,
    target_node: trial.task === 'T4' ? null : stim.targets[0],
    target_degree: stim.target_degree,
    response: response.selected ?? response.clicked ?? response.answer,
    ...result,
    ...timing,
  };

  // T4 的专用字段（docs/03 §3.7）—— 字段名按文档，便于分析脚本直接取用
  if (trial.task === 'T4') {
    record.pair = stim.pair;
    record.degree_pair = stim.pair.map((p) => stim.target_degree[p]);
    record.degree_ratio = stim.degree_ratio;
    record.response_clicked = response.clicked;
    record.pair_kind = stim.pair_kind;
  }
  session.trials.push(record);
  save();

  // ── 练习反馈（正式试次一律不给）──
  if (isPractice && CONFIG.practiceFeedback) {
    controller.unmount();
    const fb = h('div', 'practice-feedback');
    fb.append(h('p', null, practiceFeedback(trial.task, result, stim)));
    const next = h('button', 'btn primary', t('common.continue'));
    fb.append(next);                 // ⚠️ 必须先入 controls 再 await ——
    controls.replaceChildren(fb);    //    否则按钮不在 DOM 里，永远点不到，流程死锁
    await new Promise((r) => next.addEventListener('click', r));
  }

  // ── 逐 trial 易读性（docs/03 §6.4）──
  const every = CONFIG.survey.perTrialEaseEveryN || 1;
  if (!isPractice && CONFIG.survey.perTrialEase && index % every === 0) {
    controller.unmount();
    root.hidden = true;
    screen.hidden = false;
    screen.replaceChildren();
    // 用「这是第几个正式试次」，而不是 plan 索引 ——
    // plan 里夹着 attention check，直接用 index 会显示成「第 51 题」（实际只有 48 题）
    const mainNo = session.trials.filter((x) => x.phase === 'main').length;
    const ease = await perTrialEase(screen, mainNo - 1);
    session.per_trial_ease.push({ trial_index: index, ease });
    save();
  }

  await wait(CONFIG.interTrialMs);
  // 清掉上一屏残留（否则会短暂闪回说明页/同意页），并保持隐藏 ——
  // 下一次真正要显示内容时由相应分支打开
  root.hidden = true;
  screen.hidden = true;
  screen.replaceChildren();
  renderer.clear();
}

async function runAttention(ctx, root, index) {
  const { session, save } = ctx;
  const t0 = performance.now();
  const wrap = h('div', 'screen attention');
  wrap.append(h('h2', null, t('attention.title')));
  wrap.append(h('p', null, t('attention.text')));
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'text';
  const btn = h('button', 'btn primary', t('common.submit'));
  btn.disabled = true;
  inp.addEventListener('input', () => { btn.disabled = inp.value.trim() === ''; });
  const err = h('p', 'error', '');
  wrap.append(inp, btn, err);
  root.replaceChildren(wrap);

  await new Promise((resolve) => {
    btn.addEventListener('click', () => {
      const v = inp.value.trim().toUpperCase();
      if (!v) { err.textContent = t('attention.empty'); return; }
      const passed = v === 'GRAPH';
      session.attention.total += 1;
      if (passed) session.attention.passed += 1; else session.attention.failed += 1;
      session.trials.push({
        trial_index: index, phase: 'attention', task: 'ATTENTION',
        response: v, correct: passed ? 1 : 0,
        rt_ms: Math.round(performance.now() - t0),
        timestamp: Date.now(),
        visibility_switches: session.trials.at(-1)?.visibility_switches ?? 0,
      });
      save();
      resolve();
    });
  });
  root.hidden = true;
}

// ─────────────────────────── ID 展示标签 ───────────────────────────

/**
 * 把 n-index 映射成一个每图固定、**与度数无关**的展示标签。
 *
 * 为什么需要：`docs/02 §5` 要求匿名化顺序（按度数降序，n0 是最高度节点）
 * **不得在渲染中体现**；而 `docs/01 §2.3`（GVRRI 规格）要求把已选节点的 ID
 * 列在左侧面板。直接显示 n-index 会让「n 越小度数越高」这件事可见 ——
 * 于是用每图固定的打乱编号同时满足两条。
 *
 * ⚠️ 标签必须**一次算全**：若按遇到顺序惰性累加，已显示过的编号会随
 * 新节点加入而变化，看到一半标签就变了。
 */
const _labelCache = new Map();

function labelMapFor(stim) {
  let m = _labelCache.get(stim.graph_id);
  if (!m) {
    const ids = stim.nodes.map((n) => n.id);
    const sorted = ids.slice().sort((a, b) =>
      (hashString(stim.graph_id + '|' + a) % 100000) -
      (hashString(stim.graph_id + '|' + b) % 100000));
    m = new Map(sorted.map((id, i) => [id, i + 1]));
    _labelCache.set(stim.graph_id, m);
  }
  return m;
}

function labelNum(stim, id) {
  return labelMapFor(stim).get(id) ?? '?';
}
function displayLabel(stim, id) {
  return `node ${labelNum(stim, id)}`;
}

boot().catch((e) => {
  console.error(e);
  renderError($('app'), t('errors.unexpected'), String(e && e.stack ? e.stack : e));
});
