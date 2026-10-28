/**
 * 实验编号入口
 *
 * 被试（远程或实验室）打开网址后，先输入研究者发给他的编号，再进入实验。
 * 编号决定两件事：**被试的唯一标识** 和 **Latin square 的 offset**（图→布局）。
 *
 * 编号表在 `stimuli/codes.json`，由 `tools/make_codes.py` 生成。
 * 每个编号自带预先分派好的 offset —— 所以四种布局的样本量是**精确均衡**的，
 * 不依赖运行时哈希（哈希在小样本下会偏斜）。
 *
 * 编号大小写不敏感，空格与连字符会被忽略（`r-7k4m` 与 `R7K4M` 等价）。
 */

import { t } from './i18n.js';

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** ` r-7k4m ` → `R7K4M` */
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[\s\-_]/g, '');
}

export async function loadCodes(cfg) {
  const path = (cfg.storage.stimPath || '../stimuli') + '/codes.json';
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** 从编号表里取元信息；找不到返回 null。 */
export function lookupCode(codesDoc, raw) {
  const key = normalizeCode(raw);
  if (!key) return null;
  const meta = codesDoc?.codes?.[key];
  // 保留 mode 等扩展字段（复测编号用），不要把 meta 里的信息丢掉
  return meta ? { ...meta, code: key } : null;
}

/**
 * 渲染编号输入屏。
 * @returns {Promise<{code, offset, group}>}
 */
export function renderCodeEntry(container, { codesDoc, prefill = '', message = '' }) {
  return new Promise((resolve) => {
    container.replaceChildren();
    const w = h('div', 'screen welcome code-entry');
    w.append(h('h1', null, t('entry.title')));
    w.append(h('p', null, t('entry.hint')));

    const form = h('form', 'code-form');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'code-input';
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 12;
    input.placeholder = t('entry.placeholder');
    input.value = prefill;

    const btn = h('button', 'btn primary', t('entry.submit'));
    btn.type = 'submit';
    const err = h('p', 'error', message);

    form.append(input, btn);
    w.append(form, err);
    w.append(h('p', 'hint', t('entry.needCode')));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const hit = lookupCode(codesDoc, input.value);
      if (!hit) {
        err.textContent = t('entry.invalid');
        input.classList.add('invalid');
        input.focus();
        input.select();
        return;
      }
      resolve(hit);
    });

    container.append(w);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

/** 编号表缺失时的错误提示（部署漏了 codes.json 就会走到这里）。 */
export function renderMissingCodes(container, detail = '') {
  container.replaceChildren();
  const w = h('div', 'screen error-screen');
  w.append(h('h2', null, t('errors.title')));
  w.append(h('p', null, t('entry.missingTable')));
  if (detail) w.append(h('pre', 'error-detail', detail));
  container.append(w);
}
