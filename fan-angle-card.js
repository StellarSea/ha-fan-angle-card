/**
 * Fan Angle Card — a Lovelace card that edits a fan's oscillation range
 * the way the Xiaomi Home app does: one arc slider with two handles,
 * instead of two independent "boundary" number entities.
 *
 * https://github.com/StellarSea/ha-fan-angle-card
 *
 * Model
 *  - Each axis has two number entities: a "high" boundary and a "low" boundary.
 *    Horizontal: `left` holds the larger value (e.g. 0 = far right, 120 = far left).
 *    Vertical:   `up` holds the larger value. `invert: true` flips either axis.
 *  - The card keeps `high - low >= min_gap` and writes the two values in an order
 *    where every intermediate state is valid (some devices silently reject
 *    writes that would make the window invalid).
 *
 * Minimal YAML
 *   type: custom:fan-angle-card
 *   horizontal:
 *     left: number.fan_left_angle
 *     right: number.fan_right_angle
 *   vertical:
 *     up: number.fan_up_angle
 *     down: number.fan_down_angle
 */

const CARD_VERSION = "1.2.0";
const CARD_TYPE = "fan-angle-card";

// ---------- i18n ----------

const STRINGS = {
  en: {
    horizontal: "Horizontal swing",
    vertical: "Vertical swing",
    angle: "Swing angle",
    symmetric: "Symmetric swing",
    fold: "Collapse",
    unavailable: "Unavailable",
    failed: "Failed to set angle",
    no_entities: "Select the angle entities in the card editor.",
    left: "Left limit",
    right: "Right limit",
    up: "Upper limit",
    down: "Lower limit",
    // editor
    title: "Title",
    swing: "Swing switch",
    name: "Name",
    icon: "Icon",
    center: "Symmetry center",
    min_gap: "Minimum range",
    step: "Step",
    invert: "Invert direction",
    hide_symmetric: "Hide symmetric toggle",
    display: "Display",
    behavior: "Behavior",
    always_open: "Always show the dial",
    expanded: "Start expanded",
    hide_degree: "Hide the big angle number",
    hide_ticks: "Hide tick marks",
    hide_glow: "Hide glow while dragging",
    disable_animations: "Disable animations",
    disable_move: "Disable dragging the whole range",
    disable_haptics: "Disable haptic feedback",
    skip_refresh: "Skip state refresh before writing",
    help_center: "Default: middle of the range",
    help_min_gap: "Default: 2 × step",
    help_step: "Default: from the entity",
    help_symmetric: "Optional switch that stores the symmetric mode on the device",
    help_swing: "Optional switch that turns swinging on/off",
    help_skip_refresh: "The card asks HA to refresh both entities before choosing the write order",
  },
  ko: {
    horizontal: "자동 좌우 회전",
    vertical: "자동 상하 회전",
    angle: "회전 각도",
    symmetric: "대칭 회전",
    fold: "접기",
    unavailable: "사용 불가",
    failed: "각도 설정 실패",
    no_entities: "카드 편집기에서 각도 엔티티를 선택하세요.",
    left: "왼쪽 경계",
    right: "오른쪽 경계",
    up: "위쪽 경계",
    down: "아래쪽 경계",
    title: "제목",
    swing: "회전 스위치",
    name: "이름",
    icon: "아이콘",
    center: "대칭 중심",
    min_gap: "최소 범위",
    step: "단위",
    invert: "방향 반전",
    hide_symmetric: "대칭 회전 토글 숨기기",
    display: "표시",
    behavior: "동작",
    always_open: "다이얼 항상 표시",
    expanded: "펼친 상태로 시작",
    hide_degree: "큰 각도 숫자 숨기기",
    hide_ticks: "눈금 숨기기",
    hide_glow: "드래그 글로우 숨기기",
    disable_animations: "애니메이션 끄기",
    disable_move: "범위 전체 끌어서 이동 끄기",
    disable_haptics: "햅틱 진동 끄기",
    skip_refresh: "쓰기 전 상태 갱신 건너뛰기",
    help_center: "기본값: 범위의 가운데",
    help_min_gap: "기본값: 단위 × 2",
    help_step: "기본값: 엔티티 설정값",
    help_symmetric: "대칭 모드를 기기에 저장하는 스위치 (선택)",
    help_swing: "회전을 켜고 끄는 스위치 (선택)",
    help_skip_refresh: "쓰기 순서를 고르기 전에 두 엔티티 상태를 HA에 갱신 요청합니다",
  },
};

function langOf(hass) {
  const l = hass?.locale?.language || hass?.language || document.querySelector("home-assistant")?.hass?.locale?.language || navigator.language || "en";
  return String(l).toLowerCase().split(/[-_]/)[0];
}
function strings(hass) {
  return { ...STRINGS.en, ...(STRINGS[langOf(hass)] || {}) };
}

// ---------- geometry constants (viewBox 300x300, dial center 150,150) ----------

