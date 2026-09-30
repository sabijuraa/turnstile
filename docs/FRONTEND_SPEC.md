# Frontend spec

This is the Turnstile design system as it ships in `apps/web`, and the state of every page. Other streams build on it rather than around it.

## Principles

The site should read like a calm payments company. Light ground, dark type, one accent, motion only where value moves.

- Warm off-white paper, near-black ink with a faint cool bias, and one deep teal accent.
- The accent is reserved for the primary action and for the moment a payment settles.
- Depth comes from hairlines and one soft shadow. Only things that float or land get the shadow.
- Motion shows flow. A request passes the gate, a receipt lands, a meter advances. Everything else is still.
- Figures line up. Money, counts and identifiers use tabular numerals.

## Tokens

Every color, space, radius, shadow, duration and easing is a CSS custom property in `apps/web/src/styles/tokens.css`. Components read only the semantic names.

- A dark theme is added by redefining the same names under `[data-theme="dark"]`. No component changes.
- Hard coded colors in component CSS are not allowed. The on-ink translucent values are tokens too.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--color-paper` | `#f6f5f0` | Page ground |
| `--color-surface` | `#fcfcf9` | Cards, panels, raised bands |
| `--color-sunken` | `#eeede6` | Hover grounds, method tags, disabled fills |
| `--color-line` | `#e1e0d7` | Hairlines |
| `--color-line-strong` | `#cdccc2` | Stronger hairlines, the gate lane, secondary button border |
| `--color-control-border` | `#858b86` | Input borders, 3 to 1 against surface |
| `--color-ink` | `#131a1a` | Type and structure |
| `--color-ink-muted` | `#4a5453` | Secondary text |
| `--color-ink-faint` | `#636c6a` | Captions and metadata, still AA on every ground |
| `--color-on-ink` | `#f6f5f0` | Text on ink, code blocks |
| `--color-on-ink-muted` | `#b9c0bd` | Secondary text on ink |
| `--color-accent` | `#0b5a5c` | Primary action, settled state, focus ring |
| `--color-accent-strong` | `#084547` | Primary hover |
| `--color-accent-weak` | `#e2eeec` | Settled pill, icon grounds, selection |
| `--color-positive` / `-weak` | `#2c6b2f` / `#e6f0e1` | Success that is not a settlement |
| `--color-caution` / `-weak` | `#7d5300` / `#f6ecd4` | Near a cap, the 402 marker |
| `--color-critical` / `-weak` | `#a3301f` / `#f7e5e0` | Failures, refusals, a cap reached |
| `--color-meter-track` | `#e6e5dd` | Spend meter track |

### Contrast

`pnpm --filter @turnstile/web contrast` reads the token file and checks every pair the UI uses. The same pairs run as a vitest suite, so a token change that breaks AA fails the tests. Output at the time of writing follows.

| Foreground | Background | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| ink #131a1a | paper #f6f5f0 | 16.16 | 4.5 | pass |
| ink #131a1a | surface #fcfcf9 | 17.16 | 4.5 | pass |
| ink #131a1a | sunken #eeede6 | 15.03 | 4.5 | pass |
| ink-muted #4a5453 | paper #f6f5f0 | 7.17 | 4.5 | pass |
| ink-muted #4a5453 | surface #fcfcf9 | 7.61 | 4.5 | pass |
| ink-muted #4a5453 | sunken #eeede6 | 6.67 | 4.5 | pass |
| ink-faint #636c6a | paper #f6f5f0 | 4.95 | 4.5 | pass |
| ink-faint #636c6a | surface #fcfcf9 | 5.26 | 4.5 | pass |
| ink-faint #636c6a | sunken #eeede6 | 4.61 | 4.5 | pass |
| accent #0b5a5c | paper #f6f5f0 | 7.31 | 4.5 | pass |
| accent #0b5a5c | surface #fcfcf9 | 7.76 | 4.5 | pass |
| accent #0b5a5c | accent-weak #e2eeec | 6.72 | 4.5 | pass |
| on-accent #f6f5f0 | accent #0b5a5c | 7.31 | 4.5 | pass |
| on-accent #f6f5f0 | accent-strong #084547 | 9.85 | 4.5 | pass |
| positive #2c6b2f | paper #f6f5f0 | 5.92 | 4.5 | pass |
| positive #2c6b2f | positive-weak #e6f0e1 | 5.51 | 4.5 | pass |
| critical #a3301f | paper #f6f5f0 | 6.41 | 4.5 | pass |
| critical #a3301f | critical-weak #f7e5e0 | 5.75 | 4.5 | pass |
| caution #7d5300 | paper #f6f5f0 | 6.19 | 4.5 | pass |
| caution #7d5300 | caution-weak #f6ecd4 | 5.75 | 4.5 | pass |
| ink-muted #4a5453 | accent-weak #e2eeec | 6.58 | 4.5 | pass |
| ink-muted #4a5453 | critical-weak #f7e5e0 | 6.42 | 4.5 | pass |
| ink-muted #4a5453 | caution-weak #f6ecd4 | 6.66 | 4.5 | pass |
| ink-faint #636c6a | accent-weak #e2eeec | 4.55 | 4.5 | pass |
| on-ink #f6f5f0 | ink #131a1a | 16.16 | 4.5 | pass |
| on-ink-muted #b9c0bd | ink #131a1a | 9.52 | 4.5 | pass |
| focus #0b5a5c | paper #f6f5f0 | 7.31 | 3 | pass |
| focus #0b5a5c | surface #fcfcf9 | 7.76 | 3 | pass |
| control-border #858b86 | surface #fcfcf9 | 3.39 | 3 | pass |
| accent #0b5a5c | meter-track #e6e5dd | 6.32 | 3 | pass |
| caution #7d5300 | meter-track #e6e5dd | 5.34 | 3 | pass |
| critical #a3301f | meter-track #e6e5dd | 5.54 | 3 | pass |

