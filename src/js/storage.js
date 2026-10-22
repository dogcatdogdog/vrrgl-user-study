/**
 * 落盘（docs/01 §6.2）
 *
 * 模式 A（默认）localStorage + 结束时 Blob 导出 —— 实验室用，无需服务器
 * 模式 B（Prolific）每题 POST 到 CONFIG.storage.endpoint
 *
 * 每 trial 自动保存，支持断点续传。
 */

const KEY = (pid) => `vrrgl.data.${pid}`;

export class Storage {
  constructor(cfg) {
    this.cfg = cfg;
    try {
      localStorage.setItem('vrrgl.probe', '1');
      localStorage.removeItem('vrrgl.probe');
      this.available = true;
    } catch {
      this.available = false;
    }
    // localStorage 不可用时退回内存，保证流程不中断（数据会在导出时给出告警）
    this._mem = {};
  }

  _get(k) { return this.available ? localStorage.getItem(k) : (this._mem[k] ?? null); }
  _set(k, v) { if (this.available) localStorage.setItem(k, v); else this._mem[k] = v; }
  _del(k) { if (this.available) localStorage.removeItem(k); else delete this._mem[k]; }

  load(pid) {
    const raw = this._get(KEY(pid));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  save(data) {
    this._set(KEY(data.participant_id), JSON.stringify(data));
    if (this.cfg.storage.mode === 'post' && this.cfg.storage.endpoint) this._post(data);
  }

  async _post(data) {
    try {
      await fetch(this.cfg.storage.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (e) {
      // 不静默：POST 失败必须可见，否则 Prolific 上会丢数据
      console.error('[storage] POST 失败，数据仍保存在本地：', e);
      this._postFailed = (this._postFailed || 0) + 1;
    }
  }

  clear(pid) { this._del(KEY(pid)); }

  /** 导出被试 JSON（Blob 下载）。 */
  download(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.participant_id}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
