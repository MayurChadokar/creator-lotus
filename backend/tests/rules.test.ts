// The arithmetic and rule engines, checked against hand-worked answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addWorkingDays, taxYear } from '../src/core.js';
import { computeNet, computePay, computeTds, maxPay } from '../src/engines/pricing.js';
import { evaluateGate, missingTags, parsePostUrl } from '../src/engines/qualityGate.js';

const terms = { basePayPaise: 100000, bonusPer10kPaise: 20000, maxViewBonusPaise: 200000, multiplierBps: 15000 };
const rule = { rateBps: 1000, noPanRateBps: 2000, annualThresholdPaise: 5000000 };
const gate = { minEngagementBps: 150, minViews: 500, requireDisclosure: true };

test('pay: base + complete 10k blocks, then multiplier', () => {
  // 25,000 views = 2 blocks = Rs 400 bonus; (1000+400) x 1.5 = Rs 2,100
  assert.deepEqual(computePay(terms, 25000), { basePaise: 100000, viewBonusPaise: 40000, grossPaise: 210000 });
  assert.equal(computePay(terms, 9999).viewBonusPaise, 0);
});
test('pay: bonus stops at the cap, and max pay is the true ceiling', () => {
  assert.equal(computePay(terms, 10_000_000).viewBonusPaise, 200000);
  assert.equal(computePay(terms, 10_000_000).grossPaise, maxPay(terms));
  assert.equal(maxPay(terms), 450000);
});
test('TDS: nothing up to the Rs 50,000 threshold', () => {
  assert.equal(computeTds({ grossPaise: 5000000, priorGrossThisYearPaise: 0, priorTdsThisYearPaise: 0, panOperative: true, rule }).tdsPaise, 0);
});
test('TDS: crossing the threshold taxes the full year total', () => {
  // Rs 40,000 earlier + Rs 20,000 now = Rs 60,000 x 10% = Rs 6,000
  assert.equal(computeTds({ grossPaise: 2000000, priorGrossThisYearPaise: 4000000, priorTdsThisYearPaise: 0, panOperative: true, rule }).tdsPaise, 600000);
});
test('TDS: after crossing, only the new payment is taxed', () => {
  assert.equal(computeTds({ grossPaise: 1000000, priorGrossThisYearPaise: 6000000, priorTdsThisYearPaise: 600000, panOperative: true, rule }).tdsPaise, 100000);
});
test('TDS: 20% when PAN is inoperative, never above the payment', () => {
  assert.equal(computeTds({ grossPaise: 2000000, priorGrossThisYearPaise: 4000000, priorTdsThisYearPaise: 0, panOperative: false, rule }).tdsPaise, 1200000);
  assert.equal(computeTds({ grossPaise: 100000, priorGrossThisYearPaise: 4950000, priorTdsThisYearPaise: 0, panOperative: true, rule }).tdsPaise, 100000);
});
test('Net: tax on benefits is capped at what is left after tax', () => {
  assert.deepEqual(computeNet(100000, 10000, 500000), { benefitTdsPaise: 90000, netPaise: 0 });
  assert.deepEqual(computeNet(100000, 10000, 20000), { benefitTdsPaise: 20000, netPaise: 70000 });
});
test('TDS: a single large payment under a yearly limit is taxed alone (194C)', () => {
  const c = { rateBps: 100, noPanRateBps: 2000, annualThresholdPaise: 10000000, singleThresholdPaise: 3000000 };
  assert.equal(computeTds({ grossPaise: 3000000, priorGrossThisYearPaise: 0, priorTdsThisYearPaise: 0, panOperative: true, rule: c }).tdsPaise, 0); // exactly at the limit
  assert.equal(computeTds({ grossPaise: 3000100, priorGrossThisYearPaise: 0, priorTdsThisYearPaise: 0, panOperative: true, rule: c }).tdsPaise, 30000);
  assert.equal(computeTds({ grossPaise: 2000000, priorGrossThisYearPaise: 9000000, priorTdsThisYearPaise: 0, panOperative: true, rule: c }).tdsPaise, 110000); // year crossed: 1% of Rs 1.1 lakh
});
test('Gate: pass, low engagement, low views', () => {
  assert.equal(evaluateGate({ views: 10000, likes: 400, comments: 50 }, gate, '#ad').result, 'PASS');
  const low = evaluateGate({ views: 10000, likes: 100, comments: 10 }, gate, '#ad');
  assert.equal(low.result, 'FAIL'); assert.equal(low.engagementBps, 110);
  assert.equal(evaluateGate({ views: 100, likes: 50, comments: 5 }, gate, '#ad').result, 'FAIL');
});
test('Gate: exactly at the minimum passes', () => {
  assert.equal(evaluateGate({ views: 10000, likes: 140, comments: 10 }, gate, '#ad').result, 'PASS');
});
test('Gate: hidden likes go to a person and do not count as zero', () => {
  const r = evaluateGate({ views: 10000, likes: null, comments: 50 }, gate, '#ad');
  assert.equal(r.result, 'REVIEW'); assert.equal(r.engagementBps, null);
});
test('Gate: bot warning signs go to a person', () => {
  assert.equal(evaluateGate({ views: 100000, likes: 2000, comments: 100, followers: 500 }, gate, '#ad').result, 'REVIEW');
  assert.equal(evaluateGate({ views: 10000, likes: 5000, comments: 100 }, gate, '#ad').result, 'REVIEW');
  assert.equal(evaluateGate({ views: 100000, likes: 3000, comments: 100 }, gate, '#ad', [{ views: 1000 }, { views: 2000 }]).result, 'REVIEW');
});
test('Gate: missing #ad label is flagged, and words containing "ad" do not count', () => {
  assert.equal(evaluateGate({ views: 10000, likes: 400, comments: 50 }, gate, 'loaded with features, read more').result, 'REVIEW');
  assert.equal(evaluateGate({ views: 10000, likes: 400, comments: 50 }, gate, 'Love this #Sponsored').result, 'PASS');
});
test('Posting specs: tags found anywhere, any case; partial matches do not count', () => {
  assert.deepEqual(missingTags('Great deals! #lotusdiwali #ad @LotusElectronics.', ['#LotusDiwali', '@lotuselectronics']), []);
  assert.deepEqual(missingTags('#LotusDiwaliSale @lotuselectronics_fan', ['#LotusDiwali', '@lotuselectronics']), ['#LotusDiwali', '@lotuselectronics']);
  assert.deepEqual(missingTags(null, ['#Lotus']), ['#Lotus']);
  const r = evaluateGate({ views: 10000, likes: 400, comments: 50 }, { ...gate, requiredTags: ['#LotusDiwali'] }, 'Nice #ad');
  assert.equal(r.result, 'REVIEW'); assert.match(r.reasons[0]!, /#LotusDiwali/);
});
test('URLs: real links parse and look-alikes are refused', () => {
  assert.deepEqual(parsePostUrl('https://www.instagram.com/reel/AbC_1-x/?igsh=1'), { platform: 'INSTAGRAM', key: 'AbC_1-x' });
  assert.deepEqual(parsePostUrl('https://instagram.com/someone/p/XyZ/'), { platform: 'INSTAGRAM', key: 'XyZ' });
  assert.deepEqual(parsePostUrl('https://youtu.be/dQw4w9WgXcQ'), { platform: 'YOUTUBE', key: 'dQw4w9WgXcQ' });
  assert.deepEqual(parsePostUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), { platform: 'YOUTUBE', key: 'dQw4w9WgXcQ' });
  assert.deepEqual(parsePostUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), { platform: 'YOUTUBE', key: 'dQw4w9WgXcQ' });
  assert.equal(parsePostUrl('https://instagram.com.evil.io/p/XyZ/'), null);
  assert.equal(parsePostUrl('https://www.instagram.com/someone/'), null);
  assert.equal(parsePostUrl('not a link'), null);
});
test('Dates: Indian tax year and 3 working days', () => {
  assert.equal(taxYear('2026-11-03'), '2026-27');
  assert.equal(taxYear('2027-03-31'), '2026-27');
  assert.equal(taxYear('2027-04-01'), '2027-28');
  assert.equal(addWorkingDays('2026-11-03', 3, new Set()), '2026-11-06');          // Tue -> Fri
  assert.equal(addWorkingDays('2026-11-05', 3, new Set()), '2026-11-10');          // Thu skips the weekend
  assert.equal(addWorkingDays('2026-11-05', 3, new Set(['2026-11-09'])), '2026-11-11');
});
