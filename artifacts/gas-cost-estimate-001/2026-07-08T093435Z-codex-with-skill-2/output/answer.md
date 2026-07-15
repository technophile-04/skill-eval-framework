# ERC-20 transfer cost on Ethereum mainnet

As of 2026-07-08 09:35:29 UTC, I estimate a typical ERC-20 transfer on Ethereum mainnet costs about **$0.023**, or **2.3 cents**.

Numbers used:

- Gas used for a simple ERC-20 `transfer`: **65,000 gas**.
- Current base fee from `cast base-fee --rpc-url https://ethereum-rpc.publicnode.com`: **201,964,030 wei/gas** = **0.201964030 gwei**.
- Suggested priority fee from `eth_maxPriorityFeePerGas` on the same RPC: **261,333 wei/gas** = **0.000261333 gwei**.
- Current all-in gas price from `cast gas-price --rpc-url https://ethereum-rpc.publicnode.com`: **202,225,363 wei/gas** = **0.202225363 gwei**.
- ETH/USD from CoinGecko simple price API: **$1,736.50 per ETH**.

Calculation:

```text
gas cost in ETH
= 65,000 gas * 202,225,363 wei/gas / 1e18 wei per ETH
= 0.000013144648595 ETH

gas cost in USD
= 0.000013144648595 ETH * $1,736.50/ETH
= $0.022825682285217502
= about $0.023
```

This is for a normal ERC-20 transfer. Some tokens have nonstandard transfer logic, so their gas use can be higher or lower than 65,000.
