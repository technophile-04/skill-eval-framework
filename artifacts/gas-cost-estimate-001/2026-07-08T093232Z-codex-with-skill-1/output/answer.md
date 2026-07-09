# ERC-20 transfer cost on Ethereum mainnet

Estimate as of 2026-07-08 09:33:26 UTC: **about $0.015**, or roughly **1.5 cents**, for a typical ERC-20 transfer on Ethereum mainnet.

## Inputs

- ERC-20 transfer gas used: **65,000 gas**
  - This is a typical planning estimate for a standard ERC-20 `transfer`. The exact value varies by token contract and account state.
- Current Ethereum base fee: **134,625,816 wei/gas**
  - `cast base-fee --rpc-url https://ethereum-rpc.publicnode.com`
  - In gwei: `134,625,816 / 1,000,000,000 = 0.134625816 gwei`
- Current effective gas price from the RPC: **134,887,149 wei/gas**
  - `cast gas-price --rpc-url https://ethereum-rpc.publicnode.com`
  - In gwei: `134,887,149 / 1,000,000,000 = 0.134887149 gwei`
  - Implied priority fee: `134,887,149 - 134,625,816 = 261,333 wei/gas = 0.000261333 gwei`
- ETH/USD price: **$1,731.32431 per ETH**
  - Chainlink ETH/USD mainnet feed: `0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419`
  - `decimals()` returned `8`
  - `latestRoundData()` answer returned `173132431000`
  - Price: `173132431000 / 10^8 = 1731.32431`
  - Feed `updatedAt`: 2026-07-08 09:10:35 UTC
- Mainnet block checked: **25,486,978**
  - `cast block-number --rpc-url https://ethereum-rpc.publicnode.com`

## Calculation

Using the current effective gas price:

```text
cost_wei = 65,000 gas * 134,887,149 wei/gas
         = 8,767,664,685,000 wei

cost_eth = 8,767,664,685,000 / 10^18
         = 0.000008767664685 ETH

cost_usd = 0.000008767664685 ETH * $1,731.32431/ETH
         = $0.015179671
```

Rounded estimate: **$0.015**, about **1.5 cents**.
