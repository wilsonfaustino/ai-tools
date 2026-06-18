# antdV3 to antd v6 migration map

`antdV3` is an npm alias for `antd@3.x`. The migration target is `antd` v6. Most
components survive the jump by changing only the import source; a few are removed
or change behavior. Confirm each against the **repo's own migrated siblings**
before trusting this list. The repo convention wins over this document.

## Import swap (1:1, source change only)

For these, change the import source from `'antdV3'` to `'antd'` and leave the JSX
alone:

- `Empty`
- `Input` (and `Input.Search`, `Input.TextArea`)
- `Spin`
- `Button`, `Select`, `Table`, `Form`, `Modal`, `Tooltip`, and most other
  layout/data components.

Verify props against the v6 docs if a component carries non-default props; v4/v5
dropped or renamed a handful (e.g. `Form` moved to hooks-based validation in v4).

## Removed: `Icon`

`Icon` was **removed in antd v4+**. The string-typed `<Icon type='...' />` API is
gone. Replace each icon with its named export from `@ant-design/icons`:

```tsx
// v3 (antdV3)
import { Icon } from 'antdV3';
<Icon type='loading' spin />

// v6
import { LoadingOutlined } from '@ant-design/icons';
<LoadingOutlined spin />
```

`type='loading'` maps to `LoadingOutlined`. Other common maps: `type='close'` to
`CloseOutlined`, `type='search'` to `SearchOutlined`, `type='down'` to
`DownOutlined`. The general rule is `type='foo-bar'` becomes `FooBarOutlined`
(theme suffix may be `Filled` or `TwoTone`); confirm the exact export name
exists in `@ant-design/icons`.

### Repo TS workaround for icons

Some repos hit a TypeScript error on `@ant-design/icons` components about missing
`onPointerEnterCapture` / `onPointerLeaveCapture` props (a React 18 typings
mismatch). If the repo's migrated siblings pass them explicitly, copy it verbatim:

```tsx
<LoadingOutlined spin onPointerEnterCapture={undefined} onPointerLeaveCapture={undefined} />
```

Do not add this workaround speculatively. Only mirror it if a sibling already
does, or `tsc` actually complains.

## Behavior gotchas (list the ones in scope up front)

These render or behave differently in v5/v6 even when the import swap is clean.
Surface every one that touches a component in the target before editing.

- **`Spin` standalone `tip` is not rendered.** In v5/v6, `<Spin tip="Loading" />`
  on its own shows no tip text. `tip` renders only when `Spin` wraps children
  (nested mode) or via `Spin.setDefaultIndicator` / fullscreen. To keep a visible
  label, wrap content: `<Spin tip="Loading"><div style={{minHeight: 1}} /></Spin>`
  or render the label as separate markup. This is a UX decision for Step 7.
- **`Spin` default indicator size/animation** changed across majors; the spinner
  glyph may look different even with no prop changes. Expect a possible pixel
  diff on the loading screenshot and judge it against a migrated sibling.
- **`Empty` default image** and spacing were refined; verify the empty-state
  screenshot if reachable.
- **`Form`** validation and `getFieldDecorator` were removed in v4. If the target
  uses the v3 `Form.create()` / `getFieldDecorator` API, this is a larger
  migration than an import swap; flag it and scope it explicitly with the owner.
- **`Input.Search` / `Select`** event and styling defaults shifted; rely on the
  behavior check (Step 4) and the screenshot, not assumption.

## How to confirm against the repo

```bash
grep -rn "from 'antd'" "$REPO/src" | grep -E "LoadingOutlined|Spin" | head
grep -rn "@ant-design/icons" "$REPO/src" | head
grep -rn "onPointerEnterCapture" "$REPO/src" | head
```

Read one already-migrated file end to end and match its import ordering, icon
usage, and any wrapper pattern. A repo-consistent migration is the goal, not a
textbook-correct one.
