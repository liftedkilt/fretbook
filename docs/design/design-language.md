# Fretbook design language

Status: v1, proposed in the UI/UX overhaul epic. It evolves the current "night session" system in `web/src/app.css`. It does not replace it: the ember accent, Instrument Serif display face, Inter body text and the paper surface for notation all stay. What this adds is the missing rules (spacing, radius, type scale, page template, button hierarchy, icon meanings, destructive actions, motion, celebration and voice) so that every page is built the same way.

Mockups that apply it: [`issue-assets/ui-audit-2026-10/mockups/`](https://github.com/liftedkilt/fretbook/tree/issue-assets/ui-audit-2026-10/mockups).

## 1. Principles

1. **The music comes first.** On a song page the score, sheet or highway is on screen without scrolling, at every size. Chrome gets out of the way while playing.
2. **One primary action per view.** Exactly one gradient button per page, sheet or panel. Everything else is secondary, ghost or in an overflow menu.
3. **Progressive disclosure, not deletion.** Advanced features stay, but they live one level down: a tab, a collapsed "More" section, an overflow menu, or the Settings page. Admin-only things are only shown to admins.
4. **Calm chrome, warm reward.** Everyday UI is quiet and dense in the way a good pro tool is. Colour, motion and big numbers are spent on progress: a goal met, a streak, a personal best, a lesson passed.
5. **One way to do each thing.** A control appears in one place. If two places need it, one of them is a shortcut to the other, not a copy.

## 2. Personality: professional, encouraging, never childish

Fretbook should feel like a well-made instrument case: dark, warm, precise, with a little shine.

| Do | Don't |
| --- | --- |
| Celebrate real progress with a short, specific message ("New best: 94% at 100%. Up 6 points.") | Generic praise ("Awesome job!!! 🎉🎉") or mascots |
| Use the ember gradient for the one primary action and for celebration moments | Use the gradient on chips, badges, tags or secondary buttons |
| Show progress as rings, bars, stars and streak counts | Cartoon illustrations, bouncing UI, confetti that covers content |
| Use the serif display face for page titles, song titles and hero numbers on results | Use the serif for buttons, labels, body text or small headings |
| Be gentle about misses ("Streak paused. Play today to start a new one.") | Shame, red alerts or loss-framing for missed days |

## 3. Colour

Keep the existing tokens. Add semantic roles so components stop picking raw colours.

| Role | Token | Use |
| --- | --- | --- |
| Page | `--bg`, `--bg-elev` | App background, sidebar |
| Surfaces | `--surface`, `--surface-2`, `--surface-3` | Cards, inputs, hovered rows |
| Lines | `--line`, `--line-strong` | Dividers, card borders, input borders |
| Text | `--text`, `--text-2`, `--text-3` | Primary, secondary, tertiary/meta |
| Accent | `--accent`, `--accent-text`, `--accent-soft`, `--accent-ring` | Current nav item icon, selected chip border, focus ring, links |
| Primary CTA / reward | `--grad`, `--glow` | One primary button per view; celebration moments only |
| Status | `--success`, `--warn`, `--danger` (+ `-soft`) | Banners, validation, destructive buttons |
| Paper | `--paper`, `--paper-ink`, `--paper-dim`, `--paper-chord` | Every notation, tab and chord-sheet surface, in every context including previews |

New tokens:

```css
/* Grades in scored play-along, used by the highway, notation colouring and results */
--grade-hit: var(--success);
--grade-early: #7cb8ff;
--grade-late: var(--warn);
--grade-miss: var(--danger);

/* Heatmap steps (practice calendar, bar heatmap) */
--heat-0: var(--surface-2);
--heat-1: color-mix(in srgb, var(--accent) 30%, var(--surface-2));
--heat-2: color-mix(in srgb, var(--accent) 55%, var(--surface-2));
--heat-3: color-mix(in srgb, var(--accent) 80%, var(--surface-2));
--heat-4: var(--accent);
```

`#7cb8ff` is about 2:1 on white, under the 3:1 floor for a graphical mark. The light theme sets `--grade-early: #1a5fbf` (about 6:1 on white) so an early mark stays visible on paper. The other grade and heat tokens follow the theme through `var(--success)`, `var(--warn)`, `var(--danger)`, `var(--accent)` and `var(--surface-2)`.

Rules:

- Links inside body text use `--accent-text` and are underlined. Links that are rows or cards (a song in a list) are not underlined and not orange: the whole row is the target.
- Form controls (range, checkbox, radio, switch, select) are always themed. No browser-default blue anywhere (`accent-color: var(--accent)` plus custom range track and thumb).

## 4. Typography

Fonts stay: Inter Variable (UI), Instrument Serif (display), JetBrains Mono (numbers that tick: time, BPM in the dock, cents).

| Token | Size / line height | Use |
| --- | --- | --- |
| `--fs-display` | clamp(40px, 5vw, 60px) / 1.02, serif | Page title (H1) on top-level pages, song title on the song page |
| `--fs-title` | 32px / 1.1, serif | H1 on sub-pages (a setlist, a course, a tool) |
| `--fs-h2` | 20px / 1.3, Inter 600 | Section headings inside a page |
| `--fs-h3` | 16px / 1.4, Inter 600 | Card titles, panel group titles |
| `--fs-body` | 15px / 1.55 | Body text |
| `--fs-sm` | 13px / 1.45 | Meta lines, helper text |
| `--fs-xs` | 12px / 1.4 | Badges, counts |
| `--fs-eyebrow` | 11.5px, 600, 0.14em tracking, uppercase | Eyebrow above a page title |
| `--fs-hero-num` | 56px, Inter 700 tabular | Big numbers (metronome BPM, results score, streak) |

Rules:

- Every page has one H1. Section headings are H2 in Inter, never serif.
- The eyebrow names the **nav destination the page belongs to** (Library, Practice, Lessons, Setlists, Tools, Settings). The Practice log and Setlists pages currently say "Library"; that is wrong.
- Prose (lessons, notes, descriptions) gets paragraph spacing (`p + p { margin-top: 0.75em }`) and a max line length of 70ch.

## 5. Spacing

A 4px base scale. Use tokens, not raw values.

| `--sp-1` | `--sp-2` | `--sp-3` | `--sp-4` | `--sp-5` | `--sp-6` | `--sp-7` | `--sp-8` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4px | 8px | 12px | 16px | 24px | 32px | 48px | 64px |

- Inside a card: `--sp-4` (phone) / `--sp-5` (tablet and up).
- Between cards in a grid: `--sp-4`.
- Between page sections: `--sp-7`.
- Page gutter: `--pad` (already `clamp(16px, 3.2vw, 44px)`).

## 6. Radius

Today there are about ten ad-hoc radii (6, 8, 10, 11, 12, 14, 20, 22, 24, 28px). Use four, plus pill:

| Token | Value | Use |
| --- | --- | --- |
| `--r-xs` | 6px | Tags, small badges, keyboard keys |
| `--r-sm` | 10px | Buttons, inputs, selects, icon buttons, list rows |
| `--r-md` | 14px | Cards, panels, popovers, cover art |
| `--r-lg` | 20px | Sheets, the paper surface, the player dock |
| `--r-pill` | 999px | Chips, segmented controls, progress bars |

`--radius`, `--radius-lg`, `--border` and `--r-xl` are not tokens. A strong line is `--line-strong`. Circles stay `50%` (thumbs, beat dots, avatars). When an old pixel value sat halfway between two tokens, rows, buttons and inputs use `--r-sm`, and cards and panels use `--r-md`.

## 7. Elevation

- `--shadow-sm`: resting cards (light theme only; dark relies on borders).
- `--shadow-md`: popovers, menus, the dock.
- `--shadow-lg`: sheets and dialogs.
- Glass (`--glass`, blur) is for floating chrome over content only: the player dock and the phone tab bar.

## 8. Layout

### App shell

- **Desktop (≥ 1100px):** sidebar 248px. **Tablet (768–1099px):** 72px icon rail with tooltips. **Phone (< 768px):** top bar plus bottom tab bar.
- Sidebar order: brand, **New** (the only "New" button on screen), then destinations: **Practice** (home), **Library**, **Lessons**, **Setlists**, **Tools**. Below a divider: **Favourites** (up to 5). At the bottom: **Admin** (admins only), **Settings**.
- Library kind filters (Bass, Electric, Acoustic, Chord sheets) live **only** in the library toolbar, not in the sidebar. "Recently updated" is removed from the sidebar; the library's default sort already shows it.
- Phone tab bar: **Practice · Library · (+) · Lessons · Tools**, with the + centred. Setlists is reached from Library (a "Songs | Setlists" switch at the top of the library on phones) and from the song overflow menu.

### Page containers

| Token | Max width | Pages |
| --- | --- | --- |
| `--page-narrow` | 760px | Lesson reading column, settings, forms |
| `--page` | 1180px | Practice, Lessons, Setlists, Tools hub, tool pages, course |
| `--page-wide` | 1480px | Library grid, song page, editors |

Content is left-aligned inside the container on every page (no page centres its back link while left-aligning its title).

### Page header (one template, every page)

```
[‹ Back to Parent]                                (sub-pages only, top-left)
EYEBROW
Page title                                [secondary] [secondary] [Primary]
Subtitle / one-line description or count
```

- Back link: always top-left, above the eyebrow, text "‹ Parent name".
- Actions: right-aligned on desktop, wrapping below the title on phones; primary right-most. Destructive actions are never here (see §11).
- Implement once as `PageHeader.svelte` and use it on every page. Today there are at least six variants (`page-head`, `tool-header`, `tools-header`, `setlist-head`, the lesson and course headers, the song page).

## 9. Components

### Buttons

| Kind | Look | When |
| --- | --- | --- |
| Primary | `--grad` fill, white text, `--glow` | The single most important action in the view: Play, Start, Save, Create |
| Secondary | `--surface-2` fill, `--line-strong` border | Other actions. One step above a `--surface` card, so the button stays visible on it |
| Ghost | No fill, `--text-2` | Low-emphasis actions, toolbar items with labels |
| Danger | `--danger-soft` fill, `--danger` text | Confirming a destructive action (inside the confirm step only) |
| Icon button | 40×40 (44×44 on touch), `--r-sm` | Only with `aria-label` **and** a visible tooltip on hover/focus |

- Heights: 36px compact (toolbars), 44px default, 52px hero (Start on a tool page).
- A disabled primary button is shown as a disabled secondary, not as a faded gradient.

### Chips, pills and badges

- **Filter chip** (interactive, toggles): pill, `--surface` fill; selected = `--text` fill with `--bg` text. Optional count in `--text-3`.
- **Tag chip** (interactive, opens filter): pill with tag icon.
- **Meta pill** (not interactive: tuning, BPM, bars, key): `--r-xs`, no border, `--surface-2` fill, `--fs-xs`. It must not look like a button. A real action (Transpose) is a button, not a pill.
- Rows of chips that can overflow scroll sideways with an edge fade.

### Segmented control

One style everywhere (view switch Tab | Highway | Split, count-in Off | 1 bar | 2 bars, trainer modes, library Songs | Setlists): pill track in `--surface`, selected segment in `--surface-3` with `--text`. Do not reuse filter chips or tabs for this.

### Form controls

- Inputs and selects: 44px, `--surface` fill, `--line-strong` border, `--r-sm`, chevron on selects. Same on every page (the tool pages currently use a different, black select).
- Range: 4px track in `--surface-3`, filled part `--accent`, 18px thumb in `--text` with `--shadow-sm`. Value shown at the end in mono.
- Checkbox and switch: use a switch for settings that apply immediately, a checkbox inside forms. The switch is a checkbox inside `label.switch`, visually hidden, followed by `span.switch-track`. Use that pattern rather than a second switch.

### Cards and rows

- Card: `--surface`, 1px `--line`, `--r-md`, padding per §5. Clickable cards lift on hover (`--surface-2`, no movement).
- List row: 56–64px, cover thumb on the left, title (`--text`, one line, ellipsis) above meta (`--text-3`, one line). Never let the secondary text wrap while the title is truncated.

### Overlays

| Overlay | Use |
| --- | --- |
| Popover | Up to about 6 controls tied to a button (sort, filters, speed, a chip's options) |
| Sheet (side on desktop, bottom on phone) | A focused task that has its own flow: Add to library, Song details, Tuner |
| Page | Anything with sections or that people navigate to: Settings, Admin, Practice log |

The player's panel is a sheet with **tabs**, not one long scroll (see the Player issue).

### Menus

- Overflow menu (`more` icon, "⋯"): secondary and destructive actions. Destructive items are last, separated by a divider, in `--danger`.

### Empty, loading and error states

- Empty state: icon tile, one serif line, one sentence, one primary action.
- Loading: skeletons the shape of the content; no spinners for lists.
- Errors that need action: a banner at the top of the page. Errors from background work (failed imports) collapse into a single summary row ("3 imports failed · Review") that expands.

## 10. Notation surfaces

Any alphaTab render, tab preview, chord sheet or chord diagram on paper uses the paper tokens, whatever the theme, in every context (song page, editor preview, exercise preview, lesson excerpts, PDF). Never render notation directly on a dark card.

## 11. Destructive actions

- Never in a page header or a primary action row (today "Delete setlist" sits next to "Play through").
- Put them in the overflow menu, or in a "Danger zone" group at the end of a settings page.
- Prefer undo (a toast with Undo for 8 seconds) over a confirm dialog for reversible actions such as removing a song from a setlist. Use a confirm dialog that names the item for irreversible ones (deleting a song or setlist).
- Per-item delete buttons are not shown on every card. They live in the card's overflow menu or in multi-select mode.

## 12. Icons

Lucide-style, 24px grid, 1.8px stroke, round caps, inline in `Icon.svelte`. Rules:

- **One meaning per icon, one icon per meaning.** The table below is the registry. Add new meanings to it in the same PR that adds the icon.
- Toolbar icons have a visible label at tablet width and up, or a tooltip. Icon-only is fine for universally known transport icons (play, pause, previous, next).
- A unit test fails when `<Icon name="…">` (or an `icon:` property) uses a name not in `PATHS`. Today `class` (Lessons) and `x` (loop panel) render nothing.

| Meaning | Icon name | Notes |
| --- | --- | --- |
| Practice (nav, practice log) | `target` (new) | Replaces `clock` |
| Library | `library` | |
| Lessons, course | `graduation` (new) | Replaces the missing `class` |
| Setlists | `listMusic` (new) | Replaces plain `list` |
| Tools | `wrench` | |
| Tuner | `tuningFork` (new) | |
| Metronome | `metronome` (new) | Today shares `gauge` with the rhythm trainer |
| Rhythm trainer | `drum` (new) | |
| Ear and fretboard trainer | `ear` (new) | Today uses the guitar icon |
| Chord library, chord sheet | `chords` | |
| Exercises | `dumbbell` (new) | Today uses `tab` |
| Export / download a file | `download` | Only this meaning |
| Keep on this device (offline) | `cloudDownload` / `cloudCheck` (new) | Today uses `download` too |
| Follow the cursor | `crosshair` (new) | Today uses an arrow-down |
| Keyboard shortcuts | `keyboard` (new) | Today uses `info` |
| Speed | `gauge` | Only this meaning |
| Wait mode | `hourglass` (new) | |
| Score my playing | `star` | |
| Loop | `repeat` | |
| Mixer / audio | `sliders` | |
| Sync marks | `waveform` | |
| Full screen | `maximize` / `minimize` | One button per view |
| Close / remove | `close` | Replaces the missing `x` |
| Overflow menu | `more` | |

## 13. Motion

- Durations: 120ms (hover, press), 200ms (popovers, chips, tabs), 320ms (sheets, page-level transitions). Easing: `--ease`.
- Nothing moves while music is playing except the cursor, the highway and live meters.
- `prefers-reduced-motion`: replace movement with opacity changes and skip celebration animation (keep the message).

## 14. Motivation and celebration

Celebrate the moments below, and only these, so they stay meaningful.

| Moment | Where | Treatment |
| --- | --- | --- |
| Daily goal met | Practice page ring, toast anywhere | Ring fills and glows once (`--glow`); toast "Daily goal met. 6-day streak." |
| Streak milestone (3, 7, 14, 30, 50, 100 days) | Toast, practice page | Flame icon with count; one short pulse |
| Personal best (score, speed) | Results screen | Serif hero number, "New best" badge with `--grad`, delta vs previous |
| Lesson passed | Lesson page, course path | Check mark draws in, next lesson card slides up with a primary "Next lesson" |
| Course finished | Course page | Full-width banner with the course art and total time |

Constraints: at most one celebration at a time; at most 1.2 seconds of motion; never blocks input or covers the score; no sound unless the user turns it on; reduced motion shows the message only.

Progress visuals, used consistently: **ring** for today's goal, **bar** for course and lesson progress, **stars (0–3)** for scored runs, **flame + number** for the streak, **heatmap** for history.

## 15. Copy and voice

- Sentence case everywhere ("Open chord library", not "Open Chord Library"). Today tool buttons mix both.
- Buttons start with a verb and say what happens ("Play through", "Save to library").
- Speak to one player, warmly and plainly. No exclamation marks except in celebration toasts, and at most one there.
- Terms: Song, Tab, Chord sheet, Track, Setlist, Lesson, Course, Practice log, Loop, Speed trainer, Wait mode, Scored play-along. Use them consistently in English and pt-BR.
- Helper text is one sentence. Longer explanations go behind an info popover or in the docs.

## 16. Accessibility

Unchanged rules still apply (axe in `web/e2e/a11y.spec.ts`): 44px touch targets on touch devices, visible focus ring (`--accent-ring`), WCAG AA contrast in both themes, icon-only buttons have an `aria-label`, and the accessible name contains the visible text. Tooltips are shown on keyboard focus as well as hover.
