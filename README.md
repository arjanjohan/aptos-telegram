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
- **Anonymous Voting**: Disabled (voters are tracked)

## Development Status

### **Phase 1: Core Trading** ✅ **COMPLETE**
- [x] Market selection and browsing
- [x] Order creation with leverage
- [x] Position management
- [x] Real-time price tracking
- [x] PnL calculation

### **Phase 2: Position Management** ✅ **COMPLETE**
- [x] Close positions
- [x] Add margin
- [x] Set take profit/stop loss
- [x] View orders and trade history
- [x] On-chain transaction submission

### **Phase 3: Group Features** 🔄 **IN PROGRESS**
- [x] Voting infrastructure
- [ ] Group member management
- [ ] Admin permissions
- [ ] Settings interface

### **Phase 4: Advanced Features** ⏳ **PLANNED**
- [ ] Limit orders
- [ ] Order modifications
- [ ] Advanced analytics
- [ ] Performance tracking

## API Integration

### **Kana Labs Perpetual Futures API**
- **Base URL**: `https://perps-tradeapi.kana.trade` (mainnet)
- **Authentication**: API key based
- **Endpoints Used**:
  - `/getMarkets` - Market information
  - `/getMarketPrice` - Real-time prices
  - `/getPositions` - User positions
  - `/getOrders` - User orders
  - `/placeMarketOrder` - Create market orders
  - `/updateTakeProfit` - Set take profit
  - `/updateStopLoss` - Set stop loss
  - `/addMargin` - Add margin to positions


## TODO

This is just a proof of concept for the CTRL+MOVE hackathon. To make this project production ready, the follow features still need to be added:
- Limit orders
- Voting mechanics
- Key storage (securely store key)
- Validate telegram group members. People who join uninvited should not be able to vote