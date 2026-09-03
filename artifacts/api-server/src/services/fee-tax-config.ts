/**
 * One source of truth for exchange-fee and India VDA tax math.
 *
 * Rates are deliberately supplied by the caller. This module does not
 * hardcode Binance fee tiers or tax percentages, because both can change and
 * must be auditable/configurable outside the calculation itself.
 *
 * All rates use decimal form:
 *   0.001 = 0.1%
 *   0.30 = 30%
 */

export type FeeRate = {
  rate: number;
  source: "exchange" | "fallback";
  fetchedAt: string;
  staleAfterMs: number;
};

export type TaxConfig = {
  vdaTaxRate: number;
  tdsRate: number;
  updatedAt: string;
  source: string;
};

export type TradeCostInput = {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  contractMultiplier: number;
  feeRate: FeeRate;
  taxConfig: TaxConfig;
  now?: number;
};

export type TradeCostBreakdown = {
  entryNotional: number;
  exitNotional: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  netPnlBeforeTax: number;
  taxableProfit: number;
  estimatedVdaTax: number;
  estimatedTds: number;
  estimatedTakeHome: number;
  feeRate: FeeRate;
  taxConfig: TaxConfig;
};

function assertFiniteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite, non-negative number`);
  }
}

function assertRate(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a decimal rate between 0 and 1`);
  }
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function assertFreshFeeRate(feeRate: FeeRate, now = Date.now()) {
  assertRate(feeRate.rate, "feeRate.rate");
  if (!feeRate.fetchedAt || !Number.isFinite(feeRate.staleAfterMs) || feeRate.staleAfterMs <= 0) {
    throw new Error("fee rate freshness metadata is invalid");
  }
  const fetchedAt = new Date(feeRate.fetchedAt).getTime();
  if (!Number.isFinite(fetchedAt)) {
    throw new Error("feeRate.fetchedAt must be a valid timestamp");
  }
  if (now - fetchedAt > feeRate.staleAfterMs) {
    throw new Error("fee rate is stale and must be refreshed before confirmation");
  }
  return feeRate;
}

export function calculateTradeCosts(input: TradeCostInput): TradeCostBreakdown {
  const {
    entryPrice,
    exitPrice,
    quantity,
    contractMultiplier,
    feeRate,
    taxConfig,
    now = Date.now(),
  } = input;

  assertFiniteNonNegative(entryPrice, "entryPrice");
  assertFiniteNonNegative(exitPrice, "exitPrice");
  assertFiniteNonNegative(quantity, "quantity");
  assertFiniteNonNegative(contractMultiplier, "contractMultiplier");
  assertFreshFeeRate(feeRate, now);
  assertRate(taxConfig.vdaTaxRate, "taxConfig.vdaTaxRate");
  assertRate(taxConfig.tdsRate, "taxConfig.tdsRate");

  const entryNotional = entryPrice * quantity * contractMultiplier;
  const exitNotional = exitPrice * quantity * contractMultiplier;
  const grossPnl = exitNotional - entryNotional;
  const entryFee = entryNotional * feeRate.rate;
  const exitFee = exitNotional * feeRate.rate;
  const totalFees = entryFee + exitFee;
  const netPnlBeforeTax = grossPnl - totalFees;
  const taxableProfit = Math.max(0, netPnlBeforeTax);
  const estimatedVdaTax = taxableProfit * taxConfig.vdaTaxRate;
  // TDS is estimated against the exit transaction value, not against a loss.
  const estimatedTds = exitNotional * taxConfig.tdsRate;
  const estimatedTakeHome = netPnlBeforeTax - estimatedVdaTax - estimatedTds;

  return {
    entryNotional: roundMoney(entryNotional),
    exitNotional: roundMoney(exitNotional),
    grossPnl: roundMoney(grossPnl),
    entryFee: roundMoney(entryFee),
    exitFee: roundMoney(exitFee),
    totalFees: roundMoney(totalFees),
    netPnlBeforeTax: roundMoney(netPnlBeforeTax),
    taxableProfit: roundMoney(taxableProfit),
    estimatedVdaTax: roundMoney(estimatedVdaTax),
    estimatedTds: roundMoney(estimatedTds),
    estimatedTakeHome: roundMoney(estimatedTakeHome),
    feeRate,
    taxConfig,
  };
}