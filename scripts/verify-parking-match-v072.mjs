import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FIXTURE = resolve('tests', 'fixtures', 'parking-realtime-coverage-v072-replay.json');
const MIGRATION = resolve('migrations', '0005_v0_7_2_parking_match_rules.sql');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseRules(sql) {
  const rules = new Map();
  const rowPattern = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*,\s*([01])\s*,/g;
  for (const match of sql.matchAll(rowPattern)) {
    const [, parkingCode, parkingId, matchType, confidenceRaw, allowAggregateRaw] = match;
    rules.set(parkingCode, {
      parkingCode,
      parkingId,
      matchType,
      confidence: Number(confidenceRaw),
      allowAggregate: allowAggregateRaw === '1',
    });
  }
  return rules;
}

function normalizeNumbers(item) {
  const raw = {
    available: item.available == null ? null : Number(item.available),
    occupied: item.occupied == null ? null : Number(item.occupied),
    capacity: item.capacity == null ? null : Number(item.capacity),
  };

  let { available, occupied, capacity } = raw;
  const missingCount = [available, occupied, capacity].filter((value) => value == null).length;
  let derived = false;

  if (missingCount === 1) {
    if (capacity == null && available != null && occupied != null) {
      capacity = available + occupied;
      derived = true;
    } else if (available == null && capacity != null && occupied != null) {
      available = Math.max(0, capacity - occupied);
      derived = true;
    } else if (occupied == null && capacity != null && available != null) {
      occupied = Math.max(0, capacity - available);
      derived = true;
    }
  }

  const complete = available != null && occupied != null && capacity != null;
  const nonNegative = complete && capacity >= 0 && available >= 0 && occupied >= 0;
  const consistent = nonNegative && Math.abs(capacity - (available + occupied)) <= 1;

  return { available, occupied, capacity, derived, missingCount, complete, nonNegative, consistent, raw };
}

function resolvedMatch(item, rules) {
  const code = String(item.parkingCode || '').trim();
  const rule = rules.get(code);
  if (rule) {
    return {
      matched: true,
      status: 'MATCHED',
      parkingId: rule.parkingId,
      method: 'code-rule',
      allowAggregate: rule.allowAggregate,
    };
  }

  const baseline = item.baseMatch || {};
  if (baseline.status === 'BASE_MATCHED' && baseline.parkingId) {
    return {
      matched: true,
      status: 'MATCHED',
      parkingId: String(baseline.parkingId),
      method: String(baseline.method || 'unknown'),
      allowAggregate: false,
    };
  }
  if (baseline.status === 'BASE_AMBIGUOUS') {
    return { matched: false, status: 'AMBIGUOUS', parkingId: null, method: 'ambiguous', allowAggregate: false };
  }
  return { matched: false, status: 'UNMATCHED', parkingId: null, method: 'unmatched', allowAggregate: false };
}

function aggregateComponents(components) {
  const sum = (key) => components.reduce((total, item) => total + Number(item[key]), 0);
  const sourceTimes = components
    .map((item) => item.sourceUpdatedAt)
    .filter(Boolean)
    .sort((a, b) => Date.parse(String(a).replace(' ', 'T') + 'Z') - Date.parse(String(b).replace(' ', 'T') + 'Z'));

  return {
    available: sum('available'),
    occupied: sum('occupied'),
    capacity: sum('capacity'),
    sourceUpdatedAt: sourceTimes[0] || null,
    codes: components.map((item) => item.parkingCode).sort(),
  };
}

console.log('\nPlugPark v0.7.2-P2 PARKING MATCH REPLAY VERIFY');
console.log('원칙: public API call 0 · Remote D1 write 0 · 기존 P1 audit fixture replay\n');

const [fixture, migrationSql] = await Promise.all([
  readFile(FIXTURE, 'utf8').then(JSON.parse),
  readFile(MIGRATION, 'utf8'),
]);

