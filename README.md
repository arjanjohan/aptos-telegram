# Kana Labs Perpetual Futures Telegram Bot

A Telegram bot for group-based trading on Kana Labs perpetual futures platform with democratic voting mechanisms for transaction approval.

## Overview

This bot enables Telegram groups to collectively manage a single Kana Labs account for trading perpetual futures on Aptos. Group members can propose trades, and the community votes on whether to execute them before they're executed.

### Key Features

- 🏛️ **Democratic Trading**: Group members vote on all trading decisions using Telegram polls
- 📊 **Perpetual Futures Trading**: Full integration with Kana Labs perpetual futures platform
- 💰 **Position Management**: View, manage, and close positions with real-time PnL
- 🎯 **Risk Management**: Set take profit and stop loss orders
- 📈 **Real-time Data**: Live market prices and position tracking
- 🔐 **Secure**: All transactions require group approval before execution

## Project Structure

```
aptos-telegram/
├── src/
│   ├── index.ts                    # Main entry point
│   ├── bot/
│   │   └── bot.ts                  # Main bot logic and handlers
│   ├── config/
│   │   ├── index.ts                # Centralized configuration
│   │   └── markets.ts              # Market definitions (testnet/mainnet)
│   ├── services/
│   │   ├── holdings-fetcher.ts     # Aptos holdings fetcher
│   │   └── kanalabs-perps.ts       # Kana Labs API integration
│   ├── types/
│   │   └── kanalabs.ts             # TypeScript interfaces
│   └── utils/
│       └── usd-value-utils.ts      # USD value calculation utilities
├── package.json
├── tsconfig.json
├── CONFIGURATION.md                # Configuration guide
├── KANA_LABS_README.md            # Kana Labs integration docs
└── README.md
```

## Quick Start

### Prerequisites
- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Aptos wallet with private key
- Kana Labs API key

### Environment Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your values:
   ```bash
   # Required values
   TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
   APTOS_PRIVATE_KEY=your_aptos_private_key
   KANA_LABS_API_KEY=your_kana_labs_api_key

   # Optional (defaults to mainnet)
   APTOS_NETWORK=mainnet  # or testnet
   ```

3. **Start the bot:**
   ```bash
   npm start
   ```

## Commands

### **Main Commands**
- `/start` - Show main menu and bot information
- `/markets` - Browse available trading markets
- `/deposit` - Deposit funds to Kana Labs account
- `/settings` - Bot settings (coming soon)

### **Trading Flow**
1. **Select Market**: Choose from available perpetual futures markets
2. **Choose Side**: Select Long (Buy) or Short (Sell)
3. **Set Leverage**: Choose leverage (2x, 5x, 10x, or custom)
4. **Order Type**: Select market or limit order
5. **Enter Size**: Input order size with validation
6. **Confirm**: Review order details before submission
7. **Vote**: Group votes on whether to execute the trade
8. **Execute**: If approved, transaction is submitted to Aptos blockchain

## Tech Stack

- **Backend**: TypeScript/Node.js
- **Blockchain**: Aptos TS SDK
- **Trading Platform**: Kana Labs Perpetual Futures API
- **Bot Framework**: grammY (Telegram Bot API)
- **Price Data**: Kana Labs API + CoinGecko API
- **Database**: In-memory (TODO: Move to persistent storage)

## Configuration

### **Network Support**
- **Mainnet**: Production Aptos network (default)
- **Testnet**: Aptos testnet for development

### **Market Configuration**
- **Mainnet Markets**: APT-USD, BTC-USD, ETH-USD, SOL-USD
- **Testnet Markets**: APT-USD, BTC-USD, ETH-USD, SOL-USD
- **Custom Markets**: Easily configurable via `src/config/markets.ts`

### **Voting Settings**
- **Voting Period**: 5 minutes (configurable)
- **Approval Threshold**: 50% (configurable)

## API Integration

This project uses the  following Kana Labs Perpetual Futures API endpoints:

- **Core Trading Endpoints**:
  - `/getMarketInfo` - Market information and details
  - `/getMarketPrice` - Real-time market prices (bid/ask)
  - `/getLastExecutionPrice` - Last execution price for markets
  - `/placeMarketOrder` - Create market orders (GET request)
  - `/placeLimitOrder` - Create limit orders (GET request)
  - `/placeMultipleOrders` - Create multiple orders at once
  - `/cancelMultipleOrders` - Cancel multiple orders
  - `/cancelAndPlaceMultipleOrders` - Cancel and place orders atomically

- **Position & Order Management**:
  - `/getPositions` - Get user positions for a market
  - `/getOpenOrders` - Get open orders for a market
  - `/getOrderHistory` - Get order history for a market
  - `/getAllTrades` - Get all trades for a market
  - `/getFills` - Get fills for a market
  - `/getOrderStatusByOrderId` - Get specific order status
  - `/getAllOpenOrderIds` - Get all open order IDs

- **Risk Management**:
  - `/updateTakeProfit` - Set/update take profit for positions
  - `/updateStopLoss` - Set/update stop loss for positions
  - `/addMargin` - Add margin to existing positions

- **Account & Balance Management**:
  - `/getWalletAccountBalance` - Get wallet USDT balance
  - `/getProfileBalanceSnapshot` - Get Kana Labs profile balance
  - `/getNetProfileBalance` - Get net profile balance
  - `/getAccountAptBalance` - Get APT balance
  - `/getProfileAddress` - Get Kana Labs profile address
  - `/deposit` - Deposit USDT to Kana Labs (GET request)
  - `/withdrawMultipleMarkets` - Withdraw from Kana Labs (GET request)

## TODO

This is a proof of concept for the CTRL+MOVE hackathon. To make this project production ready, the following features still need to be added:
- **Group Management**:
  - Ensure only verified members can vote
  - Ensure members can only withdraw pro-rate to their deposits
- **Advanced Trading**:
   - Limit orders
   - Order modifications
   - partial position closes
- **Analytics & Reporting**:
  - Trade history
  - performance metrics
  - P&L reports
- **Notification Settings**:
  - Customizable alerts and notifications
- **Voting Integration**:
  - Voting system for trading actions
  - Customize/override voting requirements per action
  - Optional admin rights, to allow actions without voting
- **Key management**:
  - Store privatekey of KanaLabs account securely