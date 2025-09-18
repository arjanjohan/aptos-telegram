# Kana Labs Perps API Integration

This project includes a comprehensive helper service for interacting with the Kana Labs Perpetual Futures API.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the project root and add:
   ```
   KANA_LABS_API_KEY=your_api_key_here
   ```

## Files

- `src/types/kanalabs.ts` - TypeScript type definitions for all API responses
- `src/services/kanalabs-perps.ts` - Main service class with all API methods
- `src/examples/kanalabs-usage.ts` - Example usage demonstrating the service

## Usage

### Basic Setup

```typescript
import { KanaLabsPerpsService } from './services/kanalabs-perps.js';

// Initialize with API key from environment
const perpsService = new KanaLabsPerpsService();

// Or initialize with explicit API key
const perpsService = new KanaLabsPerpsService('your_api_key');
```

### Available Methods

#### Market Information
- `getMarketInfo(marketId: string)` - Get market details
- `getMarketPrice(marketId: string)` - Get current market price
- `getLastExecutionPrice(marketId: string)` - Get last execution price

#### Account Management
- `getWalletAccountBalance(userAddress: string)` - Get wallet balance
- `getProfileBalanceSnapshot(userAddress: string)` - Get profile balance
- `getAccountAptBalance(userAddress: string)` - Get APT balance
- `getTotalBalance(userAddress: string)` - Get all balances (helper method)

#### Trading Operations
- `placeLimitOrder(params: PlaceOrderParams)` - Place limit order
- `placeMarketOrder(params: PlaceOrderParams)` - Place market order
- `placeOrder(params: PlaceOrderParams)` - Auto-choose order type
- `cancelOrder(orderId: string)` - Cancel single order
- `cancelMultipleOrders(orderIds: string[])` - Cancel multiple orders

#### Order Management
- `getOpenOrders(userAddress: string, marketId: string)` - Get open orders
- `getOrderHistory(userAddress: string, marketId: string)` - Get order history
- `getOrderStatusByOrderId(orderId: string)` - Get specific order status
- `getAllOpenOrderIds(userAddress: string, marketId: string)` - Get all open order IDs

#### Position Management
- `getPositions(userAddress: string, marketId: string)` - Get current positions
- `updateTakeProfit(params: UpdateTakeProfitParams)` - Update take profit
- `updateStopLoss(params: UpdateStopLossParams)` - Update stop loss

#### Trade History
- `getAllTrades(userAddress: string, marketId: string)` - Get all trades
- `getFills(userAddress: string, marketId: string)` - Get fills

#### Deposits & Withdrawals
- `deposit(params: DepositParams)` - Deposit funds
- `withdraw(params: WithdrawParams)` - Withdraw funds

### Example Usage

```typescript
import { KanaLabsPerpsService } from './services/kanalabs-perps.js';

async function tradingExample() {
  const perpsService = new KanaLabsPerpsService();
  const userAddress = '0x...';
  const marketId = '501'; // APT/USDC

  try {
    // Get market info
    const marketInfo = await perpsService.getMarketInfo(marketId);
    console.log('Market:', marketInfo.data[0].base_name);

    // Get current price
    const price = await perpsService.getMarketPrice(marketId);
    console.log('Current Price:', price.data.price);

    // Place a limit order
    const orderResult = await perpsService.placeLimitOrder({
      marketId: marketId,
      side: true, // long position
      size: '1000',
      price: '10.50',
      orderType: 'limit'
    });
    console.log('Order placed:', orderResult.data);

    // Check open orders
    const openOrders = await perpsService.getOpenOrders(userAddress, marketId);
    console.log('Open Orders:', openOrders.data);

  } catch (error) {
    console.error('Trading error:', error);
  }
}
```

### Error Handling

All methods include comprehensive error handling:

```typescript
try {
  const result = await perpsService.getMarketInfo('501');
  console.log(result.data);
} catch (error) {
  if (error.message.includes('API Error')) {
    console.error('API returned an error:', error.message);
  } else if (error.message.includes('Network Error')) {
    console.error('Network issue:', error.message);
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

### Type Safety

The service is fully typed with TypeScript interfaces for all API responses:

```typescript
import { MarketInfo, Order, Position, Trade } from './types/kanalabs.js';

// All responses are properly typed
const marketInfo: ApiResponse<MarketInfo[]> = await perpsService.getMarketInfo('501');
const orders: ApiResponse<Order[]> = await perpsService.getOpenOrders(userAddress, marketId);
const positions: ApiResponse<Position[]> = await perpsService.getPositions(userAddress, marketId);
```

## API Reference

For complete API documentation, visit: [Kana Labs Perps API Docs](https://docs.kanalabs.io/spot-and-perp-apis/trading-apis/kana-perps-api/kana-perps-typescript-rest-api)

## Notes

- All API calls require a valid API key
- The service handles rate limiting and error responses automatically
- All amounts are returned as strings to preserve precision
- Boolean values for `side` parameter: `true` = long, `false` = short
- Market IDs are strings (e.g., '501' for APT/USDC)
