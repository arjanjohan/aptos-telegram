export interface Market {
  market_id: string;
  asset: string;
  description: string;
}

export const TESTNET_MARKETS: Market[] = [
  { market_id: "1338", asset: "APT-USD", description: "Aptos-based trading market" },
  { market_id: "1339", asset: "BTC-USD", description: "Bitcoin-based trading market" },
  { market_id: "1340", asset: "ETH-USD", description: "Ethereum-based trading market" },
  { market_id: "2387", asset: "SOL-USD", description: "Solana-based trading market" }
];

export const MAINNET_MARKETS: Market[] = [
  { market_id: "14", asset: "APT-USD", description: "Aptos-based trading market" },
  { market_id: "15", asset: "BTC-USD", description: "Bitcoin-based trading market" },
  { market_id: "16", asset: "ETH-USD", description: "Ethereum-based trading market" },
  { market_id: "31", asset: "SOL-USD", description: "Solana-based trading market" }
];

// Helper function to get markets based on environment
export function getMarkets(isTestnet: boolean = true): Market[] {
  return isTestnet ? TESTNET_MARKETS : MAINNET_MARKETS;
}

// Helper function to find a market by ID
export function findMarketById(marketId: string, isTestnet: boolean = true): Market | undefined {
  const markets = getMarkets(isTestnet);
  return markets.find(m => m.market_id === marketId);
}
