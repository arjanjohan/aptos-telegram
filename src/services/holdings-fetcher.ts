/**
 * Aptos Holdings Fetcher
 *
 * A standalone module for fetching and managing asset holdings from Aptos.
 * This module provides all necessary functions to get fungible assets and coin assets
 * for any account address.
 *
 * Usage:
 * ```typescript
 * import { AptosHoldingsFetcher } from './aptos-holdings-fetcher';
 *
 * const fetcher = new AptosHoldingsFetcher({
 *   networkUrl: 'https://mainnet.aptoslabs.com/v1',
 *   indexerUrl: 'https://indexer.mainnet.aptoslabs.com/v1/graphql'
 * });
 *
 * const holdings = await fetcher.getAccountHoldings('0x...');
 * ```
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export interface FaBalance {
  amount: number;
  asset_type: string;
  metadata: {
    name: string;
    decimals: number;
    symbol: string;
    token_standard: string; // "v1" for coins, "v2" for fungible assets
  };
}

export interface CoinDescription {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  bridge: string | null;
  panoraSymbol: string | null;
  logoUrl: string;
  websiteUrl: string | null;
  category: string;
  panoraUI: boolean;
  isInPanoraTokenList: boolean;
  isBanned: boolean;
  panoraOrderIndex?: number;
  panoraIndex?: number;
  coinGeckoId: string | null;
  coinMarketCapId: number | null;
  usdPrice: string | null;
  panoraTags: (
    | "Native"
    | "Bridged"
    | "Emojicoin"
    | "Meme"
    | "Verified"
    | "Recognized"
    | "Unverified"
    | "Banned"
    | "InternalFA"
    | "LP"
  )[];
  native?: boolean;
}


export interface CoinDescriptionPlusAmount extends CoinDescription {
  amount: number;
  tokenStandard: string;
  usdValue: number | null;
  assetType: string;
  assetVersion: string;
}

export interface HoldingsFetcherConfig {
  networkUrl: string;
  indexerUrl: string;
  coinGeckoApiKey?: string;
}

export interface AssetFilter {
  tokenStandard?: 'v1' | 'v2' | 'all';
  minAmount?: number;
  verifiedOnly?: boolean;
  includeBanned?: boolean;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Standardizes an address to the format "0x" followed by 64 lowercase hexadecimal digits.
 */
export function standardizeAddress(address: string): string {
  // Remove 0x prefix if present
  const cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

  // Pad with zeros to 64 characters
  const paddedAddress = cleanAddress.padStart(64, '0');

  // Convert to lowercase
  const lowercaseAddress = paddedAddress.toLowerCase();

  return `0x${lowercaseAddress}`;
}

/**
 * Attempts to standardize an address, returns undefined if it fails.
 */
export function tryStandardizeAddress(address: string | null | undefined): string | undefined {
  if (!address) return undefined;

  try {
    return standardizeAddress(address);
  } catch (e) {
    console.warn('Failed to standardize address', address, e);
    return undefined;
  }
}

/**
 * Gets the asset symbol with fallback logic for bridged tokens.
 */
export function getAssetSymbol(
  panoraSymbol: string | null | undefined,
  bridge: string | null | undefined,
  metadataSymbol: string | null | undefined,
): string {
  if (panoraSymbol) return panoraSymbol;
  if (bridge && metadataSymbol) return `${metadataSymbol} (${bridge})`;
  return metadataSymbol || 'Unknown';
}

/**
 * Determines if an asset_type is a Coin or Fungible Asset based on the raw value.
 *
 * @param assetType - The raw asset_type from GraphQL
 * @returns 'Coin' for v1 coins, 'FungibleAsset' for v2 fungible assets
 */
export function isCoin(assetType: string): boolean {
  // Coins typically have the format: "0x1::module_name::StructName" or "0x1::aptos_coin::AptosCoin"
  // Fungible Assets typically have the format: "0x1234567890abcdef..." (64 hex chars)

  // If it contains "::" it's likely a Coin (v1)
  if (assetType.includes('::')) {
    return true;
  }

  // If it's a 64-character hex string, it's likely a Fungible Asset (v2)
  if (/^0x[0-9a-fA-F]{64}$/.test(assetType)) {
    return false;
  }

  // Default fallback - could be either, but let's assume FA for unknown formats
  return false;
}

// ============================================================================
// MAIN FETCHER CLASS
// ============================================================================

export class AptosHoldingsFetcher {
  private config: HoldingsFetcherConfig;
  private verifiedTokensCache: Record<string, CoinDescription> | null = null;
  private priceCache: Record<string, Record<string, number>> = {};

  constructor(config: HoldingsFetcherConfig) {
    this.config = config;
  }

  // ============================================================================
  // CORE FETCHING METHODS
  // ============================================================================

