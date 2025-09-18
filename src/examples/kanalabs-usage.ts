/**
 * Example usage of Kana Labs Perps API Helper
 *
 * This file demonstrates how to use the KanaLabsPerpsService
 * for various trading operations.
 */

import { KanaLabsPerpsService } from '../services/kanalabs-perps.js';
import type { PlaceOrderParams } from '../types/kanalabs.js';
import { getAptosAddress } from '../config/index.js';

async function exampleUsage() {
  // Initialize the service
  // The API key will be read from KANA_LABS_API_KEY environment variable
  const perpsService = new KanaLabsPerpsService();

  try {
    const userAddress = getAptosAddress();
    const marketId = '501'; // APT/USDC market

    console.log('=== Kana Labs Perps API Examples ===\n');

    // 1. Get market information
    console.log('1. Getting market info...');
    const marketInfo = await perpsService.getMarketInfo(marketId);
    console.log('Market Info:', JSON.stringify(marketInfo.data, null, 2));

    // 2. Get user balances
    console.log('\n2. Getting user balances...');
    const balances = await perpsService.getTotalBalance(userAddress);
    console.log('Balances:', balances);

    // 3. Get market price
    console.log('\n3. Getting market price...');
    const marketPrice = await perpsService.getMarketPrice(marketId);
    console.log('Market Price:', marketPrice.data);

    // 4. Get open orders
    console.log('\n4. Getting open orders...');
    const openOrders = await perpsService.getOpenOrders(userAddress, marketId);
    console.log('Open Orders:', openOrders.data);

    // 5. Get positions
    console.log('\n5. Getting positions...');
    const positions = await perpsService.getPositions(userAddress, marketId);
    console.log('Positions:', positions.data);

    // 6. Example of placing a limit order (commented out to avoid actual trading)
    console.log('\n6. Example order parameters (not executed)...');
    const limitOrderParams: PlaceOrderParams = {
      marketId: marketId,
      side: true, // true for long, false for short
      size: '1000', // size in base units
      price: '10.50', // limit price
      orderType: 'limit'
    };
    console.log('Limit Order Params:', limitOrderParams);

    // 7. Example of placing a market order (commented out to avoid actual trading)
    const marketOrderParams: PlaceOrderParams = {
      marketId: marketId,
      side: false, // short position
      size: '500',
      orderType: 'market'
    };
    console.log('Market Order Params:', marketOrderParams);

    // 8. Get order history
    console.log('\n8. Getting order history...');
    const orderHistory = await perpsService.getOrderHistory(userAddress, marketId);
    console.log('Order History:', orderHistory.data);

    // 9. Get all trades
    console.log('\n9. Getting all trades...');
    const allTrades = await perpsService.getAllTrades(userAddress, marketId);
    console.log('All Trades:', allTrades.data);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Uncomment to run the example
// exampleUsage().catch(console.error);

export { exampleUsage };
