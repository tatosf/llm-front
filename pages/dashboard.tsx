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

import { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import Head from "next/head";
import {
  chainToUrl,
  abbreviateTransactionHash,
  BACKEND_URL,
  sendTransaction,
  sendOrder,
  waitForOrderStatus,
  uniswapV2Swap,
  processBuyRequest,
} from "../util/utils";
import { ethers } from "ethers";
import { OrderStatus } from "@cowprotocol/cow-sdk";

// Define the transaction history item interface
interface TransactionHistoryItem {
  id: string;
  timestamp: number;
  type: "transfer" | "swap" | "buy";
  status: "pending" | "completed" | "failed";
  data: {
    transactionHash?: string;
    chain?: string;
    fromAsset?: string;
    toAsset?: string;
    amount?: string;
    recipientAddress?: string;
    orderId?: string;
    moonpayUrl?: string;
  };
  message: string;
}

export default function DashboardPage() {
  const [intentValue, setIntentValue] = useState<string>("");
  const [status, setStatus] = useState<React.ReactNode>(<></>);
  const [showStatusPopup, setShowStatusPopup] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [userName, setUserName] = useState<string>("");
  const [transactionHistory, setTransactionHistory] = useState<TransactionHistoryItem[]>([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  
  const router = useRouter();
  const { ready, authenticated, logout } = usePrivy();

  useEffect(() => { 
    if (ready && !authenticated) {
      void router.push("/");
    }
    
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem("brinco_user_name");
      setUserName(storedName || "");
      
      // Load transaction history from localStorage
      const storedHistory = localStorage.getItem("brinco_transaction_history");
      if (storedHistory) {
        try {
          setTransactionHistory(JSON.parse(storedHistory));
        } catch (e) {
          console.error("Failed to parse transaction history:", e);
        }
      }
    }
  }, [ready, authenticated, router]);

  // Save transaction history to localStorage whenever it changes
  useEffect(() => {
    if (transactionHistory.length > 0) {
      localStorage.setItem("brinco_transaction_history", JSON.stringify(transactionHistory));
    }
  }, [transactionHistory]);

  const { wallets } = useWallets();
  
  // Function to add a new transaction to history
  const addTransactionToHistory = (item: Omit<TransactionHistoryItem, 'id' | 'timestamp'>) => {
    const newItem: TransactionHistoryItem = {
      ...item,
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
    };
    
    setTransactionHistory(prev => [newItem, ...prev].slice(0, 10)); // Keep 10 transactions
  };
  
  // Function to update an existing transaction in history
  const updateTransactionInHistory = (id: string, updates: Partial<TransactionHistoryItem>) => {
    setTransactionHistory(prev => 
      prev.map(item => 
        item.id === id ? { ...item, ...updates } : item
      )
    );
  };
  
  // Function to check network connectivity
  const checkNetwork = async (chain: string) => {
    if (!wallets[0]) {
      throw new Error("No wallet connected");
    }

    try {
      const provider = await wallets[0].getEthersProvider();
      const network = await provider.getNetwork();
      
      // Map chain names to chain IDs
      const chainIds: { [key: string]: number } = {
        'mainnet': 1,
        'sepolia': 11155111,
        'base': 8453
      };

      const targetChainId = chainIds[chain];
      if (!targetChainId) {
        throw new Error(`Unsupported chain: ${chain}`);
      }

      if (network.chainId !== targetChainId) {
        // Try to switch network first
        try {
          await wallets[0].switchChain(targetChainId);
          // After switching, get the new provider
          const newProvider = await wallets[0].getEthersProvider();
          await newProvider.getNetwork(); // Verify we can connect to the new network
          setNetworkError(null);
        } catch (switchError) {
          console.error("Failed to switch network:", switchError);
          throw new Error(`Please switch your wallet to ${chain} network`);
        }
      }

      // Test network connectivity
      await provider.getBlockNumber();
      setNetworkError(null);
    } catch (error) {
      console.error("Network check failed:", error);
      if (error instanceof Error) {
        if (error.message.includes("could not detect network")) {
          throw new Error(`Unable to connect to ${chain} network. Please check your internet connection and wallet network settings.`);
        }
        throw error;
      }
      throw new Error("Network connection failed. Please check your internet connection.");
    }
  };

  // Modify queryIntent to include network check
  const queryIntent = async () => {
    setNetworkError(null);
    let data: any;
    setLoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}answer/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: intentValue }),
      });
      if (!response.ok) {
        throw new Error("Network response was not ok!");
      }
      data = await response.json();
    } catch (error) {
      console.error("Failed to fetch:", error);
      setStatus(
        <div className="text-center">
          <h3 className="text-xl font-semibold mb-4 text-red-600">Request Failed</h3>
          <div className="bg-red-50 p-4 rounded-lg">
            <p className="text-red-700">Failed to process your request. Please check your internet connection.</p>
          </div>
        </div>
      );
      setShowStatusPopup(true);
      setLoading(false);
      return;
    }

    if (data.transaction_type === "transfer") {
      const { recipientAddress, chain, amount, token } = data.response;
      try {
        // Check network connectivity first
        await checkNetwork(chain);
        
        // Add to history as pending
        const historyId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        addTransactionToHistory({
          type: "transfer",
          status: "pending",
          data: { 
            chain, 
            amount: amount.toString(), 
            recipientAddress,
          },
          message: `Preparing to transfer ${amount} tokens to ${recipientAddress} on ${chain}...`,
        });
        
        // Try to execute the transaction
        try {
          const tx: ethers.providers.TransactionResponse = await sendTransaction(
            wallets,
            recipientAddress,
            amount.toString(),
            chain,
            token
          );
          
          // Update history with transaction hash
          updateTransactionInHistory(historyId, {
            status: "pending",
            data: { transactionHash: tx.hash },
            message: `Transfer of ${amount} tokens to ${recipientAddress} submitted. Awaiting confirmation...`,
          });
          
          setStatus(
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-4">Transfer Submitted</h3>
              <div className="bg-secondary/20 p-4 rounded-lg mb-4">
                <p className="mb-2">Transaction is being processed by the network.</p>
                <a
                  className="text-primary hover:text-primary/80 underline"
                  href={`${chainToUrl[chain]}${tx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Explorer: {abbreviateTransactionHash(tx.hash)}
                </a>
              </div>
            </div>
          );
          setShowStatusPopup(true);

          // Wait for confirmation
          try {
            const receipt = await tx.wait(1);
            
            // Update history to completed
            updateTransactionInHistory(historyId, {
              status: "completed",
              data: { transactionHash: receipt.transactionHash },
              message: `Successfully transferred ${amount} tokens to ${recipientAddress}. View on explorer: ${abbreviateTransactionHash(receipt.transactionHash)}`,
            });

            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4">Transfer Complete</h3>
                <div className="bg-green-100 p-4 rounded-lg mb-4">
                  <p className="text-green-800 mb-2">✅ Your transfer has been confirmed!</p>
                  <a
                    className="text-primary hover:text-primary/80 underline"
                    href={`${chainToUrl[chain]}${receipt.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer: {abbreviateTransactionHash(receipt.transactionHash)}
                  </a>
                </div>
              </div>
            );
          } catch (confirmError) {
            console.error("Transaction confirmation failed:", confirmError);
            
            // Even if confirmation monitoring fails, the transaction might still go through
            updateTransactionInHistory(historyId, {
              status: "pending",
              message: `Transfer submitted but confirmation status unknown. View on explorer: ${abbreviateTransactionHash(tx.hash)}`,
            });
            
            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4 text-yellow-600">Confirmation Status Unknown</h3>
                <div className="bg-yellow-50 p-4 rounded-lg mb-4">
                  <p className="text-yellow-800 mb-2">Your transaction was submitted, but we couldn't monitor its status.</p>
                  <p className="mb-2">Please check the transaction status on the blockchain explorer:</p>
                  <a
                    className="text-primary hover:text-primary/80 underline"
                    href={`${chainToUrl[chain]}${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Explorer: {abbreviateTransactionHash(tx.hash)}
                  </a>
                </div>
              </div>
            );
          }
        } catch (txError: any) {
          console.error("Transaction execution failed:", txError);
          
          // Handle ENS resolution errors specifically
          if (txError.message && (
              txError.message.includes("Could not resolve name") || 
              txError.message.includes("invalid address") ||
              txError.message.includes("ENS")
          )) {
            updateTransactionInHistory(historyId, {
              status: "failed",
              message: `Transfer failed: Could not resolve recipient address "${recipientAddress}"`,
            });
            
            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-2 text-red-600">Address Resolution Failed</h3>
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="mb-4">We couldn't resolve the recipient address.</p>
                  <p className="text-sm text-gray-600">{txError.message}</p>
                  <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      📝 Suggestions:
                      <ul className="list-disc list-inside mt-2">
                        <li>Check if the ENS name is correct</li>
                        <li>Try using the full Ethereum address instead</li>
                        <li>There might be network issues with the ENS resolution service</li>
                      </ul>
                    </p>
                  </div>
                </div>
              </div>
            );
            setShowStatusPopup(true);
            setLoading(false);
            return;
          }
          
          // Handle user rejections separately
          if (txError.message && txError.message.includes("user rejected")) {
            updateTransactionInHistory(historyId, {
              status: "failed",
              message: `Transfer was cancelled: You rejected the transaction in your wallet`,
            });
            
            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-2 text-yellow-600">Transaction Cancelled</h3>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <p>You rejected the transaction in your wallet.</p>
                </div>
              </div>
            );
            setShowStatusPopup(true);
            setLoading(false);
            return;
          }
          
          // Re-throw for general error handling
          throw txError;
        }
        
        setLoading(false);
      } catch (error) {
        console.error("Transfer failed:", error);
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setNetworkError(errorMessage);
        
        // Add failed transaction to history
        addTransactionToHistory({
          type: "transfer",
          status: "failed",
          data: { 
            chain, 
            amount: amount.toString(), 
            recipientAddress 
          },
          message: `Transfer failed: ${errorMessage}`,
        });
        
        // Build a helpful error message based on the error type
        let title = "Transfer Failed";
        let content = <p className="mb-4">Unable to complete the transfer.</p>;
        let tips = null;
        
        if (errorMessage.includes('network')) {
          title = "Network Connection Failed";
          tips = (
            <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-800">
                📝 Tips:
                <ul className="list-disc list-inside mt-2">
                  <li>Check your internet connection</li>
                  <li>Make sure your wallet is connected to the {chain} network</li>
                  <li>Try refreshing the page</li>
                </ul>
              </p>
            </div>
          );
        } else if (errorMessage.includes('insufficient') || errorMessage.includes('funds')) {
          title = "Insufficient Funds";
          content = <p className="mb-4">You don't have enough funds to complete this transfer.</p>;
          tips = (
            <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
              <p className="text-sm text-yellow-800">
                📝 Tips:
                <ul className="list-disc list-inside mt-2">
                  <li>Make sure you have enough tokens in your wallet</li>
                  <li>Consider network fees when transferring</li>
                </ul>
              </p>
            </div>
          );
        }
        
        setStatus(
          <div className="text-center">
            <h3 className="text-xl font-semibold mb-2 text-red-600">{title}</h3>
            <div className="bg-red-50 p-4 rounded-lg">
              {content}
              <p className="text-sm text-gray-600">{errorMessage}</p>
              {tips}
            </div>
          </div>
        );
        setShowStatusPopup(true);
        setLoading(false);
      }
    } else if (data.transaction_type === "swap") {
      const { chain, amount, fromAsset, toAsset } = data.response;
      try {
        // Check network connectivity first
        await checkNetwork(chain);
        
        // Add to history as pending
        const historyId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        addTransactionToHistory({
          type: "swap",
          status: "pending",
          data: { 
            chain, 
            amount: amount.toString(), 
            fromAsset,
            toAsset
          },
          message: `Swapping ${amount} from ${fromAsset.substring(0, 6)}... to ${toAsset.substring(0, 6)}... on ${chain}...`,
        });
        
        // Use Uniswap V2 for Sepolia swaps
        if (chain === "sepolia") {
          const txHash = await uniswapV2Swap(
            wallets,
            chain,
            fromAsset,
            toAsset,
            amount.toString()
          );
          
          // Update history with transaction hash
          updateTransactionInHistory(historyId, {
            status: "pending",
            data: { transactionHash: txHash },
            message: `Swap of ${amount} tokens submitted. Awaiting confirmation... View on explorer: ${abbreviateTransactionHash(txHash)}`,
          });
          
          setStatus(
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-4">Swap Submitted</h3>
              <div className="bg-secondary/20 p-4 rounded-lg mb-4">
                <p className="mb-2">Your swap transaction is being processed by the network.</p>
                <a
                  className="text-primary hover:text-primary/80 underline"
                  href={`${chainToUrl[chain]}${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Explorer: {abbreviateTransactionHash(txHash)}
                </a>
              </div>
            </div>
          );
          setShowStatusPopup(true);
          
          // Wait for transaction confirmation
          const provider = await wallets[0]?.getEthersProvider();
          if (!provider) {
            throw new Error("No wallet provider available");
          }
          const receipt = await provider.waitForTransaction(txHash);
          
          // Update history to completed
          updateTransactionInHistory(historyId, {
            status: "completed",
            data: { transactionHash: receipt.transactionHash },
            message: `Successfully swapped ${amount} tokens on ${chain}! View on explorer: ${abbreviateTransactionHash(receipt.transactionHash)}`,
          });
          
          setStatus(
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-4">Swap Complete</h3>
              <div className="bg-green-100 p-4 rounded-lg mb-4">
                <p className="text-green-800 mb-2">✅ Your swap has been confirmed!</p>
                <a
                  className="text-primary hover:text-primary/80 underline"
                  href={`${chainToUrl[chain]}${receipt.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Explorer: {abbreviateTransactionHash(receipt.transactionHash)}
                </a>
              </div>
            </div>
          );
          setLoading(false);
        } else {
          // Use COW Protocol for other chains
          const orderId = await sendOrder(
            wallets,
            chain,
            fromAsset,
            toAsset,
            amount.toString()
          );
          
          // Update history with order ID
          updateTransactionInHistory(historyId, {
            status: "pending",
            data: { orderId },
            message: `Swap order ${orderId.substring(0, 8)}... submitted. Waiting for fill...`,
          });
          
          setStatus(
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-4">Order Submitted</h3>
              <div className="bg-secondary/20 p-4 rounded-lg">
                <p>Your order has been sent to COW Protocol and is being processed.</p>
                <p className="text-sm mt-2">Order ID: {orderId.substring(0, 12)}...</p>
              </div>
            </div>
          );
          setShowStatusPopup(true);

          const orderStatus = await waitForOrderStatus(orderId, chain);
          
          if (orderStatus === OrderStatus.FULFILLED) {
            // Update history to completed
            updateTransactionInHistory(historyId, {
              status: "completed",
              message: `Successfully swapped ${amount} tokens via COW Protocol. Order: ${orderId.substring(0, 8)}...`,
            });
            
            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4">Order Filled</h3>
                <div className="bg-green-100 p-4 rounded-lg">
                  <p className="text-green-800">✅ Your swap order has been successfully filled!</p>
                </div>
              </div>
            );
          } else {
            // Update history to failed
            updateTransactionInHistory(historyId, {
              status: "failed",
              message: `Swap order failed with status: ${orderStatus}`,
            });
            
            setStatus(
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4 text-red-600">Order Failed</h3>
                <div className="bg-red-50 p-4 rounded-lg">
                  <p className="text-red-700">Something went wrong with your order.</p>
                  <p className="text-sm mt-2">Status: {orderStatus}</p>
                </div>
              </div>
            );
          }
          setLoading(false);
        }
      } catch (error: any) {
        console.error("Swap failed:", error);
        
        // Add failed transaction to history
        addTransactionToHistory({
          type: "swap",
          status: "failed",
          data: { 
            chain, 
            amount: amount.toString(), 
            fromAsset,
            toAsset 
          },
          message: `Swap of ${amount} tokens failed: ${error.message || 'Unknown error'}`,
        });
        
        let errorMessage = "Sorry, there was an issue processing your swap.";
        
        if (error.message && error.message.includes("NoLiquidity")) {
          errorMessage = "Sorry, there is no liquidity available for this swap pair. Please try a different token pair.";
        } else if (error.message && error.message.includes("Insufficient liquidity")) {
          errorMessage = "Sorry, there is insufficient liquidity for this swap pair on Uniswap. Please try a different token pair.";
        } else if (error.message && error.message.includes("No liquidity available")) {
          errorMessage = "Sorry, there is no liquidity available for this swap pair on Uniswap V2. Please try a different token pair.";
        } else if (error.message && error.message.includes("COWProtocolUnsupported")) {
          errorMessage = "Sorry, COW Protocol doesn't support swaps on the Sepolia testnet. Please try using a different network like Ethereum Mainnet.";
        } else if (error.message && (error.message.includes("404") || error.message.includes("Not Found"))) {
          errorMessage = "Sorry, COW Protocol API endpoint not found. The Sepolia testnet is not supported by COW Protocol.";
        } else if (error.message && error.message.includes("user rejected transaction")) {
          errorMessage = "Transaction was rejected in your wallet.";
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setStatus(
          <div className="text-center">
            <h3 className="text-xl font-semibold mb-4 text-red-600">Swap Failed</h3>
            <div className="bg-red-50 p-4 rounded-lg">
              <p className="text-red-700">{errorMessage}</p>
              {error.message && error.message.includes("liquidity") && (
                <p className="text-sm mt-2 text-gray-600">
                  This may be due to insufficient liquidity between these tokens on the {chain} network.
                </p>
              )}
            </div>
          </div>
        );
        setShowStatusPopup(true);
        setLoading(false);
      }
    } else if (data.transaction_type === "buy") {
      const { cryptoAsset, amount, chain, paymentMethod } = data.response;
      try {
        // Check network connectivity first
        await checkNetwork(chain);
        
        // Add to history as pending
        const historyId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        addTransactionToHistory({
          type: "buy",
          status: "pending",
          data: { 
            chain, 
            amount: amount.toString(), 
            toAsset: cryptoAsset,
          },
          message: `Initiating purchase of ${amount} ${cryptoAsset.substring(0, 8)}... on ${chain} using ${paymentMethod}`,
        });
        
        // Process the buy request using MoonPay
        const { moonpayUrl } = await processBuyRequest(
          wallets,
          amount.toString(),
          cryptoAsset,
          chain,
          paymentMethod
        );
        
        // Update history with moonpay URL
        updateTransactionInHistory(historyId, {
          status: "completed",
          data: { moonpayUrl },
          message: `MoonPay purchase request for ${amount} initiated successfully. Complete the purchase in MoonPay.`,
        });
        
        // Open the MoonPay widget in a new tab
        window.open(moonpayUrl, "_blank");
        
        setStatus(
          <div className="text-center space-y-6">
            <h3 className="text-xl font-semibold">Buy {amount} USDC with MoonPay</h3>
            
            <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm text-left">
              <p className="mb-4">We've opened MoonPay in a new tab where you can complete your purchase.</p>
              
              <ol className="list-decimal list-inside space-y-3">
                <li className="pb-2">Complete the checkout process in the MoonPay tab</li>
                <li className="pb-2">Your wallet address has been pre-filled for you</li>
                <li className="pb-2">Select your preferred payment method: {paymentMethod.replace('_', ' ')}</li>
                <li className="pb-2">Follow the prompts to complete KYC if required</li>
                <li>Once complete, USDC will be sent directly to your wallet</li>
              </ol>
            </div>
            
            <div className="bg-secondary/20 p-4 rounded-lg text-gray-800 text-sm">
              <p className="font-medium mb-1">💡 About MoonPay</p>
              <p>MoonPay is a trusted fiat-to-crypto service that makes buying cryptocurrency simple and secure. They handle all regulatory requirements and offer competitive rates.</p>
            </div>
            
            {chain !== 'mainnet' && (
              <div className="bg-yellow-50 p-4 rounded-lg text-yellow-800 text-sm">
                <p className="font-medium mb-1">⚠️ Testnet Notice</p>
                <p>You're currently on {chain} testnet. For testing purposes, the MoonPay widget will be configured to purchase on testnet, but actual testnet purchases may not be supported by all providers.</p>
              </div>
            )}
          </div>
        );
        setShowStatusPopup(true);
        setLoading(false);
      } catch (error: any) {
        console.error("Buy transaction failed:", error);
        
        // Add failed transaction to history
        addTransactionToHistory({
          type: "buy",
          status: "failed",
          data: { 
            chain, 
            amount: amount.toString(), 
            toAsset: cryptoAsset
          },
          message: `Purchase of ${amount} ${cryptoAsset.substring(0, 8)}... failed: ${error.message || 'Unknown error'}`,
        });
        
        setStatus(
          <div className="text-center">
            <h3 className="text-xl font-semibold mb-4 text-red-600">Purchase Failed</h3>
            <div className="bg-red-50 p-4 rounded-lg">
              <p className="text-red-700 mb-4">Sorry, we couldn't process your purchase request.</p>
              <p className="text-sm text-gray-600">
                {error.message || "Unknown error"}
              </p>
              <p className="mt-4">Please try again later or use your wallet's built-in "Buy" feature.</p>
            </div>
          </div>
        );
        setShowStatusPopup(true);
        setLoading(false);
      }
    }
    
    // Clear the input after processing
    setIntentValue("");
  };

  // Helper function to get appropriate color for transaction status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-status-success';
      case 'pending': return 'text-status-pending';
      case 'failed': return 'text-status-error';
      default: return 'text-gray-400';
    }
  };

  // Helper function to get appropriate icon for transaction type
  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'transfer': return '↗️';
      case 'swap': return '🔄';
      case 'buy': return '💰';
      default: return '📝';
    }
  };

  // Format timestamp to readable date
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <>
      <Head>
        <title>Brinco</title>
      </Head>

      <main className="flex flex-col items-center justify-center min-h-screen px-4 sm:px-20 bg-background text-text">
        {ready && authenticated && (
          <div className="bg-card rounded-xl overflow-hidden border border-gray-800 shadow-xl w-full max-w-3xl">
            {/* Header with window dots */}
            <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-card-header">
              <div className="flex items-center gap-2">
                <div className="window-dot window-dot-red"></div>
                <div className="window-dot window-dot-yellow"></div>
                <div className="window-dot window-dot-green"></div>
              </div>
              <div className="text-primary font-mono text-xs tracking-wider">BRINCO AGENT</div>
              <button
                onClick={logout}
                className="text-gray-400 hover:text-gray-200 hover:bg-gray-800 px-4 py-2 rounded-md text-sm flex items-center transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                Logout
              </button>
            </div>

            {networkError && (
              <div className="m-4 p-4 bg-[#2d1e1e] rounded-lg border border-status-error/30">
                <p className="text-status-error">{networkError}</p>
              </div>
            )}

            {showStatusPopup ? (
              <div className="flex flex-col items-center justify-between p-6">
                {status}
                <div className="flex flex-row items-center mt-6">
                  <button
                    onClick={() => setShowStatusPopup(false)}
                    className="btn-primary"
                  >
                    OK
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* Greeting */}
                <div className="text-center">
                  <h2 className="text-xl font-light text-primary">
                    {userName ? `Hi ${userName}` : 'Welcome'}, I'm Brinco your remittance agent
                  </h2>
                </div>

                {/* Message input */}
                <div className="space-y-3">
                  <textarea
                    value={intentValue}
                    onChange={(e) => setIntentValue(e.target.value)}
                    placeholder="How can I help you today? I support transfers, swaps, and buying crypto through your wallet."
                    className="custom-textarea"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={queryIntent}
                      className={`btn-primary ${loading ? "opacity-70 cursor-not-allowed" : ""}`}
                      disabled={loading}
                    >
                      {loading ? (
                        "Processing..."
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                          </svg>
                          Submit
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Transaction History Dropdown Section */}
                {transactionHistory.length > 0 && (
                  <div className="w-full border border-gray-800 rounded-lg overflow-hidden">
                    <button 
                      onClick={() => setShowHistory(!showHistory)}
                      className="transaction-history-header"
                    >
                      <div className="flex items-center">
                        <span className="text-primary font-medium">Transaction History</span>
                        {transactionHistory.length > 0 && (
                          <span className="ml-2 bg-primary text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                            {transactionHistory.length}
                          </span>
                        )}
                      </div>
                      <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${showHistory ? 'transform rotate-180' : ''}`}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                    
                    {/* Collapsible history content */}
                    <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showHistory ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                      <div className="divide-y divide-gray-800">
                        {transactionHistory.map((tx) => (
                          <div key={tx.id} className="transaction-item">
                            <div>
                              <div className="flex items-center">
                                <span className="mr-2">{getTransactionIcon(tx.type)}</span>
                                <span className="font-medium">{tx.type}</span>
                              </div>
                              <div className="text-sm text-gray-400 mt-1">
                                {formatTimestamp(tx.timestamp)}
                              </div>
                            </div>
                            
                            <div className="text-right">
                              <div className="font-mono">{tx.data.amount}</div>
                              <div className={`text-xs ${getStatusColor(tx.status)}`}>
                                {tx.status === 'completed' ? 'Succeeded' : tx.status}
                              </div>
                              
                              {/* Show transaction hash link if available */}
                              {tx.data.transactionHash && tx.data.chain && (
                                <a 
                                  href={`${chainToUrl[tx.data.chain]}${tx.data.transactionHash}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-primary hover:underline mt-1 inline-flex items-center"
                                >
                                  <span className="mr-1">Explorer:</span>
                                  {abbreviateTransactionHash(tx.data.transactionHash)}
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
