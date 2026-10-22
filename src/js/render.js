/**
 * 图的渲染（docs/01 §2.3 + §2.3.1）
 *
 * 视觉规格与 GVRRI 对齐：900×620 白底 / 灰节点 r=5 / 灰边 2px /
 * 目标节点【蓝色填充】/ 已选中【红描边，填充不变】/ 图上无任何标签。
 *
 * ⚠️ 坐标在刺激生成阶段就已归一化完毕（包围盒 + 8% 留白），
 *    App 直接画，不做二次缩放 —— 这保证了四种布局的尺度处理完全一致。
 *
 * ⚠️ 绝对禁令（docs/01 §2.1）：不得用大小/颜色/位置暗示度数。
 *    所有非目标节点必须同色同半径。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

export class GraphRenderer {
  constructor(svg, cfg) {
    this.svg = svg;
    this.cfg = cfg;
    this.view = { k: 1, x: 0, y: 0 };   // 平移缩放
    this.stimulus = null;
    this.selected = new Set();
    this.targets = new Set();
    this.nodeEls = new Map();
    this.transform = this.view;
    this._build();
    this._bindViewControls();
  }

  _build() {
    const { width: W, height: H, background } = this.cfg.canvas;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('width', W);
    this.svg.setAttribute('height', H);
    this.svg.style.background = background;
    this.svg.replaceChildren();

    this.gView = el('g', { class: 'viewport' });
    this.gEdges = el('g', { class: 'edges' });
    this.gNodes = el('g', { class: 'nodes' });
    this.gRubber = el('rect', {
      class: 'rubber-band',
      x: 0, y: 0, width: 0, height: 0,
      fill: 'rgba(33,150,243,0.12)', stroke: '#2196f3',
      'stroke-width': 1, 'stroke-dasharray': '4 3',
      visibility: 'hidden', 'pointer-events': 'none',
    });
    this.gView.append(this.gEdges, this.gNodes, this.gRubber);
    this.svg.append(this.gView);
    this._applyTransform();
  }

  _applyTransform() {
    const { k, x, y } = this.view;
    this.gView.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  }

  _bindViewControls() {
    if (!this.cfg.enablePanZoom) return;
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const { width: W, height: H } = this.cfg.canvas;
      const sx = (e.clientX - rect.left) * (W / rect.width);
      const sy = (e.clientY - rect.top) * (H / rect.height);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k2 = Math.min(8, Math.max(0.4, this.view.k * factor));
      // 以光标为锚点缩放
      this.view.x = sx - (sx - this.view.x) * (k2 / this.view.k);
      this.view.y = sy - (sy - this.view.y) * (k2 / this.view.k);
      this.view.k = k2;
      this._applyTransform();
    }, { passive: false });
  }

  /** 把一个 stimulus 画出来。 */
  draw(stimulus, { targets = [], selected = [] } = {}) {
    this.stimulus = stimulus;
    this.targets = new Set(targets);
    this.selected = new Set(selected);
    this.nodeEls.clear();
    this.gEdges.replaceChildren();
    this.gNodes.replaceChildren();

    const { node: cNode, edge: cEdge, target: cTarget,
            selectedOutline, selectedOutlineWidth } = this.cfg.colors;
    const r = this.cfg.nodeRadius;

    const pos = new Map(stimulus.nodes.map((n) => [n.id, n]));

    for (const e of stimulus.edges) {
      const a = pos.get(e.s), b = pos.get(e.t);
      if (!a || !b) continue;
      this.gEdges.append(el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: cEdge, 'stroke-width': this.cfg.edgeWidth,
        'stroke-linecap': 'round',
      }));
    }

    for (const n of stimulus.nodes) {
      const isTarget = this.targets.has(n.id);
      const isSel = this.selected.has(n.id);
      const c = el('circle', {
        cx: n.x, cy: n.y, r,
        // 目标 = 蓝色填充；其余 = 灰色填充。绝不因度数改变大小或颜色。
        fill: isTarget ? cTarget : cNode,
        'data-id': n.id,
        // 已选中 = 红描边，**填充不变**（docs/01 §2.3.1：目标被选中后仍保留蓝色标识）
        stroke: isSel ? selectedOutline : 'none',
        'stroke-width': isSel ? selectedOutlineWidth : 0,
      });
      // 略大一点的命中区，提升可点性；对四种布局完全一致，不引入偏差
      c.style.cursor = 'pointer';
      this.gNodes.append(c);
      this.nodeEls.set(n.id, c);
    }
    this._paintSelection();
  }

  _paintSelection() {
    const { selectedOutline, selectedOutlineWidth } = this.cfg.colors;
    for (const [id, c] of this.nodeEls) {
      const on = this.selected.has(id);
      c.setAttribute('stroke', on ? selectedOutline : 'none');
      c.setAttribute('stroke-width', on ? selectedOutlineWidth : 0);
    }
  }

  setSelected(ids) {
    this.selected = new Set(ids);
    this._paintSelection();
  }

  toggleSelected(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this._paintSelection();
    return this.selected.has(id);
  }

  clearSelection() {
    this.selected.clear();
    this._paintSelection();
  }

  /** 把屏幕坐标换算到「画布坐标」（未受 view 变换影响前）。 */
  _toCanvas(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const { width: W, height: H } = this.cfg.canvas;
    const sx = (clientX - rect.left) * (W / rect.width);
    const sy = (clientY - rect.top) * (H / rect.height);
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  /**
   * 命中检测：返回离点击点最近、且落在命中半径内的节点。
   *
   * @param {Set<string>|null} prefer 近似并列时优先的节点集合。
   *
   * 为什么要 `prefer`：KK 在黑灰产域名图上会把结构等价的节点叠在一起（docs/02 §7.2 F4），
   * 目标节点可能被一个**非目标**节点压住 —— 此时点目标的正中心会判给压在上面的那个，
   * 而 T4 只接受两个高亮节点之一，于是「点了没反应」，被试反复点也答不了。
   * T4 的题面本来就是「click one of the highlighted nodes」，
   * 所以并列时优先高亮节点是忠于题面的，且对四种布局完全一致、不引入偏差。
   * 重叠本身（看不清）是布局的性质，照常如实报告，不做特殊处理。
   */
  nodeAt(clientX, clientY, prefer = null) {
    const p = this._toCanvas(clientX, clientY);
    const lim = this.cfg.nodeRadius + 3;
    let best = null, bestD = Infinity, bestPreferred = false;
    for (const n of this.stimulus?.nodes || []) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d > lim) continue;
      const isPref = !!(prefer && prefer.has(n.id));
      const closer = d < bestD - 1e-6;          // 明显更近
      const tieButPreferred = Math.abs(d - bestD) <= 1e-6 && isPref && !bestPreferred;
      if (best === null || closer || tieButPreferred) {
        best = n.id; bestD = d; bestPreferred = isPref;
      } else if (Math.abs(d - bestD) <= 1e-6 && isPref === bestPreferred && isPref) {
        // 同为目标且并列：保持先出现者，保证确定性
      }
    }
    return best;
  }

  nodesInRect(x0, y0, x1, y1) {
    const [loX, hiX] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [loY, hiY] = y0 < y1 ? [y0, y1] : [y1, y0];
    return (this.stimulus?.nodes || [])
      .filter((n) => n.x >= loX && n.x <= hiX && n.y >= loY && n.y <= hiY)
      .map((n) => n.id);
  }

  showRubber(x0, y0, x1, y1) {
    this.gRubber.setAttribute('x', Math.min(x0, x1));
    this.gRubber.setAttribute('y', Math.min(y0, y1));
    this.gRubber.setAttribute('width', Math.abs(x1 - x0));
    this.gRubber.setAttribute('height', Math.abs(y1 - y0));
    this.gRubber.setAttribute('visibility', 'visible');
  }

  hideRubber() {
    this.gRubber.setAttribute('visibility', 'hidden');
  }

  /** 清屏 —— 每个 trial 之间（docs/03 §8）。 */
  clear() {
    this.stimulus = null;
    this.selected.clear();
    this.targets.clear();
    this.nodeEls.clear();
    this.gEdges.replaceChildren();
    this.gNodes.replaceChildren();
    this.hideRubber();
    this.view = { k: 1, x: 0, y: 0 };
    this._applyTransform();
  }
}
