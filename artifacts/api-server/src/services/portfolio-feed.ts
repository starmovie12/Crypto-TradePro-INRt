export type PortfolioFeedTick = {
  instrument: string;
  price: number;
  timestamp: number;
};

export type PortfolioFeedSnapshot = {
  prices: PortfolioFeedTick[];
  generatedAt: number;
};

export type PortfolioFeedListener = (tick: PortfolioFeedTick) => void;

type Subscription = {
  instruments: Set<string>;
  listener: PortfolioFeedListener;
};

function isValidTick(tick: PortfolioFeedTick) {
  return (
    typeof tick.instrument === "string" &&
    tick.instrument.length > 0 &&
    Number.isFinite(tick.price) &&
    tick.price >= 0 &&
    Number.isFinite(tick.timestamp) &&
    tick.timestamp > 0
  );
}

/**
 * In-memory fan-out for the portfolio price stream.
 *
 * Exchange adapters publish ticks here. HTTP/WebSocket transports subscribe
 * to this class and decide how to serialize the updates for their clients.
 * The class intentionally has no Express or WebSocket dependency, so Paper
 * and Live adapters can share the same tick semantics.
 */
export class PortfolioFeed {
  private readonly prices = new Map<string, PortfolioFeedTick>();
  private readonly subscriptions = new Set<Subscription>();

  publish(tick: PortfolioFeedTick) {
    if (!isValidTick(tick)) return false;

    const previous = this.prices.get(tick.instrument);
    if (previous && tick.timestamp < previous.timestamp) return false;
    this.prices.set(tick.instrument, tick);

    this.subscriptions.forEach(({ instruments, listener }) => {
      if (instruments.size === 0 || instruments.has(tick.instrument)) {
        listener(tick);
      }
    });
    return true;
  }

  publishMany(ticks: PortfolioFeedTick[]) {
    return ticks.reduce((accepted, tick) => accepted + Number(this.publish(tick)), 0);
  }

  subscribe(instruments: string[], listener: PortfolioFeedListener) {
    const normalizedInstruments = new Set(
      instruments.map((instrument) => instrument.trim()).filter(Boolean),
    );
    const subscription: Subscription = {
      instruments: normalizedInstruments,
      listener,
    };
    this.subscriptions.add(subscription);

    const initialSnapshot = this.snapshot(normalizedInstruments);
    initialSnapshot.prices.forEach(listener);

    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  snapshot(instruments?: Iterable<string>): PortfolioFeedSnapshot {
    const filter = instruments ? new Set(instruments) : undefined;
    const prices = Array.from(this.prices.values()).filter(
      (tick) => !filter || filter.has(tick.instrument),
    );
    return {
      prices,
      generatedAt: Date.now(),
    };
  }

  clear() {
    this.prices.clear();
  }

  get size() {
    return this.prices.size;
  }
}

export const portfolioFeed = new PortfolioFeed();