# MoveTogether

![logo](public/logo_small.png)

MoveTogether is a Telegram bot for group-based trading perps on **Kana Labs** with democratic voting mechanisms for transaction approval on **Aptos**.

## Overview

This bot enables Telegram groups to collectively manage a single Kana Labs account for trading perps on Aptos. Group members can propose trades, and the group members votes on whether to execute them or not.

### Key Features

- 🏛️ **Democratic Trading**: Group members vote on all trading decisions using Telegram polls
- 📊 **Perp Trading**: Full integration with Kana Labs perps platform
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

## Group Chat Setup

### **Privacy Mode Configuration**

To enable the bot to receive typed input in group chats, you need to disable privacy mode:

1. **Open a chat with [@BotFather](https://t.me/BotFather)** on Telegram
2. **Send the command** `/setprivacy`
3. **Select your bot** from the list
4. **Choose "Disable"** to turn off privacy mode

## Commands

### **Main Commands**
- `/start` - Show main menu and bot information
- `/markets` - Browse available trading markets
- `/deposit` - Deposit funds to Kana Labs account
- `/settings` - Bot settings

### **Trading Flow**
1. **Select Market**: Choose from available perp markets
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
- **Trading Platform**: Kana Labs Perp API
- **Bot Framework**: grammY (Telegram Bot API)
- **Price Data**: Kana Labs API + CoinGecko API

## Configuration

### **Network Support**
- **Mainnet**: Production Aptos network (default)
- **Testnet**: Aptos testnet for development (Kana Labs testnet was not available during the hackathon)

### **Market Configuration**
- **Mainnet Markets**: APT-USD, BTC-USD, ETH-USD, SOL-USD
- **Testnet Markets**: APT-USD, BTC-USD, ETH-USD, SOL-USD
- **Custom Markets**: Easily configurable via `src/config/markets.ts`

### **Voting Settings**
- **Voting Period**: 5 minutes (configurable)
- **Approval Threshold**: 50% (configurable)


## Roadmap

This is a proof of concept for the CTRL+MOVE hackathon. To make this project production ready, the following features still need to be added:

- **Group Management**:
  - Ensure only verified members can vote
  - Ensure members can only withdraw pro-rate to their deposits
- **Key management**:
  - Store privatekey of Aptos account securely

After launching on mainnet, other improvements will be made:

- **Advanced Trading**:
  - Close with limit order
  - Order modifications
  - partial position closes
- **Analytics & Reporting**:
  - Trade history
  - performance metrics
  - P&L reports
- **Notification Settings**:
  - Customizable alerts and notifications
- **Voting Integration**:
  - Customize/override voting requirements per action
  - Admin actions, to allow certain actions without voting (for example, give one person right to manager positions but require group to handle withdrawals)
- **Simplify codebase**:
  - Some actions can maybe be executed directly on Aptos, without making API calls to Kana API.
  - Formatting in Telegram properly (bold doesn't show up right sometimes)

## Links
- [Github repo](https://github.com/arjanjohan/aptos-telegram)
- [Dorahacks Buidl](https://dorahacks.io/buidl/32655)
- [Demo video](https://youtu.be/Ghx5H2Ukevg)

## Team
MoveTogether is built as a solo project by [arjanjohan](https://x.com/arjanjohan)