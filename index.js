import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class TokenTracker {
    constructor(tokenAddress, rpcUrl = 'https://solana-mainnet.api.syndica.io/api-key/fauDSBeyaV6PMwua8GV4uyedCMtCT3TmCHKKnZXjyn5eZKxs2ZazVhmVBKY8cHnpn1NoaL2wtvsceMuqosiewAyWdufM5CvGGF') {
        this.tokenAddress = new PublicKey(tokenAddress);
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.totalTokens = 0;
        this.tokenInfo = null;
    }

    async getTokenInfo() {
        try {
            // Get mint info
            const mintInfo = await getMint(this.connection, this.tokenAddress);
            
            // Get Metaplex metadata
            const metadataPDA = await this.getMetadataPDA(this.tokenAddress);
            const accountInfo = await this.connection.getAccountInfo(metadataPDA);
            
            if (accountInfo) {
                // Parse metadata
                const metadata = await this.decodeMetadata(accountInfo.data);
                
                this.tokenInfo = {
                    name: metadata.data.name,
                    symbol: metadata.data.symbol,
                    decimals: mintInfo.decimals,
                    supply: Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals),
                    uri: metadata.data.uri
                };

                logger.success(`Token Name: ${this.tokenInfo.name}`);
                logger.success(`Token Symbol: ${this.tokenInfo.symbol}`);
                logger.success(`Token Decimals: ${this.tokenInfo.decimals}`);
                logger.success(`Total Supply: ${this.tokenInfo.supply.toLocaleString()}`);
            }
            return this.tokenInfo;
        } catch (error) {
            logger.error(`Error fetching token info: ${error.message}`);
        }
    }

    async getMetadataPDA(mintAddress) {
        const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
        const [metadataAddress] = await PublicKey.findProgramAddress(
            [
                Buffer.from('metadata'),
                METADATA_PROGRAM_ID.toBuffer(),
                new PublicKey(mintAddress).toBuffer(),
            ],
            METADATA_PROGRAM_ID
        );
        return metadataAddress;
    }

    async decodeMetadata(buffer) {
        // Basic metadata structure
        let offset = 0;
        const metadata = {
            key: buffer[0],
            updateAuthority: new PublicKey(buffer.slice(1, 33)),
            mint: new PublicKey(buffer.slice(33, 65)),
            data: {
                name: '',
                symbol: '',
                uri: '',
            },
        };

        // Get name length and name
        const nameLength = buffer[65];
        metadata.data.name = buffer.slice(66, 66 + nameLength).toString('utf8').replace(/\0/g, '');
        offset = 66 + nameLength;

        // Get symbol length and symbol
        const symbolLength = buffer[offset];
        metadata.data.symbol = buffer.slice(offset + 1, offset + 1 + symbolLength).toString('utf8').replace(/\0/g, '');
        offset = offset + 1 + symbolLength;

        // Get uri length and uri
        const uriLength = buffer[offset];
        metadata.data.uri = buffer.slice(offset + 1, offset + 1 + uriLength).toString('utf8').replace(/\0/g, '');

        return metadata;
    }

    async getTokenBalance(walletAddress) {
        try {
            const wallet = new PublicKey(walletAddress);
            const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
                wallet,
                { mint: this.tokenAddress }
            );

            if (tokenAccounts.value.length > 0) {
                const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
                return parseFloat(balance.uiAmount || 0);
            }
            return 0;
        } catch (error) {
            console.error(chalk.red(`Error getting balance for ${walletAddress}: ${error.message}`));
            return 0;
        }
    }

    async processWallets(walletFile) {
        try {
            console.log(chalk.cyan('Starting Token Balance Check...'));
            console.log('-'.repeat(50));

            // Get token info first
            await this.getTokenInfo();

            // Read wallet addresses from file
            const fileContent = await fs.readFile(walletFile, 'utf8');
            const wallets = fileContent.split('\n').map(line => line.trim()).filter(line => line);

            let walletsWithBalance = 0;
            let largestHolder = { address: '', balance: 0 };
            const balances = [];

            // Process each wallet
            for (const wallet of wallets) {
                const balance = await this.getTokenBalance(wallet);
                this.totalTokens += balance;

                if (balance > 0) {
                    walletsWithBalance++;
                }

                if (balance > largestHolder.balance) {
                    largestHolder = { address: wallet, balance };
                }

                balances.push({ wallet, balance });

                // Color coding based on balance percentage of total supply
                let balanceColor = 'red';
                const percentOfSupply = (balance / this.tokenInfo.supply) * 100;
                
                if (percentOfSupply > 1) balanceColor = 'green';
                else if (percentOfSupply > 0.1) balanceColor = 'yellow';
                
                console.log(chalk.white(`Wallet: ${wallet.slice(0, 8)}...${wallet.slice(-6)}`));
                console.log(chalk[balanceColor](`Balance: ${balance.toLocaleString()} ${this.tokenInfo.symbol}`));
                console.log(chalk.blue(`Percent of Supply: ${percentOfSupply.toFixed(4)}%`));
                console.log('-'.repeat(50));

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Summary
            console.log(chalk.green('\nSUMMARY'));
            console.log(chalk.cyan(`Token Name: ${this.tokenInfo.name}`));
            console.log(chalk.cyan(`Token Symbol: ${this.tokenInfo.symbol}`));
            console.log(chalk.cyan(`Total Supply: ${this.tokenInfo.supply.toLocaleString()}`));
            console.log(chalk.cyan(`Total wallets checked: ${wallets.length}`));
            console.log(chalk.cyan(`Wallets with balance: ${walletsWithBalance}`));
            console.log(chalk.cyan(`Total tokens tracked: ${this.totalTokens.toLocaleString()}`));
            console.log(chalk.cyan(`Percent of supply tracked: ${((this.totalTokens / this.tokenInfo.supply) * 100).toFixed(2)}%`));
            console.log(chalk.cyan(`Average tokens per holder: ${(this.totalTokens / walletsWithBalance).toLocaleString()}`));
            console.log(chalk.yellow(`\nLargest holder: ${largestHolder.address.slice(0, 8)}...${largestHolder.address.slice(-6)}`));
            console.log(chalk.yellow(`Largest balance: ${largestHolder.balance.toLocaleString()} tokens (${((largestHolder.balance / this.tokenInfo.supply) * 100).toFixed(2)}% of supply)`));

            // Save report
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const report = {
                timestamp: new Date().toISOString(),
                tokenAddress: this.tokenAddress.toString(),
                tokenInfo: this.tokenInfo,
                totalWallets: wallets.length,
                walletsWithBalance,
                totalTokensTracked: this.totalTokens,
                percentOfSupplyTracked: (this.totalTokens / this.tokenInfo.supply) * 100,
                largestHolder,
                balances: balances.map(b => ({
                    address: b.wallet,
                    balance: b.balance,
                    percentOfSupply: (b.balance / this.tokenInfo.supply) * 100
                }))
            };

            await fs.writeFile(
                `token-report-${timestamp}.json`, 
                JSON.stringify(report, null, 2)
            );
            logger.success(`Report saved to token-report-${timestamp}.json`);

        } catch (error) {
            if (error.code === 'ENOENT') {
                console.error(chalk.red('Error: wallet.txt file not found!'));
            } else {
                console.error(chalk.red(`Error: ${error.message}`));
            }
        }
    }
}

// Create logger function for different message types
const logger = {
    info: (msg) => console.log(chalk.blue('ℹ '), msg),
    success: (msg) => console.log(chalk.green('✔ '), msg),
    error: (msg) => console.log(chalk.red('✖ '), msg),
    warning: (msg) => console.log(chalk.yellow('⚠ '), msg)
};

async function main() {
    const TOKEN_ADDRESS = '43VWkd99HjqkhFTZbWBpMpRhjG469nWa7x7uEsgSH7We';
    
    logger.info('Initializing Token Balance Tracker...');
    const tracker = new TokenTracker(TOKEN_ADDRESS);
    
    logger.info('Processing wallet addresses...');
    await tracker.processWallets('wallet.txt');
}

// Error handling
process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', (error) => {
    logger.error(`Unhandled Rejection: ${error.message}`);
    process.exit(1);
});

main().catch((error) => {
    logger.error(`Main process error: ${error.message}`);
    process.exit(1);
});