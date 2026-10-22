/**
 * ★ 唯一硬编码点（docs/01 §3）
 *
 * 其它模块一律从 CONFIG 读取，不得自带魔术数字。
 * 三类硬要求（docs/01 §3.3）：
 *   1. 所有项都有默认值，缺省即可跑
 *   2. 未知配置键**报错**而不是静默忽略（防止拼写错误导致配置不生效）
 *   3. 启动时打印生效配置摘要，并写入被试数据的 config 字段
 */

import { getLocale } from './i18n.js';

/** 规范形状 —— 同时也是「允许出现哪些键」的唯一真相源。 */
const DEFAULTS = {
  // ───────── 任务 ─────────
  tasks: {
    T1: { enabled: true, wording: 'factual' },   // 'factual' | 'perceptual'（GVRRI 的 VRR 措辞）
    T4: { enabled: true },
    T2: { enabled: false },                      // ← 默认关闭，pilot 后决定
  },
  // practiceTrials = 各任务的题数上限，**仅对 enabled 的任务生效**
  //   T2 关闭时（默认）→ 练习 4 题（T1:2 + T4:2）
  //   T2 开启时        → 练习 5 题（T1:2 + T4:2 + T2:1）
  practiceTrials: { T1: 2, T4: 2, T2: 1 },
  practiceFeedback: true,

  // ───────── 实验因子 ─────────
  // LPFD = 本文方法；KK = 最强几何基线；FR / FA2 = 经典与现代力导向代表
  layouts: ['LPFD', 'KK', 'FR', 'FA2'],
  degreeLevels: ['low', 'high'],   // 低 = 度 2–8 ／ 高 = 度 ≥16（无上限）（docs/02 §3.2）
  trialsPerCell: 2,                  // 4 布局 × 2 档 × 2 = 16 图
  assignment: 'latin_square',   // 'latin_square' | 'full_within'
  // offset 的来源（决定「图 → 布局」跨被试怎么轮转）
  //   'auto'    共用浏览器用计数器（精确轮转）；独立浏览器用 pid 哈希（众包必需）
  //   'counter' 强制用本地计数器 —— ★ 众包下会让 offset 恒为 0，映射永久固定
  //   'hash'    强制用哈希 —— 无共享状态也能均衡，但小样本略有偏差
  offsetSource: 'auto',

  // ───────── 采集方式 ─────────
  //   'lab'    固定机器（编号 L001…）
  //   'remote' 远程被试（编号 R001…，可在网址用 ?group=remote 临时切换）
  //   两套编号前缀不同 —— 否则远程每台机器都从 001 开始，回收的文件会与实验室撞号
  participantGroup: 'lab',
  //   'code' 先输实验编号（远程必需：保证每个编号唯一、offset 预先分派且均衡）
  //   'auto' 自动编号（实验室省事，但每台新浏览器都会从头编号，不能用于远程）
  entryMode: 'code',

  // ───────── 界面语言 ─────────
  //   'zh' 中文 ／ 'en' 英文 ／ 'auto' 按浏览器语言（中文环境→中文）
  //   界面字符串见 js/i18n.js；知情同意书正文按语言分版本，见 stimuli/consent.json
  locale: 'zh',

  // ───────── 渲染（规格与 GVRRI 对齐，docs/01 §2.3）─────────
  normalization: 'bounding_box',   // 刺激坐标在生成阶段已归一化，App 只按画布平移
  targetMedianPx: 40,              // 仅 median_edge 归一化用；见 tools/build_stimuli.py
  canvas: { width: 900, height: 620, background: '#ffffff' },
  nodeRadius: 5,
  edgeWidth: 2,
  colors: {
    node: '#9e9e9e',
    edge: '#9e9e9e',
    target: '#2196f3',           // 目标节点：蓝色【填充】
    selectedOutline: '#e53935',  // 已选中：红色【描边】，填充不变（docs/01 §2.3.1）
    selectedOutlineWidth: 3,
  },
  highlightHubs: false,   // ★ 必须为 false（docs/01 §2.1 绝对禁令）
  showNodeLabels: false,  // ★ 图上不显示节点标签
  showIdPanel: true,
  showProgressBar: true,
  enablePanZoom: true,

  // ───────── 交互 ─────────
  interactions: {
    clickToToggle: true,
    rubberBandSelect: true,
    freehandLasso: false,
    clickSubmitsT4: true,
  },

  // ───────── 质量控制 ─────────
  attentionChecks: 2,
  breakEveryNTrials: 12,
  breakDurationSec: 30,
  fullscreenRequired: false,
  detectVisibilityChange: true,
  minRtMs: 1000,
  stimulusFadeMs: 500,      // 题干显示后淡出（docs/03 §8）
  interTrialMs: 500,

  // ───────── 问卷 ─────────
  survey: {
    demographics: true,
    literacy: false,         // ✅ 已取消：无可用的经验证量表（docs/03 §6.3）。模块保留，将来拿到 NVL 改回 true
    perTrialEase: true,
    perTrialEaseEveryN: 1,
    nasaTlx: true,
    tlxWeighted: false,      // true = 15 对成对比较；false = 等权
    prevIs: false,           // ⚠️ 适配性待确认，默认关（docs/03 §6.5）
    preference: false,       // 会破坏盲测，必须放最后
  },

  // ───────── 知情同意（docs/06）─────────
  consent: {
    version: '1.0',
    condition: 'lab',             // 'lab' | 'prolific'
    textPath: '../stimuli/consent.json',
    screenOutUrl: null,           // Prolific「我不同意」的筛除链接（★ 不是完成码）
    requireExplicitAgreement: true, // 禁止预勾选（GDPR Art. 4(11)）
  },
  prolific: { completionCode: null, screenOutCode: null },

  // ───────── 落盘 ─────────
  storage: {
    mode: 'localStorage',   // 'localStorage' | 'post'
    endpoint: null,
    autosaveEveryTrial: true,
    stimPath: '../stimuli',
  },
};

