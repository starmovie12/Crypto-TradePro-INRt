import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PortfolioFeedStatus =
  | "connecting"
  | "resyncing"
  | "live"
  | "reconnecting"
  | "offline";

export type PortfolioPriceTick = {
  instrument: string;
  price: number;
  timestamp?: number;
};

type PortfolioFeedMessage =
  | PortfolioPriceTick
  | {
      type: "price";
      instrument: string;
      price: number;
      timestamp?: number;
    }
  | {
      type: "snapshot";
      prices: PortfolioPriceTick[];
    };

export type UsePortfolioLiveOptions = {
  endpoint?: string;
  enabled?: boolean;
  staleAfterMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  onReconnectResync?: () => Promise<void> | void;
};

function defaultEndpoint() {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/portfolio`;
}

function isPriceTick(value: unknown): value is PortfolioPriceTick {
  if (!value || typeof value !== "object") return false;
  const tick = value as Partial<PortfolioPriceTick>;
  return (
    typeof tick.instrument === "string" &&
    tick.instrument.length > 0 &&
    typeof tick.price === "number" &&
    Number.isFinite(tick.price) &&
    tick.price >= 0
  );
}

function parseFeedMessage(raw: string): PortfolioPriceTick[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) return parsed.filter(isPriceTick);
  if (!parsed || typeof parsed !== "object") return [];

  const message = parsed as Record<string, unknown>;
  if (
    message.type === "snapshot" &&
    Array.isArray(message.prices)
  ) {
    return message.prices.filter(isPriceTick);
  }
  if (message.type === "price" && isPriceTick(message)) return [message];
  if (isPriceTick(message)) return [message];
  return [];
}

export function usePortfolioLive(
  instruments: string[],
  options: UsePortfolioLiveOptions = {},
) {
  const {
    endpoint = defaultEndpoint(),
    enabled = true,
    staleAfterMs = 5_000,
    baseReconnectDelayMs = 500,
    maxReconnectDelayMs = 30_000,
    onReconnectResync,
  } = options;
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<PortfolioFeedStatus>(
    enabled && endpoint ? "connecting" : "offline",
  );
  const [lastMessageAt, setLastMessageAt] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [staleTick, setStaleTick] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const resyncRef = useRef(onReconnectResync);
  const instrumentKey = useMemo(
    () => Array.from(new Set(instruments.filter(Boolean))).sort().join(","),
    [instruments],
  );
  const instrumentList = useMemo(
    () => (instrumentKey ? instrumentKey.split(",") : []),
    [instrumentKey],
  );

  useEffect(() => {
    resyncRef.current = onReconnectResync;
  }, [onReconnectResync]);

  useEffect(() => {
    if (!enabled || !endpoint || typeof window === "undefined") {
      setStatus("offline");
      return;
    }

    const timer = window.setInterval(() => setStaleTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [enabled, endpoint]);

  const close = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    if (!enabled || !endpoint || typeof window === "undefined") {
      setStatus("offline");
      return () => {
        isUnmountedRef.current = true;
      };
    }

    let socketGeneration = 0;
    const connect = () => {
      if (isUnmountedRef.current) return;
      const generation = ++socketGeneration;
      setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
      setError(undefined);

      let socket: WebSocket;
      try {
        socket = new WebSocket(endpoint);
      } catch {
        setError("Portfolio live feed could not start.");
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = async () => {
        if (generation !== socketGeneration || isUnmountedRef.current) return;
        const wasConnected = hasConnectedRef.current;
        hasConnectedRef.current = true;
        reconnectAttemptRef.current = 0;
        if (instrumentList.length > 0) {
          socket.send(JSON.stringify({ type: "subscribe", instruments: instrumentList }));
        }
        if (wasConnected && resyncRef.current) {
          setStatus("resyncing");
          try {
            await resyncRef.current();
          } catch {
            setError("Portfolio state could not be resynced after reconnect.");
            socket.close();
            return;
          }
        }
        if (generation === socketGeneration && !isUnmountedRef.current) {
          setStatus("live");
        }
      };

      socket.onmessage = (event) => {
        if (generation !== socketGeneration || isUnmountedRef.current) return;
        const ticks = parseFeedMessage(String(event.data));
        if (ticks.length === 0) return;
        const receivedAt = Date.now();
        setPrices((current) => {
          const next = { ...current };
          ticks.forEach((tick) => {
            next[tick.instrument] = tick.price;
          });
          return next;
        });
        setLastMessageAt(receivedAt);
        setStatus("live");
      };

      socket.onerror = () => {
        if (generation === socketGeneration) {
          setError("Portfolio live feed connection failed.");
        }
      };

      socket.onclose = () => {
        if (generation !== socketGeneration || isUnmountedRef.current) return;
        socketRef.current = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (isUnmountedRef.current || reconnectTimerRef.current !== null) return;
      reconnectAttemptRef.current += 1;
      const delay = Math.min(
        maxReconnectDelayMs,
        baseReconnectDelayMs * 2 ** (reconnectAttemptRef.current - 1),
      );
      setStatus("reconnecting");
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    connect();
    return () => {
      isUnmountedRef.current = true;
      socketGeneration += 1;
      close();
    };
  }, [
    baseReconnectDelayMs,
    close,
    enabled,
    endpoint,
    instrumentList,
    maxReconnectDelayMs,
  ]);

  const isStale =
    staleTick >= 0 &&
    (!lastMessageAt || Date.now() - lastMessageAt > staleAfterMs);

  return {
    prices,
    status: isStale && status === "live" ? "reconnecting" : status,
    lastMessageAt,
    isStale,
    error,
    reconnectAttempt: reconnectAttemptRef.current,
    close,
  };
}