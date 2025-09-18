# Aptos Telegram Trading Bot

A Telegram bot for trading on the Aptos blockchain with portfolio management and real-time price tracking.

## Overview

This bot provides:
- 📊 **Portfolio Management**: View all your Aptos holdings with USD values
- 💰 **Buy/Sell Operations**: Interactive asset selection and trading interface
- 🔍 **Real-time Prices**: Live USD price data from CoinGecko
- 🎯 **Asset Overview**: Detailed information for each holding
- 🚀 **Simple Commands**: Easy-to-use Telegram interface

## Project Structure

```
aptos-telegram/
├── src/
│   ├── index.ts           # Main entry point
│   ├── bot/
│   │   └── bot.ts         # Main bot logic and handlers
│   ├── services/
│   │   └── holdings-fetcher.ts  # Aptos holdings fetcher
│   └── utils/
│       └── usd-value-utils.ts     # USD value calculation utilities
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Quick Start

### Prerequisites
- Node.js 18+
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Aptos wallet address (for testing)

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Get Telegram Bot Token:**
   - Go to [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot`
   - Choose a name for your bot (e.g., "Aptos Trading Bot")
   - Choose a username (e.g., "aptos_trading_bot")
   - Copy the token (looks like: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your values:
   ```bash
   # Required values
   TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
   APTOS_ADDRESS=your_aptos_wallet_address_for_testing
   ```

4. **Start the bot:**
   ```bash
   npm start
   ```

### Deployment to Railway

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Deploy to Railway:**
   - Go to [Railway](https://railway.app)
   - Connect your GitHub repo
   - Add PostgreSQL database (Railway will provide `DATABASE_URL`)
   - Set environment variables in Railway dashboard:
     - `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
     - `JWT_SECRET` - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     - `ENCRYPTION_KEY` - Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     - `NODE_ENV=production`
     - `PORT=3000`
   - Deploy!

3. **Set webhook:**
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://your-app.railway.app/webhook"}'
   ```

## Features

- 🤖 **Group DAO Creation**: Automatically creates group wallets for Telegram groups
- 💰 **Fund Management**: Easy funding and withdrawal of group wallets
- 🔐 **Wallet Management**: Individual wallets for each member
- 📊 **Balance Tracking**: Check personal and group balances
- 🚀 **Simple Commands**: Easy-to-use Telegram commands

## Commands

- `/start` - Show main menu
- `/portfolio` - View your Aptos holdings with USD values
- `/buy` - Select an asset to buy
- `/sell` - Select an asset to sell
- `/settings` - Bot settings (coming soon)

## Tech Stack

- **Backend**: TypeScript/Node.js
- **Blockchain**: Aptos TS SDK
- **Bot**: grammY (Telegram Bot API)
- **Price Data**: CoinGecko API
- **Token Data**: Panora API

## Development Status

✅ **Phase 1 Complete**: Basic bot setup with portfolio management
✅ **Phase 2 Complete**: Real-time price fetching and USD value calculation
🔄 **Phase 3 In Progress**: Buy/sell operations and asset overview
⏳ **Phase 4 Planned**: Advanced trading features and group management

## Troubleshooting

### Common Issues

**Bot not responding:**
- Check if `TELEGRAM_BOT_TOKEN` is correct
- Verify webhook is set: `curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo`
- Check bot logs for errors

**Database connection errors:**
- Verify `DATABASE_URL` format: `postgresql://user:password@host:port/database`
- Check if PostgreSQL is running: `sudo systemctl status postgresql`
- For Docker: `docker ps` to see if container is running

**Aptos connection errors:**
- Check if `APTOS_NODE_URL` is accessible
- Verify network connectivity to Aptos mainnet
- Check logs for specific error messages

**Permission errors:**
- Make sure setup script is executable: `chmod +x scripts/setup.sh`
- Check file permissions in project directory

### Getting Help

- Check the logs: `npm run dev` shows detailed error messages
- Verify all environment variables are set correctly
- Ensure all dependencies are installed: `npm install`

## Contributing

This is a hackathon project. Contributions and suggestions are welcome!

## License

MIT License - see LICENSE file for details