assert(fixture.version === 'v0.7.2-P2-replay-fixture', `fixture version=${fixture.version}`);
assert(Array.isArray(fixture.items) && fixture.items.length === 50, `fixture item count=${fixture.items?.length}`);
assert(fixture.sourceSummary?.matched === 25, `P1 matched baseline=${fixture.sourceSummary?.matched}`);
assert(fixture.sourceSummary?.unmatched === 25, `P1 unmatched baseline=${fixture.sourceSummary?.unmatched}`);
assert(fixture.sourceSummary?.ambiguous === 0, `P1 ambiguous baseline=${fixture.sourceSummary?.ambiguous}`);

const rules = parseRules(migrationSql);
assert(rules.size === 14, `production code-rule count 기대=14, 실제=${rules.size}`);
assert(!rules.has('A26'), 'A26 ambiguous rule이 남아 있습니다.');
assert(!rules.has('A435'), 'A435 schema-invalid rule은 금지입니다.');

const expectedRuleTargets = new Map([
  ['A07', '2007011298'],
  ['A21', '2019000001'],
  ['A27', '2007011184'],
  ['A29', '2007011207'],
  ['A32', '2007011110'],
  ['A33', '2009000025'],
  ['A34', '2007011236'],
  ['A35', '2007011238'],
  ['A48', '2007011003'],
  ['A433', '2007011024'],
  ['A41', '2019000002'],
  ['A50', '2019000002'],
  ['A43', '2008011648'],
  ['A44', '2008011648'],
]);
for (const [code, parkingId] of expectedRuleTargets) {
  const rule = rules.get(code);
  assert(rule?.parkingId === parkingId, `${code} rule target=${rule?.parkingId || 'missing'}`);
}
for (const code of ['A41', 'A50', 'A43', 'A44']) {
  assert(rules.get(code)?.allowAggregate === true, `${code} allow_aggregate=true가 아님`);
}

const baselineMatched = fixture.items.filter((item) => item.baseMatch?.status === 'BASE_MATCHED');
const legacyRegressions = [];
const outcomes = [];
const contributions = new Map();
let schemaInvalidCount = 0;
let numericInvalidCount = 0;
let matchedCount = 0;
let unmatchedCount = 0;
let ambiguousCount = 0;
let validMatchedContributionCount = 0;

for (const item of fixture.items) {
  const match = resolvedMatch(item, rules);
  const numbers = normalizeNumbers(item);
  const schemaInvalid = item.apiStatus === 'LIVE_SCHEMA_INVALID' || numbers.missingCount > 1;

  if (match.matched) matchedCount += 1;
  else if (match.status === 'AMBIGUOUS') ambiguousCount += 1;
  else unmatchedCount += 1;

  if (schemaInvalid) {
    schemaInvalidCount += 1;
  } else if (!numbers.consistent) {
    numericInvalidCount += 1;
  }

  if (item.baseMatch?.status === 'BASE_MATCHED') {
    if (!match.matched || match.parkingId !== String(item.baseMatch.parkingId)) {
      legacyRegressions.push({
        parkingCode: item.parkingCode,
        before: item.baseMatch.parkingId,
        after: match.parkingId,
      });
    }
  }

  if (match.matched && !schemaInvalid && numbers.consistent) {
    const current = contributions.get(match.parkingId) || new Map();
    assert(!current.has(item.parkingCode), `duplicate parking code contribution: ${item.parkingCode}`);
    current.set(item.parkingCode, {
      parkingCode: item.parkingCode,
      available: numbers.available,
      occupied: numbers.occupied,
      capacity: numbers.capacity,
      sourceUpdatedAt: item.sourceUpdatedAt || null,
    });
    contributions.set(match.parkingId, current);
    validMatchedContributionCount += 1;
  }

  outcomes.push({
    parkingCode: item.parkingCode,
    match,
    numbers,
    schemaInvalid,
  });
}