/** 允许在运行时覆盖的键（留空 = 使用默认值）。 */
const OVERRIDES = {};

// ─────────────────────────── 深合并 + 校验 ───────────────────────────

const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

function deepMerge(base, over, path = '') {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    const here = path ? `${path}.${k}` : k;
    if (!(k in base)) {
      // 未知键**报错**而不是静默忽略（docs/01 §3.3）
      throw new Error(
        `[config] 未知配置键 "${here}"。若确实要新增，请先加进 config.js 的 DEFAULTS。`
      );
    }
    if (isPlain(v) && isPlain(base[k])) out[k] = deepMerge(base[k], v, here);
    else if (isPlain(v) || isPlain(base[k])) {
      throw new Error(`[config] 配置键 "${here}" 类型不匹配（对象 vs 标量）。`);
    } else out[k] = v;
  }
  return out;
}

export const CONFIG = deepMerge(DEFAULTS, OVERRIDES);

/** 启动自检 —— 违反绝对禁令时大声告警（docs/01 §2.1）。 */
export function assertConfigSanity() {
  const problems = [];
  if (CONFIG.highlightHubs) {
    problems.push(
      'highlightHubs = true —— 这会让 T4 退化成「找红色的」，任务完全失效（docs/01 §2.1）。'
    );
  }
  if (CONFIG.showNodeLabels) {
    problems.push('showNodeLabels = true —— 节点标签会引入语义干扰（docs/01 §2.3）。');
  }
  if (CONFIG.consent.condition === 'prolific' && !CONFIG.consent.screenOutUrl) {
    problems.push(
      'consent.condition = prolific 但未设置 screenOutUrl ——「我不同意」会被当成完成，平台会收费。'
    );
  }
  const enabled = Object.entries(CONFIG.tasks).filter(([, t]) => t.enabled).map(([k]) => k);
  if (!enabled.length) problems.push('没有任何任务被启用。');
  return { problems, enabled };
}

/** 生效配置摘要 —— 打印到控制台并写入数据文件的 config 字段（docs/01 §3.3）。 */
export function configSummary() {
  return {
    layouts: CONFIG.layouts,
    degreeLevels: CONFIG.degreeLevels,
    enabledTasks: Object.entries(CONFIG.tasks).filter(([, t]) => t.enabled).map(([k]) => k),
    T1Wording: CONFIG.tasks.T1.wording,
    normalization: CONFIG.normalization,
    highlightHubs: CONFIG.highlightHubs,
    practiceTrials: CONFIG.practiceTrials,
    assignment: CONFIG.assignment,
    offsetSource: CONFIG.offsetSource,
    participantGroup: CONFIG.participantGroup,
    entryMode: CONFIG.entryMode,
    survey: CONFIG.survey,
    // 本次会话实际使用的界面语言（由 main.js 在渲染前 setLocale）
    locale: getLocale(),
    consent: { version: CONFIG.consent.version, condition: CONFIG.consent.condition },
    storage: { mode: CONFIG.storage.mode },
  };
}
