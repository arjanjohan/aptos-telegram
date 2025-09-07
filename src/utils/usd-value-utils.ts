/**
 * USD Value Calculation Utilities for Aptos Coin Holdings
 *
 * This file contains all the necessary functions to calculate USD values for coin holdings
 * in Aptos, extracted from the Aptos Explorer codebase.
 *
 * Key Features:
 * - Fetches coin metadata from Panora API
 * - Calculates USD values using CoinGecko price data
 * - Handles both Coin (v1) and Fungible Asset (v2) token standards
 * - Provides fallback data for unknown tokens
 * - Includes proper error handling and type safety
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export type CoinDescription = {
  chainId: number; // Chain id (1 if mainnet)
  tokenAddress: string | null; // This is a coin address (if it exists)
  faAddress: string | null; // This is the FA address (if it exists)
  name: string; // Full name of the coin
  symbol: string; // symbol of coin
  decimals: number; // number of decimals (u8)
  bridge: string | null; // bridge name it came from if applicable
  panoraSymbol: string | null; // panora symbol (to handle bridged tokens)
  logoUrl: string; // Logo URL of the token
  websiteUrl: string | null; // Website URL of the token
  category: string; // Category of the token
  panoraUI: boolean; // This is whether it shows at all on the panora UI
  isInPanoraTokenList: boolean; // This is whether it shows on panora
  isBanned: boolean; // if it's banned by panora
  panoraOrderIndex?: number; // Order index in panora
  panoraIndex?: number; // Order index in panora (replaced panoraOrderIndex)
  coinGeckoId: string | null; // Pricing source info
  coinMarketCapId: number | null; // Pricing source info
  usdPrice: string | null; // Decimal string of the USD price
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
  )[]; // Kind of coin
  native?: boolean; // Added for our own purposes, not from Panora
};

export type CoinDescriptionPlusAmount = {
  amount: number;
  tokenStandard: string;
  usdValue: number | null;
  assetType: string;
  assetVersion: string;
} & CoinDescription;

export type FaBalance = {
  amount: number;
  asset_type: string;
  metadata: {
    name: string;
    decimals: number;
    symbol: string;
    token_standard: string;
  };
};

// ============================================================================
// API CONFIGURATION
// ============================================================================

const COINGECKO_API_ENDPOINT = "https://api.coingecko.com/api/v3/simple/price";
const PANORA_API_ENDPOINT = "https://api.panora.exchange/tokenlist";
const PANORA_API_KEY = "a4^KV_EaTf4MW#ZdvgGKX#HUD^3IFEAOV_kzpIE^3BQGA8pDnrkT7JcIy#HNlLGi";

// ============================================================================
// CORE API FUNCTIONS
// ============================================================================

/**
 * Fetches the USD price for a cryptocurrency using its CoinGecko ID.
 *
 * @param coinId - The CoinGecko ID of the cryptocurrency (defaults to "aptos")
 * @returns The USD price of the cryptocurrency or null if the price fetch fails
 */
export async function getPrice(coinId: string = "aptos"): Promise<number | null> {
  const query = {
    ids: coinId,
    vs_currencies: "usd",
  };

  const queryString = new URLSearchParams(query);
  const url = `${COINGECKO_API_ENDPOINT}?${queryString}`;

  try {
    const response = await fetch(url, {
      method: "GET",
    });

    if (!response.ok) {
      console.error(`HTTP error! Status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return Number(data[coinId].usd);
  } catch (error) {
    console.error(`Error fetching ${coinId} price from CoinGecko:`, error);
    return null;
  }
}

/**
 * Fetches the complete coin list from Panora API.
 *
 * @returns Promise<CoinDescription[]> - Array of coin descriptions
 */
export async function getCoinList(): Promise<CoinDescription[]> {
  try {
    const query = {
      panoraUI: "true, false",
    };

    const headers = {
      "x-api-key": PANORA_API_KEY,
    };

    const queryString = new URLSearchParams(query);
    const url = `${PANORA_API_ENDPOINT}?${queryString}`;

    const response = await fetch(url, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const ret: {data: CoinDescription[]} = await response.json();
    return ret.data;
  } catch (error) {
    console.error("Error fetching coin list from Panora:", error);
    // Return empty array if API fails
    return [];
  }
}


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Standardizes an address by ensuring it starts with 0x and has proper length.
 *
 * @param address - The address to standardize
 * @returns The standardized address or null if invalid
 */
export function tryStandardizeAddress(address: string): string | null {
  if (!address) return null;

  // Remove 0x prefix if present
  let cleanAddress = address.startsWith('0x') ? address.slice(2) : address;

  // Ensure it's a valid hex string
  if (!/^[0-9a-fA-F]+$/.test(cleanAddress)) return null;

  // Pad with zeros to 64 characters if needed
  cleanAddress = cleanAddress.padStart(64, '0');

  return `0x${cleanAddress}`;
}

/**
 * Finds coin data by asset type from the coin list.
 *
 * @param coinData - Array of coin descriptions
 * @param asset_type - The asset type to search for
 * @returns The matching coin description or undefined
 */
export function findCoinData(
  coinData: CoinDescription[] | undefined,
  asset_type: string,
): CoinDescription | undefined {
  if (!asset_type || !coinData) {
    return undefined;
  }

  const coinType = asset_type.includes("::") ? asset_type : undefined;
  const faAddress = asset_type && tryStandardizeAddress(asset_type);

  return coinData.find((c) => {
    const isMatchingFa =
      faAddress &&
      c.faAddress &&
      tryStandardizeAddress(faAddress) === tryStandardizeAddress(c.faAddress);
    const isMatchingCoin =
      coinType && c.tokenAddress && c.tokenAddress === coinType;
    return isMatchingCoin || isMatchingFa;
  });
}

/**
 * Gets the asset symbol, preferring panora symbol over regular symbol.
 *
 * @param panoraSymbol - The panora symbol
 * @param bridge - The bridge name
 * @param symbol - The regular symbol
 * @returns The appropriate symbol to display
 */
export function getAssetSymbol(
  panoraSymbol: string | null,
  bridge: string | null,
  symbol: string,
): string {
  if (panoraSymbol) return panoraSymbol;
  if (bridge) return `${symbol} (${bridge})`;
  return symbol;
}

// ============================================================================
// USD VALUE CALCULATION
// ============================================================================

/**
 * Calculates the USD value for a coin holding.
 *
 * @param amount - The raw amount of the coin
 * @param decimals - The number of decimals for the coin
 * @param usdPrice - The USD price per unit (as string)
 * @returns The USD value rounded to 2 decimal places, or null if calculation fails
 */
export function calculateUSDValue(
  amount: number,
  decimals: number,
  usdPrice: string | null,
): number | null {
  if (!usdPrice) return null;

  try {
    const price = parseFloat(usdPrice);
    const adjustedAmount = amount / Math.pow(10, decimals);
    const usdValue = price * adjustedAmount;

    // Round to 2 decimal places
    return Math.round(100 * (Number.EPSILON + usdValue)) / 100;
  } catch (error) {
    console.error("Error calculating USD value:", error);
    return null;
  }
}


/**
 * Gets the total USD value of all coin holdings.
 *
 * @param coinsWithValues - Array of coins with calculated USD values
 * @returns The total USD value
 */
export function getTotalUSDValue(coinsWithValues: CoinDescriptionPlusAmount[]): number {
  return coinsWithValues.reduce((total, coin) => {
    return total + (coin.usdValue || 0);
  }, 0);
}


