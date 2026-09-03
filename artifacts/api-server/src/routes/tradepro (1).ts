import { Router, type IRouter } from "express";
import {
  AddFundsBody,
  AddFundsResponse,
  CloseAllPositionsResponse,
  ClosePositionParams,
  ClosePositionResponse,
  CreatePaperOrderBody,
  CreatePaperOrderResponse,
  GetAdvisorRecommendationsResponse,
  GetMarketOverviewResponse,
  GetOptionChainQueryParams,
  GetOptionChainResponse,
  GetPortfolioResponse,
} from "@workspace/api-zod";

type Position = {
  id: string;
  instrument: string;
  side: "CE" | "PE";
  entryPrice: number;
  livePrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  targetPrice: number;
  stopPrice: number;
  status: "open" | "target-hit" | "stop-hit" | "closed";
};

type Activity = {
  id: string;
  type: string;
  instrument: string;
  price: number;
  quantity: number;
  timestamp: string;
};

const router: IRouter = Router();
const quoteStartedAt = Date.now();

// wallet.balance = settled paper funds (deposits + realized P&L from closed
// trades), not yet reduced by capital locked in open positions.
// wallet.marginUsed = capital currently committed to open positions
// (entryPrice * quantity * 100 per position, summed).
// availableBalance shown to the UI is always wallet.balance - wallet.marginUsed.
const wallet = {
  balance: 250_000,
  marginUsed: 205 * 0.02 * 100, // matches the seeded open position below
};

const positions: Position[] = [
  {
    id: "pos-btc-pe-01",
    instrument: "BTC 96,000 PE",
    side: "PE",
    entryPrice: 205,
    livePrice: 219.4,
    quantity: 0.02,
    pnl: 288,
    pnlPercent: 7.02,
    targetPrice: 215.25,
    stopPrice: 164,
    status: "open",
  },
];

