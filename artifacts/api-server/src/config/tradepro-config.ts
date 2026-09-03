import type { FeeRate, TaxConfig } from "../services/fee-tax-config";

type Environment = Record<string, string | undefined>;

export type CurrencyConfig = {
  fallbackUsdInrRate: number | undefined;
  maxAgeMs: number;
};

export type TradeProConfig = {
  feeRate: FeeRate | undefined;
  taxConfig: TaxConfig | undefined;
  currency: CurrencyConfig;
  missingKeys: string[];
  settlementReady: boolean;
};

const DEFAULT_CURRENCY_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_FEE_MAX_AGE_MS = 5 * 60 * 1000;

function optionalNumber(environment: Environment, key: string) {
  const rawValue = environment[key];
  if (rawValue === undefined || rawValue.trim() === "") return undefined;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}

function optionalRate(environment: Environment, key: string) {
  const value = optionalNumber(environment, key);
  return value !== undefined && value >= 0 && value <= 1 ? value : undefined;
}

function positiveDuration(environment: Environment, key: string, fallback: number) {
  const value = optionalNumber(environment, key);
  return value !== undefined && value > 0 ? value : fallback;
}

function optionalTimestamp(environment: Environment, key: string, fallback: string) {
  const value = environment[key]?.trim();
  return value || fallback;
}

export function loadTradeProConfig(
  environment: Environment = process.env,
  now = Date.now(),
): TradeProConfig {
  const feeRateValue = optionalRate(environment, "TRADEPRO_FEE_RATE");
  const vdaTaxRate = optionalRate(environment, "TRADEPRO_VDA_TAX_RATE");
  const tdsRate = optionalRate(environment, "TRADEPRO_TDS_RATE");
  const feeFetchedAt = optionalTimestamp(
    environment,
    "TRADEPRO_FEE_FETCHED_AT",
    new Date(now).toISOString(),
  );
  const taxUpdatedAt = optionalTimestamp(
    environment,
    "TRADEPRO_TAX_UPDATED_AT",
    new Date(now).toISOString(),
  );

  const feeRate =
    feeRateValue === undefined
      ? undefined
      : {
          rate: feeRateValue,
          source: (environment.TRADEPRO_FEE_SOURCE === "exchange"
            ? "exchange"
            : "fallback") as FeeRate["source"],
          fetchedAt: feeFetchedAt,
          staleAfterMs: positiveDuration(
            environment,
            "TRADEPRO_FEE_TTL_MS",
            DEFAULT_FEE_MAX_AGE_MS,
          ),
        };

  const taxConfig =
    vdaTaxRate === undefined || tdsRate === undefined
      ? undefined
      : {
          vdaTaxRate,
          tdsRate,
          updatedAt: taxUpdatedAt,
          source: environment.TRADEPRO_TAX_SOURCE?.trim() || "server configuration",
        };

  const fallbackUsdInrRate = optionalNumber(environment, "TRADEPRO_FALLBACK_USD_INR_RATE");
  const currency: CurrencyConfig = {
    fallbackUsdInrRate:
      fallbackUsdInrRate !== undefined && fallbackUsdInrRate > 0
        ? fallbackUsdInrRate
        : undefined,
    maxAgeMs: positiveDuration(
      environment,
      "TRADEPRO_CURRENCY_TTL_MS",
      DEFAULT_CURRENCY_MAX_AGE_MS,
    ),
  };

  const missingKeys: string[] = [];
  if (feeRate === undefined) missingKeys.push("TRADEPRO_FEE_RATE");
  if (taxConfig === undefined) {
    if (vdaTaxRate === undefined) missingKeys.push("TRADEPRO_VDA_TAX_RATE");
    if (tdsRate === undefined) missingKeys.push("TRADEPRO_TDS_RATE");
  }

  return {
    feeRate,
    taxConfig,
    currency,
    missingKeys,
    settlementReady: feeRate !== undefined && taxConfig !== undefined,
  };
}

export function requireSettlementConfig(config: TradeProConfig) {
  if (!config.settlementReady || !config.feeRate || !config.taxConfig) {
    throw new Error(
      `Fee/tax settlement configuration is incomplete: ${config.missingKeys.join(", ")}`,
    );
  }
  return { feeRate: config.feeRate, taxConfig: config.taxConfig };
}