const ARC_R = 250;
const ARC_SPAN = 30 * (Math.PI / 180); // ±30° of a large circle
const TRACK_W = 46;
const HANDLE_R = 17;
const TAU_DRAG = 0.028; // s — how fast the drawing follows the finger
const TAU_SETTLE = 0.11; // s — snap / external-change animation

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v, step) => Math.round(v / step) * step;
const round = (v) => Math.round(v * 1000) / 1000;

const AXES = {
  horizontal: { hiKey: "left", loKey: "right", icon: "mdi:arrow-left-right", sweep: 1 },
  vertical: { hiKey: "up", loKey: "down", icon: "mdi:arrow-up-down", sweep: 0 },
};

class FanAngleCard extends HTMLElement {
  // ---------- Lovelace API ----------

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const find = (suffix) => ids.find((e) => e.startsWith("number.") && e.endsWith(suffix));
    const left = find("_left_angle");
    const prefix = left ? left.slice("number.".length, -"_left_angle".length) : "";
    const sw = (s) => (prefix && hass.states[`switch.${prefix}_${s}`] ? `switch.${prefix}_${s}` : undefined);
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
    return {
      horizontal: clean({ left, right: find("_right_angle"), swing: sw("horizontal_swing"), symmetric: sw("symmetrical_swing_h") }),
      vertical: clean({ up: find("_up_angle"), down: find("_down_angle"), swing: sw("vertical_swing"), symmetric: sw("symmetrical_swing_v") }),
    };
  }

  static getConfigForm() {
    const t = strings();
    const switches = { entity: { domain: ["switch", "input_boolean"] } };
    const numbers = { entity: { domain: ["number", "input_number"] } };
    const axis = (kind) => {
      const { hiKey, loKey, icon } = AXES[kind];
      return {
        type: "expandable",
        name: kind,
        title: t[kind],
        icon,
        schema: [
          { type: "grid", name: "", schema: [
            { name: hiKey, required: true, selector: numbers },
            { name: loKey, required: true, selector: numbers },
          ] },
          { type: "grid", name: "", schema: [
            { name: "swing", selector: switches },
            { name: "symmetric", selector: switches },
          ] },
          { type: "grid", name: "", schema: [
            { name: "name", selector: { text: {} } },
            { name: "icon", selector: { icon: {} } },
          ] },
          { type: "grid", name: "", schema: [
            { name: "center", selector: { number: { mode: "box", step: "any" } } },
            { name: "min_gap", selector: { number: { mode: "box", min: 0, step: "any" } } },
            { name: "step", selector: { number: { mode: "box", min: 0, step: "any" } } },
          ] },
          { type: "grid", name: "", schema: [
            { name: "invert", selector: { boolean: {} } },
            { name: "hide_symmetric", selector: { boolean: {} } },
          ] },
        ],
      };
    };
    const bools = (names) => ({ type: "grid", name: "", schema: names.map((name) => ({ name, selector: { boolean: {} } })) });
    return {
      schema: [
        { name: "title", selector: { text: {} } },
        axis("horizontal"),
        axis("vertical"),
        { type: "expandable", name: "display", flatten: true, title: t.display, icon: "mdi:palette-outline",
          schema: [bools(["always_open", "expanded", "hide_degree", "hide_ticks", "hide_glow", "disable_animations"])] },
        { type: "expandable", name: "behavior", flatten: true, title: t.behavior, icon: "mdi:cog-outline",
          schema: [bools(["disable_move", "disable_haptics", "skip_refresh"])] },
      ],
      computeLabel: (s) => {
        const tt = strings();
        if (s.name === "symmetric") return tt.symmetric;
        return tt[s.name];
      },
      computeHelper: (s) => strings()[`help_${s.name}`],
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    const axes = [];
    for (const kind of ["horizontal", "vertical"]) {
      const c = config[kind];
      if (!c) continue;
      const { hiKey, loKey, icon, sweep } = AXES[kind];
      const inv = !!c.invert;
      const hiRole = inv ? loKey : hiKey; // entity that holds the larger value
      const loRole = inv ? hiKey : loKey;
      if (!c[hiRole] || !c[loRole]) continue; // incomplete axis (e.g. while editing) → skipped
      axes.push({
        kind, icon, ...c,
        hi: c[hiRole], lo: c[loRole], hiRole, loRole,
        dir: inv ? -1 : 1,
        sweep: inv ? 1 - sweep : sweep,
      });
    }
    this._config = config;
    this._axes = axes;
    this._open = {};
    if (config.expanded) for (const a of axes) this._open[a.kind] = true;
    this._pending = {};
    this._disp = {};
    this._shownWidth = {};
    this._drag = null;
    this._built = false;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._built || (first && this._lang !== langOf(hass))) this._render();
    else this._update();
  }

  getCardSize() {
    return 1 + this._axes.length * (this._config.always_open ? 5 : 2);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    if (this._built) this._update();
  }

  disconnectedCallback() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  // ---------- options ----------

  get _animate() {
    return !this._config.disable_animations && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }
  _alwaysOpen() {
    return !!this._config.always_open;
  }
  _isOpen(axis) {
    return this._alwaysOpen() || !!this._open[axis.kind];
  }

  // ---------- state ----------

  _num(entityId) {
    const s = this._hass?.states?.[entityId];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  _on(entityId) {
    return entityId ? this._hass?.states?.[entityId]?.state === "on" : false;
  }

  /** Limits from entity attributes, overridable by config. */
  _limits(axis) {
    const hiA = this._hass?.states?.[axis.hi]?.attributes || {};
    const loA = this._hass?.states?.[axis.lo]?.attributes || {};
    const step = Number(axis.step) > 0 ? Number(axis.step) : hiA.step ?? loA.step ?? 1;
    const gap = axis.min_gap ?? step * 2;
    const lo_min = loA.min ?? hiA.min ?? 0;
    const hi_max = hiA.max ?? loA.max ?? 100;
    // usable values: lo ∈ [lo_min, hi_max - gap], hi ∈ [lo_min + gap, hi_max]
    const hi_min = Math.max(hiA.min ?? lo_min, lo_min + gap);
    const lo_max = Math.min(loA.max ?? hi_max, hi_max - gap);
    const center = axis.center ?? (lo_min + hi_max) / 2;
    return { step, gap, lo_min, lo_max, hi_min, hi_max, range_min: lo_min, range_max: hi_max, center };
  }

  /** Committed (step-aligned) values: drag snap > pending write > entity state. */
  _values(axis) {
    if (this._drag && this._drag.axis === axis.kind) return { hi: this._drag.hi, lo: this._drag.lo };
    const p = this._pending[axis.kind];
    const hi = this._num(axis.hi);
    const lo = this._num(axis.lo);
    if (p) {
      if ((hi === p.hi && lo === p.lo) || Date.now() > p.until) delete this._pending[axis.kind];
      else return { hi: p.hi, lo: p.lo };
    }
    return { hi, lo };
  }

  /** What the animation heads to: raw finger position while dragging. */
  _target(axis) {
    const d = this._drag;
    if (d && d.axis === axis.kind) return { hi: d.rawHi, lo: d.rawLo };
    return this._values(axis);
  }

  _isSym(axis) {
    return axis.symmetric ? this._on(axis.symmetric) : !!this._localSym?.[axis.kind];
  }

  // ---------- constraints ----------

  /** Move one handle to v and return a valid (hi, lo). doSnap=false keeps it continuous. */
  _constrain(axis, which, v, cur, sym, doSnap = true) {
    const L = this._limits(axis);
    const s = doSnap ? (x) => snap(x - (sym ? L.center : 0), L.step) + (sym ? L.center : 0) : (x) => x;
    if (sym) {
      const c = L.center;
      const hMin = Math.max(L.gap / 2, c - L.lo_max, L.hi_min - c);
      const hMax = Math.min(c - L.lo_min, L.hi_max - c);
      const target = which === "hi" ? s(v) - c : c - s(v);
      const h = doSnap
        ? clamp(target, Math.ceil(hMin / L.step) * L.step, Math.floor(hMax / L.step) * L.step)
        : clamp(target, hMin, hMax);
      return { hi: round(c + h), lo: round(c - h) };
    }
    let { hi, lo } = cur;
    if (which === "hi") hi = clamp(s(v), Math.max(L.hi_min, lo + L.gap), L.hi_max);
    else lo = clamp(s(v), L.lo_min, Math.min(L.lo_max, hi - L.gap));
    return { hi: round(hi), lo: round(lo) };
  }

  /** Shift the whole window, keeping its width. */
  _shift(axis, delta, start, doSnap = true) {
    const L = this._limits(axis);
    const w = start.hi - start.lo;
    let lo = start.lo + delta;
    if (doSnap) lo = snap(lo, L.step);
    lo = clamp(lo, L.lo_min, Math.min(L.lo_max, L.hi_max - w));
    lo = Math.max(lo, L.hi_min - w);
    return { hi: round(lo + w), lo: round(lo) };
  }

  _symmetrize(axis, cur) {
    const L = this._limits(axis);
    return this._constrain(axis, "hi", L.center + (cur.hi - cur.lo) / 2, cur, true);
  }

  // ---------- writes ----------

  _commit(axis, target) {
    this._pending[axis.kind] = { ...target, until: Date.now() + 8000 };
    this._update();
    // serialize writes: the order of each write depends on the result of the previous one
    this._queue = (this._queue || Promise.resolve()).then(() => this._write(axis, target));
    return this._queue;
  }

  async _write(axis, target) {
    const hass = this._hass;
    const L = this._limits(axis);
    const domainOf = (id) => id.split(".")[0];
    const set = (entity_id, value) => hass.callService(domainOf(entity_id), "set_value", { entity_id, value });
    if (!this._config.skip_refresh) {
      try {
        // polled integrations may hold a stale cache → refresh before choosing the write order
        await hass.callService("homeassistant", "update_entity", { entity_id: [axis.hi, axis.lo] });
      } catch (_) {
        /* not fatal */
      }
    }
    const preHi = this._num(axis.hi);
    const preLo = this._num(axis.lo);
    const setHi = () => target.hi !== preHi && set(axis.hi, target.hi);
    const setLo = () => target.lo !== preLo && set(axis.lo, target.lo);
    try {
      if (preHi === null || preLo === null || target.hi >= preLo + L.gap) {
        await setHi(); // (hi, preLo) is valid
        await setLo();
      } else if (target.lo <= preHi - L.gap) {
        await setLo(); // (preHi, lo) is valid
        await setHi();
      } else {
        // current state already invalid: first raise hi to preLo + gap
        const norm = Math.min(preLo + L.gap, L.hi_max);
        await set(axis.hi, norm);
        if (target.lo <= norm - L.gap) {
          await setLo();
          await set(axis.hi, target.hi);
        } else {
          await set(axis.hi, target.hi);
          await setLo();
        }
      }
    } catch (err) {
      delete this._pending[axis.kind];
      this._toast(`${strings(this._hass).failed}: ${err?.message || err}`);
    }
    this._update();
  }

  _toggle(entityId) {
    if (!entityId) return;
    this._haptic("light");
    this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
  }

  async _toggleSymmetric(axis) {
    const turningOn = !this._isSym(axis);
    this._haptic("light");
    if (axis.symmetric) {
      await this._hass.callService("homeassistant", turningOn ? "turn_on" : "turn_off", { entity_id: axis.symmetric });
    } else {
      this._localSym = { ...(this._localSym || {}), [axis.kind]: turningOn };
    }
    if (turningOn) {
      const cur = this._values(axis);
      if (cur.hi !== null && cur.lo !== null) {
        const t = this._symmetrize(axis, cur);
        if (t.hi !== cur.hi || t.lo !== cur.lo) this._commit(axis, t);
      }
    }
    this._update();
  }

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  /** Companion-app haptics (navigator.vibrate fallback in browsers). */
  _haptic(kind = "selection") {
    if (this._config.disable_haptics) return;
    window.dispatchEvent(new CustomEvent("haptic", { detail: kind }));
    try {
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(kind === "selection" ? 4 : 10);
    } catch (_) {}
  }

  // ---------- geometry ----------

  _center(axis) {
    return axis.kind === "horizontal" ? { x: 150, y: 195 - ARC_R } : { x: 178 - ARC_R, y: 150 };
  }

  /** value → point on the arc */
  _point(axis, value) {
    const L = this._limits(axis);
    const t = (value - L.range_min) / (L.range_max - L.range_min || 1);
    const a = axis.dir * (ARC_SPAN - 2 * ARC_SPAN * t);
    const c = this._center(axis);
    // horizontal: circle centre above → a "smile"; vertical: centre left → ")"
    if (axis.kind === "horizontal") return { x: c.x + ARC_R * Math.sin(a), y: c.y + ARC_R * Math.cos(a) };
    return { x: c.x + ARC_R * Math.cos(a), y: c.y + ARC_R * Math.sin(a) };
  }

  /** viewBox point → value (clamped to the track ends) */
  _valueAt(axis, x, y) {
    const L = this._limits(axis);
    const c = this._center(axis);
    const a = axis.kind === "horizontal" ? Math.atan2(x - c.x, y - c.y) : Math.atan2(y - c.y, x - c.x);
    const t = (ARC_SPAN - a * axis.dir) / (2 * ARC_SPAN);
    return L.range_min + clamp(t, 0, 1) * (L.range_max - L.range_min);
  }

  _arcPath(axis, a, b) {
    const p1 = this._point(axis, a);
    const p2 = this._point(axis, b);
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${ARC_R} ${ARC_R} 0 0 ${axis.sweep} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  _distToArc(axis, p) {
    const c = this._center(axis);
    return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - ARC_R);
  }

  // ---------- render ----------

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const cfg = this._config;
    const t = strings(this._hass);
    this._lang = langOf(this._hass);
    const cls = [
      cfg.always_open && "always-open",
      cfg.hide_glow && "no-glow",
      !this._animate && "no-anim",
    ].filter(Boolean).join(" ");
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="${cls}">
        ${cfg.title ? `<div class="title">${escapeHtml(cfg.title)}</div>` : ""}
        ${this._axes.length ? this._axes.map((a) => this._axisHtml(a, t)).join("") : `<div class="empty">${escapeHtml(t.no_entities)}</div>`}
      </ha-card>`;
    this._built = true;
    this._disp = {};
    this._shownWidth = {};
    this._bind();
    this._update();
  }

  _axisHtml(axis, t) {
    const k = axis.kind;
    const L = this._limits(axis);
    const cfg = this._config;
    const name = axis.name || t[k];
    let ticks = "";
    if (!cfg.hide_ticks && L.step > 0 && (L.range_max - L.range_min) / L.step <= 60) {
      for (let v = L.range_min; v <= L.range_max + 1e-9; v += L.step) {
        const p = this._point(axis, v);
        ticks += `<circle class="tick" data-v="${round(v)}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.2"/>`;
      }
    }
    const handle = (cls, role) =>
      `<circle class="handle ${cls}" r="${HANDLE_R}" tabindex="0" role="slider" aria-label="${escapeHtml(t[role])}"
        aria-valuemin="${L.range_min}" aria-valuemax="${L.range_max}" aria-orientation="${k}"/>`;
    return `
      <section class="axis" data-axis="${k}">
        <div class="row head">
          <ha-icon icon="${escapeHtml(axis.icon)}"></ha-icon>
          <span class="name">${escapeHtml(name)}</span>
          ${cfg.always_open ? `<span class="val headval"></span>` : ""}
          ${axis.swing ? `<button class="switch" data-act="swing" role="switch" aria-label="${escapeHtml(name)}"><span></span></button>` : ""}
        </div>
        ${cfg.always_open ? "" : `
        <div class="sep"></div>
        <button class="row sub" data-act="expand">
          <span class="label">${escapeHtml(t.angle)}</span>
          <span class="val"></span>
          <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>
        </button>`}
        <div class="panel">
          <div class="inner">
            <svg viewBox="0 0 300 300" class="dial ${k}">
              <circle cx="150" cy="150" r="140" class="ring"/>
              ${k === "horizontal"
                ? `<line x1="150" y1="22" x2="150" y2="278" class="axisline"/>`
                : `<line x1="22" y1="150" x2="278" y2="150" class="axisline"/>`}
              ${cfg.hide_degree ? "" : `<g class="degwrap"><text class="deg" text-anchor="middle" dominant-baseline="central"
                x="${k === "horizontal" ? 150 : 80}" y="${k === "horizontal" ? 112 : 150}"></text></g>`}
              <path class="track" d="${this._arcPath(axis, L.range_min, L.range_max)}"/>
              <path class="range glowpath"/>
              <path class="range main"/>
              <g class="ticks">${ticks}</g>
              <circle class="halo hi" r="${HANDLE_R}"/>
              <circle class="halo lo" r="${HANDLE_R}"/>
              ${handle("hi", axis.hiRole)}
              ${handle("lo", axis.loRole)}
            </svg>
            ${axis.hide_symmetric ? "" : `
            <div class="row sym">
              <span class="label strong">${escapeHtml(t.symmetric)}</span>
              <button class="switch" data-act="sym" role="switch" aria-label="${escapeHtml(t.symmetric)}"><span></span></button>
            </div>`}
            ${cfg.always_open ? "" : `<button class="fold" data-act="fold">${escapeHtml(t.fold)}</button>`}
          </div>
        </div>
      </section>`;
  }

  _bind() {
    for (const axis of this._axes) {
      const root = this._root(axis);
      root.querySelector('[data-act="expand"]')?.addEventListener("click", () => {
        this._open[axis.kind] = !this._open[axis.kind];
        this._update();
      });
      root.querySelector('[data-act="fold"]')?.addEventListener("click", () => {
        this._open[axis.kind] = false;
        this._update();
      });
      root.querySelector('[data-act="sym"]')?.addEventListener("click", () => this._toggleSymmetric(axis));
      root.querySelector('[data-act="swing"]')?.addEventListener("click", () => this._toggle(axis.swing));

      const svg = root.querySelector("svg");
      svg.addEventListener("pointerdown", (ev) => this._onDown(axis, svg, ev));
      svg.addEventListener("pointermove", (ev) => this._onMove(axis, svg, ev));
      svg.addEventListener("pointerup", (ev) => this._onUp(axis, svg, ev));
      svg.addEventListener("pointercancel", (ev) => this._onUp(axis, svg, ev, true));
      for (const which of ["hi", "lo"]) {
        svg.querySelector(`.handle.${which}`).addEventListener("keydown", (ev) => this._onKey(axis, which, ev));
      }
    }
  }

  _root(axis) {
    return this.shadowRoot.querySelector(`.axis[data-axis="${axis.kind}"]`);
  }

  _svgPoint(svg, ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  _available(axis) {
    const v = this._values(axis);
    return v.hi !== null && v.lo !== null;
  }

  // ---------- pointer ----------

  _onDown(axis, svg, ev) {
    if (!this._available(axis)) return;
    const cur = this._values(axis);
    const p = this._svgPoint(svg, ev);
    const pHi = this._point(axis, cur.hi);
    const pLo = this._point(axis, cur.lo);
    const dHi = Math.hypot(p.x - pHi.x, p.y - pHi.y);
    const dLo = Math.hypot(p.x - pLo.x, p.y - pLo.y);
    const v = this._valueAt(axis, p.x, p.y);
    const onArc = this._distToArc(axis, p) < TRACK_W / 2 + 10;
    const sym = this._isSym(axis);
    const hit = HANDLE_R + 14;
    let mode = null;
    // handles overlap → decide by the direction of the first movement
    if (dHi < hit && dLo < hit) mode = "pick";
    else if (Math.min(dHi, dLo) < hit) mode = dHi <= dLo ? "hi" : "lo";
    else if (onArc && v > cur.lo && v < cur.hi && !sym && !this._config.disable_move) mode = "move";
    else if (onArc) mode = Math.abs(v - cur.hi) <= Math.abs(v - cur.lo) ? "hi" : "lo";
    if (!mode) return;
    ev.preventDefault();
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch (_) {}
    this._drag = { axis: axis.kind, mode, sym, startV: v, start: { ...cur }, hi: cur.hi, lo: cur.lo, rawHi: cur.hi, rawLo: cur.lo };
    // tapping the track (not a handle) jumps the nearest handle there
    if ((mode === "hi" || mode === "lo") && Math.min(dHi, dLo) >= hit) this._dragTo(axis, v);
    this._haptic("light");
    this._update();
  }

  _dragTo(axis, v) {
    const d = this._drag;
    const base = { hi: d.hi, lo: d.lo };
    let raw, snapped;
    if (d.mode === "move") {
      raw = this._shift(axis, v - d.startV, d.start, false);
      snapped = this._shift(axis, v - d.startV, d.start, true);
    } else {
      raw = this._constrain(axis, d.mode, v, base, d.sym, false);
      snapped = this._constrain(axis, d.mode, v, base, d.sym, true);
    }
    const changed = snapped.hi !== d.hi || snapped.lo !== d.lo;
    Object.assign(d, { rawHi: raw.hi, rawLo: raw.lo, hi: snapped.hi, lo: snapped.lo });
    if (changed) this._haptic("selection");
  }

  _onMove(axis, svg, ev) {
    const d = this._drag;
    if (!d || d.axis !== axis.kind) return;
    ev.preventDefault();
    const p = this._svgPoint(svg, ev);
    const v = this._valueAt(axis, p.x, p.y);
    if (d.mode === "pick") {
      if (Math.abs(v - d.startV) < this._limits(axis).step / 4) return;
      d.mode = v > d.startV ? "hi" : "lo";
    }
    this._dragTo(axis, v);
    this._update();
  }

  _onUp(axis, svg, ev, cancelled = false) {
    const d = this._drag;
    if (!d || d.axis !== axis.kind) return;
    try {
      svg.releasePointerCapture(ev.pointerId);
    } catch (_) {}
    this._drag = null;
    if (!cancelled && (d.hi !== d.start.hi || d.lo !== d.start.lo)) this._commit(axis, { hi: d.hi, lo: d.lo });
    this._update(); // target becomes the snapped value → handle glides onto the tick
  }

  // ---------- keyboard ----------

  _onKey(axis, which, ev) {
    const keys = axis.kind === "horizontal"
      ? { ArrowLeft: 1, ArrowRight: -1, ArrowUp: 1, ArrowDown: -1 }
      : { ArrowUp: 1, ArrowDown: -1, ArrowRight: 1, ArrowLeft: -1 };
    let sign = keys[ev.key];
    if (!sign || !this._available(axis)) return;
    ev.preventDefault();
    // visual direction → value direction (horizontal: left = larger unless inverted)
    sign *= axis.dir;
    const L = this._limits(axis);
    const cur = this._values(axis);
    const v = (which === "hi" ? cur.hi : cur.lo) + sign * L.step;
    const next = this._constrain(axis, which, v, cur, this._isSym(axis));
    if (next.hi === cur.hi && next.lo === cur.lo) return;
    this._haptic("selection");
    this._pending[axis.kind] = { ...next, until: Date.now() + 8000 };
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => this._commit(axis, next), 450);
    this._update();
  }

  // ---------- update & animation ----------

  _update() {
    if (!this._built || !this._hass) return;
    const t = strings(this._hass);
    for (const axis of this._axes) {
      const root = this._root(axis);
      const { hi, lo } = this._values(axis);
      const valid = hi !== null && lo !== null;
      const width = valid ? round(Math.max(0, hi - lo)) : null;
      const unit = this._hass.states[axis.hi]?.attributes?.unit_of_measurement;
      const suffix = !unit || /deg|°|arc/i.test(unit) ? "°" : ` ${unit}`;
      const swingOn = this._on(axis.swing);

      const swBtn = root.querySelector('[data-act="swing"]');
      if (swBtn) {
        swBtn.classList.toggle("on", swingOn);
        swBtn.setAttribute("aria-checked", String(swingOn));
      }
      const symBtn = root.querySelector('[data-act="sym"]');
      if (symBtn) {
        const symOn = this._isSym(axis);
        symBtn.classList.toggle("on", symOn);
        symBtn.setAttribute("aria-checked", String(symOn));
      }

      root.querySelectorAll(".val").forEach((el) => (el.textContent = valid ? `${width}${suffix}` : t.unavailable));
      root.classList.toggle("dim", !!axis.swing && !swingOn);
      root.classList.toggle("unavailable", !valid);
      root.classList.toggle("busy", !!this._pending[axis.kind]);
      const dragging = this._drag && this._drag.axis === axis.kind ? this._drag.mode : null;
      root.classList.toggle("dragging", !!dragging);
      const both = ["move", "pick"].includes(dragging) || (!!dragging && this._drag.sym);
      for (const cls of ["hi", "lo"]) {
        const act = both || dragging === cls;
        root.querySelectorAll(`.handle.${cls}, .halo.${cls}`).forEach((el) => el.classList.toggle("active", act));
        const h = root.querySelector(`.handle.${cls}`);
        if (valid) h.setAttribute("aria-valuenow", String(cls === "hi" ? hi : lo));
      }

      const open = this._isOpen(axis);
      root.classList.toggle("open", open);
      root.querySelector('[data-act="expand"]')?.setAttribute("aria-expanded", String(open));

      // big number pops when it changes
      const degEl = root.querySelector(".deg");
      if (degEl && this._shownWidth[axis.kind] !== width) {
        degEl.textContent = valid ? `${width}${suffix}` : "—";
        if (this._shownWidth[axis.kind] !== undefined && open && this._animate) {
          const wrap = root.querySelector(".degwrap");
          wrap.classList.remove("pop");
          void wrap.getBoundingClientRect();
          wrap.classList.add("pop");
        }
        this._shownWidth[axis.kind] = width;
      }

      // draw immediately on first paint / while closed / without animation
      // (also keeps the card correct when rAF is paused, e.g. background tabs)
      const tgt = this._target(axis);
      if (tgt.hi !== null && tgt.lo !== null && (!this._disp[axis.kind] || !open || !this._animate)) {
        this._draw(axis, tgt);
        this._disp[axis.kind] = { ...tgt };
      }
    }
    if (this._animate) this._kick();
  }

  _kick() {
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame((ts) => this._frame(ts));
  }

  _frame(now) {
    this._raf = null;
    // exponential smoothing is stable for any dt → follow real time even on slow devices
    const dt = Math.min(0.5, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    let moving = false;
    for (const axis of this._axes) {
      const tgt = this._target(axis);
      if (tgt.hi === null || tgt.lo === null) continue;
      const cur = this._disp[axis.kind];
      let next;
      if (!cur) {
        next = { ...tgt };
      } else {
        const dragging = this._drag && this._drag.axis === axis.kind;
        const k = 1 - Math.exp(-dt / (dragging ? TAU_DRAG : TAU_SETTLE));
        next = { hi: cur.hi + (tgt.hi - cur.hi) * k, lo: cur.lo + (tgt.lo - cur.lo) * k };
        const eps = this._limits(axis).step / 500;
        if (Math.abs(tgt.hi - next.hi) < eps) next.hi = tgt.hi;
        if (Math.abs(tgt.lo - next.lo) < eps) next.lo = tgt.lo;
        if (next.hi !== tgt.hi || next.lo !== tgt.lo) moving = true;
      }
      if (!cur || cur.hi !== next.hi || cur.lo !== next.lo) this._draw(axis, next);
      this._disp[axis.kind] = next;
    }
    if (moving || this._drag) this._raf = requestAnimationFrame((ts) => this._frame(ts));
  }

  _draw(axis, v) {
    const root = this._root(axis);
    const d = this._arcPath(axis, v.lo, v.hi);
    root.querySelectorAll(".range").forEach((el) => el.setAttribute("d", d));
    for (const [cls, val] of [["hi", v.hi], ["lo", v.lo]]) {
      const p = this._point(axis, val);
      for (const el of root.querySelectorAll(`.handle.${cls}, .halo.${cls}`)) {
        el.setAttribute("cx", p.x.toFixed(2));
        el.setAttribute("cy", p.y.toFixed(2));
      }
    }
    const step = this._limits(axis).step;
    for (const tick of root.querySelectorAll(".tick")) {
      const tv = +tick.dataset.v;
      tick.classList.toggle("in", tv > v.lo + step / 2 && tv < v.hi - step / 2);
    }
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const STYLE = `
  :host {
    --fac-accent: var(--fan-angle-accent, #4fa3ab);
    --fac-track: var(--fan-angle-track, rgba(127,127,127,0.35));
    --fac-handle: var(--fan-angle-handle, #fff);
    --fac-text: var(--primary-text-color, #e1e1e1);
    --fac-sub: var(--secondary-text-color, #9b9b9b);
    --fac-divider: var(--divider-color, rgba(127,127,127,0.25));
    --fac-off: var(--fan-angle-switch-off, rgba(127,127,127,0.4));
    --fac-ease: cubic-bezier(.2,.8,.2,1);
  }
  ha-card { padding: 4px 0; overflow: hidden; }
  .title { font-size: 1.15rem; font-weight: 500; padding: 14px 20px 4px; color: var(--fac-text); }
  .empty { padding: 20px; color: var(--fac-sub); }
  .axis { padding: 4px 0; }
  .axis + .axis { border-top: 1px solid var(--fac-divider); }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 20px; width: 100%; box-sizing: border-box; }
  .head .name { flex: 1; font-size: 1.05rem; color: var(--fac-text); }
  .head ha-icon { color: var(--fac-text); --mdc-icon-size: 24px; }
  .sep { height: 1px; background: var(--fac-divider); margin: 0 20px; }
  button.row { background: none; border: 0; font: inherit; cursor: pointer; text-align: left; color: inherit; -webkit-tap-highlight-color: transparent; }
  button.row:active { background: rgba(127,127,127,.08); }
  button:focus-visible { outline: 2px solid var(--fac-accent); outline-offset: 2px; }
  .sub .label { flex: 1; color: var(--fac-sub); }
  .val { color: var(--fac-text); font-variant-numeric: tabular-nums; transition: color .3s; }
  .headval { color: var(--fac-sub); }
  .sub .chev { color: var(--fac-sub); --mdc-icon-size: 20px; margin-right: -4px; transition: transform .35s var(--fac-ease); }
  .axis.open .sub .chev { transform: rotate(90deg); }
  .axis.dim .sub .val, .axis.unavailable .val { color: var(--fac-sub); }
  .axis.unavailable .dial { opacity: .35; pointer-events: none; }

  .switch {
    position: relative; width: 52px; height: 30px; border-radius: 15px; border: 0; padding: 0;
    background: var(--fac-off); cursor: pointer; flex: none; transition: background .25s;
    -webkit-tap-highlight-color: transparent;
  }
  .switch span {
    position: absolute; top: 5px; left: 5px; width: 20px; height: 20px; border-radius: 10px;
    background: #fff; transition: transform .3s var(--fac-ease), width .15s;
    box-shadow: 0 1px 3px rgba(0,0,0,.3);
  }
  .switch:active span { width: 26px; }
  .switch.on { background: var(--fac-accent); }
  .switch.on span { transform: translateX(22px); }
  .switch.on:active span { transform: translateX(16px); }

  .panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .4s var(--fac-ease); }
  .axis.open .panel { grid-template-rows: 1fr; }
  .inner { overflow: hidden; min-height: 0; padding: 0 16px; opacity: 0; transform: translateY(-6px) scale(.98);
    transition: opacity .25s, transform .4s var(--fac-ease), padding .4s var(--fac-ease); }
  .axis.open .inner { opacity: 1; transform: none; padding: 4px 16px 16px; }

  .dial { display: block; width: 100%; max-width: 340px; margin: 0 auto; touch-action: none; user-select: none; -webkit-user-select: none; overflow: visible; }
  .ring { fill: none; stroke: var(--fac-divider); stroke-width: 1.5; }
  .axisline { stroke: var(--fac-sub); stroke-width: 1.2; stroke-dasharray: 1.5 3; opacity: .6; }
  .track { fill: none; stroke: var(--fac-track); stroke-width: ${TRACK_W}; stroke-linecap: round; }
  .range { fill: none; stroke: var(--fac-accent); stroke-width: ${TRACK_W}; stroke-linecap: round; cursor: grab; }
  .glowpath { opacity: 0; filter: blur(10px); stroke-width: ${TRACK_W + 6}; transition: opacity .3s; pointer-events: none; }
  .axis.dragging .glowpath { opacity: .55; }
  .no-glow .glowpath { display: none; }
  .axis.dragging .range { cursor: grabbing; }
  .axis.dim .range.main { opacity: .55; transition: opacity .3s; }

  .tick { fill: var(--fac-sub); opacity: .35; pointer-events: none; transition: fill .2s, opacity .2s; }
  .tick.in { fill: #fff; opacity: .45; }

  .handle { fill: var(--fac-handle); cursor: grab; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
    transition: r .2s var(--fac-ease); outline: none; }
  .handle.active { r: ${HANDLE_R + 3}px; cursor: grabbing; }
  .handle:focus-visible { stroke: var(--fac-accent); stroke-width: 4px; paint-order: stroke; r: ${HANDLE_R + 2}px; }
  .halo { fill: var(--fac-handle); opacity: 0; pointer-events: none; transition: opacity .25s, r .25s var(--fac-ease); }
  .halo.active { opacity: .18; r: ${HANDLE_R + 13}px; }

  .deg { fill: var(--fac-text); font-size: 46px; font-weight: 300; font-variant-numeric: tabular-nums; pointer-events: none; }
  .degwrap { transform-box: fill-box; transform-origin: center; }
  .degwrap.pop { animation: pop .28s var(--fac-ease); }
  @keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.08); } 100% { transform: scale(1); } }

  .axis.busy .range.main { animation: breathe 1.1s ease-in-out infinite alternate; }
  @keyframes breathe { from { opacity: 1; } to { opacity: .6; } }

  .sym .label.strong { flex: 1; color: var(--fac-text); font-weight: 500; }
  .sym { padding: 10px 6px; }
  .fold {
    display: block; width: 100%; padding: 13px; margin-top: 6px; border: 0; border-radius: 999px;
    background: var(--fac-divider); color: var(--fac-text); font: inherit; font-weight: 500; cursor: pointer;
    transition: transform .15s, background .2s; -webkit-tap-highlight-color: transparent;
  }
  .fold:active { transform: scale(.97); }

  .no-anim *, .no-anim *::before, .no-anim *::after { transition: none !important; animation: none !important; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`;

if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, FanAngleCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "Fan Angle Card",
    description: "Set a fan's oscillation range with an arc slider (two boundary number entities per axis).",
    preview: true,
    documentationURL: "https://github.com/StellarSea/ha-fan-angle-card",
  });
}

console.info(`%c FAN-ANGLE-CARD %c ${CARD_VERSION} `, "background:#4fa3ab;color:#fff", "background:#333;color:#fff");