const activity: Activity[] = [
  {
    id: "act-1",
    type: "Paper buy",
    instrument: "BTC 96,000 PE",
    price: 205,
    quantity: 0.02,
    timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    id: "act-2",
    type: "Mock funds added",
    instrument: "INR wallet",
    price: 250000,
    quantity: 1,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
];

function availableBalance() {
  return Math.max(0, wallet.balance - wallet.marginUsed);
}

function openPositions() {
  return positions.filter((position) => position.status === "open");
}

function settlePosition(position: Position, status: "closed" | "target-hit" | "stop-hit" = "closed") {
  const marginForPosition = position.entryPrice * position.quantity * 100;
  // Open P&L becomes settled balance only after an exit is confirmed.
  wallet.balance += position.pnl;
  wallet.marginUsed = Math.max(0, wallet.marginUsed - marginForPosition);
  position.status = status;
}

function portfolioSnapshot() {
  const currentPositions = openPositions();
  return {
    walletBalance: Number(wallet.balance.toFixed(2)),
    availableBalance: Number(availableBalance().toFixed(2)),
    totalPnl: Number(currentPositions.reduce((sum, position) => sum + position.pnl, 0).toFixed(2)),
    positions: currentPositions,
    activity,
  };
}

function refreshPaperQuotes() {
  const elapsed = (Date.now() - quoteStartedAt) / 1000;
  positions.forEach((position, index) => {
    if (position.status !== "open") return;
    const volatility = Math.max(2, position.entryPrice * 0.015);
    position.livePrice = Number(
      Math.max(0.01, position.entryPrice + Math.sin(elapsed / 3 + index * 1.3) * volatility).toFixed(2),
    );
    position.pnl = Number(((position.livePrice - position.entryPrice) * position.quantity * 100).toFixed(2));
    position.pnlPercent = Number(
      (((position.livePrice - position.entryPrice) / position.entryPrice) * 100).toFixed(2),
    );
    const hitTarget = position.livePrice >= position.targetPrice;
    const hitStop = position.livePrice <= position.stopPrice;
    if (hitTarget || hitStop) {
      const status = hitTarget ? "target-hit" : "stop-hit";
      settlePosition(position, status);
      activity.unshift({
        id: `${status}-${position.id}-${Date.now()}`,
        type: hitTarget ? "Paper target filled" : "Paper stop filled",
        instrument: position.instrument,
        price: position.livePrice,
        quantity: position.quantity,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

router.get("/market/overview", (_req, res) => {
  res.json(
    GetMarketOverviewResponse.parse({
      spotPrice: 8_142_360,
      change24h: 2.84,
      volume24h: 1_840_000_000,
      fundingRate: 0.0112,
      currencyRate: 83.42,
      lastUpdated: new Date().toISOString(),
      connectionState: "connected",
    }),
  );
});

router.get("/market/option-chain", (req, res) => {
  const params = GetOptionChainQueryParams.parse(req.query);
  const center = 96_000;
  const chain = [-2000, -1000, 0, 1000, 2000].map((offset, index) => {
    const strike = center + offset;
    const distance = Math.abs(offset) / 1000;
    return {
      id: `${params.symbol ?? "BTCUSDT"}-${strike}`,
      strike,
      callLtp: Number((455 - distance * 48 + index * 2.5).toFixed(2)),
      callChange: Number((2.9 - distance * 1.15).toFixed(2)),
      callVolume: Math.round(1280 - distance * 130 + index * 38),
      putLtp: Number((205 + distance * 38 - index * 1.8).toFixed(2)),
      putChange: Number((5.4 - distance * 1.1).toFixed(2)),
      putVolume: Math.round(960 - distance * 80 + index * 28),
      isAtm: offset === 0,
    };
  });
  res.json(GetOptionChainResponse.parse(chain));
});

router.get("/portfolio", (_req, res) => {
  refreshPaperQuotes();
  res.json(GetPortfolioResponse.parse(portfolioSnapshot()));
});

router.post("/portfolio/positions/:id/close", (req, res) => {
  refreshPaperQuotes();
  const { id } = ClosePositionParams.parse(req.params);
  const position = positions.find((item) => item.id === id);
  if (!position) {
    res.status(404).json({ error: "Position not found" });
    return;
  }
  if (position.status !== "open") {
    res.status(409).json({ error: "Position already closed" });
    return;
  }
  // Realize this position's P&L into the settled balance and release its margin.
  settlePosition(position);
  const closed = {
    id: `close-${Date.now()}`,
    type: "Paper close",
    instrument: position.instrument,
    price: position.livePrice,
    quantity: position.quantity,
    timestamp: new Date().toISOString(),
  };
  activity.unshift(closed);
  res.json(
    ClosePositionResponse.parse({
      ...closed,
    }),
  );
});

router.post("/portfolio/close-all", (_req, res) => {
  refreshPaperQuotes();
  const now = new Date().toISOString();
  positions.forEach((position) => {
    if (position.status === "open") {
      // Realize each position's P&L into the settled balance and release its margin.
      settlePosition(position);
      activity.unshift({
        id: `close-${position.id}`,
        type: "Paper close all",
        instrument: position.instrument,
        price: position.livePrice,
        quantity: position.quantity,
        timestamp: now,
      });
    }
  });
  res.json(CloseAllPositionsResponse.parse(portfolioSnapshot()));
});

router.post("/portfolio/add-funds", (req, res) => {
  const body = AddFundsBody.parse(req.body);
  wallet.balance += body.amount;
  activity.unshift({
    id: `funds-${Date.now()}`,
    type: "Mock funds added",
    instrument: "INR wallet",
    price: body.amount,
    quantity: 1,
    timestamp: new Date().toISOString(),
  });
  res.json(
    AddFundsResponse.parse({
      walletBalance: wallet.balance,
      availableBalance: availableBalance(),
    }),
  );
});

router.get("/advisor/recommendations", (_req, res) => {
  res.json(
    GetAdvisorRecommendationsResponse.parse([
      {
        id: "idea-1",
        title: "Momentum setup detected",
        body: "BTC 96,000 PE is holding above its intraday VWAP with rising volume. A 5% target has a favorable risk profile while spot stays above ₹8.10L.",
        instrument: "BTC 96,000 PE",
        strike: 96000,
        direction: "bullish",
        confidence: 82,
        createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
      },
      {
        id: "idea-2",
        title: "Watch the call wall",
        body: "Open interest is building around BTC 98,000 CE. Wait for a clean breakout and avoid chasing if volume fades below the first hour average.",
        instrument: "BTC 98,000 CE",
        strike: 98000,
        direction: "neutral",
        confidence: 68,
        createdAt: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
      },
    ]),
  );
});

router.post("/orders/paper", (req, res) => {
  const body = CreatePaperOrderBody.parse(req.body);
  const orderCost = body.entryPrice * body.quantity * 100;
  const available = wallet.balance - wallet.marginUsed;
  if (orderCost > available) {
    res.status(422).json({ error: "Insufficient available balance for this order" });
    return;
  }
  wallet.marginUsed += orderCost;
  const targetPrice = Number((body.entryPrice * (1 + body.targetPercent / 100)).toFixed(2));
  const stopPrice = Number((body.entryPrice * (1 - body.stopPercent / 100)).toFixed(2));
  const position = {
    id: `pos-${Date.now()}`,
    instrument: body.instrument,
    side: body.side,
    entryPrice: body.entryPrice,
    livePrice: body.entryPrice,
    quantity: body.quantity,
    pnl: 0,
    pnlPercent: 0,
    targetPrice,
    stopPrice,
    status: "open" as const,
  };
  positions.unshift(position);
  activity.unshift({
    id: `act-${Date.now()}`,
    type: "Paper buy",
    instrument: body.instrument,
    price: body.entryPrice,
    quantity: body.quantity,
    timestamp: new Date().toISOString(),
  });
  res.status(201).json(CreatePaperOrderResponse.parse(position));
});

export default router;
