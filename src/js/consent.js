/**
 * 知情同意屏（docs/06）
 *
 * 实现要点（docs/06 §2「🛠 实现要点」，逐条对照）：
 *   1. **记录同意时间戳**，与 Prolific ID 一起存储 —— Prolific 明确要求
 *   2. 强制选择、**不预勾选**（GDPR Art. 4(11)）
 *   3. 选「我不同意」→ 走 **Prolific 筛除链接**，**不是** completion code
 *   4. 不要把同意与资格筛选合并成一步
 *   5. 色觉 / 桌面设备两个自述做成**筛除分支**
 *
 * 文本全部来自 stimuli/consent.json（23 项待填），用 textContent 写入，
 * 不解析 HTML —— 既避免注入，也让你填空时不必关心转义。
 */

import { t, getLocale } from './i18n.js';

/** 按 [condition][locale] 取对应语言的同意书正文。 */
export function pickConsentDoc(doc, condition, locale) {
  const byCond = doc[condition];
  if (!byCond) throw new Error(`同意书缺少 condition: ${condition}`);
  const out = byCond[locale] || byCond.en;
  if (!out) throw new Error(`同意书缺少 ${condition}.${locale} 且无 en 回退`);
  return out;
}

export async function loadConsentText(cfg) {
  const res = await fetch(cfg.consent.textPath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`无法读取同意书文本：${cfg.consent.textPath}（HTTP ${res.status}）`);
  return res.json();
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;   // 一律 textContent，不用 innerHTML
  return n;
};

export function renderConsent(container, doc, cfg, onSubmit) {
  container.replaceChildren();
  const wrap = h('div', 'consent');

  wrap.append(h('h1', 'consent-title', doc.title));

  const head = h('div', 'consent-header');
  for (const row of doc.header || []) {
    const line = h('div', 'consent-header-row');
    line.append(h('span', 'label', `${row.label}: `), h('span', 'value', row.value));
    head.append(line);
  }
  wrap.append(head);

  if (doc.preamble) wrap.append(h('p', 'consent-preamble', doc.preamble));

  if (doc.keyInfo?.length) {
    const box = h('section', 'consent-keyinfo');
    box.append(h('h2', null, t('consent.keyInfo')));
    const ul = h('ul');
    for (const t of doc.keyInfo) ul.append(h('li', null, t));
    box.append(ul);
    wrap.append(box);
  }

  for (const s of doc.sections || []) {
    // 跳过「同意声明」那一节 —— 下面会用勾选框单独渲染，否则标题会重复出现两次
    if (/statement of consent|同意声明/i.test(s.heading)) continue;
    const sec = h('section', 'consent-section');
    sec.append(h('h2', null, s.heading));
    for (const p of s.paragraphs || []) sec.append(h('p', null, p));
    if (s.bullets?.length) {
      const ul = h('ul');
      for (const b of s.bullets) ul.append(h('li', null, b));
      sec.append(ul);
    }
    for (const p of s.paragraphsAfter || []) sec.append(h('p', null, p));
    wrap.append(sec);
  }

  // ── 资格自述（docs/06 §2 要点 5：做成筛除分支）──
  const isProlific = cfg.consent.condition === 'prolific';
  const eligibility = h('section', 'consent-section consent-eligibility');
  eligibility.append(h('h2', null, t('consent.beforeStart')));
  const eligChecks = [];

  const mkCheck = (label, screening = false) => {
    const id = `chk-${Math.random().toString(36).slice(2, 8)}`;
    const line = h('label', 'consent-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = false;                 // ★ 绝不预勾选
    input.dataset.screening = screening ? '1' : '0';
    line.append(input, h('span', null, label));
    eligibility.append(line);
    eligChecks.push(input);
    return input;
  };

  mkCheck(t('consent.age'));
  if (isProlific) {
    mkCheck(t('consent.colour'), true);
    mkCheck(t('consent.desktop'), true);
  } else {
    mkCheck(t('consent.vision'));
  }
  wrap.append(eligibility);

  // ── 同意声明 ──
  const agr = doc.agreement || {};
  const sec = h('section', 'consent-section consent-agreement');
  sec.append(h('h2', null, t('consent.statement')));
  const optIdx = new Set(agr.optionalIndices || []);
  const consentChecks = (agr.items || []).map((label, i) => {
    const line = h('label', 'consent-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = false;                 // ★ 绝不预勾选
    line.append(input, h('span', null, label));
    sec.append(line);
    if (optIdx.has(i) && agr.optionalNote) {
      sec.append(h('p', 'consent-note', agr.optionalNote));
    }
    return { input, optional: optIdx.has(i) };
  });
  wrap.append(sec);

  // ── 按钮 ──
  const actions = h('div', 'consent-actions');
  const agree = h('button', 'btn primary', agr.agreeLabel || 'I agree to take part in this study.');
  agree.disabled = true;
  const disagree = h('button', 'btn', agr.disagreeLabel || 'I do not agree.');
  actions.append(agree, disagree);
  wrap.append(actions);

  const status = h('p', 'consent-status', '');
  wrap.append(status);

  const required = consentChecks.filter((c) => !c.optional).map((c) => c.input);
  const refresh = () => {
    const allRequired = required.every((c) => c.checked);
    const allElig = eligChecks.every((c) => c.checked);
    agree.disabled = !(allRequired && allElig);
    status.textContent = agree.disabled
      ? t('consent.mustTick')
      : '';
  };
  for (const c of [...required, ...eligChecks]) c.addEventListener('change', refresh);

  agree.addEventListener('click', () => {
    // 不合并资格筛选与同意（要点 4）—— 这里只在同意之后才判定筛除
    const failed = eligChecks.filter((c) => c.dataset.screening === '1' && !c.checked);
    onSubmit({
      agreed: true,
      timestamp: Date.now(),
      version: cfg.consent.version,
      condition: cfg.consent.condition,
      checks: consentChecks.map((c) => c.input.checked),
      // 资格自述的完整记录（供分析时核对）
      eligibility: eligChecks.map((c) => c.checked),
      failedScreening: failed.length,
    });
  });

  disagree.addEventListener('click', () => {
    onSubmit({ agreed: false, timestamp: Date.now(), version: cfg.consent.version });
  });

  container.append(wrap);
}

/**
 * 不同意时的去向。
 * ★ 必须走 Prolific 的**筛除链接**，不能用 completion code —— 否则平台会照常收费。
 */
export function routeDeclined(cfg) {
  const url = cfg.consent.screenOutUrl;
  if (cfg.consent.condition === 'prolific' && url) {
    location.href = url;
    return t('errors.redirecting');
  }
  return t('consent.declined');
}