  /**
   * Fetches all fungible asset balances for a given account address.
   */
  async getAccountCoins(address: string): Promise<FaBalance[]> {
    const standardizedAddress = standardizeAddress(address);

    // First get the count
    const count = await this.getAccountCoinCount(standardizedAddress);

    if (count === 0) {
      return [];
    }

    // Fetch all coins in batches
    const PAGE_SIZE = 100;
    const promises = [];

    for (let i = 0; i < count; i += PAGE_SIZE) {
      promises.push(this.fetchCoinsPage(standardizedAddress, PAGE_SIZE, i));
    }

    const responses = await Promise.all(promises);
    return responses.flatMap(r => r.current_fungible_asset_balances);
  }

  /**
   * Gets the count of fungible assets for an account.
   */
  async getAccountCoinCount(address: string): Promise<number> {
    const query = `
      query GetFungibleAssetCount($address: String) {
        current_fungible_asset_balances_aggregate(
          where: {owner_address: {_eq: $address}}
          order_by: {amount: desc}
        ) {
          aggregate {
            count
          }
        }
      }
    `;

    const response = await this.queryIndexer(query, { address });
    return response?.current_fungible_asset_balances_aggregate?.aggregate?.count || 0;
  }

  /**
   * Fetches a single page of coins.
   */
  private async fetchCoinsPage(address: string, limit: number, offset: number): Promise<{current_fungible_asset_balances: FaBalance[]}> {
    const query = `
      query CoinsData($owner_address: String, $limit: Int, $offset: Int) {
        current_fungible_asset_balances(
          where: {owner_address: {_eq: $owner_address}}
          limit: $limit
          offset: $offset
        ) {
          amount
          asset_type
          metadata {
            name
            decimals
            symbol
            token_standard
          }
        }
      }
    `;

    return await this.queryIndexer(query, {
      owner_address: address,
      limit,
      offset
    });
  }

  /**
   * Gets hardcoded coin data for native tokens.
   */
  async getVerifiedTokens(): Promise<Record<string, CoinDescription>> {
    if (this.verifiedTokensCache) {
      return this.verifiedTokensCache;
    }

    // Return empty object since we removed hardcoded coins
    this.verifiedTokensCache = {};
    return this.verifiedTokensCache;
  }

  /**
   * Fetches USD prices for tokens from CoinGecko.
   */
  async getTokenPrices(coinGeckoIds: string[]): Promise<Record<string, number>> {
    if (coinGeckoIds.length === 0) return {};

    const cacheKey = coinGeckoIds.sort().join(',');
    if (this.priceCache[cacheKey]) {
      return this.priceCache[cacheKey];
    }

    try {
      const endpoint = "https://api.coingecko.com/api/v3/simple/price";
      const query = {
        vs_currencies: "usd",
        ids: coinGeckoIds.join(","),
      };

      const queryString = new URLSearchParams(query);
      const url = `${endpoint}?${queryString}`;

      const response = await fetch(url, { method: "GET" });
      const rawPrices = await response.json();

      // Extract just the USD price values
      const prices: Record<string, number> = {};
      Object.entries(rawPrices).forEach(([coinId, priceData]) => {
        if (priceData && typeof priceData === 'object' && 'usd' in priceData) {
          prices[coinId] = (priceData as any).usd;
        }
      });

      this.priceCache[cacheKey] = prices;
      return prices;
    } catch (error) {
      console.error('Failed to fetch token prices:', error);
      return {};
    }
  }

  // ============================================================================
  // DATA PROCESSING METHODS
  // ============================================================================

  /**
   * Finds coin data by asset type, matching both FA addresses and token addresses.
   */
  findCoinData(coinData: CoinDescription[], assetType: string): CoinDescription | undefined {
    // Since we removed tokenAddress and faAddress from CoinDescription,
    // we'll need to match against the asset_type directly or use a different approach
    // For now, return undefined to use the fallback logic
    return undefined;
  }

