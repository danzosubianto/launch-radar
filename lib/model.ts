// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// What the board is. The snapshot records 758 protocols. Some already have a token trading; the
// radar's subject is the rest — the protocols whose record carries no token yet. The board ranks
// every rankable one of them (the house watchlist of 40 plus every other pre-token record the
// snapshot holds, 300+ rows), because a radar that only repeats the floor finds nothing early.
//
// How a row earns its implied value. No name is special-cased and no multiple is a constant of
// this file: the multiples are measured from the snapshot itself. For every category, the
// tokenized protocols in that category show what the market actually pays per dollar of TVL
// (market cap / TVL); the category's multiple is the median of those ratios, shrunk toward the
// global median by the peer count so a category with two peers cannot shout. A pre-token
// protocol's implied value is then
//
//   implied = TVL x category multiple x growth x maturity x breadth x class
//
//   growth    1 + clamp(change_7d, -50, +100)/100 x 0.35 — a hot week helps, a bad week hurts,
//             neither decides: seven days is weather, not climate.
//   maturity  0.55 + 0.45 x min(age_days, 1825)/1825 — five tokenless years is the strongest
//             signal a record can carry; an unlisted age scores a neutral 0.78.
//   breadth   1 + 0.04 per extra chain, capped at 1.20 — distribution is worth something.
//   class     1 for a genuine candidate; 0.15 for a derivative product (a wrapped, staked or
//             bridged product of a token that already trades): its value sits with the parent
//             token, so a standalone token of its own would capture only a fraction.
//
// The board states the model on its face: every row carries the multiples that produced it, and
// the dashboard prints the peer table the category multiples came from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it wherever it states the model. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's Already trading view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The model's fixed weights: everything else is measured from the snapshot at run time. */
export const WEIGHTS = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1825,
  unknown_age_maturity: 0.78,
  breadth_per_chain: 0.04,
  breadth_cap: 1.2,
  derivative_class: 0.15,
  peer_shrinkage: 6,
  multiple_min: 0.02,
  multiple_max: 3,
};

/** How a board row is classed: a house-watchlist candidate, an early find, or a derivative product. */
export type RowClass = 'watchlist' | 'early' | 'derivative';

/** One category's measured multiple: the peer evidence behind a row's base value. */
export interface PeerMultiple {
  category: string;
  peers: number;
  median_ratio: number;
  multiple: number;
}

