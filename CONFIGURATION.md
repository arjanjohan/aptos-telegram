# Configuration Guide

This project uses a centralized configuration system to manage all environment variables, network settings, and API endpoints.

## Environment Variables

Create a `.env` file in the project root with the following variables:

### Required Variables

```bash
# Aptos Configuration
APTOS_ADDRESS=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
APTOS_PRIVATE_KEY=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=1234567890:ABCDEFghijklmnopqrstuvwxyz1234567890

# Kana Labs Configuration
KANA_LABS_API_KEY=your_kana_labs_api_key_here
```

### Optional Variables

```bash
# Aptos Network (defaults to mainnet)
APTOS_NETWORK=mainnet  # Options: mainnet, testnet, devnet

# Node Environment (defaults to development)
NODE_ENV=development  # Options: development, production, test

# CoinGecko API Key (optional, for enhanced price data)
COINGECKO_API_KEY=your_coingecko_api_key_here
```

## Network Configurations

The system automatically configures network URLs based on the `APTOS_NETWORK` variable:

### Mainnet (default)
- Network URL: `https://mainnet.aptoslabs.com/v1`
- Indexer URL: `https://indexer.mainnet.aptoslabs.com/v1/graphql`

### Testnet
- Network URL: `https://testnet.aptoslabs.com/v1`
- Indexer URL: `https://api.testnet.aptoslabs.com/v1/graphql`
- Faucet URL: `https://faucet.testnet.aptoslabs.com`


## Using the Configuration

### Import Configuration Functions

```typescript
import {
  getAptosConfig,
  getKanaLabsConfig,
  getTelegramConfig,
  getAccountConfig,
  getAptosNetwork,
  getAptosNetworkUrl,
  getAptosIndexerUrl,
  getKanaLabsApiKey,
  getTelegramBotToken,
  getAptosAddress,
  getAptosPrivateKey
} from './config/index.js';
```

### Example Usage

```typescript
// Get complete configurations
const aptosConfig = getAptosConfig();
const kanaLabsConfig = getKanaLabsConfig();
const telegramConfig = getTelegramConfig();
const accountConfig = getAccountConfig();

// Get specific values
const network = getAptosNetwork();
const networkUrl = getAptosNetworkUrl();
const apiKey = getKanaLabsApiKey();
const botToken = getTelegramBotToken();
const address = getAptosAddress();
const privateKey = getAptosPrivateKey();
```

### Configuration Validation

```typescript
import { validateConfig } from './config/index.js';

const validation = validateConfig();
if (!validation.isValid) {
  console.error('Configuration errors:', validation.errors);
}
```

## Service Integration

All services automatically use the centralized configuration:

### Kana Labs Perps Service
```typescript
import { KanaLabsPerpsService } from './services/kanalabs-perps.js';

// Automatically uses KANA_LABS_API_KEY from config
const perpsService = new KanaLabsPerpsService();

// Or override with custom API key
const perpsService = new KanaLabsPerpsService('custom-api-key');
```

### Holdings Fetcher
```typescript
import { createHoldingsFetcher } from './services/holdings-fetcher.js';

// Automatically uses network URLs from config
const fetcher = createHoldingsFetcher();

// Or override with custom URLs
const fetcher = createHoldingsFetcher({
  networkUrl: 'https://custom-network.com/v1',
  indexerUrl: 'https://custom-indexer.com/v1/graphql'
});
```

### Telegram Bot
```typescript
import { Bot } from './bot/bot.js';

// Automatically uses all configurations
const bot = new Bot();
```

## Environment-Specific Configurations

### Development
```bash
NODE_ENV=development
APTOS_NETWORK=testnet
```

### Production
```bash
NODE_ENV=production
APTOS_NETWORK=mainnet
```

### Testing
```bash
NODE_ENV=test
APTOS_NETWORK=devnet
```

## Security Best Practices

1. **Never commit `.env` files** to version control
2. **Use testnet for development** and testing
3. **Keep private keys secure** and never share them
4. **Regularly rotate API keys**
5. **Use environment-specific configurations** for different deployments
6. **Validate configuration** before starting the application

## Troubleshooting

### Common Issues

1. **Missing environment variables**: Check that all required variables are set
2. **Invalid network configuration**: Ensure `APTOS_NETWORK` is one of: mainnet, testnet, devnet
3. **API key errors**: Verify that API keys are correct and have proper permissions
4. **Network connectivity**: Ensure the configured network URLs are accessible

### Configuration Validation

The system automatically validates configuration on startup. If validation fails, the application will not start and will display specific error messages.

### Debug Mode

Set `NODE_ENV=development` to enable debug logging and more detailed error messages.
