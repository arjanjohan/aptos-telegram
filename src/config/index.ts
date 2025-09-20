/**
 * Centralized Configuration Service
 *
 * This module provides a centralized way to manage all configuration
 * including environment variables, network settings, and API endpoints.
 */

import { Network } from '@aptos-labs/ts-sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export type NetworkType = 'mainnet' | 'testnet' | 'devnet';

export interface AptosNetworkConfig {
  network: Network;
  networkUrl: string;
  indexerUrl: string;
  faucetUrl?: string;
}

export interface KanaLabsConfig {
  apiKey: string;
  baseUrl: string;
  perpsApiUrl: string;
}

export interface TelegramConfig {
  botToken: string;
}

export interface AptosAccountConfig {
  address: string;
  privateKey: string;
}

export interface AppConfig {
  aptos: AptosNetworkConfig;
  kanaLabs: KanaLabsConfig;
  telegram: TelegramConfig;
  account: AptosAccountConfig;
  environment: 'development' | 'production' | 'test';
}

class ConfigService {
  private static instance: ConfigService;
  private config: AppConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private loadConfig(): AppConfig {
    const environment = this.loadEnvironment();
    const networkType = this.loadNetworkType();

    return {
      aptos: this.loadAptosConfig(networkType),
      kanaLabs: this.loadKanaLabsConfig(),
      telegram: this.loadTelegramConfig(),
      account: this.loadAccountConfig(),
      environment
    };
  }

  private loadEnvironment(): 'development' | 'production' | 'test' {
    const env = process.env.NODE_ENV || 'development';
    if (['development', 'production', 'test'].includes(env)) {
      return env as 'development' | 'production' | 'test';
    }
    return 'development';
  }

  private loadNetworkType(): NetworkType {
    const network = process.env.APTOS_NETWORK || 'mainnet'; // Default to mainnet
    if (['mainnet', 'testnet', 'devnet'].includes(network)) {
      return network as NetworkType;
    }
    return 'mainnet';
  }

  private loadAptosConfig(networkType: NetworkType): AptosNetworkConfig {
    const configs: Record<NetworkType, AptosNetworkConfig> = {
      mainnet: {
        network: Network.MAINNET,
        networkUrl: 'https://mainnet.aptoslabs.com/v1',
        indexerUrl: 'https://indexer.mainnet.aptoslabs.com/v1/graphql'
      },
      testnet: {
        network: Network.TESTNET,
        networkUrl: 'https://testnet.aptoslabs.com/v1',
        indexerUrl: 'https://api.testnet.aptoslabs.com/v1/graphql',
        faucetUrl: 'https://faucet.testnet.aptoslabs.com'
      },
      devnet: {
        network: Network.DEVNET,
        networkUrl: 'https://fullnode.devnet.aptoslabs.com/v1',
        indexerUrl: 'https://indexer-devnet.aptoslabs.com/v1/graphql',
        faucetUrl: 'https://faucet.devnet.aptoslabs.com'
      }
    };

    return configs[networkType];
  }

  private loadKanaLabsConfig(): KanaLabsConfig {
    // Get network type to determine correct API URLs
    const networkType = this.loadNetworkType();

    // Use the same API key for all networks
    const apiKey = process.env.KANA_LABS_API_KEY;
    if (!apiKey) {
      throw new Error('KANA_LABS_API_KEY environment variable is required');
    }

    const urls = {
      mainnet: {
        baseUrl: 'https://perps-tradeapi.kana.trade',
        perpsApiUrl: 'https://perps-tradeapi.kana.trade'
      },
      testnet: {
        baseUrl: 'https://perps-tradeapi.kanalabs.io',
        perpsApiUrl: 'https://perps-tradeapi.kanalabs.io'
      },
      devnet: {
        baseUrl: 'https://perps-tradeapi.kanalabs.io',
        perpsApiUrl: 'https://perps-tradeapi.kanalabs.io'
      }
    };

    return {
      apiKey,
      baseUrl: urls[networkType].baseUrl,
      perpsApiUrl: urls[networkType].perpsApiUrl
    };
  }

  private loadTelegramConfig(): TelegramConfig {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
    }