assert(baselineMatched.length === 25, `legacy matched fixture=${baselineMatched.length}`);
assert(legacyRegressions.length === 0, `legacy match regression=${JSON.stringify(legacyRegressions)}`);
assert(matchedCount === 35, `P2 match-layer matched 기대=35, 실제=${matchedCount}`);
assert(unmatchedCount === 15, `P2 match-layer unmatched 기대=15, 실제=${unmatchedCount}`);
assert(ambiguousCount === 0, `P2 match-layer ambiguous 기대=0, 실제=${ambiguousCount}`);
assert(schemaInvalidCount === 1, `schema invalid 기대=1, 실제=${schemaInvalidCount}`);
assert(numericInvalidCount === 2, `numeric invalid 기대=2, 실제=${numericInvalidCount}`);
assert(validMatchedContributionCount === 34, `valid matched contributions 기대=34, 실제=${validMatchedContributionCount}`);
assert(contributions.size === 32, `unique snapshot parking ids 기대=32, 실제=${contributions.size}`);

const negativeCodes = outcomes
  .filter((item) => !item.schemaInvalid && !item.numbers.consistent && (
    (item.numbers.raw.available ?? 0) < 0 ||
    (item.numbers.raw.occupied ?? 0) < 0 ||
    (item.numbers.raw.capacity ?? 0) < 0
  ))
  .map((item) => item.parkingCode)
  .sort();
assert(JSON.stringify(negativeCodes) === JSON.stringify(['A18', 'A30']), `negative invalid=${negativeCodes.join(',')}`);

const schemaInvalidCodes = outcomes.filter((item) => item.schemaInvalid).map((item) => item.parkingCode).sort();
assert(JSON.stringify(schemaInvalidCodes) === JSON.stringify(['A435']), `schema invalid codes=${schemaInvalidCodes.join(',')}`);

for (const [code, parkingId] of expectedRuleTargets) {
  const outcome = outcomes.find((item) => item.parkingCode === code);
  assert(outcome?.match.method === 'code-rule', `${code} code-rule 우선 적용 실패`);
  assert(outcome?.match.parkingId === parkingId, `${code} replay target=${outcome?.match.parkingId}`);
}

const yacht = aggregateComponents([...contributions.get('2019000002').values()]);
assert(JSON.stringify(yacht.codes) === JSON.stringify(['A41', 'A50']), `요트경기장 components=${yacht.codes.join(',')}`);
assert(yacht.available === 229 && yacht.occupied === 70 && yacht.capacity === 299,
  `요트경기장 aggregate=${yacht.available}/${yacht.occupied}/${yacht.capacity}`);

const bujeon = aggregateComponents([...contributions.get('2008011648').values()]);
assert(JSON.stringify(bujeon.codes) === JSON.stringify(['A43', 'A44']), `부전복개도로 components=${bujeon.codes.join(',')}`);
assert(bujeon.available === 17 && bujeon.occupied === 26 && bujeon.capacity === 43,
  `부전복개도로 aggregate=${bujeon.available}/${bujeon.occupied}/${bujeon.capacity}`);

let duplicateOverwriteCount = 0;
for (const [parkingId, components] of contributions) {
  const expected = outcomes.filter((item) =>
    item.match.matched &&
    item.match.parkingId === parkingId &&
    !item.schemaInvalid &&
    item.numbers.consistent
  ).length;
  if (components.size !== expected) duplicateOverwriteCount += Math.abs(expected - components.size);
}
assert(duplicateOverwriteCount === 0, `duplicate overwrite=${duplicateOverwriteCount}`);

console.log('P1 50건 fixture ... PASS');
console.log('Strict validation ... PASS · negative=A18,A30 · schema=A435');
console.log('Code-rule priority ... PASS · production rules=14 · A26 omitted');
console.log('Match summary ... PASS · matched=35 · unmatched=15 · ambiguous=0');
console.log('Legacy 25 match regression ... PASS · regression=0');
console.log('Many-to-one aggregation ... PASS · yacht=229/70/299 · bujeon=17/26/43');
console.log('Duplicate overwrite ... PASS · 0');
console.log('Snapshot candidates ... PASS · contributions=34 · parkingIds=32');
console.log('\n✅ v0.7.2-P2 PARKING MATCH REPLAY: PASS');
console.log('Public API calls=0 · Remote D1 writes=0 · Cloudflare writes=0');