## Type

Three Google families load through `next/font` with real fallback stacks, so space is reserved before the fonts arrive. They live in `apps/web/src/app/fonts.ts`.

- Display is Newsreader at weights 500 and 600. It sets headlines and the wordmark. Fallback is Iowan Old Style, Palatino, Georgia.
- Text is Hanken Grotesk, variable. It sets body copy and UI. Fallback is Segoe UI, Helvetica Neue, Helvetica.
- Mono is IBM Plex Mono at 400 and 500. It sets amounts, receipts, addresses and code. It is not preloaded because nothing above the fold waits on it.
- Headings use `text-wrap: balance`, tight leading of 1.04 and negative tracking of about 0.022em.
- Body copy keeps a measure of about 62 characters. Paragraphs use `text-wrap: pretty`.
- Labels are uppercase at 12px with 0.09em tracking, through the `.label` class.
- Figures use `tabular-nums slashed-zero` everywhere they line up.

| Token | Size |
| --- | --- |
| `--text-2xs` | 11px |
| `--text-xs` | 12px |
| `--text-sm` | 14px |
| `--text-md` | 16px |
| `--text-lg` | 18px |
| `--text-xl` | 21px |
| `--text-2xl` | 26px |
| `--text-3xl` | 30px to 40px, fluid |
| `--text-4xl` | 36px to 56px, fluid |
| `--text-5xl` | 42px to 76px, fluid |

## Space, radius, elevation

One 4px based scale drives gaps and padding. Layout uses gap rather than margins where it can.

- Space runs `--space-1` 4px, 8, 12, 16, 24, 32, 48, 64, 96, up to `--space-10` 128px.
- `--gutter` is fluid from 16px to 40px. `--content-max` is 76rem. `--section-pad` is fluid from 64px to 128px.
- Radius is 4px for small marks, 6px for every control, 10px for cards and panels, and a pill for status.
- `--shadow-float` is for things that float, the menu panel, the policy check and toasts. `--shadow-land` is for a receipt as it lands.
- Everything else sits flat on a hairline.

## Motion

One short scale, never bouncy. Every entrance starts from a visible resting state so the first frame is complete.

- Durations are 120ms for hover and press, 200ms for small state changes, 320ms for panels and toasts, 560ms for a meter or a landing receipt.
- Easing is `cubic-bezier(0.22, 0.7, 0.2, 1)` for arrivals and `cubic-bezier(0.45, 0, 0.2, 1)` for movement along a path.
- The gate loop runs 7.2s after a 1.2s rest. A single pass in `once` mode runs 3.4s.
- The header gains opacity on scroll with a CSS scroll timeline. The how it works line fills with a view timeline over a hairline that is always visible.
- Under `prefers-reduced-motion` every component shows its end state and nothing moves. State still changes.

## Icons

One custom line set in `apps/web/src/components/Icon.tsx`. A 24 unit grid, 1.5 stroke, round caps and joins, 2 unit corners. No libraries and no emoji.

- `arrowRight`, `arrowUpRight`, `external`, `chevronDown`, `check`, `close`, `menu`, `copy`, `download`, `search`, `play`
- `key`, `lock`, `shield`, `gauge`, `clock`, `alert`, `info`, `pulse`
- `receipt`, `wallet`, `coins`, `list`, `code`, `endpoint`, `agent`, `gate`
- `sort`, `sortAsc`, `sortDesc`
- Icons are decorative by default and hidden from assistive tech. Pass `title` to give one a name.
- The mark is a three arm turnstile rotor on the accent. The favicon is the same drawing in `apps/web/src/app/icon.svg`.

