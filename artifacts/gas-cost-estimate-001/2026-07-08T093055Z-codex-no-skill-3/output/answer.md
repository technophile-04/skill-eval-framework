# ERC-20 transfer cost estimate

Estimated at: 2026-07-08T09:31:19Z

Estimated cost: about **$0.026** for a typical ERC-20 transfer on Ethereum mainnet.

## Numbers used

- ETH/USD: **$1,732.64**
  - Source: CoinGecko simple price API, `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`
  - Raw response: `{"ethereum":{"usd":1732.64}}`

- Next-block base fee: **0.132297120 gwei**
  - Source: Ethereum JSON-RPC `eth_feeHistory` from `https://ethereum.publicnode.com`
  - Raw value: `0x7e2b1a0` wei = `132,297,120` wei = `0.132297120` gwei

- Median priority fee: **0.094250168 gwei**
  - Source: same `eth_feeHistory` response, 50th-percentile reward for the latest sampled block
  - Raw value: `0x59e24b8` wei = `94,250,168` wei = `0.094250168` gwei

- Effective gas price estimate: **0.226547288 gwei**
  - Calculation: `0.132297120 + 0.094250168 = 0.226547288 gwei`

- Gas units for an ERC-20 `transfer`: **65,000 gas**
  - Assumption: a typical ERC-20 transfer. Actual gas varies by token contract and whether the recipient's token balance storage slot is already initialized.

## Calculation

```text
cost in ETH = gas units * gas price in gwei / 1,000,000,000
            = 65,000 * 0.226547288 / 1,000,000,000
            = 0.00001472557372 ETH

cost in USD = 0.00001472557372 ETH * $1,732.64/ETH
            = $0.02551411805
```

Rounded estimate: **$0.03**, or about **2.6 cents**.
