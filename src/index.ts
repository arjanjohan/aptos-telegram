/**
 * Aptos Perps Telegram Bot - Main Entry Point
 *
 * A Telegram bot for perpetual futures trading on Aptos blockchain.
 * Features portfolio management, perps trading, and real-time price tracking.
 */

import { Bot } from './bot/bot.js';

// Start the bot
const bot = new Bot();
bot.start();
