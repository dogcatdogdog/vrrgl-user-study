/**
 * 会话管理（docs/01 §4）
 *
 * - 被试 ID 来自 URL 参数 ?pid=xxx（Prolific 会带自己的参数）
 * - 支持断点续传：从 localStorage 恢复进度
 * - 数据文件的顶层结构见 docs/01 §6.2，另按 docs/06 §2 扩充了 consent / prolific_id
 */

import { configSummary } from './config.js';
import { systemInfo } from './record.js';
import { getOrAssignParticipantIndex } from './randomize.js';

export function parseParams(search = location.search) {
  const p = new URLSearchParams(search);
  // Prolific 会额外带 PROLIFIC_PID / STUDY_ID / SESSION_ID
  const prolificId = p.get('PROLIFIC_PID') || p.get('prolific_pid') || null;
  const pid = p.get('pid') || prolificId || null;
  return {
    pid,
    prolificId,
    studyId: p.get('STUDY_ID') || null,
    sessionId: p.get('SESSION_ID') || null,
    // 便于本地调试：?condition=prolific 可强制切版本
    condition: p.get('condition') || null,
    // 采集方式：'lab'（固定机器）| 'remote'（远程被试）
    group: p.get('group') || null,
  };
}

/**
 * 实验室模式：网址里没给 pid 时，按**标签页**自动分配编号 L001、L002……
 *
 * 为什么用 sessionStorage 而不是 localStorage：
 *   · **刷新**页面 → 编号不变 → 断点续传照常工作（被试刷新不会丢进度）
 *   · **新开标签页 / 重开浏览器** → 新编号 → 下一位被试是全新会话
 *
 * 这正是「同一台机器被反复使用」所需要的语义：
 *   关掉标签页 → 开新的 → 自动就是下一位被试，不需要手动改网址。
 */
/** 采集组的编号前缀。
 *   lab    → L001、L002……   固定机器
 *   remote → R001、R002……   远程被试（各自浏览器，编号互不相干）
 *  两套前缀必须不同：远程每台机器都会从 001 开始，若都用 L 前缀，
 *  回收来的 L001.json 会和实验室的 L001 撞号，合并时无法区分。
 */
const GROUP_PREFIX = { lab: 'L', remote: 'R' };

export function autoParticipantId(group = 'lab') {
  const prefix = GROUP_PREFIX[group] || 'L';
  const TAB = `vrrgl.tabPid.${group}`;
  const COUNTER = `vrrgl.counter.${group}`;
  try {
    const existing = sessionStorage.getItem(TAB);
    if (existing) return existing;
    let n = parseInt(localStorage.getItem(COUNTER) || '0', 10) + 1;
    // 跳过已被占用的编号 —— 防止「重置编号后撞上旧数据」把两份数据混在一起
    let pid = `${prefix}${String(n).padStart(3, '0')}`;
    while (localStorage.getItem(`vrrgl.data.${pid}`)) {
      n += 1;
      pid = `${prefix}${String(n).padStart(3, '0')}`;
    }
    localStorage.setItem(COUNTER, String(n));
    sessionStorage.setItem(TAB, pid);
    return pid;
  } catch {
    // 隐私模式等 sessionStorage 不可用 → 时间戳兜底（至少唯一）
    return `${prefix}${Date.now().toString(36).toUpperCase()}`;
  }
}

export function newSession({ pid, prolificId, condition, group, cfg, store }) {
  const now = Date.now();
  // 配置快照里要写**实际生效**的采集组，而不是 config 的默认值
  const cfgSnap = configSummary();
  cfgSnap.participantGroup = group || cfg.participantGroup || 'lab';
  return {
    participant_id: pid,
    // Prolific ID 与 study data 分开存放（docs/06 §2 实现要点 1）
    prolific_id: prolificId || null,
    condition: condition || cfg.consent.condition,
    // 采集方式 —— 分析时用来区分「实验室固定机器」与「远程被试」
    group: group || cfg.participantGroup || 'lab',
    consent: null,              // { agreed, timestamp, version, condition } —— 见 consent.js
    started_at: new Date(now).toISOString(),
    finished_at: null,
    completed: false,

    demographics: null,
    literacy: null,
    per_trial_ease: [],
    nasa_tlx: null,
    previs: null,
    preference: null,

    trials: [],
    attention: { total: 0, passed: 0, failed: 0 },

    // 生效配置快照 —— 事后核对用的是哪套配置（docs/01 §3.3）
    config: cfgSnap,
    // 本被试的 offset 与「图 → 布局」映射（可复现）
    assignment: null,
    system: systemInfo(),
  };
}

/**
 * 建立或恢复会话。返回 { session, resumed, participantIndex }。
 */
/** @param entry 可选 { code, offset, group } —— 来自编号表（entryMode === 'code'） */
export function openSession(cfg, store, entry = null) {
  const params = parseParams();
  let { pid, prolificId, condition } = params;
  let group = params.group || cfg.participantGroup || 'lab';
  let assignedOffset = null;

  if (entry) {
    pid = entry.code;
    group = entry.group || group;
    assignedOffset = entry.offset;
  }

  if (!pid) {
    // 众包必须带 id（Prolific 会传 PROLIFIC_PID）——没有就别跑，否则付不了钱
    if (cfg.consent.condition === 'prolific') {
      const err = new Error('缺少被试 ID（Prolific 应自动传入 PROLIFIC_PID）');
      err.code = 'NO_PID';
      throw err;
    }
    // 实验室 / 远程：自动分配（前缀区分采集组），不需要研究员手动改网址
    pid = autoParticipantId(group);
  }
  // 有编号表时不走计数器/哈希 —— offset 是预先分派好的
  const participantIndex = assignedOffset === null
    ? getOrAssignParticipantIndex(pid, store, { source: cfg.offsetSource })
    : assignedOffset;

  const storage = new SessionStorage(store);
  const existing = storage.load(pid);
  if (existing && !existing.completed) {
    return { session: existing, resumed: true, participantIndex, assignedOffset };
  }
  if (existing && existing.completed) {
    // 已完成的被试重新打开：给一个清晰的出口，不静默重跑
    const err = new Error(`被试 ${pid} 已完成实验。如需重测请换一个 pid。`);
    err.code = 'ALREADY_DONE';
    err.session = existing;
    throw err;
  }
  return {
    session: newSession({ pid, prolificId, condition, group, cfg, store }),
    resumed: false,
    participantIndex,
    assignedOffset,
  };
}

/** 薄封装，方便 session.js 不直接依赖 Storage 类。 */
class SessionStorage {
  constructor(store) { this.store = store; }
  load(pid) {
    try { return JSON.parse(this.store.getItem(`vrrgl.data.${pid}`) || 'null'); }
    catch { return null; }
  }
}