/** One row of board.json: the ranked board's row, with the model arithmetic that produced it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  row_class: RowClass;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    class_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row plus nothing it cannot show. */
export interface RadarRow extends BoardRow {
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders, computed from the snapshot by buildRadar. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: typeof WEIGHTS;
  global_multiple: number;
  peer_table: PeerMultiple[];
  counts: {
    protocols: number;
    live_token: number;
    pre_token: number;
    watchlist: number;
    board: number;
    derivative: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the protocol's record carries a token (any of market cap, Gecko id or symbol). */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose products are derivatives of a token that already trades. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name: the product is the exchange's, not a candidate's. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token record is a wrapped, staked or bridged product of a token that already
 * trades — the same tests the house watchlist applies, reused here as a discount, not an
 * exclusion: the row stays on the board, classed and priced as a derivative.
 */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** Whether a protocol may be ranked: it records no token, is not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return !recordsToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, measured from the snapshot's own tokenized protocols: for each
 * category, the median market-cap/TVL of its tokenized peers, shrunk toward the global median
 * by the peer count (multiple = (n x median + k x global) / (n + k)) and clamped to a sane band.
 * A category with no tokenized peer gets the global median itself.
 */
export function peerMultiples(snapshot: Snapshot): { global: number; byCategory: Map<string, PeerMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = all.length > 0 ? median(all) : 0.17;
  const byCategory = new Map<string, PeerMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const shrunk = (ratios.length * med + WEIGHTS.peer_shrinkage * global) / (ratios.length + WEIGHTS.peer_shrinkage);
    byCategory.set(category, {
      category,
      peers: ratios.length,
      median_ratio: round4(med),
      multiple: round4(clamp(shrunk, WEIGHTS.multiple_min, WEIGHTS.multiple_max)),
    });
  }
  return { global: round4(global), byCategory };
}

/** The multiple one category scores with, and how many tokenized peers stand behind it. */
function multipleFor(
  peers: { global: number; byCategory: Map<string, PeerMultiple> },
  category: string | null,
): { multiple: number; peers: number } {
  const row = peers.byCategory.get(category ?? '(uncategorised)');
  return row === undefined ? { multiple: peers.global, peers: 0 } : { multiple: row.multiple, peers: row.peers };
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  peers: { global: number; byCategory: Map<string, PeerMultiple> },
  rowClass: RowClass,
): { implied: number; age: number | null; multiple: number; categoryPeers: number; growthMult: number; maturityMult: number; breadthMult: number; classMult: number } {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const { multiple, peers: categoryPeers } = multipleFor(peers, p.category);
  const growthPct = clamp(p.change_7d ?? 0, WEIGHTS.growth_floor, WEIGHTS.growth_cap);
  const growthMult = 1 + (growthPct / 100) * WEIGHTS.growth_weight;
  const maturityMult =
    age === null
      ? WEIGHTS.unknown_age_maturity
      : WEIGHTS.maturity_floor + (Math.min(age, WEIGHTS.maturity_days) / WEIGHTS.maturity_days) * WEIGHTS.maturity_range;
  const breadthMult = Math.min(WEIGHTS.breadth_cap, 1 + WEIGHTS.breadth_per_chain * Math.max(0, p.chains.length - 1));
  const classMult = rowClass === 'derivative' ? WEIGHTS.derivative_class : 1;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * breadthMult * classMult));
  return { implied, age, multiple, categoryPeers, growthMult, maturityMult, breadthMult, classMult };
}

/** A typical all-in cost, in dollars, of one deposit or swap on a chain, from the chain's tier. */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 9;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Binance' || chain === 'opBNB') return 0.3;
  if (['Arbitrum', 'Base', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Metis', 'Unichain', 'Sonic', 'Avalanche', 'Polygon', 'xDai', 'Celo'].includes(chain)) return 0.4;
  return 0.8;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 1095) return 35;
  return 30;
}

