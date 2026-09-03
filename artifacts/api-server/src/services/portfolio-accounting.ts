import {
  calculateTradeCosts,
  type FeeRate,
  type TaxConfig,
} from "./fee-tax-config";

export type AccountingPosition = {
  id: string;
  entryPrice: number;
  livePrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  status: string;
};

export type AccountingWallet = {
  balance: number;
  marginUsed: number;
  realizedPnl: number;
};

export type SettlementConfig = {
  feeRate: FeeRate;
  taxConfig: TaxConfig;
};

export type MarkedPosition = AccountingPosition & {
  livePrice: number;
  pnl: number;
  pnlPercent: number;
};

export type SettlementResult =
  | {
      ok: true;
      position: AccountingPosition & { status: string };
      wallet: AccountingWallet;
      costs: ReturnType<typeof calculateTradeCosts>;
    }
  | {
      ok: false;
      reason: "missing-settlement-config";
      missingKeys: string[];
    };

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

export function calculatePositionMargin(
  position: Pick<AccountingPosition, "entryPrice" | "quantity">,
  contractMultiplier: number,
) {
  return roundMoney(position.entryPrice * position.quantity * contractMultiplier);
}

export function markPosition(
  position: AccountingPosition,
  livePrice: number,
  contractMultiplier: number,
): MarkedPosition {
  const notionalChange =
    (livePrice - position.entryPrice) * position.quantity * contractMultiplier;
  const pnlPercent =
    position.entryPrice === 0
      ? 0
      : ((livePrice - position.entryPrice) / position.entryPrice) * 100;

  return {
    ...position,
    livePrice: roundMoney(livePrice),
    pnl: roundMoney(notionalChange),
    pnlPercent: roundMoney(pnlPercent),
  };
}

export function settlePosition(input: {
  position: AccountingPosition;
  wallet: AccountingWallet;
  status?: string;
  contractMultiplier: number;
  config?: SettlementConfig;
  now?: number;
}): SettlementResult {
  const { position, wallet, status = "closed", contractMultiplier, config, now } = input;
  if (!config) {
    return {
      ok: false,
      reason: "missing-settlement-config",
      missingKeys: [
        "TRADEPRO_FEE_RATE",
        "TRADEPRO_VDA_TAX_RATE",
        "TRADEPRO_TDS_RATE",
      ],
    };
  }

  const costs = calculateTradeCosts({
    entryPrice: position.entryPrice,
    exitPrice: position.livePrice,
    quantity: position.quantity,
    contractMultiplier,
    feeRate: config.feeRate,
    taxConfig: config.taxConfig,
    now,
  });
  const margin = calculatePositionMargin(position, contractMultiplier);
  const netWalletBalance = roundMoney(wallet.balance + costs.netPnlBeforeTax);
  const netRealizedPnl = roundMoney(wallet.realizedPnl + costs.netPnlBeforeTax);

  return {
    ok: true,
    position: { ...position, status },
    wallet: {
      balance: netWalletBalance,
      marginUsed: roundMoney(Math.max(0, wallet.marginUsed - margin)),
      realizedPnl: netRealizedPnl,
    },
    costs,
  };
}