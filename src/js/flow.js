/**
 * 流程状态机与流程内控件（docs/01 §5）
 *
 * WELCOME → CONSENT → DEMOGRAPHICS → LITERACY → INSTRUCTIONS
 *   → PRACTICE×4 → MAIN×48（每 12 题强制休息）→ QUESTIONNAIRE → DONE
 */

import { t } from './i18n.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** 底部进度条（GVRRI 做法）。 */
export class ProgressBar {
  constructor(host) {
    this.el = h('div', 'progress');
    this.fill = h('div', 'progress-fill');
    this.label = h('div', 'progress-label', '');
    this.el.append(this.fill, this.label);
    host.append(this.el);
  }
  set(done, total, text = null) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    this.fill.style.width = `${pct}%`;
    this.label.textContent = text ?? `${done} / ${total}`;
  }
  show(v = true) { this.el.style.display = v ? '' : 'none'; }
}

/** 强制休息倒计时（可跳过）。 */
export class BreakScreen {
  constructor(container, cfg) {
    this.container = container;
    this.cfg = cfg;
  }
  /** @returns {Promise<void>} */
  run(completedTrials, totalTrials) {
    return new Promise((resolve) => {
      this.container.replaceChildren();
      this.container.hidden = false;   // 试次结束后 #screen 是隐藏的
      const wrap = h('div', 'screen break');
      wrap.append(h('h2', null, t('breakdown.title')));
      wrap.append(h('p', null, t('breakdown.body', { done: completedTrials, total: totalTrials })));
      const count = h('div', 'break-count', String(this.cfg.breakDurationSec));
      wrap.append(count);
      const skip = h('button', 'btn primary', t('breakdown.skip'));
      wrap.append(skip);

      let left = this.cfg.breakDurationSec;
      const timer = setInterval(() => {
        left -= 1;
        count.textContent = String(Math.max(left, 0));
        if (left <= 0) { clearInterval(timer); done(); }
      }, 1000);

      const done = () => { clearInterval(timer); resolve(); };
      skip.addEventListener('click', done);
      this.container.append(wrap);
    });
  }
}

/** 欢迎页。 */
export function renderWelcome(container, onStart, pid = null, group = 'lab') {
  container.replaceChildren();
  const w = h('div', 'screen welcome');
  w.append(h('h1', null, t('welcome.title')));
  if (pid) {
    const g = group === 'remote' ? t('welcome.groupRemote') : t('welcome.groupLab');
    w.append(h('p', 'pid-badge', `${t('welcome.pidLabel')}: ${pid}（${g}）`));
    // 「关掉标签页开下一位」只对实验室有意义；远程被试看到会困惑
    if (group !== 'remote') w.append(h('p', 'hint', t('welcome.labHint')));
  }
  w.append(h('p', null, t('welcome.intro')));
  w.append(h('p', null, t('welcome.note')));
  const b = h('button', 'btn primary', t('common.begin'));
  b.addEventListener('click', onStart);
  w.append(b);
  container.append(w);
}

/** 任务说明页（每个任务给一个静态示意 —— docs/03 §8①）。 */
export function renderInstructions(container, { enabledTasks, examples, onStart }) {
  container.replaceChildren();
  const w = h('div', 'screen instructions');
  w.append(h('h2', null, t('instructions.title')));

  if (enabledTasks.includes('T1')) {
    const s = h('section');
    s.append(h('h3', null, t('instructions.t1Title')));
    s.append(h('p', null, t('instructions.t1Text')));
    s.append(h('p', 'hint', t('instructions.t1Hint')));
    w.append(s);
  }
  if (enabledTasks.includes('T4')) {
    const s = h('section');
    s.append(h('h3', null, t('instructions.t4Title')));
    s.append(h('p', null, t('instructions.t4Text')));
    w.append(s);
  }
  if (enabledTasks.includes('T2')) {
    const s = h('section');
    s.append(h('h3', null, t('instructions.t2Title')));
    s.append(h('p', null, t('instructions.t2Text')));
    w.append(s);
  }

  if (examples?.length) {
    const box = h('section', 'example-box');
    box.append(h('h3', null, t('instructions.example')));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 900 620');
    svg.setAttribute('width', 620);
    svg.setAttribute('height', 427);
    box.append(svg);
    w.append(box);
    requestAnimationFrame(() => drawStatic(svg, examples[0], examples[0].targets.slice(0, 1)));
  }

  const b = h('button', 'btn primary', t('common.startPractice'));
  b.addEventListener('click', onStart);
  w.append(b);
  container.append(w);
}

function drawStatic(svg, stim, targets) {
  const NS = 'http://www.w3.org/2000/svg';
  svg.replaceChildren();
  svg.style.background = '#fff';
  const pos = new Map(stim.nodes.map((n) => [n.id, n]));
  for (const e of stim.edges) {
    const a = pos.get(e.s), b = pos.get(e.t);
    if (!a || !b) continue;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
    l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    l.setAttribute('stroke', '#9e9e9e'); l.setAttribute('stroke-width', 2);
    svg.append(l);
  }
  const T = new Set(targets);
  for (const n of stim.nodes) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', 5);
    c.setAttribute('fill', T.has(n.id) ? '#2196f3' : '#9e9e9e');
    svg.append(c);
  }
}

/** 结束页（Prolific 用完成码）。 */
export function renderDone(container, { session, cfg, onExport }) {
  container.replaceChildren();
  const w = h('div', 'screen done');
  w.append(h('h1', null, t('done.title')));

  const isProlific = cfg.consent.condition === 'prolific';
  if (isProlific && cfg.prolific.completionCode) {
    w.append(h('p', null, t('done.completionCode')));
    const code = h('div', 'code', cfg.prolific.completionCode);
    w.append(code);
  }

  // 只数正式试次 —— practice 与 attention 不是任务本身
  // 被试编号要显著显示 —— 研究员靠它把文件和人对上
  if (session.participant_id) {
    w.append(h('div', 'code', session.participant_id));
    w.append(h('p', 'hint', t('done.pid', { pid: session.participant_id })));
  }
  const nT = session.trials.filter((x) => x.phase === 'main').length;
  const att = session.attention;
  w.append(h('p', null, t('done.trials', { n: nT })));
  if (att.total) {
    w.append(h('p', 'hint', t('done.attention', { passed: att.passed, total: att.total })));
  }

  const b = h('button', 'btn primary', t('common.download'));
  b.addEventListener('click', onExport);
  w.append(b);
  if (session.group === 'remote') {
    // 远程被试：数据只在他自己的浏览器里，必须提醒他发回来
    w.append(h('p', 'consent-preamble', t('done.remoteCollect')));
  } else if (!cfg.storage || cfg.storage.mode === 'localStorage') {
    w.append(h('p', 'hint', t('done.collect')));
  }
  container.append(w);
}

/** 通用错误屏 —— 绝不静默失败。 */
export function renderError(container, message, detail = '') {
  container.replaceChildren();
  const w = h('div', 'screen error-screen');
  w.append(h('h2', null, t('errors.title')));
  w.append(h('p', null, message));
  if (detail) w.append(h('pre', 'error-detail', detail));
  container.append(w);
}
