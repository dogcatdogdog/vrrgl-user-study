/**
 * 计时与作答记录（docs/01 §7.3、docs/03 §2.7）
 *
 * ⚠️ 计时从【图渲染完成】开始，不是从题目出现开始 —— 用 performance.now()。
 * ⚠️ 切屏次数全程累计，写进每条 trial。
 */

export class Recorder {
  constructor(cfg) {
    this.cfg = cfg;
    this.visibilitySwitches = 0;
    this.t0 = null;
    this.trialStartWall = null;
    this._armed = false;
    this._install();
  }

  _install() {
    if (!this.cfg.detectVisibilityChange) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this._armed) {
        this.visibilitySwitches++;
        this._onSwitch?.(this.visibilitySwitches);
      }
    });
  }

  onVisibilitySwitch(fn) { this._onSwitch = fn; }

  /** 图渲染完成后调用 —— 从这里开始计时。 */
  startTrial() {
    this.t0 = performance.now();
    this.trialStartWall = Date.now();
    this._armed = true;
  }

  /** 作答完成，返回该 trial 的计时字段。 */
  stopTrial() {
    const now = performance.now();
    this._armed = false;
    const rt = this.t0 == null ? null : Math.round(now - this.t0);
    return {
      rt_ms: rt,
      timestamp: this.trialStartWall ?? Date.now(),
      visibility_switches: this.visibilitySwitches,
      // 事后过滤用（docs/01 §5：低于 minRtMs 标记为可疑）
      suspicious_rt: rt != null && rt < this.cfg.minRtMs ? 1 : 0,
    };
  }

  resetSwitchCount() { this.visibilitySwitches = 0; }
}

/** 禁右键 / 禁复制（docs/01 §5 防作弊）。 */
export function installAntiCheat(doc = document) {
  doc.addEventListener('contextmenu', (e) => e.preventDefault());
  doc.addEventListener('copy', (e) => e.preventDefault());
  doc.addEventListener('cut', (e) => e.preventDefault());
  doc.addEventListener('selectstart', (e) => {
    // 允许输入框内选择，其余禁止
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  });
}

/** 环境信息（写进数据文件的 system 字段）。 */
export function systemInfo() {
  return {
    ua: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
  };
}
