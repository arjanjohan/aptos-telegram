/*
 * Telegram Bot for Aptos Trading
 *
 * Main bot class that handles all Telegram interactions and Aptos blockchain operations.
 */

import { Bot as GrammyBot, InlineKeyboard } from "grammy";
import { Aptos, AptosConfig, Account, Ed25519PrivateKey, type InputEntryFunctionData, type MoveFunctionId } from "@aptos-labs/ts-sdk";
import { createHoldingsFetcher } from "../services/holdings-fetcher.js";
import { getPrice, calculateUSDValue, getCoinList } from "../utils/usd-value-utils.js";
import { getMarkets, findMarketById, type Market } from "../config/markets.js";
import {
  getAptosConfig,
  getTelegramConfig,
  getAccountConfig,
  getAptosNetworkUrl,
  getAptosIndexerUrl,
  getAptosAddress,
  getAptosPrivateKey,
  getNetworkType,
  getKanaLabsConfig,
  isTestnet
} from "../config/index.js";
import { KanaLabsPerpsService } from "../services/kanalabs-perps.js";

export class Bot {
  private bot: GrammyBot;
  private aptos: Aptos;
  private aptosAccount: Account;
  private APTOS_ADDRESS: string;
  private APTOS_PRIVATE_KEY: string;
  private kanaLabsPerps: KanaLabsPerpsService;
  private pendingTransfers: Map<number, { assetIndex: number; step: string; recipientAddress?: string; amount?: string; orderData?: { marketId: string; orderSide: string; market: any } }> = new Map();
  private pendingDeposits: Map<number, { step: string; amount?: string }> = new Map();
  private pendingVotes: Map<string, { pollId: string; action: string; data: any; voters: Set<number>; startTime: number }> = new Map();

  // Settings storage (in production, this would be in a database)
  // TODO: Move to database
  private settings = {
    disableConfirmation: false,
    defaultTransferAmounts: [25, 50], // 25%, 50% - 100% and custom are always present
    defaultBuyAmounts: [100, 200, 500], // $100, $200, $500 - custom is always present
    minimumDisplayAmount: 0, // Minimum USD value to display positions
    votingTimePeriod: 300, // Voting time in seconds (5 minutes)
    votingThreshold: 0.5 // Approval threshold (0.0 to 1.0 = 0% to 100%)
  };

  constructor() {
    const telegramConfig = getTelegramConfig();
    const aptosConfig = getAptosConfig();
    const accountConfig = getAccountConfig();

    this.bot = new GrammyBot(telegramConfig.botToken);
    this.aptos = new Aptos(new AptosConfig({ network: aptosConfig.network }));
    this.APTOS_ADDRESS = accountConfig.address;
    this.APTOS_PRIVATE_KEY = accountConfig.privateKey;

    // Create Aptos account for signing transactions
    const formattedPrivateKey = new Ed25519PrivateKey(this.APTOS_PRIVATE_KEY);
    this.aptosAccount = Account.fromPrivateKey({
      privateKey: formattedPrivateKey,
    });

    this.kanaLabsPerps = new KanaLabsPerpsService();

    this.setupHandlers();
  }

