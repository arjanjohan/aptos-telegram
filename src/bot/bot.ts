/**
 * Telegram Bot for Aptos Trading
 *
 * Main bot class that handles all Telegram interactions and Aptos blockchain operations.
 */

import { Bot as GrammyBot, InlineKeyboard } from "grammy";
import { Aptos, Network, AptosConfig } from "@aptos-labs/ts-sdk";
import dotenv from "dotenv";
import { createHoldingsFetcher } from "../services/holdings-fetcher.js";
import { getPrice, calculateUSDValue, getCoinList } from "../utils/usd-value-utils.js";

dotenv.config();

export class Bot {
  private bot: GrammyBot;
  private aptos: Aptos;
  private APTOS_ADDRESS: string;

  constructor() {
    this.bot = new GrammyBot(process.env.TELEGRAM_BOT_TOKEN!);
    this.aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
    this.APTOS_ADDRESS = process.env.APTOS_ADDRESS!;

    this.setupHandlers();
  }

  private setupHandlers() {
    // Start command
    this.bot.command("start", (ctx) => {
      ctx.reply("Welcome to Aptos Trading Bot! 🚀", {
        reply_markup: this.getMainMenu(),
      });
    });

    // Portfolio command
    this.bot.command("portfolio", async (ctx) => {
      await this.showPortfolio(ctx);
    });

    // Buy command
    this.bot.command("buy", async (ctx) => {
      const menu = await this.getAssetSelectionMenu();
      ctx.reply("Please select an asset to buy:", {
        reply_markup: menu,
      });
    });

    // Sell command
    this.bot.command("sell", async (ctx) => {
      const menu = await this.getAssetSelectionMenu();
      ctx.reply("Please select an asset to sell:", {
        reply_markup: menu,
      });
    });

    // Settings command
    this.bot.command("settings", (ctx) => {
      ctx.reply("Settings menu coming soon! ⚙️");
    });

    // Handle callback queries
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;

      if (data.startsWith("asset_")) {
        const parts = data.split("_");
        if (parts.length > 1 && parts[1]) {
          const index = parseInt(parts[1]);
          await this.showAssetOverview(ctx, index);
        }
      } else if (data === "portfolio") {
        await this.showPortfolio(ctx);
      } else if (data === "buy") {
        const menu = await this.getAssetSelectionMenu();
        ctx.reply("Please select an asset to buy:", {
          reply_markup: menu,
        });
      } else if (data === "sell") {
        const menu = await this.getAssetSelectionMenu();
        ctx.reply("Please select an asset to sell:", {
          reply_markup: menu,
        });
      } else if (data === "settings") {
        ctx.reply("Settings menu coming soon! ⚙️");
      }
    });
  }

  private getMainMenu(): InlineKeyboard {
    return new InlineKeyboard()
      .text("📊 Portfolio", "portfolio")
      .text("💰 Buy", "buy")
      .row()
      .text("💸 Sell", "sell")
      .text("⚙️ Settings", "settings");
  }

  private async getAssetSelectionMenu(): Promise<InlineKeyboard> {
    const holdings = await this.getRealBalances();
    const keyboard = new InlineKeyboard();

    Object.values(holdings).forEach((holding: any) => {
      keyboard.text(`/${holding.index} ${holding.symbol}`, `asset_${holding.index}`);
    });

    return keyboard;
  }

  private async showPortfolio(ctx: any) {
    try {
      const holdings = await this.getRealBalances();

      if (Object.keys(holdings).length === 0) {
        ctx.reply("No holdings found. Your portfolio is empty.");
        return;
      }

      let message = "📊 **Your Portfolio**\n\n";

      Object.values(holdings).forEach((holding: any) => {
        message += `/${holding.index} **${holding.symbol}**\n`;
        message += `   Amount: ${holding.amount}\n`;
        message += `   Value: ${holding.value}\n\n`;
      });

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: this.getMainMenu()
      });
    } catch (error) {
      console.error("Error showing portfolio:", error);
      ctx.reply("Error loading portfolio. Please try again.");
    }
  }

  private async showAssetOverview(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      const keyboard = new InlineKeyboard()
        .text("💰 Buy", `buy_${index}`)
        .text("💸 Sell", `sell_${index}`)
        .row()
        .text("🔄 Transfer", `transfer_${index}`)
        .text("🔙 Back", "portfolio");

      const message = `**${holding.symbol} Overview**\n\n` +
        `**Name:** ${holding.name}\n` +
        `**Amount:** ${holding.amount}\n` +
        `**Price:** ${holding.price}\n` +
        `**Value:** ${holding.value}\n` +
        `**Market Cap:** Coming soon\n` +
        `**24h Change:** Coming soon`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing asset overview:", error);
      ctx.reply("Error loading asset details. Please try again.");
    }
  }

  private async getRealBalances(): Promise<Record<number, any>> {
    try {
      console.log(`🔍 Fetching balances for address: ${this.APTOS_ADDRESS}`);

      // Use the Holdings Fetcher
      const fetcher = createHoldingsFetcher({
        networkUrl: 'https://mainnet.aptoslabs.com/v1',
        indexerUrl: 'https://indexer.mainnet.aptoslabs.com/v1/graphql'
      });

      const holdings = await fetcher.getAccountHoldings(this.APTOS_ADDRESS);
      console.log(`📊 Holdings Fetcher found ${holdings.length} holdings`);

      if (holdings.length === 0) {
        return {};
      }

      // Get coin list for price data
      const coinList = await getCoinList();
      console.log(`📋 Loaded ${coinList.length} coins from Panora API`);

      // Collect unique coin IDs for batch price fetching
      const coinIds = new Set<string>();
      const symbolMappings: Record<string, string> = {};

      holdings.forEach(holding => {
        if (holding.coinGeckoId) {
          coinIds.add(holding.coinGeckoId);
        } else {
          // Try to map symbol to CoinGecko ID
          const commonMappings: Record<string, string> = {
            'APT': 'aptos',
            'USDC': 'usd-coin',
            'USDT': 'tether',
            'USDt': 'tether',
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'SOL': 'solana'
          };

          const mappedId = commonMappings[holding.symbol.toUpperCase()];
          if (mappedId) {
            coinIds.add(mappedId);
            symbolMappings[holding.symbol] = mappedId;
          } else {
            // Try using the symbol directly as CoinGecko ID
            coinIds.add(holding.symbol.toLowerCase());
            symbolMappings[holding.symbol] = holding.symbol.toLowerCase();
          }
        }
      });

      // Fetch prices for all coins
      const prices: Record<string, number> = {};
      for (const coinId of coinIds) {
        try {
          const price = await getPrice(coinId);
          if (price) {
            prices[coinId] = price;
            console.log(`💰 Fetched price for ${coinId}: $${price}`);
          }
        } catch (error) {
          console.error(`Error fetching price for ${coinId}:`, error);
        }
      }

      const result: any = {};
      holdings.forEach((holding, index) => {
        console.log(`📊 Processing holding ${index + 1}:`, {
          symbol: holding.symbol,
          name: holding.name,
          amount: holding.amount,
          decimals: holding.decimals,
          coinGeckoId: holding.coinGeckoId,
          assetType: holding.assetType
        });

        const tokenAmount = (holding.amount / Math.pow(10, holding.decimals)).toFixed(4);

        // Calculate USD value using the fetched prices
        let usdValue = 0;
        let usdPrice = "N/A";

        // Try to get price using coinGeckoId first, then symbol mapping
        let priceKey = holding.coinGeckoId;
        if (!priceKey) {
          priceKey = symbolMappings[holding.symbol] || null;
        }

        if (priceKey && prices[priceKey]) {
          const price = prices[priceKey];
          if (price !== undefined) {
            const calculatedValue = calculateUSDValue(holding.amount, holding.decimals, price.toString());
            usdValue = calculatedValue || 0;
            usdPrice = `$${price.toFixed(2)}`;
            console.log(`💰 ${holding.symbol}: ${tokenAmount} tokens = $${usdValue.toFixed(2)}`);
          }
        } else {
          console.log(`❌ No price found for ${holding.symbol} (tried: ${priceKey})`);
        }

        const tokenValue = usdValue > 0 ? `$${usdValue.toFixed(2)}` : "$0.00";

        result[index + 1] = {
          index: index + 1,
          symbol: holding.symbol,
          name: holding.name,
          amount: tokenAmount,
          value: tokenValue,
          price: usdPrice,
          decimals: holding.decimals,
          assetType: holding.assetType
        };
      });

      console.log(`✅ Found ${Object.keys(result).length} holdings via Holdings Fetcher`);
      return result;

    } catch (error) {
      console.error("Error fetching balances:", error);
      return {};
    }
  }

  public start() {
    this.bot.start();
    console.log("🤖 Aptos Telegram Bot started!");
  }
}