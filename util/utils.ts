/**
 * Copyright (c) 2024 Blockchain at Berkeley.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * SPDX-License-Identifier: MIT
 */

import { ethers } from "ethers";
import { ConnectedWallet } from "@privy-io/react-auth";
import {
  OrderBookApi,
  OrderSigningUtils,
  SupportedChainId,
  OrderQuoteSideKindSell,
  SigningScheme,
  COW_PROTOCOL_VAULT_RELAYER_ADDRESS,
  OrderQuoteRequest,
  OrderStatus,
} from "@cowprotocol/cow-sdk";
type Address = string;

// Add Uniswap V2 constants
const UNISWAP_V2_ROUTER: { [key: number]: string } = {
  1: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // mainnet
  11155111: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008", // sepolia
};

const UNISWAP_V2_FACTORY: { [key: number]: string } = {
  1: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // mainnet
  11155111: "0x7E0987E5b3a30e3f2828572Bb659A548460a3003", // sepolia
};

// Uniswap V2 Router ABI
const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
];

// Add Uniswap V2 Factory ABI
const UNISWAP_V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)"
];

const decimalConverter: { [key: number]: { [key: string]: number } } = {
  11155111: {
    // sepolia
    "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9": 18, // Sepolia WETH
    "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8": 6, // cowswap testnet USDC (cowswap liquidity address)
    "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238": 6, // transfer testnet USDC
    "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4": 6, // testnet EURC
    "0xB4F1737Af37711e9A5890D9510c9bB60e170CB0D": 18, // cowswap test DAI
    "0xbe72E441BF55620febc26715db68d3494213D8Cb": 18, // cowswap test USDC (if applicable)
  },
  1: {
    // mainnet
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 18, // WETH
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 6, // USDC
    "0x6B175474E89094C44Da98b954EedeAC495271d0F": 18, // DAI
    "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c": 6, // EURC
  },
};

export const chainToUrl: Record<string, string> = {
  sepolia: "https://sepolia.etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  mainnet: "https://etherscan.io/tx",
};

const supportedChains: { [key: string]: number } = {
  sepolia: 11155111,
  mainnet: 1,
  base: 8453,
};

const mainnetRpcUrls = [
  "https://eth.llamarpc.com",
  "https://ethereum.publicnode.com",
  "https://1rpc.io/eth",
  "https://rpc.ankr.com/eth", 
];

// Create a provider with fallback mechanism
const createMainnetProvider = (): ethers.providers.Provider => {
  // Try JsonRpcProviders first
  for (const url of mainnetRpcUrls) {
    try {
      return new ethers.providers.JsonRpcProvider(url);
    } catch (e) {
      console.warn(`Failed to connect to RPC ${url}`, e);
    }
  }
  
  // If all else fails, use Ethers' built-in default provider which has its own fallbacks
  console.warn("All RPC connections failed, using default provider");
  return ethers.getDefaultProvider('mainnet');
};

// Create the provider once
const mainnetProvider = createMainnetProvider();

const resolveNameOrAddress = async (addressOrENS: string): Promise<string> => {
  if (ethers.utils.isAddress(addressOrENS)) {
    return addressOrENS;
  }
  
  try {
    const resolved = await mainnetProvider.resolveName(addressOrENS);
    if (resolved) {
      return resolved;
    }
    throw new Error("Could not resolve ENS name");
  } catch (error) {
    console.error("ENS resolution failed:", error);
    throw new Error(`Could not resolve name '${addressOrENS}'. Please use a valid ENS name or Ethereum address.`);
  }
};

const ERC20_ABI = [
  // Read-Only Functions
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",

  // Authenticated Functions
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",

  // Events
  "event Transfer(address indexed from, address indexed to, uint amount)",
];

// Helper function to check allowance and submit an approval if necessary
async function checkAllowanceAndApproveIfNecessary(
  targetContract: string,
  tokenContract: string,
  signer: ethers.providers.JsonRpcSigner,
  requiredAmount: ethers.BigNumber
): Promise<void> {
  const sellTokenContract = new ethers.Contract(
    tokenContract,
    ERC20_ABI,
    signer
  );
  console.log(sellTokenContract);

  const existingAllowance: ethers.BigNumber = await sellTokenContract.allowance(
    await signer.getAddress(),
    targetContract
  );
  const sellAmountBn = ethers.BigNumber.from(requiredAmount);
  if (existingAllowance.gte(sellAmountBn)) {
    console.log("existing allowance is sufficient");
  } else {
    const sellTokenSigner = sellTokenContract.connect(signer);
    const tx = await await sellTokenSigner.approve(
      targetContract,
      ethers.constants.MaxUint256
    );
    console.log("Sending approval transaction...");
    // Waiting for the transaction to be mined
    const receipt = await tx.wait();
    // The transaction is now on chain!
    console.log(`Approval finalized in block ${receipt.blockNumber}`);
  }
}