    return {
      botToken
    };
  }

  private loadAccountConfig(): AptosAccountConfig {
    const address = process.env.APTOS_ADDRESS;
    const privateKey = process.env.APTOS_PRIVATE_KEY;

    if (!address) {
      throw new Error('APTOS_ADDRESS environment variable is required');
    }

    if (!privateKey) {
      throw new Error('APTOS_PRIVATE_KEY environment variable is required');
    }

    return {
      address,
      privateKey
    };
  }

  // Public getters
  public getConfig(): AppConfig {
    return this.config;
  }

  public getAptosConfig(): AptosNetworkConfig {
    return this.config.aptos;
  }

  public getKanaLabsConfig(): KanaLabsConfig {
    return this.config.kanaLabs;
  }

  public getTelegramConfig(): TelegramConfig {
    return this.config.telegram;
  }

  public getAccountConfig(): AptosAccountConfig {
    return this.config.account;
  }

  public getEnvironment(): 'development' | 'production' | 'test' {
    return this.config.environment;
  }

  public isDevelopment(): boolean {
    return this.config.environment === 'development';
  }

  public isProduction(): boolean {
    return this.config.environment === 'production';
  }

  public isTest(): boolean {
    return this.config.environment === 'test';
  }

  public getNetworkType(): NetworkType {
    const network = this.config.aptos.network;
    if (network === Network.MAINNET) return 'mainnet';
    if (network === Network.TESTNET) return 'testnet';
    if (network === Network.DEVNET) return 'devnet';
    return 'mainnet';
  }

  public isMainnet(): boolean {
    return this.getNetworkType() === 'mainnet';
  }

  public isTestnet(): boolean {
    return this.getNetworkType() === 'testnet';
  }

  // Convenience methods for common configurations
  public getAptosNetwork(): Network {
    return this.config.aptos.network;
  }

  public getAptosNetworkUrl(): string {
    return this.config.aptos.networkUrl;
  }

  public getAptosIndexerUrl(): string {
    return this.config.aptos.indexerUrl;
  }

  public getKanaLabsApiKey(): string {
    return this.config.kanaLabs.apiKey;
  }

  public getKanaLabsBaseUrl(): string {
    return this.config.kanaLabs.baseUrl;
  }

  public getTelegramBotToken(): string {
    return this.config.telegram.botToken;
  }

  public getAptosAddress(): string {
    return this.config.account.address;
  }

  public getAptosPrivateKey(): string {
    return this.config.account.privateKey;
  }

  // Method to reload configuration (useful for testing)
  public reloadConfig(): void {
    this.config = this.loadConfig();
  }

  // Method to validate configuration
  public validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      this.loadKanaLabsConfig();
    } catch (error) {
      errors.push('Kana Labs configuration is invalid');
    }

    try {
      this.loadTelegramConfig();
    } catch (error) {
      errors.push('Telegram configuration is invalid');
    }

    try {
      this.loadAccountConfig();
    } catch (error) {
      errors.push('Aptos account configuration is invalid');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export const config = ConfigService.getInstance();

// Export the class for testing
export { ConfigService };

// Export convenience functions
export const getConfig = () => config.getConfig();
export const getAptosConfig = () => config.getAptosConfig();
export const getKanaLabsConfig = () => config.getKanaLabsConfig();
export const getTelegramConfig = () => config.getTelegramConfig();
export const getAccountConfig = () => config.getAccountConfig();
export const getEnvironment = () => config.getEnvironment();
export const isDevelopment = () => config.isDevelopment();
export const isProduction = () => config.isProduction();
export const isTest = () => config.isTest();
export const getNetworkType = () => config.getNetworkType();
export const isMainnet = () => config.isMainnet();
export const isTestnet = () => config.isTestnet();
export const getAptosNetwork = () => config.getAptosNetwork();
export const getAptosNetworkUrl = () => config.getAptosNetworkUrl();
export const getAptosIndexerUrl = () => config.getAptosIndexerUrl();
export const getKanaLabsApiKey = () => config.getKanaLabsApiKey();
export const getKanaLabsBaseUrl = () => config.getKanaLabsBaseUrl();
export const getTelegramBotToken = () => config.getTelegramBotToken();
export const getAptosAddress = () => config.getAptosAddress();
export const getAptosPrivateKey = () => config.getAptosPrivateKey();
export const validateConfig = () => config.validateConfig();
