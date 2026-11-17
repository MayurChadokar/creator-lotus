// Engine 2: pricing and tax. Pure arithmetic with no database, so it is easy to test.
export interface RateTerms {
  basePayPaise: number;
  bonusPer10kPaise: number;
  maxViewBonusPaise: number;
  multiplierBps: number;
}
export interface PayResult { basePaise: number; viewBonusPaise: number; grossPaise: number }

/** gross = (base + view bonus) x category multiplier. Bonus counts complete 10,000-view blocks only. */
export function computePay(t: RateTerms, views: number): PayResult {
  const blocks = Math.floor(Math.max(views, 0) / 10000);
  const viewBonusPaise = Math.min(blocks * t.bonusPer10kPaise, t.maxViewBonusPaise);
  const grossPaise = Math.round(((t.basePayPaise + viewBonusPaise) * t.multiplierBps) / 10000);
  return { basePaise: t.basePayPaise, viewBonusPaise, grossPaise };
}

/** The most a submission can ever earn. This is what gets reserved from the campaign budget. */
export const maxPay = (t: RateTerms): number =>
  Math.round(((t.basePayPaise + t.maxViewBonusPaise) * t.multiplierBps) / 10000);

export interface TdsRule { rateBps: number; noPanRateBps: number; annualThresholdPaise: number; singleThresholdPaise?: number | null }
export interface TdsInput {
  grossPaise: number;
  priorGrossThisYearPaise: number;
  priorTdsThisYearPaise: number;
  panOperative: boolean;
  rule: TdsRule;
}

/**
 * TDS for this payment. Nothing is deducted until the year's total crosses the threshold.
 * On crossing, tax is due on the whole year's total, so earlier untaxed payments are caught up.
 * Rounded to the nearest rupee and never more than this payment.
 */
export function computeTds(i: TdsInput): { tdsPaise: number; rateBps: number } {
  const rateBps = i.panOperative ? i.rule.rateBps : i.rule.noPanRateBps;
  const yearTotal = i.priorGrossThisYearPaise + i.grossPaise;
  if (yearTotal <= i.rule.annualThresholdPaise) {
    // 194C: one large payment is taxed by itself, even while the year is under its limit.
    const single = i.rule.singleThresholdPaise;
    if (single !== null && single !== undefined && i.grossPaise > single) {
      return { tdsPaise: Math.min(Math.round((i.grossPaise * rateBps) / 10000 / 100) * 100, i.grossPaise), rateBps };
    }
    return { tdsPaise: 0, rateBps };
  }
  const dueForYear = Math.round((yearTotal * rateBps) / 10000 / 100) * 100;
  const tdsPaise = Math.min(Math.max(dueForYear - i.priorTdsThisYearPaise, 0), i.grossPaise);
  return { tdsPaise, rateBps };
}

/**
 * Final settlement. Tax owed on a free product, gift or trip is taken from the money paid out,
 * up to what remains after this payment's own TDS. Anything left carries to the next payment.
 */
export function computeNet(grossPaise: number, tdsPaise: number, benefitTdsOpenPaise: number) {
  const afterTax = grossPaise - tdsPaise;
  const benefitTdsPaise = Math.min(benefitTdsOpenPaise, afterTax);
  return { benefitTdsPaise, netPaise: afterTax - benefitTdsPaise };
}
