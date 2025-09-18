/**
 * TypeScript types for Kana Labs Perps API
 */

export interface MarketInfo {
  __variant__: string;
  base_decimals: number;
  base_name: string;
  counter: string;
  creator: string;
  lot_size: string;
  maintenance_margin: string;
  market_address: string;
  market_id: string;
  max_leverage: string;
  max_lots: string;
  min_lots: string;
  quote_decimals: number;
  quote_precision: number;
  tick_size: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface OrderPayload {
  function: string;
  functionArguments: (string | number | boolean)[];
  typeArguments: string[];
}

export interface Order {
  address: string;
  market_id: string;
  leverage: number;
  order_type: number;
  price: string;
  total_size: string;
  remaining_size: string;
  order_value: string;
  order_id: string;
  trade_id: string;
  trade_side?: boolean; // true for long, false for short
}

export interface Position {
  address: string;
  market_id: string;
  leverage: number;
  trade_side: boolean; // true for long, false for short
  size: string;
  available_order_size: string;
  value: string;
  entry_price: string;
  liq_price: string;
  margin: string;
  tp: string;
  sl: string;
  trade_id: string;
  price?: string; // current price
  pnl?: string; // profit/loss
}

export interface Trade {
  trade_id: string;
  order_id: string;
  market_id: string;
  side: boolean;
  size: string;
  price: string;
  fee: string;
  timestamp: string;
}

export interface Fill {
  fill_id: string;
  order_id: string;
  market_id: string;
  side: boolean;
  size: string;
  price: string;
  fee: string;
  timestamp: string;
}

export interface MarketPrice {
  market_id: string;
  price: string;
  timestamp: string;
  bestAskPrice?: number;
  bestBidPrice?: number;
}

export interface LastExecutionPrice {
  market_id: string;
  price: string;
  timestamp: string;
}

export interface DepositParams {
  marketId: string;
  amount: string;
}

export interface WithdrawParams {
  marketId: string;
  amount: string;
}

export interface PlaceOrderParams {
  marketId: string;
  side: boolean; // true for long, false for short
  size: string;
  price?: string; // optional for market orders
  orderType: 'limit' | 'market';
}

export interface CancelOrderParams {
  orderId: string;
}

export interface UpdateTakeProfitParams {
  marketId: string;
  tradeSide: boolean;
  newTakeProfitPrice: string;
}

export interface UpdateStopLossParams {
  marketId: string;
  tradeSide: boolean;
  newStopLossPrice: string;
}