## Components

Each component lives once in `apps/web/src/components` with a CSS module beside it. Components that show live data take it as props and hold no sample data.

- `Button` and `ButtonLink` come in primary, secondary and quiet, in md and sm. They cover hover, focus-visible, active, disabled and loading. Loading keeps the width, shows a spinner, sets `aria-busy` and announces `loadingLabel`.
- `Header` has the wordmark, Product, Solutions, Pricing, Docs, a quiet Sign in and a primary Open console. It is sticky and slim with a hairline. Below 832px it becomes a disclosure menu with `aria-expanded`. Escape and outside clicks close it and focus returns to the toggle. A route change closes it.
- `Footer` has Product, Developers, Company and Legal columns, a line about Turnstile and the network it settles on. Every link resolves.
- `Section` and `Container` give the standard width, rhythm and header block. `PageIntro` opens an inner page.
- `Card` is flat on a hairline or raised for things that float.
- `StatTile` inside `StatGrid` pairs a label with a tabular figure, an optional unit, a detail line with a tone, and a loading shimmer.
- `CodeBlock` renders on the server with a language or file name header. Only `CopyButton` hydrates. It says Copied or Copy failed and announces the same words.
- `ReceiptCard` shows one receipt in full with the amount leading. `ReceiptRow` and `ReceiptList` show many, with monospace right aligned amounts, a status pill, a timestamp and an explorer link.
- `SpendMeter` is a calm bar that eases toward a cap. It turns caution at 80 percent and critical at the cap, and says so in words. It carries a native `meter` for assistive tech.
- `PolicyPanel` is a read only permissions view of per-call cap, daily cap, session key and allow-list, with a slot for a meter and an action.
- `StatusPill` marks settled, positive, caution, critical and neutral states. The word always carries the meaning.
- `Table` has sortable headers with `aria-sort`, tabular figures and a focusable scroll region. Sorting is exact for bigint amounts. It sorts locally or hands sorting to the parent.
- `Field`, `Input` and `Textarea` wire the label, help text and inline error to the control. The error names the problem and the next step.
- `InlineStatus` sits next to the thing it describes. `ToastProvider` and `useToast` show short confirmations in a polite live region. Critical toasts stay until closed.
- `Illustration` wraps sample content on marketing pages with a visible caption that says it is an illustration.
- `Gate` is the signature element. See below.

### The gate

A request enters, is checked against the policy, passes, and a small receipt lands. The markup is the finished state, so the first frame is complete with no script and with reduced motion.

- `variant` is `full` for the hero or `compact` for a single row echo.
- `motion` is `loop`, `once` or `still`. For the live demo use `once` and change the React key for each new request.
- `outcome` is settled with an amount and a receipt reference, or refused with a reason and a program error name. When refused the arm stays down, the token stops at the gate and turns critical, and a refusal card lands in place of the receipt.
- Each check has a state of pass, fail or skip. Skipped checks read Not reached.
- The stage has fixed dimensions, so it never shifts the layout.
- The visual stage is hidden from assistive tech. A caption built from the props describes the request, the checks and the outcome in one or two sentences.

### Data component props

```ts
// Gate
interface GateProps {
  request: { method: string; path: string; price: string; asset: string };
  checks: readonly { label: string; detail: string; state: "pass" | "fail" | "skip" }[];
  outcome:
    | { kind: "settled"; amount: string; asset: string; reference: string }
    | { kind: "refused"; reason: string; code?: string };
  variant?: "full" | "compact";
  motion?: "loop" | "once" | "still";
}

// ReceiptList and ReceiptRow
interface ReceiptView {
  id: string; // receipt address
  amount: string; // exact decimal, format base units with formatUnits from @turnstile/shared
  asset: string;
  resource: string;
  payer?: string;
  settledAt: string; // ISO 8601
  status: "settled" | "pending" | "failed";
  explorerUrl?: string;
  failureReason?: string;
}
interface ReceiptListProps {
  receipts: readonly ReceiptView[];
  label: string;
  empty?: ReactNode;
  landingIds?: readonly string[]; // only these play the landing motion
  live?: boolean; // announce additions politely
  timeZone?: string; // defaults to UTC so server and browser agree
}

// SpendMeter
interface SpendMeterProps {
  label: string;
  spent: bigint; // base units
  cap: bigint; // base units
  decimals?: number; // defaults to 6
  asset: string;
  cautionAt?: number; // defaults to 0.8
  detail?: ReactNode;
  size?: "md" | "sm";
}

// Table
interface TableProps {
  columns: readonly { key: string; label: string; numeric?: boolean; mono?: boolean; sortable?: boolean; width?: string }[];
  rows: readonly { id: string; cells: Record<string, { value: string | number | bigint | null; display?: ReactNode }> }[];
  caption: string;
  showCaption?: boolean;
  initialSort?: { key: string; direction: "ascending" | "descending" };
  sort?: { key: string; direction: "ascending" | "descending" } | null; // controlled
  onSortChange?: (sort: { key: string; direction: "ascending" | "descending" }) => void;
  empty?: ReactNode;
}

// StatTile, inside StatGrid
interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  detail?: ReactNode;
  icon?: IconName;
  tone?: "neutral" | "positive" | "caution" | "critical";
  loading?: boolean;
}
```