  /**
   * Processes raw asset data and enriches it with verified metadata.
   */
  async processAccountHoldings(address: string): Promise<CoinDescriptionPlusAmount[]> {
    const [rawCoins, verifiedTokens] = await Promise.all([
      this.getAccountCoins(address),
      this.getVerifiedTokens()
    ]);

    const coinData = Object.values(verifiedTokens);

    // Get all coin IDs for batch price fetching
    const coinIds: string[] = [];
    const holdings = rawCoins
      .filter((coin) => Boolean(coin.metadata))
      .map((coin): CoinDescriptionPlusAmount => {
        const foundCoin = this.findCoinData(coinData, coin.asset_type);
        let coinId = null;

        if (foundCoin && foundCoin.coinGeckoId) {
          coinId = foundCoin.coinGeckoId;
        } else {
          // Try to get CoinGecko ID for common tokens
          const commonMappings: Record<string, string> = {
            'APT': 'aptos',
            'USDC': 'usd-coin',
            'USDT': 'tether',
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'SOL': 'solana'
          };
          coinId = commonMappings[coin.metadata.symbol.toUpperCase()] || null;
        }

        if (coinId) {
          coinIds.push(coinId);
        }

        if (!foundCoin) {
          // Return minimal information for unverified tokens
          return {
            name: coin.metadata.name,
            amount: coin.amount,
            decimals: coin.metadata.decimals,
            symbol: coin.metadata.symbol,
            assetType: coin.asset_type, // Keep raw asset_type
            assetVersion: coin.metadata.token_standard,
            chainId: 0,
            bridge: null,
            panoraSymbol: null,
            logoUrl: "",
            websiteUrl: null,
            category: "N/A",
            isInPanoraTokenList: false,
            isBanned: false,
            panoraOrderIndex: 20000000,
            coinGeckoId: coinId,
            coinMarketCapId: null,
            tokenStandard: coin.metadata.token_standard,
            usdPrice: null, // Will be set after price fetching
            panoraTags: [],
            panoraUI: false,
            native: false,
            usdValue: 0,
          };
        } else {
          // Use verified token data
          return {
            ...foundCoin,
            amount: coin.amount,
            tokenStandard: coin.metadata.token_standard,
            usdValue: 0, // Will be calculated after price fetching
            assetType: coin.asset_type,
            assetVersion: coin.metadata.token_standard,
            coinGeckoId: coinId || foundCoin.coinGeckoId,
          };
        }
      });

    // Fetch prices for all coins
    if (coinIds.length > 0) {
      try {
        const prices = await this.getTokenPrices(coinIds);
        console.log(`💰 Fetched prices for ${Object.keys(prices).length} tokens:`, prices);

        // Update holdings with prices
        holdings.forEach(holding => {
          if (holding.coinGeckoId && prices[holding.coinGeckoId]) {
            const price = prices[holding.coinGeckoId];
            if (price !== undefined && price !== null) {
              holding.usdPrice = price.toString();
              holding.usdValue = Math.round(
                100 *
                  (Number.EPSILON +
                    (price * holding.amount) / Math.pow(10, holding.decimals))
              ) / 100;
            }
          }
        });
      } catch (error) {
        console.error('Error fetching prices:', error);
      }
    }

    return holdings;
  }

  // ============================================================================
  // FILTERING AND QUERYING METHODS
  // ============================================================================

  /**
   * Gets all holdings for an account with optional filtering.
   */
  async getAccountHoldings(address: string, filter?: AssetFilter): Promise<CoinDescriptionPlusAmount[]> {
    const holdings = await this.processAccountHoldings(address);

    if (!filter) return holdings;

    return holdings.filter(holding => {
      // Filter by token standard
      if (filter.tokenStandard && filter.tokenStandard !== 'all') {
        if (holding.tokenStandard !== filter.tokenStandard) return false;
      }

      // Filter by minimum amount
      if (filter.minAmount !== undefined) {
        const formattedAmount = holding.amount / Math.pow(10, holding.decimals);
        if (formattedAmount < filter.minAmount) return false;
      }

      // Filter by verification status
      if (filter.verifiedOnly && !holding.isInPanoraTokenList) return false;

      // Filter out banned tokens
      if (!filter.includeBanned && holding.isBanned) return false;

      return true;
    });
  }


  // ============================================================================
  // UTILITY METHODS
  // ============================================================================


  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Makes a GraphQL query to the indexer.
   */
  private async queryIndexer(query: string, variables: Record<string, any>): Promise<any> {
    const response = await fetch(this.config.indexerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (!response.ok) {
      throw new Error(`Indexer query failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Creates a new AptosHoldingsFetcher instance with default configuration.
 */
export function createHoldingsFetcher(config: Partial<HoldingsFetcherConfig> = {}): AptosHoldingsFetcher {
  // Use default URLs if not provided in config
  const defaultConfig: HoldingsFetcherConfig = {
    networkUrl: 'https://testnet.aptoslabs.com/v1',
    indexerUrl: 'https://api.testnet.aptoslabs.com/v1/graphql',
    ...config
  };

  return new AptosHoldingsFetcher(defaultConfig);
}

/**
 * Quick function to get all holdings for an account.
 */
export async function getAccountHoldings(
  address: string,
  config?: Partial<HoldingsFetcherConfig>
): Promise<CoinDescriptionPlusAmount[]> {
  const fetcher = createHoldingsFetcher(config);
  return fetcher.getAccountHoldings(address);
}


// ============================================================================
// EXPORTS
// ============================================================================

export default AptosHoldingsFetcher;
