# Round 3 market model

Replaces the clearing rule "(net shares ÷ 1,000)%, capped at ±10%" with a model that behaves more like a real market.
Code: `packages/engine/src/market.ts` (engine) and `supabase/migrations/20261106000016_market_model.sql` (database),
kept identical by the parity tests.

Per company, when a round clears:

| Part | Rule | Why |
|---|---|---|
| Impact | sign(net) × 1% × √(\|net\| × price ÷ $10,000) | Square-root law: $10k net → 1%, $100k → 3.2%, $1M → 10%. Money, not share count, moves a price. |
| Value | 12% of the gap to the score-based (judged) price | Background value investors: good analysis pays. Before 02:45 it uses the public post-crisis price, so no score leaks. |
| Momentum | 10% of last round's move | Trend followers. |
| Market / sector / own | 0.3% / 0.5% / 0.7% × a random draw | Everything moves together a little, the 15 companies of a crisis card more, each company a bit on its own. Prices move even when nobody trades. |
| News | the organisers' scheduled shocks | Released with the clearing, so nobody trades on it first. |

The total is capped at ±10% per round (so the 110% buy reserve still covers every fill), and every order of a round
still fills at the one price: order speed gives no advantage. Nothing about orders, limits or scoring changes.

**Randomness you can check afterwards.** The database creates a market seed (at the first clearing, or earlier from
`market_seed_commitment(event)`); its SHA-256 is public in `events.market_seed_commitment` from then on, the seed
itself is published in `events.market_seed_revealed` at the 04:30 close. Organisers only can read it before that.

**Market news** (control panel → Bulletins → Market news): title, body, round, who it moves (every company, one crisis
card's companies, one company) and a shock of −20% to +20%. It stays hidden until its round clears. Rumours still never
change any price.

**Fallback:** `set_market_model(event, 'SIMPLE')` restores the original rule, any time before round 1 clears.

**Tuning:** `pnpm market-sim --runs 40` plays Round 3 with 150 bot teams under both rules. Results (40 nights):

| | old rule | new model |
|---|---|---|
| average move per round | 1.9% | 1.2% |
| moves stuck at the ±10% limit | 8.0% | 0.6% |
| company-rounds with no move at all | 45.8% | 3.2% |
| average return, value investors | −8.9% | +5.9% |
| average return, trend chasers | −3.7% | −11.5% |
| share of return differences due to the noise | 0% | ≈15% |

Every price, with its parts, is stored in `round_prices.move_ppm` and `round_prices.parts`.
