/**
 * 端到端自动走查驱动（供 Playwright / 控制台注入使用）
 *
 * 用法（Playwright evaluate / 浏览器控制台）—— 用 <script> 注入，不用 eval：
 *   const s = document.createElement('script');
 *   s.src = '../tools/e2e_driver.js';
 *   document.head.append(s);
 *   await new Promise(r => s.onload = r);   // 装好后
 *   await window.__e2e.waitDone();          // 等跑完
 *   return window.__e2e.report();
 *
 * 它模拟一个「随便答」的被试：每个试次都作答、问卷给固定值。
 * 目的是把流程走通并暴露卡死/报错，**不是**模拟真实反应时。
 * 注意：它会用合成鼠标事件点击节点，因此把 rt_ms 压到几十毫秒，
 * 这些记录会被 minRtMs 标成 suspicious —— 那是预期行为。
 */
(() => {
  if (window.__e2e && window.__e2e.timer) clearInterval(window.__e2e.timer);

  const S = { n: 0, stop: false, done: false, seen: {}, errors: [] };

  const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
  }));
  const clickAt = (el, x, y) => {
    fire(el, 'pointerdown', x, y); fire(el, 'pointerup', x, y); fire(el, 'click', x, y);
  };
  const mid = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
  const bump = (k) => { S.seen[k] = (S.seen[k] || 0) + 1; };

  function tick() {
    if (S.stop || S.n > 300000) return;
    S.n++;
    try { step(); } catch (e) { S.errors.push(String(e && e.message || e)); }
  }

  function step() {
    const q = (s) => document.querySelector(s);
    const screen = q('#screen'), root = q('#trialroot');
    const screenVisible = screen && !screen.hidden;
    const rootVisible = root && !root.hidden;

    // ① 这些优先于「点图」
    if (q('.practice-feedback .btn')) { q('.practice-feedback .btn').click(); return; }
    if (q('.screen.done')) { S.stop = true; S.done = true; return; }
    if (screenVisible && q('.screen.break .btn')) { q('.screen.break .btn').click(); return; }

    const att = q('.screen.attention input.text');
    if (att) {
      att.value = 'GRAPH';
      att.dispatchEvent(new Event('input', { bubbles: true }));
      q('.screen.attention .btn.primary').click();
      bump('ATT'); return;
    }

    // ② 试次屏
    if (rootVisible) {
      const svg = q('#trialroot svg#graph');
      if (!svg) return;
      const blue = [...svg.querySelectorAll('circle[fill="#2196f3"]')];
      if (blue.length === 2) {                       // T4
        const [x, y] = mid(blue[0]); clickAt(svg, x, y); bump('T4');
      } else if (q('.controls input.num')) {         // T2
        q('.controls input.num').value = '5';
        q('.controls .btn.primary').click(); bump('T2');
      } else {                                       // T1
        [...svg.querySelectorAll('circle[fill="#9e9e9e"]')].slice(0, 3)
          .forEach((g) => { const [x, y] = mid(g); clickAt(svg, x, y); });
        const sub = q('.controls .btn.primary');
        if (sub && !sub.disabled) sub.click();
        bump('T1');
      }
      return;
    }

    if (!screenVisible) return;                      // 过渡中

    // ③ 其它屏
    const ease = q('form.ease');
    if (ease) {
      ease.querySelector('input[name=ease][value="5"]').checked = true;
      ease.querySelector('.btn.primary').click(); bump('EASE'); return;
    }
    const tlx = q('form.survey input[type=range]');
    if (tlx) {
      const f = tlx.closest('form');
      f.querySelectorAll('input[type=range]').forEach((r) => { r.value = '40'; });
      f.querySelector('.btn.primary').click(); bump('TLX'); return;
    }
    if (q('.screen.welcome .btn')) { q('.screen.welcome .btn').click(); bump('WELCOME'); return; }

    const agree = q('.consent-actions .btn.primary');
    if (agree) {
      document.querySelectorAll('.consent-check input').forEach((i) => {
        if (!i.checked) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      if (!agree.disabled) agree.click();
      return;
    }
    if (q('form.survey input[name=age]')) {
      const f = q('form.survey');
      f.querySelector('input[name=age]').value = '30';
      f.querySelector('select[name=gender]').value = 'M';
      f.querySelector('select[name=field]').value = 'CS';
      f.querySelector('input[name=graph_familiarity][value="4"]').checked = true;
      f.querySelector('select[name=graph_frequency]').value = 'monthly';
      f.querySelector('.btn.primary').click(); bump('DEMO'); return;
    }
    if (q('.literacy-item')) {
      document.querySelectorAll('.literacy-item').forEach((s) => {
        const n = s.querySelector('input[type=number]');
        if (n) n.value = '5';
        else { const c = s.querySelector('circle');
               if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
      });
      q('form.survey .btn.primary').click(); bump('LIT'); return;
    }
    const instr = q('.screen.instructions .btn.primary');
    if (instr) { instr.click(); bump('INSTR'); return; }
  }

  S.timer = setInterval(tick, 70);

  S.waitDone = (timeoutMs = 240000) => new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const timedOut = Date.now() - t0 > timeoutMs;
      if (S.done || S.stop || timedOut) {
        clearInterval(iv);
        resolve({ finished: S.done, timedOut: timedOut && !S.done, ticks: S.n, seen: S.seen });
      }
    }, 800);
  });

  S.report = () => ({
    finished: S.done, ticks: S.n, seen: S.seen, errors: S.errors,
    onDoneScreen: !!document.querySelector('.screen.done'),
    data: JSON.parse(localStorage.getItem(`vrrgl.data.${new URLSearchParams(location.search).get('pid')}`) || 'null'),
  });

  window.__e2e = S;
})();
