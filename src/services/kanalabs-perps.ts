/**
 * Kana Labs Perps API Helper Service
 *
 * A comprehensive service for interacting with Kana Labs Perpetual Futures API.
 * Provides methods for all available endpoints with proper error handling and TypeScript support.
 */

import axios, { type AxiosResponse } from 'axios';
import type {
  MarketInfo,
  ApiResponse,
  OrderPayload,
  Order,
  Position,
  Trade,
  Fill,
  MarketPrice,
  LastExecutionPrice,
  DepositParams,
  WithdrawParams,
  PlaceOrderParams,
  CancelOrderParams,
  UpdateTakeProfitParams,
  UpdateStopLossParams
} from '../types/kanalabs.js';
import { getKanaLabsConfig, getKanaLabsBaseUrl, getKanaLabsApiKey } from '../config/index.js';

export class KanaLabsPerpsService {
  private baseURL: string;
  private apiKey: string;

  constructor(apiKey?: string) {
    const kanaLabsConfig = getKanaLabsConfig();
    this.baseURL = kanaLabsConfig.baseUrl;
    this.apiKey = apiKey || kanaLabsConfig.apiKey;

    if (!this.apiKey) {
      throw new Error('Kana Labs API key is required. Set KANA_LABS_API_KEY environment variable or pass it to constructor.');
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, any> = {},
    method: 'GET' | 'POST' = 'GET'
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseURL}${endpoint}`;
      const config = {
        headers: {
          'x-api-key': this.apiKey,
        },
        ...(method === 'GET' ? { params } : { data: params })
      };

      console.log(`🔍 [KANA_API] Making ${method} request to: ${url}`);
      console.log(`🔍 [KANA_API] Request config:`, { headers: config.headers, params: method === 'GET' ? params : undefined, data: method === 'POST' ? params : undefined });

      const response: AxiosResponse<ApiResponse<T>> = method === 'GET'
        ? await axios.get(url, config)
        : await axios.post(url, config);

      console.log(`🔍 [KANA_API] Response status: ${response.status}`);
      console.log(`🔍 [KANA_API] Response data:`, response.data);

      return response.data;
    } catch (error: any) {
      console.error(`❌ [KANA_API] Request failed:`, error);
      if (error.response) {
        console.error(`❌ [KANA_API] Error response:`, error.response.status, error.response.data);
        throw new Error(`API Error: ${error.response.status} - ${error.response.data?.message || error.message}`);
      } else if (error.request) {
        console.error(`❌ [KANA_API] Network error:`, error.request);
        throw new Error('Network Error: Unable to reach Kana Labs API');
      } else {
        console.error(`❌ [KANA_API] Request setup error:`, error.message);
        throw new Error(`Request Error: ${error.message}`);
      }
    }
  }

  /**
   * Get market information for a specific market
   */
  async getMarketInfo(marketId: string): Promise<ApiResponse<MarketInfo[]>> {
    return this.makeRequest<MarketInfo[]>('/getMarketInfo', { marketId });
  }

  /**
   * Get wallet account balance
   */
  async getWalletAccountBalance(userAddress: string): Promise<ApiResponse<string>> {
    return this.makeRequest<string>('/getWalletAccountBalance', { userAddress });
  }

  /**
   * Get profile balance snapshot
   */
  async getProfileBalanceSnapshot(userAddress: string): Promise<ApiResponse<string>> {
    return this.makeRequest<string>('/getProfileBalanceSnapshot', { userAddress });
  }

  /**
   * Deposit funds to a specific market
   */
  async deposit(params: DepositParams): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/deposit', params, 'POST');
  }

  /**
   * Withdraw funds from a specific market
   */
  async withdraw(params: WithdrawParams): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/withdraw', params, 'POST');
  }

  /**
   * Place a limit order
   */
  async placeLimitOrder(params: PlaceOrderParams): Promise<ApiResponse<OrderPayload>> {
    if (params.orderType !== 'limit') {
      throw new Error('Order type must be "limit" for placeLimitOrder');
    }
    if (!params.price) {
      throw new Error('Price is required for limit orders');
    }
    return this.makeRequest<OrderPayload>('/placeLimitOrder', params, 'POST');
  }

  /**
   * Place a market order
   */
  async placeMarketOrder(params: PlaceOrderParams): Promise<ApiResponse<OrderPayload>> {
    if (params.orderType !== 'market') {
      throw new Error('Order type must be "market" for placeMarketOrder');
    }
    return this.makeRequest<OrderPayload>('/placeMarketOrder', params, 'POST');
  }

  /**
   * Cancel multiple orders
   */
  async cancelMultipleOrders(orderIds: string[]): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/cancelMultipleOrders', { orderIds }, 'POST');
  }

  /**
   * Place multiple orders
   */
  async placeMultipleOrders(orders: PlaceOrderParams[]): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/placeMultipleOrders', { orders }, 'POST');
  }

  /**
   * Cancel and place multiple orders
   */
  async cancelAndPlaceMultipleOrders(
    cancelOrderIds: string[],
    newOrders: PlaceOrderParams[]
  ): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/cancelAndPlaceMultipleOrders', {
      cancelOrderIds,
      newOrders
    }, 'POST');
  }

  /**
   * Get open orders for a user and market
   */
  async getOpenOrders(userAddress: string, marketId: string): Promise<ApiResponse<Order[]>> {
    console.log(`🔍 [KANA_API] getOpenOrders called with userAddress: ${userAddress}, marketId: ${marketId}`);
    const result = await this.makeRequest<Order[]>('/getOpenOrders', { userAddress, marketId });
    console.log(`🔍 [KANA_API] getOpenOrders result:`, result);
    return result;
  }

  /**
   * Get order history for a user and market
   */
  async getOrderHistory(userAddress: string, marketId: string): Promise<ApiResponse<Order[]>> {
    return this.makeRequest<Order[]>('/getOrderHistory', { userAddress, marketId });
  }

  /**
   * Get positions for a user and market
   */
  async getPositions(userAddress: string, marketId: string): Promise<ApiResponse<Position[]>> {
    console.log(`🔍 [KANA_API] getPositions called with userAddress: ${userAddress}, marketId: ${marketId}`);
    const result = await this.makeRequest<Position[]>('/getPositions', { userAddress, marketId });
    console.log(`🔍 [KANA_API] getPositions result:`, result);
    return result;
  }

  /**
   * Get all trades for a user and market
   */
  async getAllTrades(userAddress: string, marketId: string): Promise<ApiResponse<Trade[]>> {
    return this.makeRequest<Trade[]>('/getAllTrades', { userAddress, marketId });
  }

  /**
   * Get order status by order ID
   */
  async getOrderStatusByOrderId(orderId: string): Promise<ApiResponse<Order>> {
    return this.makeRequest<Order>('/getOrderStatusByOrderId', { orderId });
  }

  /**
   * Get fills for a user and market
   */
  async getFills(userAddress: string, marketId: string): Promise<ApiResponse<Fill[]>> {
    return this.makeRequest<Fill[]>('/getFills', { userAddress, marketId });
  }

  /**
   * Get market price
   */
  async getMarketPrice(marketId: string): Promise<ApiResponse<MarketPrice>> {
    return this.makeRequest<MarketPrice>('/getMarketPrice', { marketId });
  }

  /**
   * Get last execution price
   */
  async getLastExecutionPrice(marketId: string): Promise<ApiResponse<LastExecutionPrice>> {
    return this.makeRequest<LastExecutionPrice>('/getLastExecutionPrice', { marketId });
  }

  /**
   * Get all open order IDs for a user and market
   */
  async getAllOpenOrderIds(userAddress: string, marketId: string): Promise<ApiResponse<string[]>> {
    return this.makeRequest<string[]>('/getAllOpenOrderIds', { userAddress, marketId });
  }

  /**
   * Update take profit for a position
   */
  async updateTakeProfit(params: UpdateTakeProfitParams): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/updateTakeProfit', params);
  }

  /**
   * Get account APT balance
   */
  async getAccountAptBalance(userAddress: string): Promise<ApiResponse<number>> {
    return this.makeRequest<number>('/getAccountAptBalance', { userAddress });
  }

  /**
   * Get net profile balance
   */
  async getNetProfileBalance(userAddress: string): Promise<ApiResponse<string>> {
    return this.makeRequest<string>('/getNetProfileBalance', { userAddress });
  }

  /**
   * Update stop loss for a position
   */
  async updateStopLoss(params: UpdateStopLossParams): Promise<ApiResponse<OrderPayload>> {
    return this.makeRequest<OrderPayload>('/updateStopLoss', params);
  }

  /**
   * Get USDT faucet transaction payload for testnet
   */
  getUSDTFaucetPayload(amount: string = "1000000000000000"): any {
    return {
      function: "0x24246c14448a5994d9f23e3b978da2a354e64b6dfe54220debb8850586c448cc::usdt::faucet",
      typeArguments: [],
      functionArguments: [amount]
    };
  }

  /**
   * Helper method to place an order (automatically chooses limit or market)
   */
  async placeOrder(params: PlaceOrderParams): Promise<ApiResponse<OrderPayload>> {
    if (params.orderType === 'limit') {
      return this.placeLimitOrder(params);
    } else {
      return this.placeMarketOrder(params);
    }
  }

  /**
   * Helper method to cancel a single order
   */
  async cancelOrder(orderId: string): Promise<ApiResponse<OrderPayload>> {
    return this.cancelMultipleOrders([orderId]);
  }

  /**
   * Helper method to get user's total balance across all markets
   */
  async getTotalBalance(userAddress: string): Promise<{ wallet: string; profile: string; apt: number }> {
    const [walletBalance, profileBalance, aptBalance] = await Promise.all([
      this.getWalletAccountBalance(userAddress),
      this.getProfileBalanceSnapshot(userAddress),
      this.getAccountAptBalance(userAddress)
    ]);

    return {
      wallet: walletBalance.data,
      profile: profileBalance.data,
      apt: aptBalance.data
    };
  }
}
