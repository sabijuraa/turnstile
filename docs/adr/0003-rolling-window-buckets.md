# ADR 0003. Rolling daily cap in 15 minute buckets

Status. Accepted.

## Context

The daily cap must cover a real rolling 24 hour window, not a calendar day that resets at midnight. Keeping every payment on chain would make the wallet account grow without bound.

## Decision

The wallet keeps a ring of 97 buckets of 900 seconds each.

- The bucket index is `floor(unix_timestamp / 900)` and it lives in slot `index mod 97`.
- Recording spend adds to the slot when it holds the same index. Otherwise the slot is reset to the new index first.
- Rolling spend is the sum of buckets with `index >= now_index - 96`.
- The window covers 97 consecutive indexes and each has its own slot. A reset slot therefore only ever held spend that had already left the window.

## Consequences

- A payment counts toward the cap for at least 24 hours and at most 24 hours and 15 minutes. The window errs on the side of the owner. More than the cap never goes through in any true 24 hour period.
- The ring costs 1552 bytes in the account and a fixed scan of 97 entries per settlement.
- Amounts are integer base units with checked math. There is no rounding.
- `rolling_spend` exposes the current value as return data, and `rollingSpend` in packages/shared computes the same sum off chain.