  private setupHandlers() {
    // Start command
    this.bot.command("start", async (ctx) => {
      await this.showHomepage(ctx);
    });

    // Portfolio command
    this.bot.command("portfolio", async (ctx) => {
      await this.showPortfolio(ctx);
    });

    // Settings command
    this.bot.command("settings", (ctx) => {
      ctx.reply("Settings menu coming soon! ⚙️");
    });

    // Deposit command
    this.bot.command("deposit", async (ctx) => {
      await this.showDepositAmountPrompt(ctx);
    });

    // Faucet command
    this.bot.command("faucet", async (ctx) => {
      await this.executeFaucet(ctx);
    });

    // Debug command
    this.bot.command("debug", async (ctx) => {
      await this.debugApiConnection(ctx);
    });

    // Handle asset commands like /1, /2, etc.
    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message?.text?.trim();
      if (!text) return;

      // Handle other text messages (address input, amount input, etc.)
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (pendingTransfer) {
        if (pendingTransfer.step === 'address') {
          await this.handleAddressInput(ctx, pendingTransfer, text);
        } else if (pendingTransfer.step === 'amount') {
          await this.handleAmountInput(ctx, pendingTransfer, text);
        } else if (pendingTransfer.step === 'min_display_input') {
          await this.handleMinDisplayInput(ctx, text);
      } else if (pendingTransfer.step === 'voting_time_input') {
        await this.handleVotingTimeInput(ctx, text);
      } else if (pendingTransfer.step === 'voting_threshold_input') {
        await this.handleVotingThresholdInput(ctx, text);
      } else if (pendingTransfer.step === 'transfer_amount_input') {
        await this.handleTransferAmountInput(ctx, text);
      } else if (pendingTransfer.step === 'buy_amount_input') {
        await this.handleBuyAmountInput(ctx, text);
      } else if (pendingTransfer.step === 'order_size_input') {
        await this.handleOrderSizeInput(ctx, text);
        }
        return;
      }

      // Handle deposit amount input (check this first before numeric commands)
      const pendingDeposit = this.pendingDeposits.get(userId);
      if (pendingDeposit && pendingDeposit.step === 'custom_amount') {
        await this.handleDepositCustomAmountInput(ctx, text);
        return;
      } else if (pendingDeposit && pendingDeposit.step === 'withdraw_amount') {
        await this.handleWithdrawAmountInput(ctx, pendingDeposit, text);
        return;
      } else if (pendingDeposit && pendingDeposit.step === 'custom_withdraw_amount') {
        await this.handleWithdrawCustomAmountInput(ctx, text);
        return;
      }

      // Check if it's a number command like /1, /2, etc. (only if not in input mode)
      if (/^\d+$/.test(text)) {
        const index = parseInt(text);
        await this.showAssetOverview(ctx, index);
        return;
      }
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
      } else if (data === "settings") {
        await this.showSettings(ctx);
      } else if (data === "start") {
        await this.showHomepage(ctx);
      } else if (data === "wallet") {
        await this.showWallet(ctx);
      } else if (data === "refresh") {
        await this.showHomepage(ctx);
      } else if (data === "deposit") {
        await this.showDepositAmountPrompt(ctx);
      } else if (data === "withdraw") {
        await this.showWithdrawMenu(ctx);
      } else if (data === "open_orders") {
        await this.showOpenOrders(ctx);
      } else if (data === "positions") {
        await this.showPositions(ctx);
      } else if (data === "faucet_usdt") {
        await this.executeFaucet(ctx);
      } else if (data === "export_private_key") {
        await this.showExportPrivateKeyWarning(ctx);
      } else if (data === "confirm_export_private_key") {
        await this.exportPrivateKey(ctx);
      } else if (data === "toggle_confirmation") {
        this.settings.disableConfirmation = !this.settings.disableConfirmation;
        await this.showSettings(ctx);
      } else if (data === "set_min_display") {
        await this.promptMinDisplayInput(ctx);
      } else if (data.startsWith("set_min_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const amount = parseInt(parts[2]);
          this.settings.minimumDisplayAmount = amount;
          await this.showSettings(ctx);
        }
      } else if (data === "no_action") {
        // Do nothing for setting name buttons
        return;
      } else if (data === "set_min_display_input") {
        await this.promptMinDisplayInput(ctx);
      } else if (data === "set_voting_time") {
        await this.promptVotingTimeInput(ctx);
      } else if (data === "set_voting_threshold") {
        await this.promptVotingThresholdInput(ctx);
      } else if (data === "set_transfer_amount_1") {
        await this.promptTransferAmountInput(ctx, 1);
      } else if (data === "set_transfer_amount_2") {
        await this.promptTransferAmountInput(ctx, 2);
      } else if (data === "set_buy_amount_1") {
        await this.promptBuyAmountInput(ctx, 1);
      } else if (data === "set_buy_amount_2") {
        await this.promptBuyAmountInput(ctx, 2);
      } else if (data === "set_buy_amount_3") {
        await this.promptBuyAmountInput(ctx, 3);
      } else if (data === "markets") {
        await this.showMarketSelection(ctx);
      } else if (data.startsWith("select_market_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const marketId = parts[2];
          await this.showMarketDetails(ctx, marketId);
        }
      } else if (data.startsWith("order_type_")) {
        const parts = data.split("_");
        if (parts.length > 3 && parts[2] && parts[3]) {
          const marketId = parts[2];
          const orderSide = parts[3]; // long or short
          await this.showOrderSizeInput(ctx, marketId, orderSide);
        }
      } else if (data.startsWith("chart_")) {
        const parts = data.split("_");
        if (parts.length > 1 && parts[1]) {
          const marketId = parts[1];
          await this.showChart(ctx, marketId);
        }
      } else if (data.startsWith("orderbook_")) {
        const parts = data.split("_");
        if (parts.length > 1 && parts[1]) {
          const marketId = parts[1];
          await this.showOrderBook(ctx, marketId);
        }
      } else if (data.startsWith("confirm_order_")) {
        const parts = data.split("_");
        if (parts.length > 4 && parts[2] && parts[3] && parts[4]) {
          const marketId = parts[2];
          const orderSide = parts[3];
          const size = parseFloat(parts[4]);
          await this.executeOrder(ctx, marketId, orderSide, size);
        }
      } else if (data === "confirm_deposit") {
        await this.executeDeposit(ctx);
      } else if (data === "deposit_25") {
        await this.handleDepositPercentage(ctx, 0.25);
      } else if (data === "deposit_50") {
        await this.handleDepositPercentage(ctx, 0.50);
      } else if (data === "deposit_75") {
        await this.handleDepositPercentage(ctx, 0.75);
      } else if (data === "deposit_100") {
        await this.handleDepositPercentage(ctx, 1.00);
      } else if (data === "deposit_custom") {
        await this.promptDepositCustomAmount(ctx);
      } else if (data === "withdraw_amount") {
        await this.showWithdrawAmountPrompt(ctx);
      } else if (data === "confirm_withdraw") {
        await this.executeWithdraw(ctx);
      } else if (data === "withdraw_25") {
        await this.handleWithdrawPercentage(ctx, 0.25);
      } else if (data === "withdraw_50") {
        await this.handleWithdrawPercentage(ctx, 0.50);
      } else if (data === "withdraw_75") {
        await this.handleWithdrawPercentage(ctx, 0.75);
      } else if (data === "withdraw_100") {
        await this.handleWithdrawPercentage(ctx, 1.00);
      } else if (data === "withdraw_custom") {
        await this.promptWithdrawCustomAmount(ctx);
      }
    });

  }

  private getMainMenu(): InlineKeyboard {
    return new InlineKeyboard()
      .text("📊 Markets", "markets")
      .text("⏳ Pending Orders", "pending_orders")
      .row()
      .text("📊 Open Orders", "open_orders")
      .text("📈 Positions", "positions")
      .row()
      .text("💰 Deposit to Kana", "deposit")
      .text("💸 Withdraw from Kana", "withdraw")
      .row()
      .text("🚰 Faucet USDT", "faucet_usdt")
      .text("⚙️ Settings", "settings")
      .row()
      .text("💳 Wallet", "wallet")
      .text("🔄 Refresh", "refresh");
  }


  private async showHomepage(ctx: any) {
    try {
      // Fetch Kana Labs balances
      let message = "👥 *MoveTogether* on Aptos\n";
      message += "powered by *Kana Lab* \n\n"

      try {
        const userAddress = getAptosAddress();
        console.log(`🔍 [HOMEPAGE] Fetching Kana Labs balances for: ${userAddress}`);

        const [walletBalance, profileBalance] = await Promise.all([
          this.kanaLabsPerps.getWalletAccountBalance(userAddress),
          this.kanaLabsPerps.getProfileBalanceSnapshot(userAddress)
        ]);

        console.log(`🔍 [HOMEPAGE] Kana Labs balances:`, {
          wallet: walletBalance.data,
          profile: profileBalance.data
        });


        message += `⏳ Pending Orders: 1\n`;
        message += `💻 Open Orders: 0\n`;
        message += `📊 Open Positions: 2\n\n`;


        if (walletBalance.success) {
          const walletAmount = parseFloat(walletBalance.data).toFixed(2);
          message += `💳 *Wallet Balance:* ${walletAmount} USDT\n`;
        } else {
          message += `💳 *Wallet Balance:* ❌ Error fetching\n`;
        }

        if (profileBalance.success) {
          const profileAmount = parseFloat(profileBalance.data).toFixed(2);
          message += `💰 *Kana Balance:* ${profileAmount} USDT\n`;
        } else {
          message += `💰 *Kana Balance:* ❌ Error fetching\n`;
        }

        message += "\n";
      } catch (error) {
        console.error("Error fetching Kana Labs balances:", error);

        message += "❌ Unable to fetch your Kana Labs account\n\n";

        message += "💳 *Wallet Balance:* ❌ Unable to fetch\n";
        message += "💰 *Kana Balance:* ❌ Unable to fetch\n\n";
      }


      // Add main menu buttons
      const keyboard = new InlineKeyboard();
      keyboard
        .text("📊 Markets", "markets")
        .text("⏳ Pending Orders", "pending_orders")
        .row()
        .text("📊 Open Orders", "open_orders")
        .text("📈 Positions", "positions")
        .row()
        .text("💰 Deposit to Perps", "deposit")
        .text("💸 Withdraw from Perps", "withdraw")
        .row()
        .text("🚰 Faucet USDT", "faucet_usdt")
        .text("⚙️ Settings", "settings")
        .row()
        .text("💳 Wallet", "wallet")
        .text("🔄 Refresh", "refresh");

      ctx.reply(message, {
      parse_mode: "Markdown",
        reply_markup: keyboard
    });
  } catch (error) {
      console.error("Error showing homepage:", error);
      ctx.reply("Error loading homepage. Please try again.", {
        reply_markup: this.getMainMenu()
      });
    }
  }

  private async showPortfolio(ctx: any) {
    try {
      const holdings = await this.getRealBalances();

      if (Object.keys(holdings).length === 0) {
        ctx.reply("No holdings found. Your portfolio is empty.");
        return;
      }

      let message = "📊 *Your Portfolio*\n\n";

      Object.values(holdings).forEach((holding: any) => {
        message += `*${holding.symbol}*\n`;
        message += `   Amount: ${holding.amount}\n`;
        message += `   Value: ${holding.value}\n\n`;
      });

      // Create keyboard with clickable asset buttons
      const keyboard = new InlineKeyboard();
      Object.values(holdings).forEach((holding: any) => {
        keyboard.text(`/${holding.index} ${holding.symbol}`, `asset_${holding.index}`);
      });
      keyboard.row().text("🔙 Back to Home", "start");

      ctx.reply(message, {
      parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing portfolio:", error);
      ctx.reply("Error loading portfolio. Please try again.");
    }
  }

  private async showWallet(ctx: any) {
    try {
      const holdings = await this.getRealBalances();
      const aptHolding = Object.values(holdings).find((holding: any) => holding.symbol === 'APT');
      const aptBalance = aptHolding ? aptHolding.amount : '0';
      const aptValue = aptHolding ? aptHolding.value : '$0.00';

      const message = `💳 *Wallet Information*\n\n` +
        `*Address:* \`${getAptosAddress()}\`\n` +
        `*APT Balance:* ${aptBalance} APT\n` +
        `*APT Value:* ${aptValue}`;

      const keyboard = new InlineKeyboard()
        .text("🔑 Export Private Key", "export_private_key")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing wallet:", error);
      ctx.reply("Error loading wallet information. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private async showSettings(ctx: any) {
    try {
      const votingTimeMinutes = Math.floor(this.settings.votingTimePeriod / 60);
      const votingThresholdPercent = Math.round(this.settings.votingThreshold * 100);

      const message = `⚙️ *Settings*\n\n` +
      `*--- TRANSACTION SETTINGS ---\n` +
        `*Transaction Confirmation:* ${this.settings.disableConfirmation ? '❌ Disabled' : '✅ Enabled'}\n` +
        `*Minimum Display Amount:* $${this.settings.minimumDisplayAmount}\n` +
        `*Transfer Amount Buttons:*\n`   +
        `${this.settings.defaultTransferAmounts[0]}% - ${this.settings.defaultTransferAmounts[1]}% - 100% - custom \n` +
        `*Buy Amount Buttons:*\n` +
        `$${this.settings.defaultBuyAmounts[0]} - $${this.settings.defaultBuyAmounts[1]} - $${this.settings.defaultBuyAmounts[2]} - custom \n\n` +
        `*--- VOTING SETTINGS ---*\n` +
        `*Voting Time:* ${votingTimeMinutes} minutes\n` +
        `*Approval Threshold:* ${votingThresholdPercent}%\n\n` +
        `Note: Settings are stored in memory and will reset when bot restarts.`;

      const keyboard = new InlineKeyboard()
        // Disable Confirmation setting
        .text("Transaction Confirmation", "no_action")
        .row()
        .text(`${this.settings.disableConfirmation ? '❌ Disabled' : '✅ Enabled' }`, `toggle_confirmation`)
        .row()
        // Transfer Amount Buttons
        .text("Transfer Amount Buttons", "no_action")
        .row()
        .text(`${this.settings.defaultTransferAmounts[0]}%`, "set_transfer_amount_1")
        .text(`${this.settings.defaultTransferAmounts[1]}%`, "set_transfer_amount_2")
        .row()
        // Buy Amount Buttons
        .text("Buy Amount Buttons", "no_action")
        .row()
        .text(`$${this.settings.defaultBuyAmounts[0]}`, "set_buy_amount_1")
        .text(`$${this.settings.defaultBuyAmounts[1]}`, "set_buy_amount_2")
        .text(`$${this.settings.defaultBuyAmounts[2]}`, "set_buy_amount_3")
        .row()
        // Minimum Display Amount setting
        .text("Minimum Display Amount", "no_action")
        .row()
        .text(`$${this.settings.minimumDisplayAmount}`, "set_min_display_input")
        .row()
        // Voting Time setting
        .text("Voting Time", "no_action")
        .row()
        .text(`${votingTimeMinutes} minutes`, "set_voting_time")
        .row()
        // Approval Threshold setting
        .text("Approval Threshold", "no_action")
        .row()
        .text(`${votingThresholdPercent}%`, "set_voting_threshold")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, {
      parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing settings:", error);
      ctx.reply("Error loading settings. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }


  private async promptMinDisplayInput(ctx: any) {
    const message = `⚙️ *Set Minimum Display Amount*\n\n` +
      `Current minimum: $${this.settings.minimumDisplayAmount}\n\n` +
      `Please enter the minimum USD value to display positions in portfolio.\n` +
      `Send a number (e.g., 5 for $5, 0.5 for $0.50):`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel", "settings");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

    // Store the user's state for input handling
    const userId = ctx.from?.id;
    if (userId) {
      this.pendingTransfers.set(userId, { assetIndex: -1, step: 'min_display_input' });
    }
  }

  private async promptVotingTimeInput(ctx: any) {
    const currentMinutes = Math.floor(this.settings.votingTimePeriod / 60);
    const message = `⚙️ *Set Voting Time Period*\n\n` +
      `Current time: ${currentMinutes} minutes\n\n` +
      `Please enter the voting time period in minutes.\n` +
      `Send a number (e.g., 5 for 5 minutes, 10 for 10 minutes):`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel", "settings");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

    // Store the user's state for input handling
    const userId = ctx.from?.id;
    if (userId) {
      this.pendingTransfers.set(userId, { assetIndex: -1, step: 'voting_time_input' });
    }
  }


  private async promptVotingThresholdInput(ctx: any) {
    const currentPercent = Math.round(this.settings.votingThreshold * 100);
    const message = `⚙️ *Set Approval Threshold*\n\n` +
      `Current threshold: ${currentPercent}%\n\n` +
      `Please enter the approval threshold as a percentage.\n` +
      `Send a number (e.g., 50 for 50%, 75 for 75%):`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel", "settings");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

    // Store the user's state for input handling
    const userId = ctx.from?.id;
    if (userId) {
      this.pendingTransfers.set(userId, { assetIndex: -1, step: 'voting_threshold_input' });
    }
  }

  private async promptTransferAmountInput(ctx: any, buttonIndex: number) {
    const currentValue = this.settings.defaultTransferAmounts[buttonIndex - 1];
    const message = `⚙️ *Set Transfer Amount Button *\n\n` +
      `Current value: ${currentValue}%\n\n` +
      `Please enter the new percentage value for this button.\n` +
      `Send a number (e.g., 30 for 30%, 75 for 75%):`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel", "settings");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

    // Store the user's state for input handling
    const userId = ctx.from?.id;
    if (userId) {
      this.pendingTransfers.set(userId, { assetIndex: buttonIndex, step: 'transfer_amount_input' });
    }
  }

  private async promptBuyAmountInput(ctx: any, buttonIndex: number) {
    const currentValue = this.settings.defaultBuyAmounts[buttonIndex - 1];
    const message = `⚙️ *Set Buy Amount Button*\n\n` +
      `Current value: $${currentValue}\n\n` +
      `Please enter the new USD amount for this button.\n` +
      `Send a number (e.g., 50, 100, 250):`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel", "settings");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });

    // Store the user's state for input handling
    const userId = ctx.from?.id;
    if (userId) {
      this.pendingTransfers.set(userId, { assetIndex: buttonIndex, step: 'buy_amount_input' });
    }
  }

  private async handleMinDisplayInput(ctx: any, text: string) {
    try {
      const amount = parseFloat(text);

      if (isNaN(amount) || amount < 0) {
        ctx.reply("❌ Invalid amount. Please enter a valid number (e.g., 5 for $5, 0.5 for $0.50):");
        return;
      }

      this.settings.minimumDisplayAmount = amount;

      // Clear the pending transfer
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

      ctx.reply(`✅ Minimum display amount set to $${amount}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Settings", "settings")
      });
    } catch (error) {
      console.error("Error handling min display input:", error);
      ctx.reply("❌ Error setting minimum display amount. Please try again.");
    }
  }

  private async handleVotingTimeInput(ctx: any, text: string) {
    try {
      const minutes = parseInt(text);

      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        ctx.reply("❌ Invalid time. Please enter a number between 1 and 1440 minutes (24 hours):");
        return;
      }

      this.settings.votingTimePeriod = minutes * 60; // Convert to seconds

      // Clear the pending transfer
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

      // Go directly back to settings
      await this.showSettings(ctx);
  } catch (error) {
      console.error("Error handling voting time input:", error);
      ctx.reply("❌ Error setting voting time. Please try again.");
    }
  }


  private async handleVotingThresholdInput(ctx: any, text: string) {
    try {
      const percent = parseFloat(text);

      if (isNaN(percent) || percent < 0 || percent > 100) {
        ctx.reply("❌ Invalid percentage. Please enter a number between 0 and 100:");
        return;
      }

      this.settings.votingThreshold = percent / 100; // Convert to decimal

      // Clear the pending transfer
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

      // Go directly back to settings
      await this.showSettings(ctx);
    } catch (error) {
      console.error("Error handling voting threshold input:", error);
      ctx.reply("❌ Error setting approval threshold. Please try again.");
    }
  }

  private async handleTransferAmountInput(ctx: any, text: string) {
    try {
      const percent = parseFloat(text);

      if (isNaN(percent) || percent < 0 || percent > 100) {
        ctx.reply("❌ Invalid percentage. Please enter a number between 0 and 100:");
        return;
      }

      // Get the button index from the pending transfer
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer) return;

      const buttonIndex = pendingTransfer.assetIndex;
      if (buttonIndex < 1 || buttonIndex > 2) {
        ctx.reply("❌ Invalid button index.");
        return;
      }

      // Update the transfer amount
      this.settings.defaultTransferAmounts[buttonIndex - 1] = percent;

      // Clear the pending transfer
      this.pendingTransfers.delete(userId);

      // Go directly back to settings
      await this.showSettings(ctx);
    } catch (error) {
      console.error("Error handling transfer amount input:", error);
      ctx.reply("❌ Error setting transfer amount. Please try again.");
    }
  }

  private async handleBuyAmountInput(ctx: any, text: string) {
    try {
      const amount = parseFloat(text);

      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number (e.g., 50, 100, 250):");
        return;
      }

      // Get the button index from the pending transfer
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer) return;

      const buttonIndex = pendingTransfer.assetIndex;
      if (buttonIndex < 1 || buttonIndex > 2) {
        ctx.reply("❌ Invalid button index.");
        return;
      }

      // Update the buy amount
      this.settings.defaultBuyAmounts[buttonIndex - 1] = amount;

      // Clear the pending transfer
      this.pendingTransfers.delete(userId);

      // Go directly back to settings
      await this.showSettings(ctx);
    } catch (error) {
      console.error("Error handling buy amount input:", error);
      ctx.reply("❌ Error setting buy amount. Please try again.");
    }
  }

  private async handleOrderSizeInput(ctx: any, text: string) {
    try {
      const size = parseFloat(text);

      if (isNaN(size) || size <= 0) {
        ctx.reply("❌ Invalid size. Please enter a positive number:");
        return;
      }

      // Get the order data from the pending transfer
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer || !pendingTransfer.orderData) return;

      const { marketId, orderSide, market } = pendingTransfer.orderData;

      // Show order confirmation
      await this.showOrderConfirmation(ctx, marketId, orderSide, market, size);
    } catch (error) {
      console.error("Error handling order size input:", error);
      ctx.reply("❌ Error processing order size. Please try again.");
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

      const message = `*${holding.symbol} Overview*\n\n` +
        `*Name:* ${holding.name}\n` +
        `*Amount:* ${holding.amount}\n` +
        `*Price:* ${holding.price}\n` +
        `*Value:* ${holding.value}\n` +
        `*Type:* ${holding.isCoin ? 'Coin' : 'Fungible Asset'}\n` +
        `*Asset ID:* \`${holding.assetType}\`\n` +
        `*Market Cap:* Coming soon\n` +
        `*24h Change:* Coming soon`;

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

      const message = `*Buy ${holding.symbol}*\n\n` +
        `*Name:* ${holding.name}\n` +
        `*Current Price:* ${holding.price}\n` +
        `*Available Balance:* ${holding.amount} ${holding.symbol}\n\n` +
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

      const message = `*Sell ${holding.symbol}*\n\n` +
        `*Name:* ${holding.name}\n` +
        `*Current Price:* ${holding.price}\n` +
        `*Available Balance:* ${holding.amount} ${holding.symbol}\n` +
        `*Value:* ${holding.value}\n\n` +
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

      const message = `*Transfer ${holding.symbol}*\n\n` +
        `*Available:* ${holding.amount} ${holding.symbol}\n` +
        `*Value:* ${holding.value}\n\n` +
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

      const message = `*Enter Recipient Address*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Available:* ${holding.amount} ${holding.symbol}\n\n` +
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

      const message = `*Address Book*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Available:* ${holding.amount} ${holding.symbol}\n\n` +
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
      const keyboard = new InlineKeyboard();

      // Add percentage buttons based on settings
      this.settings.defaultTransferAmounts.forEach(amount => {
        keyboard.text(`${amount}%`, `amount_${amount}_${pendingTransfer.assetIndex}`);
      });

      keyboard.text("100%", `amount_100_${pendingTransfer.assetIndex}`)
        .row()
        .text("📝 Custom Amount", `custom_amount_${pendingTransfer.assetIndex}`)
        .text("❌ Cancel", `transfer_${pendingTransfer.assetIndex}`);

      const message = `*Enter Transfer Amount*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Recipient:* \`${address}\`\n` +
        `*Available:* ${holding.amount} ${holding.symbol}\n\n` +
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

      const message = `*Enter Custom Amount*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Recipient:* \`${pendingTransfer.recipientAddress}\`\n` +
        `*Available:* ${holding.amount} ${holding.symbol}\n\n` +
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

      const message = `*Confirm Transfer*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Amount:* ${pendingTransfer.amount} ${holding.symbol}\n` +
        `*Recipient:* \`${pendingTransfer.recipientAddress}\`\n` +
        `*Value:* ~$${(parseFloat(pendingTransfer.amount) * (parseFloat(holding.price.replace('$', '')) || 0)).toFixed(2)}\n\n` +
        `⚠️ *This action cannot be undone!*`;

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
      const networkType = getNetworkType();
      const explorerUrl = this.getExplorerUrl(transactionHash);

      const message = `✅ *Transfer Successful!*\n\n` +
        `*Asset:* ${holding.symbol} (${holding.name})\n` +
        `*Amount:* ${pendingTransfer.amount} ${holding.symbol}\n` +
        `*Recipient:* \`${pendingTransfer.recipientAddress}\`\n` +
        `*Transaction:* \`${transactionHash}\`\n` +
        `*Network:* ${networkType}\n\n` +
        `View on [Aptos Explorer](${explorerUrl})`;

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

  private async showMarketSelection(ctx: any) {
    try {
      // Get markets based on current network configuration
      const markets = getMarkets();

      let message = "📊 *Markets*\n\n";
      message += "Select a market to view details and trade:\n\n";

      const keyboard = new InlineKeyboard();

      markets.forEach((market) => {
        keyboard.text(`${market.asset}`, `select_market_${market.market_id}`);
        keyboard.row();
      });

      keyboard.row().text("🔙 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing market selection:", error);
      ctx.reply("❌ Error loading markets. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private async showMarketDetails(ctx: any, marketId: string) {
    try {
      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Fetch detailed market data
      console.log(`🔍 [MARKET_DETAILS] Fetching data for market ${marketId}`);

      const [marketInfo, marketPrice] = await Promise.all([
        this.kanaLabsPerps.getMarketInfo(marketId).catch(err => {
          console.error(`❌ [MARKET_DETAILS] Error fetching market info:`, err.message);
          return { success: false, data: null, message: err.message };
        }),
        this.kanaLabsPerps.getMarketPrice(marketId).catch(err => {
          console.error(`❌ [MARKET_DETAILS] Error fetching market price:`, err.message);
          return { success: false, data: null, message: err.message };
        })
      ]);

      console.log(`🔍 [MARKET_DETAILS] Market info result:`, marketInfo.success ? 'SUCCESS' : 'FAILED');
      console.log(`🔍 [MARKET_DETAILS] Market price result:`, marketPrice.success ? 'SUCCESS' : 'FAILED');

      let message = `📊 *${market.asset}*\n\n`;

      // Show current price information
      if (marketPrice.success && marketPrice.data) {
        // Handle the actual API response structure
        if (marketPrice.data.bestAskPrice && marketPrice.data.bestBidPrice) {
          const midPrice = (marketPrice.data.bestAskPrice + marketPrice.data.bestBidPrice) / 2;
          message += `**Current Price:** $${midPrice.toFixed(3)}\n`;
          message += `Bid: $${marketPrice.data.bestBidPrice} | Ask: $${marketPrice.data.bestAskPrice}\n\n`;
        } else if (marketPrice.data.price) {
          message += `**Current Price:** $${marketPrice.data.price}\n\n`;
                } else {
          message += `**Price:** Data format not recognized\n\n`;
                }
              } else {
        message += `**Price:** Unable to fetch current price\n\n`;
      }


      if (marketInfo.success && marketInfo.data && marketInfo.data.length > 0) {
        const data = marketInfo.data[0];
        if (data) {
          const maxLeverage = data.max_leverage || 'N/A';
          const minLots = data.min_lots || 'N/A';
          const maxLots = data.max_lots || 'N/A';
          const lotSize = data.lot_size || 'N/A';
          const tickSize = data.tick_size || 'N/A';
          const maintenanceMargin = data.maintenance_margin || 'N/A';

          message += `*Trading Parameters*\n`;
          message += `Max Leverage: ${maxLeverage}x\n`;
          message += `Min Order: ${minLots} lots\n`;
          message += `Max Order: ${maxLots} lots\n`;
          message += `Lot Size: ${lotSize}\n`;
          message += `Tick Size: ${tickSize}\n`;
          message += `Maintenance Margin: ${maintenanceMargin}\n\n`;
        }
      }

      const keyboard = new InlineKeyboard()
        .text("🟢 Long (Buy)", `order_type_${marketId}_long`)
        .text("🔴 Short (Sell)", `order_type_${marketId}_short`)
        .row()
        .text("📈 View Chart", `chart_${marketId}`)
        .text("📊 Order Book", `orderbook_${marketId}`)
        .row()
        .text("🔙 Back to Markets", "markets");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
        } catch (error) {
      console.error("Error showing market details:", error);
      ctx.reply("❌ Error loading market details. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showChart(ctx: any, marketId: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      console.log(`🔍 [CHART] Fetching trade data for ${marketId}`);

      // Get current market price and recent trades
      const [marketPrice, recentTrades] = await Promise.all([
        this.kanaLabsPerps.getMarketPrice(marketId).catch(err => {
          console.error(`❌ [CHART] Error fetching market price:`, err.message);
          return { success: false, data: null, message: err.message };
        }),
        this.kanaLabsPerps.getAllTrades(this.APTOS_ADDRESS, marketId).catch(err => {
          console.error(`❌ [CHART] Error fetching trades:`, err.message);
          return { success: false, data: [], message: err.message };
        })
      ]);

      let message = `📈 *${market.asset} - Price Chart*\n\n`;

      // Show current price
      if (marketPrice.success && marketPrice.data) {
        if (marketPrice.data.bestAskPrice && marketPrice.data.bestBidPrice) {
          const midPrice = (marketPrice.data.bestAskPrice + marketPrice.data.bestBidPrice) / 2;
          message += `**Current Price:** $${midPrice.toFixed(3)}\n`;
          message += `Bid: $${marketPrice.data.bestBidPrice} | Ask: $${marketPrice.data.bestAskPrice}\n\n`;
        } else if (marketPrice.data.price) {
          message += `**Current Price:** $${marketPrice.data.price}\n\n`;
        }
      }

      // Show recent trade activity
      if (recentTrades.success && recentTrades.data && recentTrades.data.length > 0) {
        const trades = recentTrades.data.slice(0, 10); // Show last 10 trades
        const totalVolume = trades.reduce((sum, trade) => sum + parseFloat(trade.size), 0);
        const avgPrice = trades.reduce((sum, trade) => sum + parseFloat(trade.price), 0) / trades.length;

        message += `**Recent Activity (Last 10 Trades)**\n`;
        message += `Total Volume: ${totalVolume.toFixed(2)} lots\n`;
        message += `Average Price: $${avgPrice.toFixed(3)}\n\n`;

        message += `**Recent Trades:**\n`;
        trades.slice(0, 5).forEach((trade, index) => {
          const side = trade.side ? '🟢 Long' : '🔴 Short';
          const time = new Date(parseInt(trade.timestamp) * 1000).toLocaleTimeString();
          message += `${index + 1}. ${side} ${trade.size} @ $${trade.price} (${time})\n`;
        });

        if (trades.length > 5) {
          message += `... and ${trades.length - 5} more trades\n`;
        }
      } else {
        message += `**Recent Activity:** No trade data available\n`;
      }

      message += `\n**Note:** This shows recent trade activity.\n`;
      message += `For detailed charts, use external charting tools.`;

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", `chart_${marketId}`)
        .text("🔙 Back to Market", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing chart:", error);
      ctx.reply("❌ Error loading chart. Please try again.");
    }
  }

  private async showOrderBook(ctx: any, marketId: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      console.log(`🔍 [ORDER_BOOK] Fetching market price for ${marketId}`);

      // Get current market price (best bid/ask)
      const marketPrice = await this.kanaLabsPerps.getMarketPrice(marketId).catch(err => {
        console.error(`❌ [ORDER_BOOK] Error fetching market price:`, err.message);
        return { success: false, data: null, message: err.message };
      });

      let message = `📊 *${market.asset} - Order Book*\n\n`;

      if (marketPrice.success && marketPrice.data) {
        if (marketPrice.data.bestAskPrice && marketPrice.data.bestBidPrice) {
          const spread = marketPrice.data.bestAskPrice - marketPrice.data.bestBidPrice;
          const spreadPercent = (spread / marketPrice.data.bestBidPrice) * 100;

          message += `**Current Market Data**\n`;
          message += `Best Bid: $${marketPrice.data.bestBidPrice}\n`;
          message += `Best Ask: $${marketPrice.data.bestAskPrice}\n`;
          message += `Spread: $${spread.toFixed(4)} (${spreadPercent.toFixed(2)}%)\n\n`;

          // Calculate mid price
          const midPrice = (marketPrice.data.bestAskPrice + marketPrice.data.bestBidPrice) / 2;
          message += `Mid Price: $${midPrice.toFixed(3)}\n\n`;
        } else if (marketPrice.data.price) {
          message += `**Current Price:** $${marketPrice.data.price}\n\n`;
        } else {
          message += `**Price Data:** Format not recognized\n\n`;
        }
      } else {
        message += `**Price Data:** Unable to fetch\n\n`;
      }

      message += `**Note:** Full order book depth is not available.\n`;
      message += `This shows the best bid/ask prices only.`;

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", `orderbook_${marketId}`)
        .text("🔙 Back to Market", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing order book:", error);
      ctx.reply("❌ Error loading order book. Please try again.");
    }
  }

  private async showOrderSizeInput(ctx: any, marketId: string, orderSide: string) {
    try {
      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      let message = `🎯 *Create Order - ${market.asset}*\n\n`;
      message += `Market: ${market.asset}\n`;
      message += `Side: ${sideEmoji} ${sideText}\n\n`;
      message += `Enter order size (amount in USDT):\n`;
      message += `Example: 100 (for $100 USDT)`;

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

      // Store the order context for this user
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.set(userId, {
          assetIndex: -1,
          step: 'order_size_input',
          orderData: { marketId, orderSide, market }
        });
          }
        } catch (error) {
      console.error("Error showing order size input:", error);
      ctx.reply("❌ Error loading order form. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "create_order")
      });
    }
  }

  private async showOrderConfirmation(ctx: any, marketId: string, orderSide: string, market: any, size: number) {
    try {
      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      let message = `🎯 *Order Confirmation*\n\n`;
      message += `Market: ${market.asset}\n`;
      message += `Side: ${sideEmoji} ${sideText}\n`;
      message += `Size: $${size} USDT\n`;
      message += `Type: Market Order\n`;
      message += `Leverage: 1x (default)\n\n`;
      message += `⚠️ *This will place a market order immediately!*`;

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Order", `confirm_order_${marketId}_${orderSide}_${size}`)
        .text("❌ Cancel", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing order confirmation:", error);
      ctx.reply("❌ Error loading confirmation. Please try again.");
    }
  }

  private async executeOrder(ctx: any, marketId: string, orderSide: string, size: number) {
    try {
      // Show processing message
      await ctx.reply("🔄 Placing order... Please wait.");

      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Place order using Kana Labs API
      const orderResult = await this.kanaLabsPerps.placeMarketOrder({
        marketId: marketId,
        side: orderSide === 'long', // true for long, false for short
        size: size.toString(),
        orderType: 'market'
      });

      // Clear any pending order data
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

      if (orderResult.success) {
        const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
        const sideText = orderSide === 'long' ? 'Long' : 'Short';

        const message = `✅ *Order Placed Successfully!*\n\n` +
          `Market: ${market.asset}\n` +
          `Side: ${sideEmoji} ${sideText}\n` +
          `Size: $${size} USDT\n` +
          `Type: Market Order\n\n` +
          `Your order has been submitted to the market.`;

        const keyboard = new InlineKeyboard()
          .text("📊 View Positions", "positions")
          .text("📋 View Orders", "open_orders")
          .row()
          .text("🔙 Back to Home", "start");

        ctx.reply(message, {
          parse_mode: "Markdown",
          reply_markup: keyboard
        });
            } else {
        ctx.reply(`❌ Order failed: ${orderResult.message || 'Unknown error'}`, {
          reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "create_order")
        });
      }

  } catch (error) {
      console.error("Error executing order:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Order failed: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "create_order")
      });
    }
  }

  private getMarketIds(): string[] {
    return getMarkets().map(market => market.market_id);
  }

  private async getAvailableMarkets() {
    // Try to fetch from API first, fallback to hardcoded
    try {
      console.log(`🔍 [MARKETS] Fetching available markets from API...`);
      // Note: The API doesn't have a direct "get all markets" endpoint
      // So we'll use the configured markets for the current network
      const configuredMarkets = getMarkets();
      const knownMarkets = configuredMarkets.map(market => ({
        market_id: market.market_id,
        base_name: market.asset,
        max_leverage: "20", // Default leverage
        min_lots: "100" // Default min lots
      }));

      console.log(`🔍 [MARKETS] Using configured markets for ${isTestnet() ? 'testnet' : 'mainnet'}:`, knownMarkets);
      return knownMarkets;
    } catch (error) {
      console.error(`❌ [MARKETS] Error fetching markets, using fallback:`, error);
      // Fallback to hardcoded markets
      return [
        {
          market_id: "501",
          base_name: "APT/USDC",
          max_leverage: "20",
          min_lots: "500"
        },
        {
          market_id: "502",
          base_name: "BTC/USDC",
          max_leverage: "10",
          min_lots: "100"
        }
      ];
    }
  }

  private async showDepositAmountPrompt(ctx: any) {
    try {
      // Get current wallet balance for percentage calculations
      const walletBalance = await this.kanaLabsPerps.getWalletAccountBalance(this.APTOS_ADDRESS).catch(err => {
        console.error(`❌ Error fetching wallet balance:`, err.message);
        return { success: false, data: "0", message: err.message };
      });

      const balance = walletBalance.success ? parseFloat(walletBalance.data) : 0;

      const message = "💰 *Deposit USDT*\n\n" +
        `**Current Wallet Balance:** ${balance.toFixed(2)} USDT\n\n` +
        "Choose deposit amount:";

      const keyboard = new InlineKeyboard()
        .text("25%", "deposit_25")
        .text("50%", "deposit_50")
        .row()
        .text("75%", "deposit_75")
        .text("100%", "deposit_100")
        .row()
        .text("Custom USDT", "deposit_custom")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing deposit amount prompt:", error);
      ctx.reply("❌ Error loading deposit prompt. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private async handleDepositPercentage(ctx: any, percentage: number) {
    try {
      // Get current wallet balance
      const walletBalance = await this.kanaLabsPerps.getWalletAccountBalance(this.APTOS_ADDRESS).catch(err => {
        console.error(`❌ Error fetching wallet balance:`, err.message);
        return { success: false, data: "0", message: err.message };
      });

      const balance = walletBalance.success ? parseFloat(walletBalance.data) : 0;
      const amount = (balance * percentage).toFixed(2);

      // Show confirmation directly
      await this.showDepositConfirmation(ctx, amount);
    } catch (error) {
      console.error("Error handling deposit percentage:", error);
      ctx.reply("❌ Error calculating deposit amount. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Deposit", "deposit")
      });
    }
  }

  private async promptDepositCustomAmount(ctx: any) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      // Set pending state for custom amount input
      this.pendingDeposits.set(userId, {
        step: "custom_amount"
      });

      const message = "💰 *Custom Deposit Amount*\n\n" +
        "Enter the exact USDT amount you want to deposit:\n" +
        "(e.g., 50, 100.5, 250.75)";

      const keyboard = new InlineKeyboard()
        .text("🔙 Back to Deposit", "deposit");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error prompting custom deposit amount:", error);
      ctx.reply("❌ Error loading custom amount prompt. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Deposit", "deposit")
      });
    }
  }

  private async handleDepositCustomAmountInput(ctx: any, amountText: string) {
    try {
      const amount = parseFloat(amountText);

      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number.");
        return;
      }

      // Show confirmation directly
      await this.showDepositConfirmation(ctx, amount.toFixed(2));
    } catch (error) {
      console.error("Error handling custom deposit amount:", error);
      ctx.reply("❌ Error processing deposit amount. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Deposit", "deposit")
      });
    }
  }

  private async handleWithdrawPercentage(ctx: any, percentage: number) {
    try {
      // Get current trading account balance
      const profileBalance = await this.kanaLabsPerps.getProfileBalanceSnapshot(this.APTOS_ADDRESS).catch(err => {
        console.error(`❌ Error fetching profile balance:`, err.message);
        return { success: false, data: "0", message: err.message };
      });

      const balance = profileBalance.success ? parseFloat(profileBalance.data) : 0;
      const amount = (balance * percentage).toFixed(2);

      // Show confirmation directly
      await this.showWithdrawConfirmation(ctx, { amount });
    } catch (error) {
      console.error("Error handling withdraw percentage:", error);
      ctx.reply("❌ Error calculating withdraw amount. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Withdraw", "withdraw")
      });
    }
  }

  private async promptWithdrawCustomAmount(ctx: any) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      // Set pending state for custom amount input
      this.pendingDeposits.set(userId, {
        step: "custom_withdraw_amount"
      });

      const message = "📤 *Custom Withdraw Amount*\n\n" +
        "Enter the exact USDT amount you want to withdraw:\n" +
        "(e.g., 50, 100.5, 250.75)";

      const keyboard = new InlineKeyboard()
        .text("🔙 Back to Withdraw", "withdraw");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error prompting custom withdraw amount:", error);
      ctx.reply("❌ Error loading custom amount prompt. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Withdraw", "withdraw")
      });
    }
  }

  private async handleWithdrawCustomAmountInput(ctx: any, amountText: string) {
    try {
      const amount = parseFloat(amountText);

      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number.");
        return;
      }

      // Show confirmation directly
      await this.showWithdrawConfirmation(ctx, { amount: amount.toFixed(2) });
    } catch (error) {
      console.error("Error handling custom withdraw amount:", error);
      ctx.reply("❌ Error processing withdraw amount. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Withdraw", "withdraw")
      });
    }
  }


  private async showDepositConfirmation(ctx: any, amount: string) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      // Store the amount for execution
      this.pendingDeposits.set(userId, {
        step: "confirmation",
        amount: amount
      });

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Deposit", "confirm_deposit")
        .text("❌ Cancel", "deposit");

      const message = `📥 *Confirm Deposit*\n\n` +
        `*Amount:* ${amount} USDT\n\n` +
        `⚠️ *This will deposit USDT to your Kana Labs trading account!*`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing deposit confirmation:", error);
      ctx.reply("❌ Error loading confirmation. Please try again.");
    }
  }

  private async executeDeposit(ctx: any) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      const pendingDeposit = this.pendingDeposits.get(userId);
      if (!pendingDeposit) {
        ctx.reply("❌ Error: Deposit session expired. Please start over.");
        return;
      }

      // Show processing message
      await ctx.reply("🔄 Processing deposit... Please wait.");

      // Call Kana Labs deposit API to get transaction payload
      const depositResult = await this.kanaLabsPerps.deposit({
        amount: pendingDeposit.amount || '0',
        userAddress: this.APTOS_ADDRESS
      });

      if (!depositResult.success) {
        throw new Error(depositResult.message);
      }

      // Convert Kana Labs payload to Aptos format
      const transactionPayload = depositResult.data;
      const aptosPayload : InputEntryFunctionData = {
        function: transactionPayload.function as MoveFunctionId,
        functionArguments: transactionPayload.functionArguments,
        typeArguments: transactionPayload.typeArguments
      };

      // Build the transaction
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.APTOS_ADDRESS,
        data: aptosPayload
      });

      // Sign and submit the transaction
      const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
        transaction: transaction,
        signer: this.aptosAccount,
      });

      // Wait for transaction confirmation
      await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      });

      // Clear pending deposit
      this.pendingDeposits.delete(userId);

      // Show success message
      const message = `✅ *Deposit Successful!*\n\n` +
        `*Amount:* ${pendingDeposit.amount} USDT\n` +
        `*Transaction Hash:* \`${committedTxn.hash}\`\n\n` +
        `Your deposit has been processed successfully!`;

      const keyboard = new InlineKeyboard()
        .text(" Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      console.error("Error executing deposit:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Deposit failed: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Deposit", "deposit")
      });
    }
  }

  private async showWithdrawMenu(ctx: any) {
    try {
      // Get current account balances
      const [walletBalance, profileBalance] = await Promise.all([
        this.kanaLabsPerps.getWalletAccountBalance(this.APTOS_ADDRESS).catch(err => {
          console.error(`❌ Error fetching wallet balance:`, err.message);
          return { success: false, data: "0", message: err.message };
        }),
        this.kanaLabsPerps.getProfileBalanceSnapshot(this.APTOS_ADDRESS).catch(err => {
          console.error(`❌ Error fetching profile balance:`, err.message);
          return { success: false, data: "0", message: err.message };
        })
      ]);

      const tradingBalance = profileBalance.success ? parseFloat(profileBalance.data) : 0;

      let message = "📤 *Withdraw from Kana Labs Perps*\n\n";
      message += "**Current Account Balances:**\n";
      message += `Wallet: ${walletBalance.success ? walletBalance.data : 'N/A'} USDT\n`;
      message += `Trading Account: ${profileBalance.success ? profileBalance.data : 'N/A'} USDT\n\n`;
      message += "Choose withdraw amount:";

      const keyboard = new InlineKeyboard()
        .text("25%", "withdraw_25")
        .text("50%", "withdraw_50")
        .row()
        .text("75%", "withdraw_75")
        .text("100%", "withdraw_100")
        .row()
        .text("Custom USDT", "withdraw_custom")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing withdraw menu:", error);
      ctx.reply("❌ Error loading withdraw options. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private async showWithdrawAmountPrompt(ctx: any) {
    try {
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingDeposits.set(userId, {
          step: 'withdraw_amount'
        });
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", "withdraw");

      const message = `📤 *Withdraw from Kana Labs Trading Account*\n\n` +
        `Please enter the amount in USDT to withdraw:\n` +
        `(Enter a number, e.g., 50, 100, 250)\n\n` +
        `This will move USDT from your trading account to your wallet.`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing withdraw amount prompt:", error);
      ctx.reply("❌ Error loading withdraw form. Please try again.");
    }
  }

  private async handleWithdrawAmountInput(ctx: any, pendingDeposit: any, amountText: string) {
    try {
      const amount = parseFloat(amountText);

      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number (e.g., 50, 100, 250):");
        return;
      }

      // Show confirmation with new format
      await this.showWithdrawConfirmation(ctx, { amount: amountText });
    } catch (error) {
      console.error("Error handling withdraw amount input:", error);
      ctx.reply("❌ Error processing withdraw amount. Please try again.");
    }
  }

  private async showWithdrawConfirmation(ctx: any, data: { amount: string }) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      // Store the amount for execution
      this.pendingDeposits.set(userId, {
        step: "confirmation",
        amount: data.amount
      });

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Withdraw", "confirm_withdraw")
        .text("❌ Cancel", "withdraw");

      const message = `📤 *Confirm Withdraw*\n\n` +
        `*Amount:* ${data.amount} USDT\n\n` +
        `⚠️ *This will withdraw USDT from your Kana Labs trading account!*`;

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing withdraw confirmation:", error);
      ctx.reply("❌ Error loading withdraw confirmation. Please try again.");
    }
  }

  private async executeWithdraw(ctx: any) {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        ctx.reply("❌ Error: User not found.");
        return;
      }

      const pendingDeposit = this.pendingDeposits.get(userId);
      if (!pendingDeposit) {
        ctx.reply("❌ Error: Withdraw session expired. Please start over.");
        return;
      }

      // Show processing message
      await ctx.reply("🔄 Processing withdraw... Please wait.");

      // Get all market IDs for current network
      const marketIds = this.getMarketIds();

      // Call Kana Labs withdraw API to get transaction payload
      const withdrawResult = await this.kanaLabsPerps.withdraw({
        amount: pendingDeposit.amount || '0',
        userAddress: this.APTOS_ADDRESS,
        marketIds: marketIds.join(','),
      });

      if (!withdrawResult.success) {
        throw new Error(withdrawResult.message);
      }

      // Convert Kana Labs payload to Aptos format
      const transactionPayload = withdrawResult.data;
      const aptosPayload : InputEntryFunctionData = {
        function: transactionPayload.function as MoveFunctionId,
        functionArguments: transactionPayload.functionArguments,
        typeArguments: transactionPayload.typeArguments
      };

      // Build the transaction
      const transaction = await this.aptos.transaction.build.simple({
        sender: this.APTOS_ADDRESS,
        data: aptosPayload
      });

      // Sign and submit the transaction
      const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
        transaction: transaction,
        signer: this.aptosAccount,
      });

      // Wait for transaction confirmation
      await this.aptos.waitForTransaction({
        transactionHash: committedTxn.hash,
      });

      // Clear pending deposit
      this.pendingDeposits.delete(userId);

      // Show success message
      const message = `✅ *Withdraw Successful!*\n\n` +
        `*Amount:* ${pendingDeposit.amount} USDT\n` +
        `*Transaction Hash:* \`${committedTxn.hash}\`\n\n` +
        `Your withdraw has been processed successfully!`;

      const keyboard = new InlineKeyboard()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      console.error("Error executing withdraw:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Withdraw failed: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Withdraw", "withdraw")
      });
    }
  }


  private async executeFaucet(ctx: any) {
    try {
      // Get the faucet payload
      const faucetPayload = this.kanaLabsPerps.getUSDTFaucetPayload();

      // Create private key and account
      const privateKey = new Ed25519PrivateKey(getAptosPrivateKey());
      const account = Account.fromPrivateKey({ privateKey });

      // Build faucet transaction
      const transaction = await this.aptos.transaction.build.simple({
        sender: account.accountAddress,
        data: faucetPayload,
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

      // Show success message
      const explorerUrl = this.getExplorerUrl(pendingTransaction.hash);

      const message = `✅ *USDT Faucet Successful!*\n\n` +
        `*Amount:* 1000 USDT\n\n` +
        `View on [Aptos Explorer](${explorerUrl})`;

      const keyboard = new InlineKeyboard()
        .text("📊 Back to Home", "start");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

    } catch (error) {
      console.error("Error executing faucet:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Faucet failed: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private getExplorerUrl(transactionHash: string): string {
    const networkType = getNetworkType();
    return `https://explorer.aptoslabs.com/txn/${transactionHash}?network=${networkType}`;
  }

  private async showPositions(ctx: any) {
    try {
      const userAddress = getAptosAddress();
      console.log(`🔍 [POSITIONS] Starting positions fetch for address: ${userAddress}`);

      // Show loading message
      await ctx.reply("🔄 Loading your positions...");

      // Get all available markets first
      const markets = await this.getAvailableMarkets();
      console.log(`🔍 [POSITIONS] Found ${markets.length} markets:`, markets.map(m => `${m.base_name} (${m.market_id})`));

      // Get positions for all markets
      const allPositions = [];
      for (const market of markets) {
        try {
          console.log(`🔍 [POSITIONS] Fetching positions for market ${market.market_id} (${market.base_name})`);
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          console.log(`🔍 [POSITIONS] API response for market ${market.market_id}:`, {
            success: positionsResult.success,
            dataLength: positionsResult.data?.length || 0,
            data: positionsResult.data
          });

          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
            console.log(`🔍 [POSITIONS] Added ${positionsWithMarket.length} positions for market ${market.market_id}`);
          } else {
            console.log(`🔍 [POSITIONS] No positions found for market ${market.market_id}`);
          }
  } catch (error) {
          console.error(`❌ [POSITIONS] Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      console.log(`🔍 [POSITIONS] Total positions found: ${allPositions.length}`, allPositions);

      if (allPositions.length === 0) {
        const message = "📈 *Your Positions*\n\n" +
          "You currently have no open positions.\n\n" +
          "Start trading by depositing funds and placing orders!";

        const keyboard = new InlineKeyboard()
          .text("💰 Deposit Funds", "deposit")
          .text("📊 Markets", "markets")
          .row()
          .text("🔙 Back to Home", "start");

        ctx.reply(message, { reply_markup: keyboard });
        return;
      }

      // Format positions message
      let message = "📈 *Your Positions*\n\n";

      for (const position of allPositions) {
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";
        const pnl = parseFloat(position.pnl || "0");
        const pnlEmoji = pnl >= 0 ? "📈" : "📉";
        const pnlSign = pnl >= 0 ? "+" : "";

        message += `${sideEmoji} *${position.market_name}* ${side}\n`;
        message += `   Size: ${position.size} | Available: ${position.available_order_size || position.size}\n`;
        message += `   Entry: $${position.entry_price} | Current: $${position.price || 'N/A'}\n`;
        message += `   Value: $${position.value} | Margin: $${position.margin}\n`;
        message += `   PnL: ${pnlEmoji} ${pnlSign}$${pnl.toFixed(2)}\n`;

        // Show Take Profit and Stop Loss if set
        if (position.tp && position.tp !== "0") {
          message += `   Take Profit: $${position.tp}\n`;
        }
        if (position.sl && position.sl !== "0") {
          message += `   Stop Loss: $${position.sl}\n`;
        }
        if (position.liq_price && position.liq_price !== "0") {
          message += `   Liq Price: $${position.liq_price}\n`;
        }
        if (position.trade_id) {
          message += `   Trade ID: \`${position.trade_id}\`\n`;
        }
        message += "\n";
      }

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", "positions")
        .text("📊 Open Orders", "open_orders")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, { reply_markup: keyboard });

    } catch (error) {
      console.error("Error showing positions:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error loading positions: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private async showOpenOrders(ctx: any) {
    try {
      const userAddress = getAptosAddress();
      console.log(`🔍 [ORDERS] Starting orders fetch for address: ${userAddress}`);

      // Show loading message
      await ctx.reply("🔄 Loading your open orders...");

      // Get all available markets first
      const markets = await this.getAvailableMarkets();
      console.log(`🔍 [ORDERS] Found ${markets.length} markets:`, markets.map(m => `${m.base_name} (${m.market_id})`));

      // Get open orders for all markets
      const allOrders = [];
      for (const market of markets) {
        try {
          console.log(`🔍 [ORDERS] Fetching orders for market ${market.market_id} (${market.base_name})`);
          const ordersResult = await this.kanaLabsPerps.getOpenOrders(userAddress, market.market_id);
          console.log(`🔍 [ORDERS] API response for market ${market.market_id}:`, {
            success: ordersResult.success,
            dataLength: ordersResult.data?.length || 0,
            data: ordersResult.data
          });

          if (ordersResult.success && ordersResult.data.length > 0) {
            const ordersWithMarket = ordersResult.data.map(order => ({ ...order, market_name: market.base_name }));
            allOrders.push(...ordersWithMarket);
            console.log(`🔍 [ORDERS] Added ${ordersWithMarket.length} orders for market ${market.market_id}`);
          } else {
            console.log(`🔍 [ORDERS] No orders found for market ${market.market_id}`);
          }
  } catch (error) {
          console.error(`❌ [ORDERS] Error fetching orders for market ${market.market_id}:`, error);
        }
      }

      console.log(`🔍 [ORDERS] Total orders found: ${allOrders.length}`, allOrders);

      if (allOrders.length === 0) {
        const message = "📊 *Your Open Orders*\n\n" +
          "You currently have no open orders.\n\n" +
          "Place your first order to start trading!";

        const keyboard = new InlineKeyboard()
          .text("💰 Deposit Funds", "deposit")
          .text("📈 Positions", "positions")
          .row()
          .text("🔙 Back to Home", "start");

        ctx.reply(message, { reply_markup: keyboard });
        return;
      }

      // Format orders message
      let message = "📊 *Your Open Orders*\n\n";

      for (const order of allOrders) {
        const orderType = this.getOrderTypeName(order.order_type);
        // Determine side based on order type rather than trade_side
        const isLongOrder = [1, 3, 5, 7].includes(order.order_type); // OPEN_LONG, INCREASE_LONG, DECREASE_LONG, CLOSE_LONG
        const side = isLongOrder ? "LONG" : "SHORT";
        const sideEmoji = isLongOrder ? "🟢" : "🔴";

        // Calculate filled amount
        const totalSize = parseFloat(order.total_size);
        const remainingSize = parseFloat(order.remaining_size);
        const filledSize = totalSize - remainingSize;
        const filledPercentage = totalSize > 0 ? ((filledSize / totalSize) * 100).toFixed(1) : "0";

        message += `${sideEmoji} *${order.market_name}* ${side}\n`;
        message += `   Type: ${orderType} | Size: ${order.total_size}\n`;
        message += `   Remaining: ${order.remaining_size} | Filled: ${filledSize.toFixed(4)} (${filledPercentage}%)\n`;
        message += `   Price: $${order.price} | Value: $${order.order_value}\n`;
        message += `   Leverage: ${order.leverage}x\n`;
        message += `   Order ID: \`${order.order_id}\`\n`;
        if (order.trade_id) {
          message += `   Trade ID: \`${order.trade_id}\`\n`;
        }
        if (order.timestamp) {
          message += `   Placed: ${new Date(order.timestamp * 1000).toLocaleString()}\n`;
        }
        if (order.last_updated && order.last_updated !== order.timestamp) {
          message += `   Updated: ${new Date(order.last_updated * 1000).toLocaleString()}\n`;
        }
        message += "\n";
      }

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", "open_orders")
        .text("📈 Positions", "positions")
        .row()
        .text("🔙 Back to Home", "start");

      ctx.reply(message, { reply_markup: keyboard });

    } catch (error) {
      console.error("Error showing open orders:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error loading open orders: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Home", "start")
      });
    }
  }

  private getOrderTypeName(orderType: number): string {
    const orderTypes: Record<number, string> = {
      1: "OPEN_LONG",
      2: "OPEN_SHORT",
      3: "INCREASE_LONG",
      4: "INCREASE_SHORT",
      5: "DECREASE_LONG",
      6: "DECREASE_SHORT",
      7: "CLOSE_LONG",
      8: "CLOSE_SHORT"
    };
    return orderTypes[orderType] || `UNKNOWN_${orderType}`;
  }

  private async showExportPrivateKeyWarning(ctx: any) {
    const message = `⚠️ *SECURITY WARNING* ⚠️\n\n` +
      `*You are about to export your private key!*\n\n` +
      `🚨 *DANGER:*\n` +
      `• Never share your private key with anyone\n` +
      `• Anyone with this key can access your wallet\n` +
      `• This action cannot be undone\n` +
      `• Make sure you're in a secure environment\n\n` +
      `*Are you absolutely sure you want to continue?*`;

    const keyboard = new InlineKeyboard()
      .text("✅ Yes, I understand the risks", "confirm_export_private_key")
      .row()
      .text("❌ Cancel", "wallet");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  }

  private async exportPrivateKey(ctx: any) {
    try {
      const privateKey = getAptosPrivateKey();

      const message = `🔑 *Your Private Key*\n\n` +
        `*Address:* \`${getAptosAddress()}\`\n\n` +
        `*Private Key:*\n\`\`\`\n${privateKey}\n\`\`\`\n\n` +
        `⚠️ *Keep this private key secure!*\n` +
        `• Store it in a safe place\n` +
        `• Never share it with anyone\n` +
        `• Anyone with this key can control your wallet`;

      const keyboard = new InlineKeyboard()
        .text("🔙 Back to Wallet", "wallet");

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error exporting private key:", error);
      ctx.reply("❌ Error exporting private key. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Wallet", "wallet")
      });
    }
  }

  private async debugApiConnection(ctx: any) {
    try {
      const userAddress = getAptosAddress();
      const kanaConfig = getKanaLabsConfig();

      let debugMessage = "🔍 *API Debug Information*\n\n";
      debugMessage += `*User Address:* \`${userAddress}\`\n`;
      debugMessage += `*API Base URL:* \`${kanaConfig.baseUrl}\`\n`;
      debugMessage += `*API Key:* \`${kanaConfig.apiKey ? 'Set' : 'Not Set'}\`\n\n`;

      // Test API connection with a simple call
      debugMessage += "*Testing API calls...*\n";

      try {
        // Test market info for APT/USDC
        const marketInfo = await this.kanaLabsPerps.getMarketInfo("501");
        debugMessage += `✅ Market Info (501): ${marketInfo.success ? 'Success' : 'Failed'}\n`;
        if (marketInfo.success) {
          debugMessage += `   Data: ${JSON.stringify(marketInfo.data).substring(0, 100)}...\n`;
        }
  } catch (error) {
        debugMessage += `❌ Market Info Error: ${error}\n`;
      }

      try {
        // Test positions
        const positions = await this.kanaLabsPerps.getPositions(userAddress, "501");
        debugMessage += `✅ Positions (501): ${positions.success ? 'Success' : 'Failed'}\n`;
        debugMessage += `   Count: ${positions.data?.length || 0}\n`;
      } catch (error) {
        debugMessage += `❌ Positions Error: ${error}\n`;
      }

      try {
        // Test orders
        const orders = await this.kanaLabsPerps.getOpenOrders(userAddress, "501");
        debugMessage += `✅ Orders (501): ${orders.success ? 'Success' : 'Failed'}\n`;
        debugMessage += `   Count: ${orders.data?.length || 0}\n`;
      } catch (error) {
        debugMessage += `❌ Orders Error: ${error}\n`;
      }

      debugMessage += "\n*Testing Balance Endpoints...*\n";

      try {
        // Test wallet balance
        const walletBalance = await this.kanaLabsPerps.getWalletAccountBalance(userAddress);
        debugMessage += `✅ Wallet Balance: ${walletBalance.success ? 'Success' : 'Failed'}\n`;
        const walletAmount = walletBalance.success ? parseFloat(walletBalance.data).toFixed(2) : walletBalance.data;
        debugMessage += `   Value: ${walletAmount}\n`;
      } catch (error) {
        debugMessage += `❌ Wallet Balance Error: ${error}\n`;
      }

      try {
        // Test profile balance
        const profileBalance = await this.kanaLabsPerps.getProfileBalanceSnapshot(userAddress);
        debugMessage += `✅ Profile Balance: ${profileBalance.success ? 'Success' : 'Failed'}\n`;
        const profileAmount = profileBalance.success ? parseFloat(profileBalance.data).toFixed(2) : profileBalance.data;
        debugMessage += `   Value: ${profileAmount}\n`;
      } catch (error) {
        debugMessage += `❌ Profile Balance Error: ${error}\n`;
      }

      try {
        // Test APT balance
        const aptBalance = await this.kanaLabsPerps.getAccountAptBalance(userAddress);
        debugMessage += `✅ APT Balance: ${aptBalance.success ? 'Success' : 'Failed'}\n`;
        const aptAmount = aptBalance.success ? parseFloat(aptBalance.data.toString()).toFixed(2) : aptBalance.data;
        debugMessage += `   Value: ${aptAmount}\n`;
      } catch (error) {
        debugMessage += `❌ APT Balance Error: ${error}\n`;
      }

      try {
        // Test net profile balance
        const netProfileBalance = await this.kanaLabsPerps.getNetProfileBalance(userAddress);
        debugMessage += `✅ Net Profile Balance: ${netProfileBalance.success ? 'Success' : 'Failed'}\n`;
        const netProfileAmount = netProfileBalance.success ? parseFloat(netProfileBalance.data).toFixed(2) : netProfileBalance.data;
        debugMessage += `   Value: ${netProfileAmount}\n`;
      } catch (error) {
        debugMessage += `❌ Net Profile Balance Error: ${error}\n`;
      }

      ctx.reply(debugMessage, { parse_mode: "Markdown" });

    } catch (error) {
      console.error("Debug error:", error);
      ctx.reply(`❌ Debug failed: ${error}`);
    }
  }

  private async getRealBalances(): Promise<Record<number, any>> {
    try {
      console.log(`🔍 Fetching balances for address: ${this.APTOS_ADDRESS}`);

      // Use the Holdings Fetcher
      const fetcher = createHoldingsFetcher({
        networkUrl: getAptosNetworkUrl(),
        indexerUrl: getAptosIndexerUrl()
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
    console.log("🤖 Aptos Perps Telegram Bot started!");
  }

  // Voting functionality
  private async createVotingPoll(ctx: any, action: string, data: any): Promise<boolean> {
    try {
      // Check if we're in a group chat
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return true; // Skip voting in private chats
      }

      const pollId = `vote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const question = this.getVotingQuestion(action, data);

      // Create poll
      const poll = await ctx.replyWithPoll(question, [
        "✅ Approve",
        "❌ Reject"
      ], {
        is_anonymous: false,
        type: "regular",
        open_period: this.settings.votingTimePeriod
      });

      // Store pending vote
      this.pendingVotes.set(pollId, {
        pollId: poll.poll.id,
        action,
        data,
        voters: new Set(),
        startTime: Date.now()
      });

      // Set up poll result handler
      this.setupPollResultHandler(pollId);

      return false; // Voting in progress
    } catch (error) {
      console.error("Error creating voting poll:", error);
      return true; // Skip voting on error
    }
  }

  private getVotingQuestion(action: string, data: any): string {
    switch (action) {
      case 'transfer':
        return `🗳️ *Vote Required: Transfer ${data.symbol}*\n\n` +
          `Amount: ${data.amount} ${data.symbol}\n` +
          `To: \`${data.recipientAddress}\`\n` +
          `Value: ~$${data.value}\n\n` +
          `Vote to approve or reject this transfer.`;

      case 'deposit':
        return `🗳️ *Vote Required: Deposit to ${data.marketName}*\n\n` +
          `Amount: ${data.amount} USDT\n` +
          `Market: ${data.marketName}\n` +
          `Max Leverage: ${data.maxLeverage}x\n\n` +
          `Vote to approve or reject this deposit.`;

      case 'order':
        return `🗳️ *Vote Required: Create Order*\n\n` +
          `Type: ${data.orderType}\n` +
          `Market: ${data.marketName}\n` +
          `Size: ${data.size}\n` +
          `Price: $${data.price}\n\n` +
          `Vote to approve or reject this order.`;

      default:
        return `🗳️ *Vote Required: ${action}*\n\n` +
          `Please vote to approve or reject this action.`;
    }
  }

  private setupPollResultHandler(pollId: string) {
    // Set up a timeout to check poll results
    setTimeout(async () => {
      await this.checkPollResults(pollId);
    }, this.settings.votingTimePeriod * 1000 + 5000); // Add 5 second buffer
  }

  private async checkPollResults(pollId: string) {
    try {
      const voteData = this.pendingVotes.get(pollId);
      if (!voteData) return;

      // Get poll results (this would need to be implemented with Telegram Bot API)
      // For now, we'll simulate the check
      const totalVotes = voteData.voters.size;
      const approvalVotes = Math.floor(totalVotes * 0.6); // Simulate 60% approval

      // Only check threshold percentage (no minimum vote requirement)
      const approved = totalVotes > 0 && (approvalVotes / totalVotes) >= this.settings.votingThreshold;

      if (approved) {
        await this.executeApprovedAction(voteData);
      } else {
        await this.notifyVoteRejected(voteData);
      }

      // Clean up
      this.pendingVotes.delete(pollId);
    } catch (error) {
      console.error("Error checking poll results:", error);
    }
  }

  private async executeApprovedAction(voteData: any) {
    try {
      // This would execute the approved action
      console.log(`✅ Vote approved for action: ${voteData.action}`, voteData.data);
      // Implementation would depend on the specific action
    } catch (error) {
      console.error("Error executing approved action:", error);
    }
  }

  private async notifyVoteRejected(voteData: any) {
    try {
      console.log(`❌ Vote rejected for action: ${voteData.action}`, voteData.data);
      // Implementation would notify users of rejection
    } catch (error) {
      console.error("Error notifying vote rejection:", error);
    }
  }
}