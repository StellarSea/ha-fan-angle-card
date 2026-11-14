# Fan Angle Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)

A Home Assistant Lovelace card that sets a fan's oscillation range with **one arc slider and two handles**, like the Xiaomi Home app. It replaces two separate "left/right limit" (or "up/down limit") number entities.

[한국어 설명은 아래에 있습니다.](#한국어)

| Collapsible (default) | `always_open: true`, while dragging |
|---|---|
| ![collapsible](images/collapsible.png) | ![always open](images/always-open.png) |

## Why

Some fan integrations, such as `xiaomi_miot` for the Xiaomi / Mijia circulators (`xiaomi.fan.p90`), expose the oscillation range as independent boundary entities:

```
number.fan_left_angle    10–120
number.fan_right_angle    0–110
number.fan_up_angle      10–100
number.fan_down_angle     0–90
```

Editing these one at a time is unintuitive and easy to get wrong. If you set a combination the device doesn't accept (for example, a left limit lower than the right limit), the device can ignore the write without any error. This card:

- shows each axis as one arc with two handles, with the **total range** in the middle,
- enforces `high − low ≥ min_gap` and the entities' own `min` / `max` / `step`,
- writes the two values **in a safe order**, so every in-between state is valid,
- has an optional **symmetric** mode that mirrors the handles around the center,
- follows your finger while you drag and settles on the nearest step when you let go. Nothing is sent until you release.

## Installation

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/StellarSea/ha-fan-angle-card` with category **Dashboard**.
2. Install **Fan Angle Card** and reload the browser.

### Manual

1. Copy `fan-angle-card.js` to `/config/www/`.
2. **Settings → Dashboards → ⋮ → Resources → Add resource**: `/local/fan-angle-card.js`, type **JavaScript module**.
3. Hard-refresh the browser.

## Configuration

You can configure everything from the visual editor. Search for **Fan Angle Card** when adding a card. YAML works too:

```yaml
type: custom:fan-angle-card
title: Circulator
horizontal:
  left: number.fan_left_angle        # entity holding the LARGER value (unless invert)
  right: number.fan_right_angle
  swing: switch.fan_horizontal_swing          # optional
  symmetric: switch.fan_symmetrical_swing_h   # optional
vertical:
  up: number.fan_up_angle
  down: number.fan_down_angle
  swing: switch.fan_vertical_swing
  symmetric: switch.fan_symmetrical_swing_v
```

Either axis can be left out.

### Axis options (`horizontal` / `vertical`)

| Option | Default | Description |
|---|---|---|
| `left` / `right`, `up` / `down` | **required** | The two boundary entities (`number` or `input_number`). |
| `swing` | – | Switch that turns swinging on/off. Shown as a toggle in the header. |
| `symmetric` | – | Switch that stores the symmetric mode on the device. Without it, the toggle only lasts in the browser. |
| `name` | localized | Header text. |
| `icon` | `mdi:arrow-left-right` / `mdi:arrow-up-down` | Header icon. |
| `center` | middle of the range | Center used by symmetric mode. |
| `min_gap` | `2 × step` | Minimum distance between the two limits. |
| `step` | entity `step` | Snap step. |
| `invert` | `false` | Flip the direction (e.g. when `right` holds the larger value). |
| `hide_symmetric` | `false` | Hide the symmetric toggle. |

### Card options

| Option | Default | Description |
|---|---|---|
| `title` | – | Card title. |
| `always_open` | `false` | Always show the dials, with no "Swing angle" row or Collapse button. |
| `expanded` | `false` | Start with the dials open (when collapsible). |
| `hide_degree` | `false` | Hide the large angle number on the dial. |
| `hide_ticks` | `false` | Hide the step tick marks. |
| `hide_glow` | `false` | Hide the glow while dragging. |
| `disable_animations` | `false` | No easing or transitions. `prefers-reduced-motion` is also respected. |
| `disable_move` | `false` | Don't drag the whole range by grabbing its middle. |
| `disable_haptics` | `false` | No haptic feedback in the companion app. |
| `skip_refresh` | `false` | Don't call `homeassistant.update_entity` before writing. |

### Theming

Set these variables in your theme. Every one is optional:

```yaml
my_theme:
  fan-angle-accent: "#4fa3ab"
  fan-angle-track: "rgba(127,127,127,.35)"
  fan-angle-handle: "#fff"
  fan-angle-switch-off: "rgba(127,127,127,.4)"
```

## Interaction

- **Drag a handle** to move one limit. If the handles overlap, the direction you drag decides which one moves.
- **Drag the middle of the range** to shift the whole range and keep its width.
- **Tap the track** to jump the nearest handle there.
- **Keyboard**: focus a handle and use the arrow keys. The value is sent 0.45 s after the last key press.

## Write order

When both limits change, the card first asks HA to refresh both entities. It then chooses an order that keeps the device valid at every step:

- If the new high limit is at least `old low + min_gap`, it writes **high first**.
- Otherwise, if the new low limit is at most `old high − min_gap`, it writes **low first**.

Starting from a valid state, one of the two always applies.

## Development

`test.html` is a playground with a mocked `hass` and a fake device that ignores invalid writes:

```bash
python -m http.server 8765
# open http://localhost:8765/test.html  (add ?lang=en for English)
```

---

## 한국어

샤오미 앱처럼 **호(arc) 슬라이더 하나와 핸들 두 개**로 선풍기·서큘레이터의 회전 범위를 설정하는 Home Assistant 카드입니다.

`xiaomi_miot` 같은 통합은 회전 범위를 왼쪽/오른쪽(위/아래) **경계값 엔티티 두 개**로 따로 제공합니다. 이 방식은 직관적이지 않고, 기기가 받지 않는 조합을 보내면 쓰기가 오류 없이 무시되기도 합니다. 이 카드는 이렇게 동작합니다.

- 축마다 호 하나에 두 경계를 함께 보여 주고, 가운데에 전체 회전 폭을 표시합니다.
- 엔티티의 min/max/step과 최소 간격(`min_gap`)을 지킵니다.
- 중간 상태가 항상 유효하도록 순서를 골라 두 값을 씁니다.
- 대칭 회전 모드를 지원합니다.
- 드래그 중에는 손가락을 연속으로 따라가고, 손을 떼면 눈금에 붙으면서 한 번만 전송합니다.
- 비주얼 편집기를 지원하고, 모든 부가 기능을 켜고 끌 수 있습니다(위 표 참고).
- 한국어와 영어 UI를 HA 언어에 맞춰 자동으로 고릅니다.

설치는 HACS **사용자 정의 저장소**(카테고리 **Dashboard**)에 이 저장소 주소를 추가하거나, `fan-angle-card.js`를 `/config/www/`에 넣고 리소스로 등록하면 됩니다.

## License

MIT
