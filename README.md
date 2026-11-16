# Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/danzosubianto/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/danzosubianto/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the bounty's sealed DefiLlama snapshot (758 protocols), sets aside the 416 that already trade a token, and ranks all 289 rankable protocols that record no token yet — the house watchlist of 40 plus every early find below its floor — by an implied token value measured from the snapshot itself. Each category's multiple is the median market-cap/TVL of that category's tokenized protocols, shrunk toward the global median by peer count; growth, tokenless age, chain breadth and a derivative discount (0.15× for wrapped, staked or bridged products of tokens that already trade) adjust it. Every row carries a five-step farm plan with costs and times, and the static dashboard is sortable and filterable, with a detail view per protocol and an Already trading view for the evidence base.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
