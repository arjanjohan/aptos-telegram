/**
 * Aptos Telegram Bot - Main Entry Point
 *
 * A Telegram bot for trading on Aptos blockchain.
 * Features portfolio management, buy/sell operations, and real-time price tracking.
 */

import { Bot } from './bot/bot.js';

// Start the bot
const bot = new Bot();
bot.start();
