# G3 — Willingness-to-pay interviews (human executable)

**Status:** READY pack · outreach = human  
**Goal:** Validate that design partners will pay for Atlas Truth / Sentinel before Paid Beta.

## Who to interview (target 8–12)

| Segment | Ideal signal |
|---|---|
| Founding eng / CTO (10–80 eng) | Own release risk; use coding agents |
| Platform / DevEx lead | Own CI + readiness gates |
| Security eng (defensive) | Care about secrets / AuthZ / deps |

**Exclude:** agencies shopping for “AI chatbot”, red-team vendors, students.

## Script (30–40 min)

1. **Context (3 min)** — What ships this month? What’s the last prod surprise?
2. **Current spend (5 min)** — GitHub/GitLab · CI · monitoring · coding agents · SAST. Ballpark monthly.
3. **Pain ranking (7 min)** — Rank 1–5: unknown blast radius · flaky readiness · secrets in git · AuthZ regressions · “AI said it’s fine”.
4. **Demo / story (8 min)** — Show Change → Impact → Evidence → Risk (Truth) + one Sentinel finding with evidenceRefs. Emphasize: no evidence = no strong claim.
5. **Willingness (10 min)** —  
   - Would you pay for this as a seat / repo / eng-surface?  
   - What price feels cheap / fair / expensive? (anchor ranges: $49 / $149 / $499 / custom)  
   - Budget owner + next quarter cycle?
6. **Close (3 min)** — Invite to Early Access / Paid Beta waitlist. Ask for intro to one peer.

## Capture sheet (copy per interview)

```
Date:
Person / role / company size:
Current tools paid:
Top pain (1 sentence):
Price signal (cheap / fair / expensive + number):
Would join Paid Beta? Y/N / When:
Blockers:
Quote (optional, with permission):
```

## Decision rule

| Result | Next |
|---|---|
| ≥5 “fair” at ≥$99/mo equivalent OR ≥3 committed Paid Beta | Open **G4** |
| Soft interest only | Stay on Early Access; refine ICP |
| “Would not pay” dominant | Revisit packaging (Truth vs Sentinel vs seats) |

## Links

- G1 pack: [`design-partner-truth10-early-access.md`](./design-partner-truth10-early-access.md)  
- Why pay: [`why-customers-pay.md`](./why-customers-pay.md)  
- Tracker: [`design-partner-tracker.md`](./design-partner-tracker.md)