export const abbreviateTransactionHash = (hash: string) => {
  if (!hash) return "";
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

export const BACKEND_URL = "http://localhost:8000/";

/**
 * Asynchronously waits for the specified number of milliseconds.
 * @param ms - The number of milliseconds to wait.
 * @returns {Promise<void>} - A Promise that resolves after the specified time.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export async function sendTransaction(
  wallets: ConnectedWallet[],
  receiver: Address,
  amount: string,
  chain: string,
  erc20ContractAddress: Address
): Promise<ethers.providers.TransactionResponse> {
  if (!wallets[0]) {
    throw new Error("No wallet is connected!");
  }

  const chainId = supportedChains[chain];
  if (chainId === undefined) {
    throw new Error("Unsupported chain");
  }

  await wallets[0].switchChain(chainId);
  const provider = await wallets[0].getEthersProvider();
  const signer = provider.getSigner();

  const contract = new ethers.Contract(erc20ContractAddress, ERC20_ABI, signer);

  const chainDecimals = decimalConverter[chainId];
  if (chainDecimals === undefined) {
    throw new Error(`No decimals for chain: ${chain}`);
  }

  const decimals = chainDecimals[erc20ContractAddress];
  if (decimals === undefined) {
    throw new Error(`No decimals for token: ${erc20ContractAddress}`);
  }

  const amount_decimals = ethers.utils.parseUnits(amount, decimals);
  const contractSigner = contract.connect(signer);

  let receiverAddress: string;
  try {
    receiverAddress = await resolveNameOrAddress(receiver);
  } catch (error) {
    // Try one more time with direct wallet provider if possible
    if (!ethers.utils.isAddress(receiver) && chain === 'mainnet') {
      try {
        // If we're on mainnet, try to resolve directly with the wallet's provider
        console.log("Trying to resolve ENS with wallet provider");
        const resolved = await provider.resolveName(receiver);
        if (resolved) {
          receiverAddress = resolved;
        } else {
          throw error; // Re-throw if still null
        }
      } catch (secondError) {
        // If both resolution attempts fail, throw a user-friendly error
        console.error("Both ENS resolution attempts failed:", secondError);
        throw new Error(`Could not resolve name '${receiver}'. Please use a valid ENS name or Ethereum address.`);
      }
    } else {
      throw error;
    }
  }

  console.log("Sending transaction...");
  const tx = await contractSigner.transfer(receiverAddress, amount_decimals);
  return tx;
}

export async function sendOrder(
  wallets: ConnectedWallet[],
  chain: string,
  fromAsset: string,
  toAsset: string,
  amount: string
): Promise<string> {
  const chainId = supportedChains[chain];
  if (chainId === undefined) {
    throw new Error("Unsupported chain");
  }

  if (!wallets[0]) {
    throw new Error("No wallet is connected!");
  }

  await wallets[0].switchChain(chainId);

  const provider = await wallets[0].getEthersProvider();
  const signer = provider.getSigner();
  const fromAddress = await signer.getAddress();

  const chainDecimals = decimalConverter[chainId];
  if (chainDecimals === undefined) {
    throw new Error(`No decimals for chain: ${chain}`);
  }

  const decimals = chainDecimals[fromAsset];
  if (decimals === undefined) {
    throw new Error(`No decimals for token: ${fromAsset}`);
  }

  const amountDecimals = ethers.utils.parseUnits(amount, decimals).toString();
  const slippage = 0.05;

  const quoteRequest: OrderQuoteRequest = {
    sellToken: fromAsset,
    buyToken: toAsset,
    from: fromAddress,
    receiver: fromAddress,
    sellAmountBeforeFee: amountDecimals,
    kind: OrderQuoteSideKindSell.SELL,
  };

  const vaultAddr =
    COW_PROTOCOL_VAULT_RELAYER_ADDRESS[chainId as SupportedChainId];
  await checkAllowanceAndApproveIfNecessary(
    vaultAddr,
    fromAsset,
    signer,
    ethers.BigNumber.from(amountDecimals)
  );

  const orderBookApi = new OrderBookApi({ chainId: chainId });
  try {
    const { quote, ...quoteParams } = await orderBookApi.getQuote(quoteRequest);

    quote.feeAmount = "0";
    quote.sellAmount = amountDecimals;
    quote.buyAmount = Math.round(
      Number(quote.buyAmount) * (1 - slippage)
    ).toString();

    const orderSigningResult = await OrderSigningUtils.signOrder(
      { ...quote, receiver: fromAddress },
      chainId,
      signer
    );

    const orderObj = {
      ...quote,
      ...orderSigningResult,
      signingScheme: SigningScheme.EIP712,
      quoteId: quoteParams.id,
      from: fromAddress,
    };

    return await orderBookApi.sendOrder(orderObj);
  } catch (error: any) {
    // Properly propagate NoLiquidity error with appropriate message
    if (error.body && error.body.errorType === "NoLiquidity") {
      throw new Error(`NoLiquidity: ${error.body.description || "No route found between these tokens"}`);
    }
    // Rethrow the original error
    throw error;
  }
}

export async function waitForOrderStatus(
  orderId: string,
  chain: string
): Promise<OrderStatus> {
  const chainId = supportedChains[chain];
  if (chainId === undefined) {
    throw new Error("Unsupported chain");
  }

  const orderBookApi = new OrderBookApi({ chainId: chainId });
  let orderStatus: OrderStatus = OrderStatus.OPEN;
  while (orderStatus == OrderStatus.OPEN) {
    // wait three seconds
    await sleep(3000);
    const enrichedOrder = await orderBookApi.getOrder(orderId);
    orderStatus = enrichedOrder.status;
  }
  return orderStatus;
}

/**
 * Checks if a liquidity pool exists between two tokens
 * @param provider Ethers provider
 * @param factoryAddress Uniswap V2 Factory address
 * @param tokenA First token address
 * @param tokenB Second token address
 * @returns True if a pool exists, false otherwise
 */
async function checkLiquidityPoolExists(
  provider: ethers.providers.Provider,
  factoryAddress: string,
  tokenA: string,
  tokenB: string
): Promise<boolean> {
  try {
    const factory = new ethers.Contract(
      factoryAddress,
      UNISWAP_V2_FACTORY_ABI,
      provider
    );
    
    const pairAddress = await factory.getPair(tokenA, tokenB);
    return pairAddress !== ethers.constants.AddressZero;
  } catch (error) {
    console.error("Error checking liquidity pool:", error);
    return false;
  }
}

/**
 * Performs a token swap using Uniswap V2
 * @param wallets Connected wallets
 * @param chain Chain to use for the swap
 * @param fromAsset Token address to swap from
 * @param toAsset Token address to swap to
 * @param amount Amount to swap in human readable format
 * @returns The transaction hash
 */
export async function uniswapV2Swap(
  wallets: ConnectedWallet[],
  chain: string,
  fromAsset: string,
  toAsset: string,
  amount: string
): Promise<string> {
  if (!wallets[0]) {
    throw new Error("No wallet is connected!");
  }

  const chainId = supportedChains[chain];
  if (chainId === undefined) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Get router contract address for this chain
  const routerAddress = UNISWAP_V2_ROUTER[chainId];
  if (!routerAddress) {
    throw new Error(`No Uniswap Router found for chain: ${chain}`);
  }
  
  // Get factory address for this chain
  const factoryAddress = UNISWAP_V2_FACTORY[chainId];
  if (!factoryAddress) {
    throw new Error(`No Uniswap Factory found for chain: ${chain}`);
  }

  await wallets[0].switchChain(chainId);
  const provider = await wallets[0].getEthersProvider();
  const signer = provider.getSigner();
  const fromAddress = await signer.getAddress();

  const chainDecimals = decimalConverter[chainId];
  if (chainDecimals === undefined) {
    throw new Error(`No decimals for chain: ${chain}`);
  }

  const decimals = chainDecimals[fromAsset];
  if (decimals === undefined) {
    throw new Error(`No decimals for token: ${fromAsset}`);
  }

  // Parse the amount with correct decimals
  const amountDecimals = ethers.utils.parseUnits(amount, decimals);
  
  // Initialize the Uniswap Router contract
  const uniswapRouter = new ethers.Contract(
    routerAddress,
    UNISWAP_V2_ROUTER_ABI,
    signer
  );

  // Create the token contract to approve spending
  const tokenContract = new ethers.Contract(
    fromAsset,
    ERC20_ABI,
    signer
  );
  
  // Check and set allowance
  await checkAllowanceAndApproveIfNecessary(
    routerAddress,
    fromAsset,
    signer,
    amountDecimals
  );

  // Define WETH address for the chain
  const WETH_ADDRESS = chainId === 11155111 
    ? "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9" // Sepolia WETH
    : "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // Mainnet WETH
    
  // Check if direct pool exists
  const directPoolExists = await checkLiquidityPoolExists(
    provider,
    factoryAddress,
    fromAsset,
    toAsset
  );
  
  console.log(`Direct pool between tokens exists: ${directPoolExists}`);
  
  // Check if pools with WETH exist
  const fromWethPoolExists = await checkLiquidityPoolExists(
    provider,
    factoryAddress,
    fromAsset,
    WETH_ADDRESS
  );
  
  const toWethPoolExists = await checkLiquidityPoolExists(
    provider,
    factoryAddress,
    WETH_ADDRESS,
    toAsset
  );
  
  console.log(`Pool from asset to WETH exists: ${fromWethPoolExists}`);
  console.log(`Pool from WETH to target asset exists: ${toWethPoolExists}`);
  
  // Determine the best path
  let path: string[];
  
  if (directPoolExists) {
    path = [fromAsset, toAsset];
    console.log("Using direct swap path");
  } else if (fromWethPoolExists && toWethPoolExists) {
    path = [fromAsset, WETH_ADDRESS, toAsset];
    console.log("Using WETH as intermediary");
  } else {
    console.log("No viable swap path found. Attempting to create necessary pools...");
    
    try {
      // Try to create direct pool first
      if (!directPoolExists) {
        try {
          await createLiquidityPoolIfNeeded(signer, factoryAddress, fromAsset, toAsset);
          path = [fromAsset, toAsset];
          console.log("Created direct pool and using direct swap path");
        } catch (error) {
          console.error("Failed to create direct pool:", error);
          
          // If direct pool creation fails, try creating pools with WETH
          if (!fromWethPoolExists) {
            await createLiquidityPoolIfNeeded(signer, factoryAddress, fromAsset, WETH_ADDRESS);
          }
          
          if (!toWethPoolExists) {
            await createLiquidityPoolIfNeeded(signer, factoryAddress, WETH_ADDRESS, toAsset);
          }
          
          path = [fromAsset, WETH_ADDRESS, toAsset];
          console.log("Created WETH intermediary pools and using WETH as intermediary");
        }
      } else {
        // This should never happen, but initialize path to avoid linter error
        path = [fromAsset, WETH_ADDRESS, toAsset];
      }
    } catch (error) {
      console.error("Failed to create necessary liquidity pools:", error);
      throw new Error("No viable swap path found and failed to create necessary liquidity pools. There is no liquidity for this pair.");
    }
  }

  // Set up the swap parameters with WETH as an intermediary
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
  const slippage = 0.05; // 5% slippage

  try {
    // Get the expected output amount
    const amounts = await uniswapRouter.getAmountsOut(amountDecimals, path);
    const outputIndex = path.length - 1;
    const amountOutMin = amounts[outputIndex].mul(ethers.BigNumber.from(100 - Math.floor(slippage * 100))).div(ethers.BigNumber.from(100));

    console.log(`Swapping ${amount} of ${fromAsset} to ${toAsset}`);
    console.log(`Expected output amount: ${ethers.utils.formatUnits(amounts[outputIndex], chainDecimals[toAsset] || 18)}`);
    console.log(`Minimum output amount: ${ethers.utils.formatUnits(amountOutMin, chainDecimals[toAsset] || 18)}`);
    
    // Execute the swap transaction
    const tx = await uniswapRouter.swapExactTokensForTokens(
      amountDecimals,
      amountOutMin,
      path,
      fromAddress,
      deadline,
      { gasLimit: 500000 } // Add explicit gas limit to avoid underestimation
    );

    console.log(`Swap transaction sent! Hash: ${tx.hash}`);
    return tx.hash;
  } catch (error: any) {
    console.error("Uniswap swap error:", error);
    
    // Check if it's a liquidity issue
    if (error.message && error.message.includes("INSUFFICIENT_OUTPUT_AMOUNT")) {
      throw new Error("Insufficient liquidity for this swap pair");
    }
    
    // If we get here, something else went wrong
    throw new Error(`Swap failed: ${error.message}`);
  }
}

/**
 * Creates a liquidity pool between two tokens if it doesn't exist
 * @param signer Ethers signer
 * @param factoryAddress Uniswap V2 Factory address
 * @param tokenA First token address
 * @param tokenB Second token address
 * @returns The pair address
 */
async function createLiquidityPoolIfNeeded(
  signer: ethers.providers.JsonRpcSigner,
  factoryAddress: string,
  tokenA: string,
  tokenB: string
): Promise<string> {
  try {
    const factory = new ethers.Contract(
      factoryAddress,
      UNISWAP_V2_FACTORY_ABI,
      signer
    );
    
    // Check if pair already exists
    const pairAddress = await factory.getPair(tokenA, tokenB);
    if (pairAddress !== ethers.constants.AddressZero) {
      console.log(`Pair already exists at ${pairAddress}`);
      return pairAddress;
    }
    
    // Create the pair
    console.log(`Creating pair between ${tokenA} and ${tokenB}`);
    const tx = await factory.createPair(tokenA, tokenB);
    await tx.wait();
    
    // Get the new pair address
    const newPairAddress = await factory.getPair(tokenA, tokenB);
    console.log(`Created new pair at ${newPairAddress}`);
    return newPairAddress;
  } catch (error) {
    console.error("Error creating liquidity pool:", error);
    throw new Error("Failed to create liquidity pool");
  }
}

// MoonPay URLs
const MOONPAY_BASE_URL = "https://buy.moonpay.com";
const MOONPAY_API_KEY = "pk_test_1234567890"; // Replace with your actual publishable API key

/**
 * Processes a fiat-to-crypto purchase request by creating a MoonPay widget URL
 * @param wallets Connected wallets
 * @param buyAmount Amount of crypto to buy in USD
 * @param cryptoAsset Token contract address to purchase
 * @param chain Blockchain network for the purchased crypto
 * @param paymentMethod Payment method to use (bank_account, credit_card, debit_card)
 * @returns A URL to the MoonPay widget pre-configured with the user's details
 */
export async function processBuyRequest(
  wallets: ConnectedWallet[],
  buyAmount: string,
  cryptoAsset: string,
  chain: string,
  paymentMethod: string
): Promise<{ moonpayUrl: string }> {
  if (!wallets[0]) {
    throw new Error("No wallet is connected!");
  }

  const chainId = supportedChains[chain];
  if (chainId === undefined) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Switch to the target chain
  await wallets[0].switchChain(chainId);
  const walletAddress = await wallets[0].address;

  // Get the currency code for MoonPay based on the token and chain
  let currencyCode = "usdc";
  if (chain === "mainnet") {
    currencyCode = "usdc"; // Ethereum mainnet USDC
  } else if (chain === "base") {
    currencyCode = "usdc_base"; // Base USDC
  } else if (chain === "sepolia") {
    currencyCode = "usdc_ethereum_sepolia"; // Sepolia testnet USDC
  }

  // Map our payment method to MoonPay's payment method parameter
  let moonpayPaymentMethod = "";
  if (paymentMethod === "bank_account") {
    // US users typically use ACH
    moonpayPaymentMethod = "sepa_bank_transfer";
  } else if (paymentMethod === "credit_card") {
    moonpayPaymentMethod = "credit_debit_card";
  } else if (paymentMethod === "debit_card") {
    moonpayPaymentMethod = "credit_debit_card";
  }

  // Build the MoonPay URL with all required parameters
  const params = new URLSearchParams({
    apiKey: MOONPAY_API_KEY,
    currencyCode: currencyCode,
    walletAddress: walletAddress,
    baseCurrencyCode: "usd",
    baseCurrencyAmount: buyAmount,
    showWalletAddressForm: "false",
    redirectURL: window.location.origin, // Redirect back to our app
  });

  // Add payment method if specified
  if (moonpayPaymentMethod) {
    params.append("paymentMethod", moonpayPaymentMethod);
  }

  // Create the final URL
  const moonpayUrl = `${MOONPAY_BASE_URL}?${params.toString()}`;
  
  return {
    moonpayUrl: moonpayUrl
  };
}
