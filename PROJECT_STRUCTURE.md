# Project Structure Overview

This document outlines the improved project structure with centralized configuration management.

## Directory Structure

```
aptos-telegram/
├── src/
│   ├── config/                    # Centralized configuration
│   │   └── index.ts              # Configuration service and getters
│   ├── types/                    # TypeScript type definitions
│   │   └── kanalabs.ts          # Kana Labs API types
│   ├── services/                 # Business logic services
│   │   ├── kanalabs-perps.ts    # Kana Labs Perps API service
│   │   └── holdings-fetcher.ts  # Aptos holdings fetcher
│   ├── utils/                    # Utility functions
│   │   └── usd-value-utils.ts   # USD value calculations
│   ├── bot/                      # Telegram bot implementation
│   │   └── bot.ts               # Main bot class
│   ├── examples/                 # Usage examples
│   │   └── kanalabs-usage.ts    # Kana Labs API examples
│   └── index.ts                  # Application entry point
├── CONFIGURATION.md              # Configuration guide
├── KANA_LABS_README.md          # Kana Labs integration docs
├── PROJECT_STRUCTURE.md         # This file
└── package.json
```

## Key Improvements

### 1. Centralized Configuration (`src/config/index.ts`)

**Benefits:**
- Single source of truth for all configuration
- Environment-specific settings (mainnet/testnet/devnet)
- Type-safe configuration access
- Automatic validation
- Easy to maintain and extend

**Features:**
- Network configuration management
- API key management
- Environment detection
- Configuration validation
- Convenience getters

### 2. Type Safety

**Benefits:**
- All API responses are properly typed
- Configuration is type-safe
- Better IDE support and autocomplete
- Compile-time error checking

### 3. Service Architecture

**Kana Labs Perps Service (`src/services/kanalabs-perps.ts`):**
- Complete API wrapper for all Kana Labs endpoints
- Automatic configuration from centralized config
- Comprehensive error handling
- Type-safe method signatures

**Holdings Fetcher (`src/services/holdings-fetcher.ts`):**
- Fetches Aptos account holdings
- Uses centralized network configuration
- Price integration with CoinGecko
- Filtering and querying capabilities

### 4. Configuration Management

**Environment Variables:**
```bash
# Required
APTOS_ADDRESS=0x...
APTOS_PRIVATE_KEY=...
TELEGRAM_BOT_TOKEN=...
KANA_LABS_API_KEY=...

# Optional
APTOS_NETWORK=mainnet  # mainnet, testnet, devnet
NODE_ENV=development   # development, production, test
```

**Network Support:**
- **Mainnet**: Production Aptos network
- **Testnet**: Testing network with faucet
- **Devnet**: Development network

### 5. Usage Examples

**Basic Usage:**
```typescript
import { KanaLabsPerpsService } from './services/kanalabs-perps.js';
import { getAptosAddress } from './config/index.js';

const perpsService = new KanaLabsPerpsService();
const userAddress = getAptosAddress();
const marketInfo = await perpsService.getMarketInfo('501');
```

**Configuration Access:**
```typescript
import {
  getAptosConfig,
  getKanaLabsConfig,
  getTelegramConfig
} from './config/index.js';

const aptosConfig = getAptosConfig();
const kanaLabsConfig = getKanaLabsConfig();
const telegramConfig = getTelegramConfig();
```

## Configuration Flow

1. **Environment Variables** → Loaded from `.env` file
2. **Configuration Service** → Validates and structures config
3. **Services** → Use configuration via getters
4. **Validation** → Ensures all required config is present

## Benefits of New Structure

### 1. Maintainability
- Single place to update configuration
- Clear separation of concerns
- Easy to add new services or configurations

### 2. Flexibility
- Easy to switch between networks
- Environment-specific configurations
- Override capabilities for testing

### 3. Type Safety
- Compile-time error checking
- Better IDE support
- Self-documenting code

### 4. Testing
- Easy to mock configurations
- Environment-specific test configs
- Validation testing

### 5. Security
- Centralized secret management
- Environment-specific configurations
- Validation prevents misconfigurations

## Migration from Old Structure

### Before:
```typescript
// Scattered configuration
const bot = new GrammyBot(process.env.TELEGRAM_BOT_TOKEN!);
const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
const baseURL = 'https://perps-tradeapi.kanalabs.io';
```

### After:
```typescript
// Centralized configuration
import { getTelegramConfig, getAptosConfig, getKanaLabsConfig } from './config/index.js';

const telegramConfig = getTelegramConfig();
const aptosConfig = getAptosConfig();
const kanaLabsConfig = getKanaLabsConfig();

const bot = new GrammyBot(telegramConfig.botToken);
const aptos = new Aptos(new AptosConfig({ network: aptosConfig.network }));
const baseURL = kanaLabsConfig.baseUrl;
```

## Next Steps

1. **Add more services** as needed (e.g., other DEX integrations)
2. **Extend configuration** for additional features
3. **Add configuration validation** for specific use cases
4. **Implement configuration caching** for performance
5. **Add configuration hot-reloading** for development

## Best Practices

1. **Always use the configuration service** instead of direct `process.env` access
2. **Validate configuration** before starting the application
3. **Use environment-specific configurations** for different deployments
4. **Keep secrets secure** and never commit them to version control
5. **Document new configuration options** in `CONFIGURATION.md`