/** The category's core action and its weekly follow-up, in words a farmer can follow. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow about 40% of it once and repay it a week later, so the wallet shows both sides of the market.`,
      weekly: `Add or remove a small amount of collateral each week and let one borrow run for at least seven days before repaying.`,
    };
  if (c.includes('dex'))
    return {
      core: `Swap about $${Math.max(25, Math.round(capital / 4))} into the main pair on ${name} (${chain}) and provide the rest of the $${capital} as liquidity in that pool.`,
      weekly: `Make two or three swaps a week through ${name} and rebalance the liquidity position once, keeping it in range.`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge $${capital} of USDC from Ethereum to ${chain === 'Ethereum' ? 'a chain ' + name + ' serves' : chain} through ${name}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
      weekly: `Bridge a small amount ($25–$50) once a week, alternating direction, and keep a balance on the far side between trips.`,
    };
  if (c.includes('staking') || c.includes('restak'))
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token in the same wallet.`,
      weekly: `Claim and re-stake the rewards each week, and add a small top-up once a month so the position keeps growing.`,
    };
  if (c.includes('derivative') || c.includes('perpetual'))
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long and short the same size on two markets) so the account trades without directional risk.`,
      weekly: `Roll the hedge once a week and keep the margin topped up; volume and open interest are what these venues count.`,
    };
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield'))
    return {
      core: `Deposit $${capital} into one of ${name}'s vaults on ${chain} and keep the vault shares in the depositing wallet.`,
      weekly: `Move a small part of the position between two vaults each fortnight, so the wallet shows considered use rather than a parked deposit.`,
    };
  if (c.includes('rwa'))
    return {
      core: `Complete ${name}'s onboarding on ${chain} and mint $${capital} of its yield asset, holding it in the onboarding wallet.`,
      weekly: `Hold through each distribution date and make one small additional mint a month while onboarding stays open.`,
    };
  if (c.includes('basis'))
    return {
      core: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position through a full funding cycle.`,
      weekly: `Check the position weekly and top up by $25 after any week the vault reports positive funding.`,
    };
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open.`,
    weekly: `Make one qualifying action each week — a deposit, a swap, a vote or a claim — so the wallet reads as a regular user.`,
  };
}

/**
 * A protocol's farm plan: five steps, each an action with its cost and its time, derived from the
 * protocol's own record (category, main chain, TVL, age) — never from a hand-written list of names.
 * Derivative products get an honest plan: the token, if one comes, belongs to the parent, so the
 * plan says to farm the parent's ecosystem instead of pretending otherwise.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, rowClass: RowClass): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasUsd(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gasText = gas < 1 ? 'under $1' : `about $${gas}`;
  const steps: string[] = [];
  steps.push(
    `Set up a fresh wallet for this farm and fund it on ${chain} with the position money plus gas. Cost: ${gasText} for the first transaction. Time: 10 minutes.`,
  );
  if (rowClass === 'derivative') {
    steps.push(
      `${p.name} is a wrapped, staked or bridged product of a token that already trades, so a new token of its own is unlikely: farm the parent ecosystem instead — hold the product on ${chain} and use it as collateral or liquidity in one major app. Cost: $${capital} of capital, ${gasText} of gas. Time: 15 minutes.`,
    );
    steps.push(
      `Keep the product working for at least ${hold} days rather than idle: a position that earns and is counted in snapshots is the whole play here. Cost: the $${capital} stays deployed. Time: ${hold} days.`,
    );
  } else {
    const play = playbook(p, capital, chain);
    steps.push(`${play.core} Cost: $${capital} of capital and ${gasText} of gas. Time: 15 minutes to set up.`);
    steps.push(`${play.weekly} Cost: about $${Math.max(1, Math.round(gas * 2))} of gas a week. Time: 10 minutes a week.`);
    steps.push(
      `Hold the position for at least ${hold} days so the activity spans more than one snapshot of the protocol's records. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    );
  }
  steps.push(
    `Register the wallet on ${p.name}'s own points, quests or rewards page if it runs one, and claim only from links that page publishes — never from a search result or a direct message. Cost: nothing to check, and never pay a fee to claim. Time: 10 minutes.`,
  );
  steps.push(
    `Keep a farm log — wallet, dates, amounts, transaction hashes — and review it monthly: if a token is announced, the log is your proof of when you were active, and it makes unwinding a five-minute job. Cost: nothing. Time: 5 minutes a month.`,
  );
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** A row's class: watchlist first (the house's own candidates), then derivative, then early. */
function classOf(p: SnapshotProtocol, watchlist: Set<string>): RowClass {
  if (watchlist.has(p.slug)) return 'watchlist';
  if (isDerivativeProduct(p)) return 'derivative';
  return 'early';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const rowClass = classOf(p, watchlist);
    const v = impliedValue(p, snapshot, peers, rowClass);
    return { p, rowClass, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    row_class: s.rowClass,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      category_peers: s.categoryPeers,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      class_multiplier: s.classMult,
    },
    farm_steps: farmSteps(s.p, s.age, s.rowClass),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const peers = peerMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const peerTable = [...peers.byCategory.values()]
    .filter((row) => board.some((r) => (r.category ?? '(uncategorised)') === row.category))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
    .slice(0, 12);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    weights: WEIGHTS,
    global_multiple: peers.global,
    peer_table: peerTable,
    counts: {
      protocols: snapshot.protocols.length,
      live_token: snapshot.protocols.filter(recordsToken).length,
      pre_token: snapshot.protocols.filter((p) => !recordsToken(p)).length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      derivative: board.filter((r) => r.row_class === 'derivative').length,
    },
    rows: board.map((r) => ({ ...r, on_watchlist: watchlist.has(r.slug) })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
