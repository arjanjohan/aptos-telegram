/**
 * Telegram Bot for Aptos Trading
 *
 * Main bot class that handles all Telegram interactions and Aptos blockchain operations.
 */

import { Bot as GrammyBot, InlineKeyboard } from "grammy";
import { Aptos, Network, AptosConfig, Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import dotenv from "dotenv";
import { createHoldingsFetcher } from "../services/holdings-fetcher.js";
import { getPrice, calculateUSDValue, getCoinList } from "../utils/usd-value-utils.js";

dotenv.config();

export class Bot {
  private bot: GrammyBot;
  private aptos: Aptos;
  private APTOS_ADDRESS: string;
  private APTOS_PRIVATE_KEY: string;
  private pendingTransfers: Map<number, { assetIndex: number; step: string; recipientAddress?: string; amount?: string }> = new Map();

  constructor() {
    this.bot = new GrammyBot(process.env.TELEGRAM_BOT_TOKEN!);
    this.aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
    this.APTOS_ADDRESS = process.env.APTOS_ADDRESS!;
    this.APTOS_PRIVATE_KEY = process.env.APTOS_PRIVATE_KEY!;

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
      const menu = await this.getBuyAssetSelectionMenu();
      ctx.reply("Please select an asset to buy:", {
        reply_markup: menu,
      });
    });

    // Sell command
    this.bot.command("sell", async (ctx) => {
      const menu = await this.getSellAssetSelectionMenu();
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
      } else if (data.startsWith("buy_asset_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.showBuyOptions(ctx, index);
        }
      } else if (data.startsWith("sell_asset_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.showSellOptions(ctx, index);
        }
      } else if (data.startsWith("transfer_")) {
        const parts = data.split("_");
        if (parts.length > 1 && parts[1]) {
          const index = parseInt(parts[1]);
          await this.showTransferPrompt(ctx, index);
        }
      } else if (data.startsWith("enter_address_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.promptForAddress(ctx, index);
        }
      } else if (data.startsWith("address_book_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.showAddressBook(ctx, index);
        }
      } else if (data.startsWith("confirm_transfer_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.executeTransfer(ctx, index);
        }
      } else if (data.startsWith("amount_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[1] && parts[2]) {
          const percentage = parts[1];
          const index = parseInt(parts[2]);
          await this.handlePercentageAmount(ctx, index, percentage);
        }
      } else if (data.startsWith("custom_amount_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const index = parseInt(parts[2]);
          await this.promptCustomAmount(ctx, index);
        }
      } else if (data === "portfolio") {
        await this.showPortfolio(ctx);
      } else if (data === "buy") {
        const menu = await this.getBuyAssetSelectionMenu();
        ctx.reply("Please select an asset to buy:", {
          reply_markup: menu,
        });
      } else if (data === "sell") {
        const menu = await this.getSellAssetSelectionMenu();
        ctx.reply("Please select an asset to sell:", {
          reply_markup: menu,
        });
      } else if (data === "settings") {
        ctx.reply("Settings menu coming soon! ⚙️");
      } else if (data === "start") {
        ctx.reply("Welcome to Aptos Trading Bot! 🚀", {
          reply_markup: this.getMainMenu(),
        });
      }
    });

    // Handle text messages for address input
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer) return;

      const text = ctx.message.text.trim();

      if (pendingTransfer.step === 'address') {
        await this.handleAddressInput(ctx, pendingTransfer, text);
      } else if (pendingTransfer.step === 'amount') {
        await this.handleAmountInput(ctx, pendingTransfer, text);
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

  private async getBuyAssetSelectionMenu(): Promise<InlineKeyboard> {
    const holdings = await this.getRealBalances();
    const keyboard = new InlineKeyboard();
    
    Object.values(holdings).forEach((holding: any) => {
      keyboard.text(`/${holding.index} ${holding.symbol}`, `buy_asset_${holding.index}`);
    });
    
    return keyboard;
  }

  private async getSellAssetSelectionMenu(): Promise<InlineKeyboard> {
    const holdings = await this.getRealBalances();
    const keyboard = new InlineKeyboard();
    
    Object.values(holdings).forEach((holding: any) => {
      keyboard.text(`/${holding.index} ${holding.symbol}`, `sell_asset_${holding.index}`);
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
        message += `**${holding.symbol}**\n`;
        message += `   Amount: ${holding.amount}\n`;
        message += `   Value: ${holding.value}\n\n`;
      });

      // Create keyboard with clickable asset buttons
      const keyboard = new InlineKeyboard();
      Object.values(holdings).forEach((holding: any) => {
        keyboard.text(`/${holding.index} ${holding.symbol}`, `asset_${holding.index}`);
      });
      keyboard.row().text("🔙 Back to Menu", "start");

      ctx.reply(message, { 
        parse_mode: "Markdown",
        reply_markup: keyboard
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
        `**Type:** ${holding.isCoin ? 'Coin' : 'Fungible Asset'}\n` +
        `**Asset ID:** \`${holding.assetType}\`\n` +
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

  private async showBuyOptions(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];
      
      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      const keyboard = new InlineKeyboard()
        .text("📝 Enter Amount", `buy_amount_${index}`)
        .text("25%", `buy_25_${index}`)
        .text("50%", `buy_50_${index}`)
        .text("100%", `buy_100_${index}`)
        .row()
        .text("🔙 Back to Buy Menu", "buy");

      const message = `**Buy ${holding.symbol}**\n\n` +
        `**Name:** ${holding.name}\n` +
        `**Current Price:** ${holding.price}\n` +
        `**Available Balance:** ${holding.amount} ${holding.symbol}\n\n` +
        `Choose how much you want to buy:`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing buy options:", error);
      ctx.reply("Error loading buy options. Please try again.");
    }
  }

  private async showSellOptions(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];
      
      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      const keyboard = new InlineKeyboard()
        .text("📝 Enter Amount", `sell_amount_${index}`)
        .text("25%", `sell_25_${index}`)
        .text("50%", `sell_50_${index}`)
        .text("100%", `sell_100_${index}`)
        .row()
        .text("🔙 Back to Sell Menu", "sell");

      const message = `**Sell ${holding.symbol}**\n\n` +
        `**Name:** ${holding.name}\n` +
        `**Current Price:** ${holding.price}\n` +
        `**Available Balance:** ${holding.amount} ${holding.symbol}\n` +
        `**Value:** ${holding.value}\n\n` +
        `Choose how much you want to sell:`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing sell options:", error);
      ctx.reply("Error loading sell options. Please try again.");
    }
  }

  private async showTransferPrompt(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      const keyboard = new InlineKeyboard()
        .text("📝 Enter Address", `enter_address_${index}`)
        .text("📋 Address Book", `address_book_${index}`)
        .row()
        .text("🔙 Back to Asset", `asset_${index}`);

      const message = `**Transfer ${holding.symbol}**\n\n` +
        `**Available:** ${holding.amount} ${holding.symbol}\n` +
        `**Value:** ${holding.value}\n\n` +
        `Choose how to enter the recipient address:`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing transfer prompt:", error);
      ctx.reply("Error loading transfer options. Please try again.");
    }
  }

  private async promptForAddress(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      // Store the transfer context for this user
      const userId = ctx.from?.id;
      if (userId) {
        // In a real implementation, you'd store this in a database
        // For now, we'll use a simple in-memory store
        this.pendingTransfers = this.pendingTransfers || new Map();
        this.pendingTransfers.set(userId, { assetIndex: index, step: 'address' });
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `transfer_${index}`);

      const message = `**Enter Recipient Address**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Available:** ${holding.amount} ${holding.symbol}\n\n` +
        `Please send the recipient's Aptos address as a message.\n` +
        `The address should start with "0x" and be 64 characters long.`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error prompting for address:", error);
      ctx.reply("Error loading address input. Please try again.");
    }
  }

  private async showAddressBook(ctx: any, index: number) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      // For now, show a simple address book with common addresses
      const keyboard = new InlineKeyboard()
        .text("📝 Enter Custom Address", `enter_address_${index}`)
        .row()
        .text("🔙 Back to Transfer", `transfer_${index}`);

      const message = `**Address Book**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Available:** ${holding.amount} ${holding.symbol}\n\n` +
        `Address book feature coming soon!\n` +
        `For now, please enter a custom address.`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing address book:", error);
      ctx.reply("Error loading address book. Please try again.");
    }
  }

  private async handleAddressInput(ctx: any, pendingTransfer: any, address: string) {
    try {
      // Validate address format
      if (!address.startsWith('0x') || address.length !== 66) {
        ctx.reply("❌ Invalid address format. Please enter a valid Aptos address (0x followed by 64 hex characters).");
        return;
      }

      // Update pending transfer with address
      pendingTransfer.recipientAddress = address;
      pendingTransfer.step = 'amount';
      this.pendingTransfers.set(ctx.from.id, pendingTransfer);

      const holdings = await this.getRealBalances();
      const holding = holdings[pendingTransfer.assetIndex];

      const availableAmount = parseFloat(holding.amount);
      const keyboard = new InlineKeyboard()
        .text("25%", `amount_25_${pendingTransfer.assetIndex}`)
        .text("50%", `amount_50_${pendingTransfer.assetIndex}`)
        .text("100%", `amount_100_${pendingTransfer.assetIndex}`)
        .row()
        .text("📝 Custom Amount", `custom_amount_${pendingTransfer.assetIndex}`)
        .text("❌ Cancel", `transfer_${pendingTransfer.assetIndex}`);

      const message = `**Enter Transfer Amount**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Recipient:** \`${address}\`\n` +
        `**Available:** ${holding.amount} ${holding.symbol}\n\n` +
        `Choose a percentage or enter a custom amount:`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error handling address input:", error);
      ctx.reply("Error processing address. Please try again.");
    }
  }

  private async handleAmountInput(ctx: any, pendingTransfer: any, amountText: string) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[pendingTransfer.assetIndex];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      // Parse amount
      const amount = parseFloat(amountText);
      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number.");
        return;
      }

      // Check if user has enough balance
      const availableAmount = parseFloat(holding.amount);
      if (amount > availableAmount) {
        ctx.reply(`❌ Insufficient balance. You have ${holding.amount} ${holding.symbol}, but trying to transfer ${amount}.`);
        return;
      }

      // Update pending transfer with amount
      pendingTransfer.amount = amountText;
      this.pendingTransfers.set(ctx.from.id, pendingTransfer);

      // Show confirmation
      await this.showTransferConfirmation(ctx, pendingTransfer);
    } catch (error) {
      console.error("Error handling amount input:", error);
      ctx.reply("Error processing amount. Please try again.");
    }
  }

  private async handlePercentageAmount(ctx: any, index: number, percentage: string) {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer || pendingTransfer.assetIndex !== index) {
        ctx.reply("Transfer session expired. Please start over.");
        return;
      }

      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      const availableAmount = parseFloat(holding.amount);
      const percentageValue = parseFloat(percentage);
      const amount = (availableAmount * percentageValue) / 100;
      const amountText = amount.toFixed(holding.decimals);

      // Update pending transfer with amount
      pendingTransfer.amount = amountText;
      this.pendingTransfers.set(userId, pendingTransfer);

      // Show confirmation
      await this.showTransferConfirmation(ctx, pendingTransfer);
    } catch (error) {
      console.error("Error handling percentage amount:", error);
      ctx.reply("Error processing amount. Please try again.");
    }
  }

  private async promptCustomAmount(ctx: any, index: number) {
    try {
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer || pendingTransfer.assetIndex !== index) {
        ctx.reply("Transfer session expired. Please start over.");
        return;
      }

      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      // Update step to amount input
      pendingTransfer.step = 'amount';
      this.pendingTransfers.set(userId, pendingTransfer);

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `transfer_${index}`);

      const message = `**Enter Custom Amount**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Recipient:** \`${pendingTransfer.recipientAddress}\`\n` +
        `**Available:** ${holding.amount} ${holding.symbol}\n\n` +
        `Please enter the exact amount to transfer (e.g., "1.5" for 1.5 tokens):`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error prompting custom amount:", error);
      ctx.reply("Error loading custom amount input. Please try again.");
    }
  }

  private async showTransferConfirmation(ctx: any, pendingTransfer: any) {
    try {
      const holdings = await this.getRealBalances();
      const holding = holdings[pendingTransfer.assetIndex];

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Transfer", `confirm_transfer_${pendingTransfer.assetIndex}`)
        .text("❌ Cancel", `transfer_${pendingTransfer.assetIndex}`);

      const message = `**Confirm Transfer**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Amount:** ${pendingTransfer.amount} ${holding.symbol}\n` +
        `**Recipient:** \`${pendingTransfer.recipientAddress}\`\n` +
        `**Value:** ~$${(parseFloat(pendingTransfer.amount) * (parseFloat(holding.price.replace('$', '')) || 0)).toFixed(2)}\n\n` +
        `⚠️ **This action cannot be undone!**`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing transfer confirmation:", error);
      ctx.reply("Error loading confirmation. Please try again.");
    }
  }

  private async executeTransfer(ctx: any, index: number) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("Error: User not found.");
        return;
      }

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer || pendingTransfer.assetIndex !== index) {
        ctx.reply("Error: Transfer session expired. Please start over.");
        return;
      }

      const holdings = await this.getRealBalances();
      const holding = holdings[index];

      if (!holding) {
        ctx.reply("Asset not found.");
        return;
      }

      // Show processing message
      await ctx.reply("🔄 Processing transfer... Please wait.");

      // Convert amount to raw units (considering decimals)
      const amount = parseFloat(pendingTransfer.amount || '0');
      const rawAmount = Math.floor(amount * Math.pow(10, holding.decimals));

      let transactionHash: string;

      if (holding.isCoin) {
        // Transfer Coin (v1)
        transactionHash = await this.transferCoin(
          pendingTransfer.recipientAddress!,
          holding.assetType,
          rawAmount
        );
      } else {
        // Transfer Fungible Asset (v2)
        transactionHash = await this.transferFungibleAsset(
          pendingTransfer.recipientAddress!,
          holding.assetType,
          rawAmount
        );
      }

      // Clear pending transfer
      this.pendingTransfers.delete(userId);

      // Show success message
      const message = `✅ **Transfer Successful!**\n\n` +
        `**Asset:** ${holding.symbol} (${holding.name})\n` +
        `**Amount:** ${pendingTransfer.amount} ${holding.symbol}\n` +
        `**Recipient:** \`${pendingTransfer.recipientAddress}\`\n` +
        `**Transaction:** \`${transactionHash}\`\n\n` +
        `View on [Aptos Explorer](https://explorer.aptoslabs.com/txn/${transactionHash})`;

      const keyboard = new InlineKeyboard()
        .text("📊 Back to Portfolio", "portfolio");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      console.error("Error executing transfer:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Transfer failed: ${errorMessage}`);
    }
  }

  private async transferCoin(recipientAddress: string, coinType: string, amount: number): Promise<string> {
    try {
      console.log(`🔄 Transferring coin:`, {
        recipientAddress,
        coinType,
        amount,
        privateKeyLength: this.APTOS_PRIVATE_KEY?.length,
        privateKeyPrefix: this.APTOS_PRIVATE_KEY?.substring(0, 10)
      });

      // Validate private key format
      if (!this.APTOS_PRIVATE_KEY) {
        throw new Error("Private key not found in environment variables");
      }

      // Create private key and account
      const privateKey = new Ed25519PrivateKey(this.APTOS_PRIVATE_KEY);
      const account = Account.fromPrivateKey({ privateKey });

      console.log(`✅ Account created:`, {
        accountAddress: account.accountAddress
      });

      // Build transfer transaction
      const transaction = await this.aptos.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: "0x1::aptos_account::transfer_coins",
          typeArguments: [coinType],
          functionArguments: [recipientAddress, amount],
        },
      });

      // Sign and submit transaction
      const senderAuthenticator = this.aptos.transaction.sign({
        signer: account,
        transaction,
      });

      const pendingTransaction = await this.aptos.transaction.submit.simple({
        transaction,
        senderAuthenticator,
      });

      await this.aptos.waitForTransaction({
        transactionHash: pendingTransaction.hash,
      });

      return pendingTransaction.hash;
    } catch (error) {
      console.error("Error transferring coin:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Coin transfer failed: ${errorMessage}`);
    }
  }

  private async transferFungibleAsset(recipientAddress: string, assetAddress: string, amount: number): Promise<string> {
    try {
      console.log(`🔄 Transferring fungible asset:`, {
        recipientAddress,
        assetAddress,
        amount,
        privateKeyLength: this.APTOS_PRIVATE_KEY?.length,
        privateKeyPrefix: this.APTOS_PRIVATE_KEY?.substring(0, 10)
      });

      // Validate private key format
      if (!this.APTOS_PRIVATE_KEY) {
        throw new Error("Private key not found in environment variables");
      }

      // Create private key and account
      const privateKey = new Ed25519PrivateKey(this.APTOS_PRIVATE_KEY);
      const account = Account.fromPrivateKey({ privateKey });

      console.log(`✅ Account created:`, {
        accountAddress: account.accountAddress
      });

      // Build transfer transaction for fungible asset
      const transaction = await this.aptos.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: "0x1::primary_fungible_store::transfer",
          typeArguments: [],
          functionArguments: [assetAddress, recipientAddress, amount],
        },
      });

      // Sign and submit transaction
      const senderAuthenticator = this.aptos.transaction.sign({
        signer: account,
        transaction,
      });

      const pendingTransaction = await this.aptos.transaction.submit.simple({
        transaction,
        senderAuthenticator,
      });

      await this.aptos.waitForTransaction({
        transactionHash: pendingTransaction.hash,
      });

      return pendingTransaction.hash;
    } catch (error) {
      console.error("Error transferring fungible asset:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Fungible asset transfer failed: ${errorMessage}`);
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
          assetType: holding.assetType,
          isCoin: holding.assetType.includes('::'),
          isFungibleAsset: /^0x[0-9a-fA-F]{64}$/.test(holding.assetType)
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
          assetType: holding.assetType,
          isCoin: holding.assetType.includes('::'),
          isFungibleAsset: /^0x[0-9a-fA-F]{64}$/.test(holding.assetType)
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