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
  private pendingTransfers: Map<number, { assetIndex?: number; step?: string; type?: string; recipientAddress?: string; amount?: string; orderData?: { marketId: string; orderSide: string; market: any; limitPrice?: number }; tradeId?: string; marketId?: string; tradeSide?: boolean; orderSide?: string; leverage?: string; currentPrice?: number }> = new Map();
  private pendingDeposits: Map<number, { step: string; amount?: string }> = new Map();
  private pendingVotes: Map<string, { pollId: string; action: string; data: any; voters: Set<number>; startTime: number }> = new Map();
  private pendingPolls: Map<string, { pollId: string; action: string; data: any; voters: Map<number, number>; startTime: number; requiredVotes: number; chatId: number; messageId: number }> = new Map();

  // Settings storage (in production, this would be in a database)
  // TODO: Move to database
  private settings = {
    disableConfirmation: false,
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
        } else if (pendingTransfer.step === 'min_display_input') {
          await this.handleMinDisplayInput(ctx, text);
      } else if (pendingTransfer.step === 'voting_time_input') {
        await this.handleVotingTimeInput(ctx, text);
      } else if (pendingTransfer.step === 'voting_threshold_input') {
        await this.handleVotingThresholdInput(ctx, text);
      } else if (pendingTransfer.step === 'order_size_input') {
        await this.handleOrderSizeInput(ctx, text);
      } else if (pendingTransfer.step === 'custom_leverage_input') {
        await this.handleCustomLeverageInput(ctx, text);
      } else if (pendingTransfer.type === 'set_take_profit') {
        await this.handleTakeProfitInput(ctx, pendingTransfer, text);
      } else if (pendingTransfer.type === 'set_stop_loss') {
        await this.handleStopLossInput(ctx, pendingTransfer, text);
      } else if (pendingTransfer.type === 'add_margin') {
        await this.handleAddMarginInput(ctx, pendingTransfer, text);
      } else if (pendingTransfer.type === 'limit_price_input') {
        await this.handleLimitPriceInput(ctx, pendingTransfer, text);
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
        return;
      }
    });

    // Handle callback queries
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;

      if (data === "settings") {
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
      } else if (data.startsWith("position_details_")) {
        const tradeId = data.replace("position_details_", "");
        await this.showPositionDetails(ctx, tradeId);
      } else if (data.startsWith("close_position_")) {
        const tradeId = data.replace("close_position_", "");
        await this.closePosition(ctx, tradeId);
      } else if (data.startsWith("add_margin_")) {
        const tradeId = data.replace("add_margin_", "");
        await this.addMarginPrompt(ctx, tradeId);
      } else if (data.startsWith("set_tp_")) {
        const tradeId = data.replace("set_tp_", "");
        await this.setTakeProfitPrompt(ctx, tradeId);
      } else if (data.startsWith("set_sl_")) {
        const tradeId = data.replace("set_sl_", "");
        await this.setStopLossPrompt(ctx, tradeId);
      } else if (data.startsWith("position_orders_")) {
        const tradeId = data.replace("position_orders_", "");
        await this.showPositionOrders(ctx, tradeId);
      } else if (data.startsWith("position_history_")) {
        const tradeId = data.replace("position_history_", "");
        await this.showPositionHistory(ctx, tradeId);
      } else if (data.startsWith("order_details_")) {
        const orderId = data.replace("order_details_", "");
        await this.showOrderDetails(ctx, orderId);
      } else if (data.startsWith("cancel_order_")) {
        const orderId = data.replace("cancel_order_", "");
        await this.cancelOrder(ctx, orderId);
      } else if (data.startsWith("flip_to_market_")) {
        const orderId = data.replace("flip_to_market_", "");
        await this.flipOrderToMarket(ctx, orderId);
      } else if (data.startsWith("confirm_tp_")) {
        const parts = data.replace("confirm_tp_", "").split("_");
        const tradeId = parts[0];
        const price = parts[1];
        if (tradeId && price) {
          await this.executeTakeProfit(ctx, tradeId, price);
        }
      } else if (data.startsWith("confirm_sl_")) {
        const parts = data.replace("confirm_sl_", "").split("_");
        const tradeId = parts[0];
        const price = parts[1];
        if (tradeId && price) {
          await this.executeStopLoss(ctx, tradeId, price);
        }
      } else if (data.startsWith("confirm_close_")) {
        const tradeId = data.replace("confirm_close_", "");
        await this.executeClosePosition(ctx, tradeId);
      } else if (data.startsWith("confirm_add_margin_")) {
        const parts = data.replace("confirm_add_margin_", "").split("_");
        const tradeId = parts[0];
        const amount = parts[1];
        if (tradeId && amount) {
          await this.executeAddMargin(ctx, tradeId, amount);
        }
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
      } else if (data === "markets") {
        await this.showMarketSelection(ctx);
      } else if (data.startsWith("select_market_")) {
        const parts = data.split("_");
        if (parts.length > 2 && parts[2]) {
          const marketId = parts[2];
          await this.showMarketDetails(ctx, marketId);
        }
      } else if (data.startsWith("order_side_")) {
        const parts = data.split("_");
        console.log(`🔍 [ORDER_SIDE] Button clicked: ${data}, parts:`, parts);
        if (parts.length > 3 && parts[2] && parts[3]) {
          const marketId = parts[2];
          const orderSide = parts[3]; // long or short
          console.log(`🔍 [ORDER_SIDE] Proceeding to leverage selection:`, { marketId, orderSide });
          await this.showLeverageSelection(ctx, marketId, orderSide);
        } else {
          console.log(`❌ [ORDER_SIDE] Invalid parts length or missing data:`, parts);
        }
      } else if (data.startsWith("leverage_")) {
        const parts = data.split("_");
        console.log(`🔍 [LEVERAGE] Button clicked: ${data}, parts:`, parts);
        console.log(`🔍 [LEVERAGE] Length check: ${parts.length} >= 4 = ${parts.length >= 4}`);
        console.log(`🔍 [LEVERAGE] Parts check: parts[1]=${parts[1]}, parts[2]=${parts[2]}, parts[3]=${parts[3]}`);
        if (parts.length >= 4 && parts[1] && parts[2] && parts[3]) {
          const marketId = parts[1];
          const orderSide = parts[2];
          const leverage = parts[3];
          console.log(`🔍 [LEVERAGE] Proceeding to order type selection:`, { marketId, orderSide, leverage });
          await this.showOrderTypeSelection(ctx, marketId, orderSide, leverage);
        } else {
          console.log(`❌ [LEVERAGE] Invalid parts length or missing data:`, parts);
        }
      } else if (data.startsWith("leverage_custom_")) {
        const parts = data.split("_");
        if (parts.length > 4 && parts[2] && parts[3] && parts[4]) {
          const marketId = parts[2];
          const orderSide = parts[3];
          await this.showCustomLeverageInput(ctx, marketId, orderSide);
        }
      } else if (data.startsWith("order_type_")) {
        const parts = data.split("_");
        if (parts.length > 5 && parts[2] && parts[3] && parts[4] && parts[5]) {
          const marketId = parts[2];
          const orderSide = parts[3];
          const leverage = parts[4];
          const orderType = parts[5]; // market or limit

          if (orderType === 'limit') {
            await this.showLimitPriceInput(ctx, marketId, orderSide, leverage);
          } else {
            await this.showOrderSizeInput(ctx, marketId, orderSide, leverage, orderType);
          }
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
        if (parts.length > 6 && parts[2] && parts[3] && parts[4] && parts[5] && parts[6]) {
          const marketId = parts[2];
          const orderSide = parts[3];
          const leverage = parts[4];
          const orderType = parts[5];
          const size = parseFloat(parts[6]);
          const limitPrice = parts.length > 7 && parts[7] ? (isNaN(parseFloat(parts[7])) ? undefined : parseFloat(parts[7])) : undefined;
          await this.executeOrder(ctx, marketId, orderSide, leverage, orderType, size, limitPrice);
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

    // Handle poll answers for group voting
    this.bot.on("poll_answer", async (ctx) => {
      await this.handlePollAnswer(ctx);
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

// todo: get actual values
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

  private async showWallet(ctx: any) {
    try {
      const holdings = await this.getRealBalances();
      const aptHolding = Object.values(holdings).find((holding: any) => holding.symbol === 'APT');
      const aptBalance = aptHolding ? aptHolding.amount : '0';
      const aptValue = aptHolding ? aptHolding.value : '$0.00';

      // Get profile address
      const profileAddressResult = await this.kanaLabsPerps.getProfileAddress(this.APTOS_ADDRESS);
      const profileAddress = profileAddressResult.success ? profileAddressResult.data : 'Not available';

      const message = `💳 *Wallet Information*\n\n` +
        `*Address:* \`${getAptosAddress()}\`\n` +
        `*Profile Address:* \`${profileAddress}\`\n` +
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

      const { marketId, orderSide, leverage, orderType, market, limitPrice } = pendingTransfer.orderData as any;

      // Validate minimum order size
      const minSize = this.getMinimumOrderSize(market.asset);
      if (size < minSize) {
        const minSizeText = this.getMinimumOrderSizeText(market.asset);
        ctx.reply(`❌ Order size too small. Minimum: ${minSizeText}\n\nPlease enter a larger amount:`);
        return;
      }

      // Show order confirmation
      await this.showOrderConfirmation(ctx, marketId, orderSide, leverage, orderType, market, size, limitPrice);
    } catch (error) {
      console.error("Error handling order size input:", error);
      ctx.reply("❌ Error processing order size. Please try again.");
    }
  }

  private async handleCustomLeverageInput(ctx: any, text: string) {
    try {
      const leverage = parseFloat(text);

      if (isNaN(leverage) || leverage < 1 || leverage > 20) {
        ctx.reply("❌ Invalid leverage. Please enter a number between 1 and 20:");
        return;
      }

      // Get the order data from the pending transfer
      const userId = ctx.from?.id;
      if (!userId) return;

      const pendingTransfer = this.pendingTransfers.get(userId);
      if (!pendingTransfer || !pendingTransfer.orderData) return;

      const { marketId, orderSide, market } = pendingTransfer.orderData;

      // Proceed to order type selection with custom leverage
      await this.showOrderTypeSelection(ctx, marketId, orderSide, leverage.toString());
    } catch (error) {
      console.error("Error handling custom leverage input:", error);
      ctx.reply("❌ Error processing leverage. Please try again.");
    }
  }

  private async handleTakeProfitInput(ctx: any, pendingTransfer: any, text: string) {
    try {
      const price = parseFloat(text);

      if (isNaN(price) || price <= 0) {
        ctx.reply("❌ Invalid price. Please enter a positive number:");
        return;
      }

      const { tradeId, marketId, tradeSide } = pendingTransfer;

      // Get current price for validation
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
          } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);
      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.");
        return;
      }

      const currentPrice = parseFloat(position.price || position.entry_price);

      // Validate price based on position side
      const isLong = tradeSide;
      if (isLong && price <= currentPrice) {
        ctx.reply(`❌ For LONG positions, take profit must be above current price (${this.formatDollar(currentPrice)}). Please try again:`);
        return;
      }
      if (!isLong && price >= currentPrice) {
        ctx.reply(`❌ For SHORT positions, take profit must be below current price (${this.formatDollar(currentPrice)}). Please try again:`);
        return;
      }

      // Show confirmation
      const sideText = isLong ? "LONG" : "SHORT";
      const sideEmoji = isLong ? "🟢" : "🔴";

      let message = `🎯 *Confirm Take Profit*\n\n`;
      message += `${sideEmoji} *${sideText}* Position\n`;
      message += `Take Profit Price: ${this.formatDollar(price)}\n\n`;
      message += `This will set a take profit order at ${this.formatDollar(price)}`;

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm", `confirm_tp_${tradeId}_${price}`)
        .text("❌ Cancel", `position_details_${tradeId}`)
        .row();

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

      // Clear pending transfer
      this.pendingTransfers.delete(ctx.from?.id);

    } catch (error) {
      console.error("Error handling take profit input:", error);
      ctx.reply("❌ Error processing take profit price. Please try again.");
    }
  }

  private async handleStopLossInput(ctx: any, pendingTransfer: any, text: string) {
    try {
      const price = parseFloat(text);

      if (isNaN(price) || price <= 0) {
        ctx.reply("❌ Invalid price. Please enter a positive number:");
        return;
      }

      const { tradeId, marketId, tradeSide } = pendingTransfer;

      // Get current price for validation
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
    } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);
      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.");
        return;
      }

      const currentPrice = parseFloat(position.price || position.entry_price);

      // Validate price based on position side
      const isLong = tradeSide;
      const liquidationPrice = parseFloat(position.liq_price);

      if (isLong) {
        if (price >= currentPrice) {
          ctx.reply(`❌ For LONG positions, stop loss must be below current price (${this.formatDollar(currentPrice)}). Please try again:`);
          return;
        }
        if (price <= liquidationPrice) {
          ctx.reply(`❌ Stop loss must be above liquidation price (${this.formatDollar(liquidationPrice)}). Please try again:`);
          return;
        }
      } else {
        if (price <= currentPrice) {
          ctx.reply(`❌ For SHORT positions, stop loss must be above current price (${this.formatDollar(currentPrice)}). Please try again:`);
        return;
        }
        if (price >= liquidationPrice) {
          ctx.reply(`❌ Stop loss must be below liquidation price (${this.formatDollar(liquidationPrice)}). Please try again:`);
          return;
        }
      }

      // Show confirmation
      const sideText = isLong ? "LONG" : "SHORT";
      const sideEmoji = isLong ? "🟢" : "🔴";

      let message = `🛡️ *Confirm Stop Loss*\n\n`;
      message += `${sideEmoji} *${sideText}* Position\n`;
      message += `Stop Loss Price: ${this.formatDollar(price)}\n\n`;
      message += `This will set a stop loss order at ${this.formatDollar(price)}`;

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm", `confirm_sl_${tradeId}_${price}`)
        .text("❌ Cancel", `position_details_${tradeId}`)
        .row();

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

      // Clear pending transfer
      this.pendingTransfers.delete(ctx.from?.id);

    } catch (error) {
      console.error("Error handling stop loss input:", error);
      ctx.reply("❌ Error processing stop loss price. Please try again.");
    }
  }

  private async handleAddMarginInput(ctx: any, pendingTransfer: any, text: string) {
    try {
      const amount = parseFloat(text);

      if (isNaN(amount) || amount <= 0) {
        ctx.reply("❌ Invalid amount. Please enter a positive number:");
        return;
      }

      if (amount < 1) {
        ctx.reply("❌ Minimum margin amount is $1.00. Please enter a higher amount:");
        return;
      }

      const { tradeId, marketId, tradeSide } = pendingTransfer;

      // Show confirmation
      const sideText = tradeSide ? "LONG" : "SHORT";
      const sideEmoji = tradeSide ? "🟢" : "🔴";

      let message = `💰 *Confirm Add Margin*\n\n`;
      message += `${sideEmoji} *${sideText}* Position\n`;
      message += `Amount to Add: ${this.formatDollar(amount)}\n\n`;
      message += `This will add ${this.formatDollar(amount)} to your position's margin.`;

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm", `confirm_add_margin_${tradeId}_${amount}`)
        .text("❌ Cancel", `position_details_${tradeId}`)
        .row();

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

      // Clear pending transfer
      this.pendingTransfers.delete(ctx.from?.id);

    } catch (error) {
      console.error("Error handling add margin input:", error);
      ctx.reply("❌ Error processing margin amount. Please try again.");
    }
  }

  private async handleLimitPriceInput(ctx: any, pendingTransfer: any, text: string) {
    try {
      const price = parseFloat(text);

      if (isNaN(price) || price <= 0) {
        ctx.reply("❌ Invalid price. Please enter a positive number:");
        return;
      }

      const { marketId, orderSide, leverage, currentPrice } = pendingTransfer;

      // Validate price based on order side
      if (orderSide === 'long' && price >= currentPrice) {
        ctx.reply(`❌ For LONG orders, limit price must be below current price ($${currentPrice.toFixed(3)}). Please try again:`);
        return;
      }

      if (orderSide === 'short' && price <= currentPrice) {
        ctx.reply(`❌ For SHORT orders, limit price must be above current price ($${currentPrice.toFixed(3)}). Please try again:`);
        return;
      }

      // Clear the pending transfer
      this.pendingTransfers.delete(ctx.from.id);

      // Proceed to order size input with the limit price
      await this.showOrderSizeInput(ctx, marketId, orderSide, leverage, 'limit', price);
    } catch (error) {
      console.error("Error handling limit price input:", error);
      ctx.reply("❌ Error processing limit price. Please try again.");
    }
  }

  private async executeTakeProfit(ctx: any, tradeId: string, price: string) {
    try {
      console.log(`🔍 [EXECUTE_TP] Executing take profit for trade ID: ${tradeId}, price: ${price}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Call the Kana Labs API
      console.log(`🔍 [EXECUTE_TP] API Call params:`, {
        marketId: position.market_id,
        tradeSide: position.trade_side,
        newTakeProfitPrice: price
      });

      const result = await this.kanaLabsPerps.updateTakeProfit({
        marketId: position.market_id,
        tradeSide: position.trade_side,
        newTakeProfitPrice: price
      });

      console.log(`🔍 [EXECUTE_TP] API Response:`, result);

      if (result.success) {
        // The API returns a transaction payload that needs to be submitted to the blockchain
        const payloadData = result.data;

        console.log(`🔍 [EXECUTE_TP] Building transaction with payload:`, payloadData);

        // Build the transaction
        const transactionPayload = await this.aptos.transaction.build.simple({
          sender: this.aptosAccount.accountAddress,
          data: {
            function: payloadData.function as `${string}::${string}::${string}`,
            functionArguments: payloadData.functionArguments,
            typeArguments: payloadData.typeArguments
          }
        });

        console.log(`🔍 [EXECUTE_TP] Transaction built, signing and submitting...`);

        // Sign and submit the transaction
        const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
          transaction: transactionPayload,
          signer: this.aptosAccount,
        });

        console.log(`🔍 [EXECUTE_TP] Transaction submitted:`, committedTxn.hash);

        // Wait for transaction confirmation
        await this.aptos.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log(`🔍 [EXECUTE_TP] Transaction confirmed!`);

        const marketName = position.market_name || `Market ${position.market_id}`;
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";

        let message = `✅ *Take Profit Set Successfully*\n\n`;
        message += `${sideEmoji} *${marketName}* ${side}\n`;
        message += `Your take profit order has been placed. ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}\n\n`;
        message += `This order will execute when the price reaches ${this.formatDollar(price)}.`;

        const keyboard = new InlineKeyboard()
          .text("🔙 Back to Position", `position_details_${tradeId}`)
          .text("🔙 Back to Positions", "positions");

      ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: "Markdown"
      });
      } else {
        throw new Error(result.message);
      }

    } catch (error) {
      console.error("Error executing take profit:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error setting take profit: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async executeStopLoss(ctx: any, tradeId: string, price: string) {
    try {
      console.log(`🔍 [EXECUTE_SL] Executing stop loss for trade ID: ${tradeId}, price: ${price}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Call the Kana Labs API
      console.log(`🔍 [EXECUTE_SL] API Call params:`, {
        marketId: position.market_id,
        tradeSide: position.trade_side,
        newStopLossPrice: price
      });

      const result = await this.kanaLabsPerps.updateStopLoss({
        marketId: position.market_id,
        tradeSide: position.trade_side,
        newStopLossPrice: price
      });

      console.log(`🔍 [EXECUTE_SL] API Response:`, result);

      if (result.success) {
        // The API returns a transaction payload that needs to be submitted to the blockchain
        const payloadData = result.data;

        console.log(`🔍 [EXECUTE_SL] Building transaction with payload:`, payloadData);

        // Build the transaction
        const transactionPayload = await this.aptos.transaction.build.simple({
          sender: this.aptosAccount.accountAddress,
          data: {
            function: payloadData.function as `${string}::${string}::${string}`,
            functionArguments: payloadData.functionArguments,
            typeArguments: payloadData.typeArguments
          }
        });

        console.log(`🔍 [EXECUTE_SL] Transaction built, signing and submitting...`);

        // Sign and submit the transaction
        const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
          transaction: transactionPayload,
          signer: this.aptosAccount,
        });

        console.log(`🔍 [EXECUTE_SL] Transaction submitted:`, committedTxn.hash);

        // Wait for transaction confirmation
        await this.aptos.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log(`🔍 [EXECUTE_SL] Transaction confirmed!`);

        const marketName = position.market_name || `Market ${position.market_id}`;
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";

        let message = `✅ *Stop Loss Set Successfully*\n\n`;
        message += `${sideEmoji} *${marketName}* ${side}\n`;
        message += `Your stop loss order has been placed. ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}\n\n`;
        message += `This order will execute when the price reaches ${this.formatDollar(price)}.`;

      const keyboard = new InlineKeyboard()
          .text("🔙 Back to Position", `position_details_${tradeId}`)
          .text("🔙 Back to Positions", "positions");

      ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: "Markdown"
      });
      } else {
        throw new Error(result.message);
      }

        } catch (error) {
      console.error("Error executing stop loss:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error setting stop loss: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async executeClosePosition(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [EXECUTE_CLOSE] Executing close position for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // For closing a position, we need to reverse the direction
      // If position is LONG (true), we need to SHORT (false) to close it
      // If position is SHORT (false), we need to LONG (true) to close it
      const closeSide = !position.trade_side;

      console.log(`🔍 [EXECUTE_CLOSE] API Call params:`, {
        marketId: position.market_id,
        tradeSide: position.trade_side,
        direction: true, // true to close a position
        size: position.size,
        leverage: position.leverage,
        takeProfit: 0, // optional, default to 0
        stopLoss: 0    // optional, default to 0
      });

      // Get market order payload to close the position
      const result = await this.kanaLabsPerps.getMarketOrderPayload({
        marketId: position.market_id,
        size: position.size,
        tradeSide: position.trade_side,
        direction: true, // true to close a position
        leverage: position.leverage,
        takeProfit: 0, // optional, default to 0
        stopLoss: 0    // optional, default to 0
      });

      console.log(`🔍 [EXECUTE_CLOSE] API Response:`, result);

      if (result.success) {
        // The API returns a transaction payload that needs to be submitted to the blockchain
        const payloadData = result.data;

        console.log(`🔍 [EXECUTE_CLOSE] Building transaction with payload:`, payloadData);

        // Build the transaction
        const transactionPayload = await this.aptos.transaction.build.simple({
          sender: this.aptosAccount.accountAddress,
          data: {
            function: payloadData.function as `${string}::${string}::${string}`,
            functionArguments: payloadData.functionArguments,
            typeArguments: payloadData.typeArguments
          }
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction built, signing and submitting...`);

        // Sign and submit the transaction
        const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
          transaction: transactionPayload,
          signer: this.aptosAccount,
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction submitted:`, committedTxn.hash);

        // Wait for transaction confirmation
      await this.aptos.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction confirmed!`);

        const marketName = position.market_name || `Market ${position.market_id}`;
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";

        let message = `✅ *Position Closed Successfully*\n\n`;
        message += `${sideEmoji} *${marketName}* ${side}\n`;
        message += `Size: ${position.size}\n`;
        message += `Closed with: ${closeSide ? "LONG" : "SHORT"} order\n\n`;
        message += `Your position has been closed at market price. ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}`;

        const keyboard = new InlineKeyboard()
          .text("🔙 Back to Positions", "positions")
          .text("🏠 Home", "start");

        ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: "Markdown"
        });
      } else {
        throw new Error(result.message);
      }

    } catch (error) {
      console.error("Error executing close position:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error closing position: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async executeAddMargin(ctx: any, tradeId: string, amount: string) {
    try {
      console.log(`🔍 [EXECUTE_ADD_MARGIN] Executing add margin for trade ID: ${tradeId}, amount: ${amount}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Call the Kana Labs addMargin API
      console.log(`🔍 [EXECUTE_ADD_MARGIN] API Call params:`, {
        marketId: position.market_id,
        tradeSide: position.trade_side,
        amount: amount
      });

      const result = await this.kanaLabsPerps.addMargin({
        marketId: position.market_id,
        tradeSide: position.trade_side,
        amount: amount
      });

      console.log(`🔍 [EXECUTE_ADD_MARGIN] API Response:`, result);

      if (result.success) {
        // The API returns a transaction payload that needs to be submitted to the blockchain
        const payloadData = result.data;

        console.log(`🔍 [EXECUTE_ADD_MARGIN] Building transaction with payload:`, payloadData);

        // Build the transaction
        const transactionPayload = await this.aptos.transaction.build.simple({
          sender: this.aptosAccount.accountAddress,
          data: {
            function: payloadData.function as `${string}::${string}::${string}`,
            functionArguments: payloadData.functionArguments,
            typeArguments: payloadData.typeArguments
          }
        });

        console.log(`🔍 [EXECUTE_ADD_MARGIN] Transaction built, signing and submitting...`);

        // Sign and submit the transaction
        const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
          transaction: transactionPayload,
          signer: this.aptosAccount,
        });

        console.log(`🔍 [EXECUTE_ADD_MARGIN] Transaction submitted:`, committedTxn);

        // Wait for transaction confirmation
      await this.aptos.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log(`🔍 [EXECUTE_ADD_MARGIN] Transaction confirmed!`);

        const marketName = position.market_name || `Market ${position.market_id}`;
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";

        let message = `✅ *Margin Added Successfully*\n\n`;
        message += `${sideEmoji} *${marketName}* ${side}\n`;
        message += `Amount Added: ${this.formatDollar(amount)}\n\n`;
        message += `Your position's margin has been increased by ${this.formatDollar(amount)}. ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}`;

        const keyboard = new InlineKeyboard()
          .text("🔙 Back to Position", `position_details_${tradeId}`)
          .text("🔙 Back to Positions", "positions");

        ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: "Markdown"
        });
      } else {
        throw new Error(result.message);
      }

    } catch (error) {
      console.error("Error executing add margin:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error adding margin: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private formatDollar(value: string | number | undefined, fallback: string = "N/A"): string {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (isNaN(numValue)) {
      return fallback;
    }
    return `$${numValue.toFixed(2)}`;
  }

  private getExplorerLink(txHash: string): string {
    const network = isTestnet() ? 'testnet' : 'mainnet';
    return `https://explorer.aptoslabs.com/txn/${txHash}?network=${network}`;
  }

  private formatTransactionLink(txHash: string, displayText?: string): string {
    const link = this.getExplorerLink(txHash);
    const text = displayText || txHash;
    return `[${text}](${link})`;
    // return `<a href="${link}">${text}</a>`;
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
        .text("🟢 Long (Buy)", `order_side_${marketId}_long`)
        .text("🔴 Short (Sell)", `order_side_${marketId}_short`)
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

  private async showLimitPriceInput(ctx: any, marketId: string, orderSide: string, leverage: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Get current market price for reference
      let currentPrice = "N/A";
      try {
        const priceResult = await this.kanaLabsPerps.getMarketPrice(marketId);
        if (priceResult.success && priceResult.data) {
          if (priceResult.data.bestAskPrice && priceResult.data.bestBidPrice) {
            const midPrice = (priceResult.data.bestAskPrice + priceResult.data.bestBidPrice) / 2;
            currentPrice = midPrice.toFixed(3);
          } else if (priceResult.data.price) {
            currentPrice = parseFloat(priceResult.data.price).toFixed(3);
          }
        }
      } catch (error) {
        console.error(`Error fetching market price:`, error);
      }

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      let message = `📊 *Limit Order - ${market.asset}*\n\n`;
      message += `Side: ${sideEmoji} ${sideText}\n`;
      message += `Leverage: ${leverage}x\n`;
      message += `Current Price: $${currentPrice}\n\n`;
      message += `Enter your limit price:\n\n`;

      if (orderSide === 'long') {
        message += `• For LONG: Enter price below current price (e.g., $${(parseFloat(currentPrice) * 0.95).toFixed(3)})\n`;
        message += `• Current: $${currentPrice}\n`;
      } else {
        message += `• For SHORT: Enter price above current price (e.g., $${(parseFloat(currentPrice) * 1.05).toFixed(3)})\n`;
        message += `• Current: $${currentPrice}\n`;
      }

      message += `\nExample: ${(parseFloat(currentPrice) * (orderSide === 'long' ? 1.05 : 0.95)).toFixed(3)}`;

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });

      // Store the order context for price input
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.set(userId, {
          type: 'limit_price_input',
          marketId,
          orderSide,
          leverage,
          currentPrice: parseFloat(currentPrice)
        });
      }
    } catch (error) {
      console.error("Error showing limit price input:", error);
      ctx.reply("❌ Error loading price input. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showOrderSizeInput(ctx: any, marketId: string, orderSide: string, leverage: string, orderType: string, limitPrice?: number) {
    try {
      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';
      const orderTypeEmoji = orderType === 'market' ? '⚡' : '📊';
      const orderTypeText = orderType === 'market' ? 'Market Order' : 'Limit Order';

      // Get minimum order size based on asset
      const minSize = this.getMinimumOrderSize(market.asset);
      const minSizeText = this.getMinimumOrderSizeText(market.asset);

      let message = `🎯 *Create Order - ${market.asset}*\n\n`;
      message += `Side: ${sideEmoji} ${sideText}\n`;
      message += `Leverage: ${leverage}x\n`;
      message += `Type: ${orderTypeEmoji} ${orderTypeText}\n`;
      if (limitPrice) {
        message += `Limit Price: $${limitPrice.toFixed(3)}\n`;
      }
      message += `\nEnter order size:\n`;
      message += `Minimum: ${minSizeText}\n`;
      message += `Example: ${minSize} (for ${minSizeText})`;

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
          orderData: { marketId, orderSide, leverage, orderType, market, limitPrice } as any
        });
          }
        } catch (error) {
      console.error("Error showing order size input:", error);
      ctx.reply("❌ Error loading order form. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showCustomLeverageInput(ctx: any, marketId: string, orderSide: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      let message = `📝 *Create Order - ${market.asset}*\n\n`;
      message += `Side: ${sideEmoji} ${sideText}\n\n`;
      message += `Enter custom leverage (1-20x):\n`;
      message += `Example: 15 (for 15x leverage)`;

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
          step: 'custom_leverage_input',
          orderData: { marketId, orderSide, market } as any
        });
      }
    } catch (error) {
      console.error("Error showing custom leverage input:", error);
      ctx.reply("❌ Error loading leverage input. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private getMinimumOrderSize(asset: string): number {
    switch (asset) {
      case 'APT-USD':
        return 0.5;
      case 'BTC-USD':
        return 0.0001;
      case 'ETH-USD':
        return 0.001;
      case 'SOL-USD':
        return 0.05;
      default:
        return 0.5; // Default to APT minimum
    }
  }

  private getMinimumOrderSizeText(asset: string): string {
    switch (asset) {
      case 'APT-USD':
        return '0.5 APT';
      case 'BTC-USD':
        return '0.0001 BTC';
      case 'ETH-USD':
        return '0.001 ETH';
      case 'SOL-USD':
        return '0.05 SOL';
      default:
        return '0.5 APT'; // Default to APT minimum
    }
  }

  private async showOrderSideSelection(ctx: any, marketId: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      let message = `📝 *Create Order - ${market.asset}*\n\n`;
      message += `Select order side:\n\n`;

      const keyboard = new InlineKeyboard()
        .text("🟢 Long (Buy)", `order_side_${marketId}_long`)
        .text("🔴 Short (Sell)", `order_side_${marketId}_short`)
        .row()
        .text("🔙 Back to Market", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing order side selection:", error);
      ctx.reply("❌ Error loading order form. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showLeverageSelection(ctx: any, marketId: string, orderSide: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Check for existing positions in the same direction
      const userAddress = getAptosAddress();
      const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, marketId);

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      if (positionsResult.success && positionsResult.data && positionsResult.data.length > 0) {
        // Check if user has existing position in same direction
        const existingPosition = positionsResult.data.find(pos => pos.trade_side === (orderSide === 'long'));

        if (existingPosition) {
          // User has existing position - use existing leverage and skip leverage selection
          const existingLeverage = existingPosition.leverage;

          let message = `📝 *Create Order - ${market.asset}*\n\n`;
          message += `Side: ${sideEmoji} ${sideText}\n\n`;
          message += `🔄 *Adding to Existing Position*\n`;
          message += `Current Position: ${existingPosition.size} ${market.asset} at ${existingLeverage}x\n`;
          message += `Leverage: ${existingLeverage}x (locked to existing position)\n\n`;
          message += `Your new order will add to your existing ${sideText.toLowerCase()} position.`;

          const keyboard = new InlineKeyboard()
            .text("Continue", `leverage_${marketId}_${orderSide}_${existingLeverage}`)
            .row()
            .text("🔙 Back", `select_market_${marketId}`);

          ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: keyboard
          });
          return;
        }
      }

      // No existing position - show normal leverage selection
      let message = `📝 *Create Order - ${market.asset}*\n\n`;
      message += `Side: ${sideEmoji} ${sideText}\n\n`;
      message += `✨ *New Position*\n`;
      message += `Select leverage:\n\n`;

      const keyboard = new InlineKeyboard()
        .text("2x", `leverage_${marketId}_${orderSide}_2`)
        .text("5x", `leverage_${marketId}_${orderSide}_5`)
        .text("10x", `leverage_${marketId}_${orderSide}_10`)
        .row()
        .text("Custom (1-20x)", `leverage_custom_${marketId}_${orderSide}`)
        .row()
        .text("🔙 Back", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing leverage selection:", error);
      ctx.reply("❌ Error loading leverage selection. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showOrderTypeSelection(ctx: any, marketId: string, orderSide: string, leverage: string) {
    try {
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';

      let message = `📝 *Create Order - ${market.asset}*\n\n`;
      message += `Side: ${sideEmoji} ${sideText}\n`;
      message += `Leverage: ${leverage}x\n\n`;
      message += `Select order type:\n\n`;

      const keyboard = new InlineKeyboard()
        .text("⚡ Market Order", `order_type_${marketId}_${orderSide}_${leverage}_market`)
        .text("📊 Limit Order", `order_type_${marketId}_${orderSide}_${leverage}_limit`)
        .row()
        .text("🔙 Back", `select_market_${marketId}`);

      ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing order type selection:", error);
      ctx.reply("❌ Error loading order type selection. Please try again.", {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
      });
    }
  }

  private async showOrderConfirmation(ctx: any, marketId: string, orderSide: string, leverage: string, orderType: string, market: any, size: number, limitPrice?: number) {
    try {
      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long (Buy)' : 'Short (Sell)';
      const orderTypeEmoji = orderType === 'market' ? '⚡' : '📊';
      const orderTypeText = orderType === 'market' ? 'Market Order' : 'Limit Order';

      let message = `🎯 *Order Confirmation*\n\n`;
      message += `Market: ${market.asset}\n`;
      message += `Side: ${sideEmoji} ${sideText}\n`;
      message += `Size: ${size} ${this.getAssetSymbol(market.asset)}\n`;
      message += `Type: ${orderTypeEmoji} ${orderTypeText}\n`;
      if (limitPrice) {
        message += `Limit Price: $${limitPrice.toFixed(3)}\n`;
      }
      message += `Leverage: ${leverage}x\n\n`;

      if (orderType === 'market') {
      message += `⚠️ *This will place a market order immediately!*`;
      } else {
        message += `⚠️ *This will place a limit order*`;
      }

      const confirmCallback = limitPrice
        ? `confirm_order_${marketId}_${orderSide}_${leverage}_${orderType}_${size}_${limitPrice}`
        : `confirm_order_${marketId}_${orderSide}_${leverage}_${orderType}_${size}`;

      const keyboard = new InlineKeyboard()
        .text("✅ Confirm Order", confirmCallback)
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

  private getAssetSymbol(asset: string): string {
    switch (asset) {
      case 'APT-USD':
        return 'APT';
      case 'BTC-USD':
        return 'BTC';
      case 'ETH-USD':
        return 'ETH';
      case 'SOL-USD':
        return 'SOL';
      default:
        return 'USDT';
    }
  }

  private async executeOrder(ctx: any, marketId: string, orderSide: string, leverage: string, orderType: string, size: number, limitPrice?: number) {
    try {
      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Create poll for order approval
      const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
      const sideText = orderSide === 'long' ? 'Long' : 'Short';
      const orderTypeEmoji = orderType === 'market' ? '⚡' : '📊';
      const orderTypeText = orderType === 'market' ? 'Market Order' : 'Limit Order';

      const description = `<b>${orderTypeText}</b>\n\n` +
        `Market: ${market.asset}\n` +
        `Side: ${sideEmoji} ${sideText}\n` +
        `Size: ${size} ${this.getAssetSymbol(market.asset)}\n` +
        `Leverage: ${leverage}x${limitPrice ? `\nPrice: $${limitPrice}` : ''}`;

      const pollId = await this.createVotingPoll(ctx, 'place_order', {
        marketId,
        orderSide,
        leverage,
        orderType,
        size,
        limitPrice,
        chatId: ctx.chat.id
      }, description);

      // Clear any pending order data
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

    } catch (error) {
      console.error("Error creating order poll:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error creating order poll: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "create_order")
      });
    }
  }

  private async executeOrderDirect(ctx: any, marketId: string, orderSide: string, leverage: string, orderType: string, size: number, limitPrice?: number) {
    try {

      // Get market info
      const market = findMarketById(marketId);
      if (!market) {
        ctx.reply("❌ Market not found.");
        return;
      }

      // Get transaction payload from Kana Labs API
      let orderResult;

      if (orderType === 'limit') {
        if (!limitPrice) {
          ctx.reply("❌ Limit price is required for limit orders.");
          return;
        }

        orderResult = await this.kanaLabsPerps.placeLimitOrder({
        marketId: marketId,
          tradeSide: orderSide === 'long', // true for long, false for short
          direction: false, // false to open a position
        size: size.toString(),
          leverage: parseInt(leverage),
          orderType: 'limit',
          price: limitPrice.toString()
        });
      } else {
        orderResult = await this.kanaLabsPerps.placeMarketOrder({
          marketId: marketId,
          tradeSide: orderSide === 'long', // true for long, false for short
          direction: false, // false to open a position
          size: size.toString(),
          leverage: parseInt(leverage),
        orderType: 'market'
      });
      }

      if (orderResult.success && orderResult.data) {
        try {
          // Build and submit transaction to Aptos
          const payloadData = orderResult.data;
          console.log(`🔍 [EXECUTE_ORDER] Transaction payload:`, payloadData);

          // Map OrderPayload to Aptos SDK format
          const aptosPayload = {
            function: payloadData.function as `${string}::${string}::${string}`,
            typeArguments: payloadData.typeArguments || [],
            arguments: payloadData.functionArguments || []
          };

          const transactionPayload = await this.aptos.transaction.build.simple({
            sender: this.APTOS_ADDRESS,
            data: {
              function: aptosPayload.function,
              typeArguments: aptosPayload.typeArguments,
              functionArguments: aptosPayload.arguments
            }
          });

          const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
            transaction: transactionPayload,
            signer: this.aptosAccount,
          });

          console.log(`🔍 [EXECUTE_ORDER] Transaction submitted: ${committedTxn.hash}`);

          // Wait for transaction confirmation
          const response = await this.aptos.waitForTransaction({
            transactionHash: committedTxn.hash,
          });

          if (response.success) {
      // Clear any pending order data
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.delete(userId);
      }

        const sideEmoji = orderSide === 'long' ? '🟢' : '🔴';
        const sideText = orderSide === 'long' ? 'Long' : 'Short';
            const orderTypeEmoji = orderType === 'market' ? '⚡' : '📊';
            const orderTypeText = orderType === 'market' ? 'Market Order' : 'Limit Order';

        const message = `✅ *Order Placed Successfully!*\n\n` +
          `Market: ${market.asset}\n` +
          `Side: ${sideEmoji} ${sideText}\n` +
              `Size: ${size} ${this.getAssetSymbol(market.asset)}\n` +
              `Type: ${orderTypeEmoji} ${orderTypeText}\n` +
              `Leverage: ${leverage}x\n\n` +
              `Transaction: ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}\n` +
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
            ctx.reply(`❌ Transaction failed: ${response.success}`, {
              reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
            });
          }
        } catch (error) {
          console.error("Error executing order transaction:", error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          ctx.reply(`❌ Error executing order: ${errorMessage}`, {
            reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
          });
        }
            } else {
        ctx.reply(`❌ Order failed: ${orderResult.message || 'Unknown error'}`, {
          reply_markup: new InlineKeyboard().text("🔙 Back to Markets", "markets")
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
        `Your deposit has been processed successfully! ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}`;

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
        `Your withdraw has been processed successfully! ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}`;

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

      // Format positions message with buttons
      let message = "📈 *Your Positions*\n\n";

      if (allPositions.length === 0) {
        message += "No open positions found.";
      } else {
        message += `Found ${allPositions.length} position${allPositions.length === 1 ? '' : 's'}. Click on a position to view details and manage it.`;
      }

      const keyboard = new InlineKeyboard();

      // Add position buttons
      for (let i = 0; i < allPositions.length; i++) {
        const position = allPositions[i];
        if (!position) continue;

        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";
        const pnl = parseFloat(position.pnl || "0");
        const pnlEmoji = pnl >= 0 ? "📈" : "📉";
        const pnlSign = pnl >= 0 ? "+" : "";

        // Calculate PnL percentage based on margin (consistent with position details)
        const margin = parseFloat(position.margin || "0");
        const pnlPercentage = margin > 0 ? (pnl / margin) * 100 : 0;

        const marketName = position.market_name || `Market ${position.market_id}`;
        const buttonText = `${sideEmoji} ${marketName} ${side}\nSize: ${position.size} | PnL: ${pnlEmoji} ${pnlSign}${pnlPercentage.toFixed(2)}%`;
        keyboard.text(buttonText, `position_details_${position.trade_id}`);
        keyboard.row();
      }

      // Add action buttons
      keyboard
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

  private async showPositionDetails(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [POSITION_DETAILS] Fetching details for trade ID: ${tradeId}`);

      // Get all positions to find the specific one
      const userAddress = getAptosAddress();

      // Get all available markets first to add market names
      const markets = await this.getAvailableMarkets();

      // Get positions for all markets and add market names
      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Debug logging
      console.log(`🔍 [POSITION_DETAILS] Found position:`, {
        trade_id: position.trade_id,
        market_id: position.market_id,
        market_name: position.market_name,
        has_market_name: !!position.market_name,
        tp: position.tp,
        sl: position.sl,
        liq_price: position.liq_price
      });


      // Get current market price and calculate PnL
      let currentPrice = "N/A";
      let calculatedPnl = 0;
      let pnlPercentage = 0;

      try {
        console.log(`🔍 [POSITION_DETAILS] Fetching current price for market ${position.market_id}`);
        const priceResult = await this.kanaLabsPerps.getMarketPrice(position.market_id);

        if (priceResult.success && priceResult.data) {
          // Calculate current price (average of bid and ask if available, or use single price)
          if (priceResult.data.bestAskPrice && priceResult.data.bestBidPrice) {
            const midPrice = (priceResult.data.bestAskPrice + priceResult.data.bestBidPrice) / 2;
            currentPrice = midPrice.toFixed(3);
          } else if (priceResult.data.price) {
            currentPrice = parseFloat(priceResult.data.price).toFixed(3);
          }

          // Calculate PnL based on current price
          const entryPrice = parseFloat(position.entry_price || "0");
          const currentPriceNum = parseFloat(currentPrice);
          const size = parseFloat(position.size || "0");

          if (entryPrice > 0 && currentPriceNum > 0 && size > 0) {
            if (position.trade_side) {
              // LONG position: PnL = (current_price - entry_price) * size
              calculatedPnl = (currentPriceNum - entryPrice) * size;
            } else {
              // SHORT position: PnL = (entry_price - current_price) * size
              calculatedPnl = (entryPrice - currentPriceNum) * size;
            }

            // Calculate PnL percentage based on margin
            const margin = parseFloat(position.margin || "0");
            if (margin > 0) {
              pnlPercentage = (calculatedPnl / margin) * 100;
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching market price for ${position.market_id}:`, error);
      }
      // Format detailed position information
      const side = position.trade_side ? "LONG" : "SHORT";
      const sideEmoji = position.trade_side ? "🟢" : "🔴";
      const pnl = calculatedPnl;
      const pnlEmoji = pnl >= 0 ? "📈" : "📉";
      const pnlSign = pnl >= 0 ? "+" : "";

      let message = `📈 *Position Details*\n\n`;
      const marketName = position.market_name || `Market ${position.market_id}`;
      message += `${sideEmoji} *${marketName}* ${side}\n\n`;
      message += `**Position Info:**\n`;
      message += `   Size: ${position.size} | Available: ${position.available_order_size || position.size}\n`;
      message += `   Entry: ${this.formatDollar(position.entry_price)} | Current: $${currentPrice}\n`;
      message += `   Value: ${this.formatDollar(position.value)} | Margin: ${this.formatDollar(position.margin)}\n`;
      message += `   Leverage: ${position.leverage}x\n`;
      message += `   PnL: ${pnlEmoji} ${pnlSign}${this.formatDollar(pnl)} (${pnlPercentage.toFixed(2)}%)\n\n`;

      message += `**Risk Management:**\n`;
      if (position.tp && position.tp !== "0") {
        message += `   Take Profit: ${this.formatDollar(position.tp)}\n`;
      } else {
        message += `   Take Profit: Not set\n`;
      }
      if (position.sl && position.sl !== "0") {
        message += `   Stop Loss: ${this.formatDollar(position.sl)}\n`;
      } else {
        message += `   Stop Loss: Not set\n`;
      }
      if (position.liq_price && position.liq_price !== "0") {
        message += `   Liq Price: ${this.formatDollar(position.liq_price)}\n`;
      }
      message += `\n`;

      message += `**Reference:**\n`;
      message += `   Trade ID: \`${position.trade_id}\`\n`;
      message += `   Market ID: \`${position.market_id}\`\n`;

      // Create action buttons
      const keyboard = new InlineKeyboard();

      // Trading actions
      keyboard
        .text("🔴 Close Position", `close_position_${tradeId}`)
        .text("💰 Add Margin", `add_margin_${tradeId}`)
        .row();

      // Risk management
      keyboard
        .text("🎯 Set Take Profit", `set_tp_${tradeId}`)
        .text("🛡️ Set Stop Loss", `set_sl_${tradeId}`)
        .row();

      // Information
      keyboard
        .text("📊 View Orders", `position_orders_${tradeId}`)
        .text("📈 Trade History", `position_history_${tradeId}`)
        .row();

      // Navigation
      keyboard
        .text("🔄 Refresh", `position_details_${tradeId}`)
        .text("🔙 Back to Positions", "positions")
        .row()
        .text("🏠 Home", "start");

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error showing position details:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error loading position details: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
      });
    }
  }

  private async closePosition(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [CLOSE_POSITION] Closing position for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      const marketName = position.market_name || `Market ${position.market_id}`;
      const side = position.trade_side ? "LONG" : "SHORT";
      const sideEmoji = position.trade_side ? "🟢" : "🔴";
      const currentPrice = parseFloat(position.price || position.entry_price);
      const entryPrice = parseFloat(position.entry_price);
      const pnl = parseFloat(position.pnl || "0");
      const pnlEmoji = pnl >= 0 ? "📈" : "📉";
      const pnlSign = pnl >= 0 ? "+" : "";

      // Calculate PnL percentage based on margin (consistent with other views)
      const margin = parseFloat(position.margin || "0");
      const pnlPercentage = margin > 0 ? (pnl / margin) * 100 : 0;

      // Create poll for close position approval
      const description = `<b>Close Position</b>\n\n` +
        `Market: ${marketName}\n` +
        `Side: ${sideEmoji} ${side}\n` +
        `Size: ${position.size}\n` +
        `Entry Price: ${this.formatDollar(entryPrice)}\n` +
        `Current Price: ${this.formatDollar(currentPrice)}\n` +
        `PnL: ${pnlEmoji} ${pnlSign}${this.formatDollar(pnl)} (${pnlPercentage.toFixed(2)}%)\n\n` +
        `⚠️ This will close your entire position at market price.`;

      const pollId = await this.createVotingPoll(ctx, 'close_position', {
        tradeId,
        marketId: position.market_id,
        tradeSide: position.trade_side,
        chatId: ctx.chat.id
      }, description);

    } catch (error) {
      console.error("Error creating close position poll:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error creating close position poll: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async closePositionDirect(ctx: any, tradeId: string, marketId: string, tradeSide: boolean) {
    try {
      console.log(`🔍 [EXECUTE_CLOSE] Executing close position for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // For closing a position, we need to reverse the direction
      // If position is LONG (true), we need to SHORT (false) to close it
      // If position is SHORT (false), we need to LONG (true) to close it
      const closeSide = !position.trade_side;

      console.log(`🔍 [EXECUTE_CLOSE] API Call params:`, {
        marketId: position.market_id,
        tradeSide: position.trade_side,
        direction: true, // true to close a position
        size: position.size,
        leverage: position.leverage,
        takeProfit: 0, // optional, default to 0
        stopLoss: 0    // optional, default to 0
      });

      // Get market order payload to close the position
      const result = await this.kanaLabsPerps.getMarketOrderPayload({
        marketId: position.market_id,
        size: position.size,
        tradeSide: position.trade_side,
        direction: true, // true to close a position
        leverage: position.leverage,
        takeProfit: 0, // optional, default to 0
        stopLoss: 0    // optional, default to 0
      });

      console.log(`🔍 [EXECUTE_CLOSE] API Response:`, result);

      if (result.success) {
        // The API returns a transaction payload that needs to be submitted to the blockchain
        const payloadData = result.data;

        console.log(`🔍 [EXECUTE_CLOSE] Building transaction with payload:`, payloadData);

        // Build the transaction
        const transactionPayload = await this.aptos.transaction.build.simple({
          sender: this.aptosAccount.accountAddress,
          data: {
            function: payloadData.function as `${string}::${string}::${string}`,
            functionArguments: payloadData.functionArguments,
            typeArguments: payloadData.typeArguments
          }
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction built, signing and submitting...`);

        // Sign and submit the transaction
        const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
          transaction: transactionPayload,
          signer: this.aptosAccount,
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction submitted:`, committedTxn.hash);

        // Wait for transaction confirmation
      await this.aptos.waitForTransaction({
          transactionHash: committedTxn.hash,
        });

        console.log(`🔍 [EXECUTE_CLOSE] Transaction confirmed!`);

        const marketName = position.market_name || `Market ${position.market_id}`;
        const side = position.trade_side ? "LONG" : "SHORT";
        const sideEmoji = position.trade_side ? "🟢" : "🔴";

        let message = `✅ *Position Closed Successfully*\n\n`;
        message += `${sideEmoji} *${marketName}* ${side}\n`;
        message += `Size: ${position.size}\n`;
        message += `Closed with: ${closeSide ? "LONG" : "SHORT"} order\n\n`;
        message += `Transaction: ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}\n\n`;
        message += `Your position has been closed at market price.`;

        const keyboard = new InlineKeyboard()
          .text("🔙 Back to Positions", "positions")
          .text("🏠 Home", "start");

        ctx.reply(message, {
          reply_markup: keyboard,
          parse_mode: "Markdown"
        });
      } else {
        throw new Error(result.message);
      }

    } catch (error) {
      console.error("Error executing close position:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error closing position: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async addMarginPrompt(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [ADD_MARGIN] Adding margin for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      const marketName = position.market_name || `Market ${position.market_id}`;
      const side = position.trade_side ? "LONG" : "SHORT";
      const sideEmoji = position.trade_side ? "🟢" : "🔴";
      const currentMargin = parseFloat(position.margin);
      const liquidationPrice = parseFloat(position.liq_price);

      let message = `💰 *Add Margin*\n\n`;
      message += `${sideEmoji} *${marketName}* ${side}\n`;
      message += `Current Margin: ${this.formatDollar(currentMargin)}\n`;
      message += `Liquidation Price: ${this.formatDollar(liquidationPrice)}\n\n`;
      message += `Enter the amount of margin to add:\n`;
      message += `• This will increase your position's margin\n`;
      message += `• Higher margin = lower liquidation price\n`;
      message += `• Minimum amount: $1.00\n`;
      message += `• Example: 10.50 (for $10.50)`;

      // Store the trade ID for the response handler
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.set(userId, {
          type: 'add_margin',
          tradeId: tradeId,
          marketId: position.market_id,
          tradeSide: position.trade_side
        });
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `position_details_${tradeId}`);

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error adding margin:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error adding margin: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async setTakeProfitPrompt(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [SET_TP] Setting take profit for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      const marketName = position.market_name || `Market ${position.market_id}`;
      const side = position.trade_side ? "LONG" : "SHORT";
      const sideEmoji = position.trade_side ? "🟢" : "🔴";
      const currentPrice = parseFloat(position.price || position.entry_price);
      const entryPrice = parseFloat(position.entry_price);

      let message = `🎯 *Set Take Profit*\n\n`;
      message += `${sideEmoji} *${marketName}* ${side}\n`;
      message += `Entry Price: ${this.formatDollar(entryPrice)}\n`;
      message += `Current Price: ${this.formatDollar(currentPrice)}\n\n`;

      if (position.tp && position.tp !== "0") {
        message += `Current Take Profit: ${this.formatDollar(position.tp)}\n\n`;
      }

      message += `Enter your take profit price:\n`;
      message += `• For LONG: Enter price above current price (e.g., $${(currentPrice * 1.05).toFixed(2)})\n`;
      message += `• For SHORT: Enter price below current price (e.g., $${(currentPrice * 0.95).toFixed(2)})\n\n`;
      message += `Example: ${side === "LONG" ? (currentPrice * 1.1).toFixed(2) : (currentPrice * 0.9).toFixed(2)}`;

      // Store the trade ID for the response handler
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.set(userId, {
          type: 'set_take_profit',
          tradeId: tradeId,
          marketId: position.market_id,
          tradeSide: position.trade_side
        });
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `position_details_${tradeId}`);

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error setting take profit:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error setting take profit: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async setStopLossPrompt(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [SET_SL] Setting stop loss for trade ID: ${tradeId}`);

      // Get the position to find market details
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();

      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      const marketName = position.market_name || `Market ${position.market_id}`;
      const side = position.trade_side ? "LONG" : "SHORT";
      const sideEmoji = position.trade_side ? "🟢" : "🔴";
      const currentPrice = parseFloat(position.price || position.entry_price);
      const entryPrice = parseFloat(position.entry_price);

      let message = `🛡️ *Set Stop Loss*\n\n`;
      message += `${sideEmoji} *${marketName}* ${side}\n`;
      message += `Entry Price: ${this.formatDollar(entryPrice)}\n`;
      message += `Current Price: ${this.formatDollar(currentPrice)}\n`;
      message += `Liquidation Price: ${this.formatDollar(position.liq_price)}\n\n`;

      if (position.sl && position.sl !== "0") {
        message += `Current Stop Loss: ${this.formatDollar(position.sl)}\n\n`;
      }

      message += `Enter your stop loss price:\n`;
      message += `• For LONG: Enter price below current price (e.g., $${(currentPrice * 0.95).toFixed(2)})\n`;
      message += `• For SHORT: Enter price above current price (e.g., $${(currentPrice * 1.05).toFixed(2)})\n\n`;

      if (side === "LONG") {
        message += `⚠️ Must be above liquidation price: ${this.formatDollar(position.liq_price)}\n`;
      } else {
        message += `⚠️ Must be below liquidation price: ${this.formatDollar(position.liq_price)}\n`;
      }

      message += `Example: ${side === "LONG" ? (currentPrice * 0.9).toFixed(2) : (currentPrice * 1.1).toFixed(2)}`;

      // Store the trade ID for the response handler
      const userId = ctx.from?.id;
      if (userId) {
        this.pendingTransfers.set(userId, {
          type: 'set_stop_loss',
          tradeId: tradeId,
          marketId: position.market_id,
          tradeSide: position.trade_side
        });
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `position_details_${tradeId}`);

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error setting stop loss:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error setting stop loss: ${errorMessage}`, {
        reply_markup: new InlineKeyboard().text("🔙 Back to Position", `position_details_${tradeId}`)
      });
    }
  }

  private async showPositionOrders(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [POSITION_ORDERS] Fetching orders for trade ID: ${tradeId}`);

      // First get the position to find the market ID
      const userAddress = getAptosAddress();

      // Get all available markets first to add market names
      const markets = await this.getAvailableMarkets();

      // Get positions for all markets and add market names
      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Get orders for this market
      const ordersResult = await this.kanaLabsPerps.getOpenOrders(userAddress, position.market_id);
      if (!ordersResult.success) {
        throw new Error(ordersResult.message);
      }

      const orders = ordersResult.data || [];

      // Filter orders that might be related to this position (same trade_id)
      const relatedOrders = orders.filter(order => order.trade_id === tradeId);

      let message = `📊 *Orders for ${position.market_name}*\n\n`;

      if (relatedOrders.length === 0) {
        message += "No open orders found for this position.";
      } else {
        message += `Found ${relatedOrders.length} order${relatedOrders.length === 1 ? '' : 's'} for this position:\n\n`;

        for (const order of relatedOrders) {
          const orderType = this.getOrderTypeName(order.order_type);
          const isLongOrder = [1, 3, 5, 7].includes(order.order_type);
          const side = isLongOrder ? "LONG" : "SHORT";
          const sideEmoji = isLongOrder ? "🟢" : "🔴";

          // Calculate filled amount
          const totalSize = parseFloat(order.total_size);
          const remainingSize = parseFloat(order.remaining_size);
          const filledSize = totalSize - remainingSize;
          const filledPercentage = totalSize > 0 ? ((filledSize / totalSize) * 100).toFixed(1) : "0";

          message += `${sideEmoji} *${orderType}* ${side}\n`;
          message += `   Size: ${order.total_size} | Remaining: ${order.remaining_size}\n`;
          message += `   Filled: ${filledSize.toFixed(4)} (${filledPercentage}%)\n`;
          message += `   Price: $${order.price} | Value: $${order.order_value}\n`;
          message += `   Leverage: ${order.leverage}x\n`;
          message += `   Order ID: \`${order.order_id}\`\n`;
          if (order.timestamp) {
            message += `   Placed: ${new Date(order.timestamp * 1000).toLocaleString()}\n`;
          }
          message += "\n";
        }
      }

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", `position_orders_${tradeId}`)
        .text("🔙 Back to Position", `position_details_${tradeId}`)
        .row()
        .text("🔙 Back to Positions", "positions");

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error showing position orders:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error loading position orders: ${errorMessage}`, {
        reply_markup: new InlineKeyboard()
          .text("🔙 Back to Position", `position_details_${tradeId}`)
          .text("🔙 Back to Positions", "positions")
      });
    }
  }

  private async showPositionHistory(ctx: any, tradeId: string) {
    try {
      console.log(`🔍 [POSITION_HISTORY] Fetching trade history for trade ID: ${tradeId}`);

      // First get the position to find the market ID
      const userAddress = getAptosAddress();

      // Get all available markets first to add market names
      const markets = await this.getAvailableMarkets();

      // Get positions for all markets and add market names
      const allPositions = [];
      for (const market of markets) {
        try {
          const positionsResult = await this.kanaLabsPerps.getPositions(userAddress, market.market_id);
          if (positionsResult.success && positionsResult.data.length > 0) {
            const positionsWithMarket = positionsResult.data.map(pos => ({ ...pos, market_name: market.base_name }));
            allPositions.push(...positionsWithMarket);
          }
        } catch (error) {
          console.error(`Error fetching positions for market ${market.market_id}:`, error);
        }
      }

      const position = allPositions.find(p => p.trade_id === tradeId);

      if (!position) {
        ctx.reply("❌ Position not found. It may have been closed.", {
          reply_markup: new InlineKeyboard().text("🔙 Back to Positions", "positions")
        });
        return;
      }

      // Get trade history for this market
      const tradesResult = await this.kanaLabsPerps.getAllTrades(userAddress, position.market_id);
      if (!tradesResult.success) {
        throw new Error(tradesResult.message);
      }

      const allTrades = tradesResult.data || [];

      // Filter trades that might be related to this position (same trade_id)
      const relatedTrades = allTrades.filter(trade => trade.trade_id === tradeId);

      let message = `📈 *Trade History for ${position.market_name}*\n\n`;

      if (relatedTrades.length === 0) {
        message += "No trade history found for this position.";
      } else {
        message += `Found ${relatedTrades.length} trade${relatedTrades.length === 1 ? '' : 's'} for this position:\n\n`;

        // Sort trades by timestamp (newest first)
        relatedTrades.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));

        for (const trade of relatedTrades) {
          const side = trade.side ? "LONG" : "SHORT";
          const sideEmoji = trade.side ? "🟢" : "🔴";
          const timestamp = new Date(parseInt(trade.timestamp) * 1000).toLocaleString();

          message += `${sideEmoji} *${side}* Trade\n`;
          message += `   Size: ${trade.size} | Price: $${trade.price}\n`;
          message += `   Fee: $${trade.fee} | Trade ID: \`${trade.trade_id}\`\n`;
          message += `   Order ID: \`${trade.order_id}\`\n`;
          message += `   Time: ${timestamp}\n\n`;
        }
      }

      const keyboard = new InlineKeyboard()
        .text("🔄 Refresh", `position_history_${tradeId}`)
        .text("🔙 Back to Position", `position_details_${tradeId}`)
        .row()
        .text("🔙 Back to Positions", "positions");

      ctx.reply(message, {
        reply_markup: keyboard,
        parse_mode: "Markdown"
      });

    } catch (error) {
      console.error("Error showing position history:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      ctx.reply(`❌ Error loading position history: ${errorMessage}`, {
        reply_markup: new InlineKeyboard()
          .text("🔙 Back to Position", `position_details_${tradeId}`)
          .text("🔙 Back to Positions", "positions")
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

      // Format orders message with individual buttons (like positions)
      let message = "📊 *Your Open Orders*\n\n";
      const keyboard = new InlineKeyboard();

      for (const order of allOrders) {
        const orderType = this.getOrderTypeName(order.order_type);
        // Determine side based on order type rather than trade_side
        const isLongOrder = [1, 3, 5, 7].includes(order.order_type); // OPEN_LONG, INCREASE_LONG, DECREASE_LONG, CLOSE_LONG
        const sideEmoji = isLongOrder ? "🟢" : "🔴";

        // Calculate filled amount
        const totalSize = parseFloat(order.total_size);
        const remainingSize = parseFloat(order.remaining_size);
        const filledSize = totalSize - remainingSize;
        const filledPercentage = totalSize > 0 ? ((filledSize / totalSize) * 100).toFixed(1) : "0";

        // Create meaningful button text like positions
        const buttonText = `${sideEmoji} ${order.market_name} ${orderType} | ${this.formatDollar(order.price)} | ${filledPercentage}% filled`;

        // Add button for each order
        keyboard.text(buttonText, `order_details_${order.order_id}`).row();
      }

      keyboard
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

  private async showOrderDetails(ctx: any, orderId: string) {
    try {
      const userAddress = getAptosAddress();
      console.log(`🔍 [ORDER_DETAILS] Fetching details for order ID: ${orderId}`);

      // Get all available markets first
      const markets = await this.getAvailableMarkets();
      let order: any = null;
      let market: any = null;

      // Search for the order across all markets
      for (const m of markets) {
        try {
          const ordersResult = await this.kanaLabsPerps.getOpenOrders(userAddress, m.market_id);
          if (ordersResult.success && ordersResult.data) {
            const foundOrder = ordersResult.data.find(o => o.order_id === orderId);
            if (foundOrder) {
              order = { ...foundOrder, market_name: m.base_name };
              market = m;
              break;
            }
          }
        } catch (error) {
          console.error(`Error fetching orders for market ${m.market_id}:`, error);
        }
      }

      if (!order || !market) {
        ctx.reply("❌ Order not found.");
        return;
      }

      console.log(`🔍 [ORDER_DETAILS] Order found:`, order);

      // Format detailed order information
      const orderType = this.getOrderTypeName(order.order_type);
      const isLongOrder = [1, 3, 5, 7].includes(order.order_type);
      const side = isLongOrder ? "LONG" : "SHORT";
      const sideEmoji = isLongOrder ? "🟢" : "🔴";

      // Calculate filled amount
      const totalSize = parseFloat(order.total_size);
      const remainingSize = parseFloat(order.remaining_size);
      const filledSize = totalSize - remainingSize;
      const filledPercentage = totalSize > 0 ? ((filledSize / totalSize) * 100).toFixed(1) : "0";

      let message = `📊 <b>Order Details</b>\n\n`;
      message += `${sideEmoji} <b>${order.market_name}</b> ${side}\n\n`;
      message += `<b>Order Info:</b>\n`;
      message += `   Type: ${orderType}\n`;
      message += `   Size: ${order.total_size} | Remaining: ${order.remaining_size}\n`;
      message += `   Filled: ${filledSize.toFixed(4)} (${filledPercentage}%)\n`;
      message += `   Price: ${this.formatDollar(order.price)}\n`;
      message += `   Value: ${this.formatDollar(order.order_value)}\n`;
      message += `   Leverage: ${order.leverage}x\n\n`;
      message += `<b>Order Details:</b>\n`;
      message += `   Order ID: ${order.order_id}\n`;
      if (order.trade_id) {
        message += `   Trade ID: ${order.trade_id}\n`;
      }
      if (order.timestamp) {
        message += `   Placed: ${new Date(order.timestamp * 1000).toLocaleString()}\n`;
      }
      if (order.last_updated && order.last_updated !== order.timestamp) {
        message += `   Updated: ${new Date(order.last_updated * 1000).toLocaleString()}\n`;
      }

      const keyboard = new InlineKeyboard()
        .text("❌ Cancel", `cancel_order_${orderId}`)
        .text("🔄 Flip to Market", `flip_to_market_${orderId}`)
        .row()
        .text("🔙 Back to Orders", "open_orders");

      ctx.reply(message, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      console.error("Error showing order details:", error);
      ctx.reply("❌ Error loading order details. Please try again.");
    }
  }

  private async cancelOrder(ctx: any, orderId: string) {
    try {
      // First, get the order details to extract marketId and orderSide
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();
      let order: any = null;

      // Search for the order across all markets
      for (const market of markets) {
        try {
          const ordersResult = await this.kanaLabsPerps.getOpenOrders(userAddress, market.market_id);
          if (ordersResult.success && ordersResult.data) {
            const foundOrder = ordersResult.data.find(o => o.order_id === orderId);
            if (foundOrder) {
              order = foundOrder;
              break;
            }
          }
        } catch (error) {
          console.error(`Error fetching orders for market ${market.market_id}:`, error);
        }
      }

      if (!order) {
        ctx.reply("❌ Order not found.");
        return;
      }

      // Create poll for cancel order approval
      const orderType = this.getOrderTypeName(order.order_type);
      const isLongOrder = [1, 3, 5, 7].includes(order.order_type);
      const sideEmoji = isLongOrder ? "🟢" : "🔴";
      const sideText = isLongOrder ? "LONG" : "SHORT";

      // Get market name from our market config
      const market = findMarketById(order.market_id);
      const marketName = market?.asset || `Market ${order.market_id}`;

      const description = `<b>Cancel Order</b>\n\n` +
        `Market: ${marketName}\n` +
        `Type: ${sideEmoji} ${orderType}\n` +
        `Size: ${order.remaining_size}\n` +
        `Price: $${order.price}`;

      const pollId = await this.createVotingPoll(ctx, 'cancel_order', {
        orderId,
        chatId: ctx.chat.id
      }, description);

    } catch (error) {
      console.error("Error creating cancel order poll:", error);
      ctx.reply(`❌ Error creating cancel order poll: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cancelOrderDirect(ctx: any, orderId: string) {
    try {
      await ctx.reply("🔄 Cancelling order... Please wait.");

      // First, get the order details to extract marketId and orderSide
      const userAddress = getAptosAddress();
      const markets = await this.getAvailableMarkets();
      let order: any = null;

      // Search for the order across all markets
      for (const market of markets) {
        try {
          const ordersResult = await this.kanaLabsPerps.getOpenOrders(userAddress, market.market_id);
          if (ordersResult.success && ordersResult.data) {
            const foundOrder = ordersResult.data.find(o => o.order_id === orderId);
            if (foundOrder) {
              order = foundOrder;
              break;
            }
          }
        } catch (error) {
          console.error(`Error fetching orders for market ${market.market_id}:`, error);
        }
      }

      if (!order) {
        ctx.reply("❌ Order not found.");
        return;
      }

      // Determine order side from order type
      const isLongOrder = [1, 3, 5, 7].includes(order.order_type);
      const orderSide = isLongOrder;

      // Get transaction payload from Kana Labs API
      const cancelResult = await this.kanaLabsPerps.cancelOrder({
        marketId: order.market_id,
        orderId: orderId,
        orderSide: orderSide
      });

      if (cancelResult.success && cancelResult.data) {
        try {
          // Build and submit transaction to Aptos
          const payloadData = cancelResult.data;
          console.log(`🔍 [CANCEL_ORDER] Transaction payload:`, payloadData);

          // The API returns null for orderIds and tradeSides, but we need to provide them
          // Convert order ID to BigInt and trade side to boolean
          const orderIdBigInt = BigInt(orderId);
          const tradeSideBoolean = orderSide;

          const transactionPayload = await this.aptos.transaction.build.simple({
            sender: this.APTOS_ADDRESS,
            data: {
              function: payloadData.function as `${string}::${string}::${string}`,
              typeArguments: payloadData.typeArguments || [],
              functionArguments: [
                order.market_id, // marketId
                [orderIdBigInt], // orderIds as vector<u128>
                [tradeSideBoolean] // tradeSides as vector<bool>
              ]
            }
          });

          const committedTxn = await this.aptos.transaction.signAndSubmitTransaction({
            transaction: transactionPayload,
            signer: this.aptosAccount,
          });

          console.log(`🔍 [CANCEL_ORDER] Transaction submitted: ${committedTxn.hash}`);

          // Wait for transaction confirmation
          const response = await this.aptos.waitForTransaction({
            transactionHash: committedTxn.hash,
          });

          if (response.success) {
            const message = `❌ *Order Cancelled Successfully!*\n\n` +
              `Order ID: ${orderId}\n` +
              `Transaction: ${this.formatTransactionLink(committedTxn.hash, "View on Explorer")}\n\n` +
              `Your order has been cancelled.`;

            const keyboard = new InlineKeyboard()
              .text("📊 View Orders", "open_orders")
              .text("🏠 Back to Home", "start");

            ctx.reply(message, {
              parse_mode: "HTML",
              reply_markup: keyboard
            });
          } else {
            throw new Error(`Transaction failed: ${committedTxn.hash}`);
          }
        } catch (txError) {
          console.error(`❌ [CANCEL_ORDER] Aptos transaction failed:`, txError);
          ctx.reply(`❌ Error cancelling order: ${txError instanceof Error ? txError.message : 'Unknown error'}`);
        }
      } else {
        ctx.reply(`❌ Cancel order failed: ${cancelResult.message || 'Unknown API error'}`);
      }
    } catch (error) {
      console.error("Error cancelling order:", error);
      ctx.reply(`❌ Error cancelling order: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async flipOrderToMarket(ctx: any, orderId: string) {
    const message = `🚧 *Coming Soon!*\n\n` +
      `The "Flip to Market" feature is currently under development.\n\n` +
      `For now, you can:\n` +
      `• Cancel your limit order\n` +
      `• Place a new market order\n\n` +
      `This feature will be available in a future update!`;

    const keyboard = new InlineKeyboard()
      .text("❌ Cancel Order", `cancel_order_${orderId}`)
      .text("📊 View Orders", "open_orders")
      .row()
      .text("🏠 Back to Home", "start");

    ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
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

  private isGroupChat(ctx: any): boolean {
    return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
  }

  private async getGroupMemberCount(ctx: any): Promise<number> {
    try {
      if (!this.isGroupChat(ctx)) {
        return 1; // Private chat
      }

      const memberCount = await ctx.api.getChatMemberCount(ctx.chat.id);
      return memberCount;
    } catch (error) {
      console.error("Error getting group member count:", error);
      return 1; // Fallback to 1 for private chat
    }
  }

  private async createVotingPoll(ctx: any, action: string, data: any, description: string): Promise<string> {
    const memberCount = await this.getGroupMemberCount(ctx);
    const isGroup = this.isGroupChat(ctx);

    // Calculate required votes based on group size and settings
    let requiredVotes: number;
    if (isGroup) {
      // For groups, require at least 30% of members to vote, minimum 2, maximum 10
      requiredVotes = Math.max(2, Math.min(10, Math.ceil(memberCount * 0.3)));
    } else {
      // For private chats, just 1 vote (the user)
      requiredVotes = 1;
    }

    const pollId = `poll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const pollMessage = await ctx.reply(`🗳️ <b>Voting Required: </b>${description}\n\n` +
      `Required votes: ${requiredVotes}${isGroup ? ` (${memberCount} members in group)` : ''}`, {
      parse_mode: "HTML"
    });

    // Create the poll
    const poll = await ctx.api.sendPoll(ctx.chat.id,
      `Vote: ${action}`,
      [
        "✅ Approve",
        "❌ Reject"
      ],
      {
        is_anonymous: false,
        allows_multiple_answers: false,
        reply_to_message_id: pollMessage.message_id
      }
    );

    // Store poll information
    this.pendingPolls.set(pollId, {
      pollId: poll.poll.id,
      action,
      data,
      voters: new Map(),
      startTime: Date.now(),
      requiredVotes,
      chatId: ctx.chat.id,
      messageId: pollMessage.message_id
    });

    return pollId;
  }

  private async handlePollAnswer(ctx: any) {
    const pollAnswer = ctx.pollAnswer;
    if (!pollAnswer) return;

    const pollId = pollAnswer.poll_id;
    const userId = pollAnswer.user.id;
    const optionIds = pollAnswer.option_ids;

    // Find the poll in our pending polls
    let foundPoll: any = null;
    let foundPollKey: string = '';
    for (const [id, poll] of this.pendingPolls.entries()) {
      if (poll.pollId === pollId) {
        foundPoll = poll;
        foundPollKey = id;
        break;
      }
    }

    if (!foundPoll) return;

    // Store the user's vote (0 = approve, 1 = reject)
    const voteOption = optionIds[0]; // 0 for approve, 1 for reject
    foundPoll.voters.set(userId, voteOption);

    // Count votes
    const totalVotes = foundPoll.voters.size;
    const approveVotes = Array.from(foundPoll.voters.values()).filter(vote => vote === 0).length;
    const rejectVotes = Array.from(foundPoll.voters.values()).filter(vote => vote === 1).length;

    // Check if we have enough votes
    if (totalVotes >= foundPoll.requiredVotes) {
      try {
        // Clean up the poll
        this.pendingPolls.delete(foundPollKey);

        // Determine if approved (more approve votes than reject votes)
        const isApproved = approveVotes > rejectVotes;

        if (isApproved) {
          await ctx.api.sendMessage(foundPoll.chatId, "✅ <b>Vote Passed!</b> Executing transaction...", { parse_mode: "HTML" });
          await this.executeApprovedAction(ctx, foundPoll.action, foundPoll.data);
        } else {
          await ctx.api.sendMessage(foundPoll.chatId, "❌ <b>Vote Rejected!</b> Transaction cancelled.", { parse_mode: "HTML" });
        }
      } catch (error) {
        console.error("Error handling poll results:", error);
        await ctx.api.sendMessage(foundPoll.chatId, "❌ Error processing vote results.");
      }
    } else {
      // Update the poll message with current vote count
      const remainingVotes = foundPoll.requiredVotes - totalVotes;
      await ctx.api.editMessageText(foundPoll.chatId, foundPoll.messageId,
        `🗳️ <b>Voting Required</b>\n\n${foundPoll.action}\n\n` +
        `Current votes: ${totalVotes}/${foundPoll.requiredVotes}\n` +
        `Approve: ${approveVotes} | Reject: ${rejectVotes}\n` +
        `Remaining votes needed: ${remainingVotes}`,
        { parse_mode: "HTML" }
      );
    }
  }

  private async executeApprovedAction(ctx: any, action: string, data: any) {
    try {
      // Get the chat ID from the poll data or context
      const chatId = ctx.chat?.id || data.chatId;

      if (!chatId) {
        console.error("No chat ID available for executing approved action");
        return;
      }

      // Create a mock context for the direct execution methods
      const mockCtx = {
        ...ctx,
        chat: { id: chatId },
        reply: async (message: string, options?: any) => {
          return await ctx.api.sendMessage(chatId, message, options);
        }
      };

      switch (action) {
        case 'place_order':
          await this.executeOrderDirect(mockCtx, data.marketId, data.orderSide, data.leverage, data.orderType, data.size, data.limitPrice);
          break;
        case 'cancel_order':
          await this.cancelOrderDirect(mockCtx, data.orderId);
          break;
        case 'close_position':
          await this.closePositionDirect(mockCtx, data.tradeId, data.marketId, data.tradeSide);
          break;
        default:
          console.error(`Unknown action: ${action}`);
      }
    } catch (error) {
      console.error(`Error executing approved action ${action}:`, error);
      const chatId = ctx.chat?.id || data.chatId;
      if (chatId) {
        await ctx.api.sendMessage(chatId, `❌ Error executing ${action}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
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

}