- `SpendMeter` imports `formatUnits` from `@turnstile/shared`. Using it in a client component pulls the shared package into that bundle, which brings `@solana/web3.js` along. Render it from a server component where you can.
- Timestamps render through `formatTimestamp` with fixed month names and an explicit zone, so hydration never disagrees.

## Pages

Every link in the header and footer resolves. Every page below ships, and the shell tests in `apps/web/src/lib/site.test.ts` check that each chrome link has a page.

| Route | Status |
| --- | --- |
| `/` | Built. Hero, problem, how it works, control, proof, builders and owners, live demo teaser, closing call to action |
| `/product` | Built. Model, payment flow, policy, records, security posture, closing |
| `/solutions` | Built. Where it fits, four use cases, what Turnstile takes care of in every case |
| `/pricing` | Built. Illustrative price model, what is included, FAQ |
| `/security` | Built. Trust boundaries, threat model, the guarantee, key handling and rotation, with an on-page jump nav |
| `/docs` | Built. Overview and where to start, inside the docs layout with a sidebar and a narrow screen menu |
| `/docs/quickstart` | Built. Paid route quickstart |
| `/docs/agent-quickstart` | Built. Session key, agent wallet and policy, paying a 402 |
| `/docs/concepts` | Built. How a paid request works and what you work with |
| `/docs/reference` | Built. API reference with examples captured from a local run in `apps/web/src/app/docs/_examples` |
| `/demo` | Built. Live run against the demo agent, with the policy, the gate, receipts and the on-chain refusal. Shows an offline state when the runner does not answer |
| `/signin` | Built. Wallet sign in through Wallet Standard |
| `/console` | Built. Dashboard with totals, spend chart, recent receipts and pending failures |
| `/console/agents` | Built. Agent list read from chain with status and cap usage |
| `/console/agents/new` | Built. Create, fund and set the policy of an agent |
| `/console/agents/[address]` | Built. Agent detail with vault, spend, session keys, allow-list, deposit and withdraw |
| `/console/agents/[address]/policy` | Built. Edit caps and allow-list |
| `/console/receipts` | Built. Filterable, sortable receipts with CSV export |
| `/console/settings` | Built. Console API keys |
| `/about` | Heading and one sentence |
| `/legal/terms` and `/legal/privacy` | Heading and one sentence |
| Not found | Built. Says what happened and offers the home page and the docs |

Gaps found by the first console audit. Uncommitted console work at the time of writing addresses the first two, so check them again with `console-audit.mjs`.

- `/console` had no `h1`.
- `/console` and `/signin` answered 502 when no backend was running, instead of a designed error state.
- A "preloaded but not used" CSS warning appears on every page from link prefetch of the console toast styles.

### Home sections

- Hero. The thesis, a support line, Open console and See it live, three short pillars, and the gate. The gate is labelled as an illustration.
- Problem. Three short blocks on checkout, per-call control and late invoices.
- How it works. Four steps with icons joined by a line that fills on scroll from a visible hairline.
- Control. The four rules in plain words beside a policy panel and a spend meter, labelled as an illustration.
- Proof. One receipt card beside the story of the on-chain record and a link to the settlement program on Solana Explorer. The receipt is labelled as an illustration.
- Builders and owners. Two short columns.
- Live demo teaser. A compact gate and one action to the demo.
- Closing. One calm band with Open console and Read the docs.

## Verification

`pnpm --filter @turnstile/web e2e` runs `apps/web/e2e/audit.mjs` against a running server. Set `E2E_BASE_URL` when the server is not on port 3000.

- It screenshots the home page at 360, 768 and 1440 wide, with and without motion, and with script disabled.
- It runs axe-core with the WCAG 2.1 A and AA and best practice rules on every route at 360 and 1440 wide.
- It fails on sideways scroll, console errors or warnings, layout shift above 0.01, a focus stop with no visible indicator, or a mobile menu that does not open, announce and close correctly.
- Output lands in `apps/web/e2e/output`, which git ignores.
