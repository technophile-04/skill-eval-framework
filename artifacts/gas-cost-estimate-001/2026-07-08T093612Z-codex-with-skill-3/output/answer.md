# ERC-20 transfer cost on Ethereum mainnet

As of 2026-07-08T09:36:39Z, I estimate a normal ERC-20 `transfer` on Ethereum mainnet costs about **$0.025**, roughly **2.5 cents**.

Numbers used:

- Gas used for a typical ERC-20 transfer: **65,000 gas**. This varies by token and recipient state, but 65k gas is a reasonable rule-of-thumb estimate for a plain ERC-20 `transfer`.
- Latest mainnet base fee checked by JSON-RPC `eth_getBlockByNumber` against `https://ethereum-rpc.publicnode.com`: **173,951,850 wei/gas = 0.17395185 gwei/gas**.
- The same latest block/base fee was also returned by `https://rpc.mevblocker.io`, for block **25,486,995** at **2026-07-08T09:36:47Z**.
- Priority fee estimate from JSON-RPC `eth_feeHistory` median rewards over the last 5 blocks, 50th percentile: rewards were **0.009147429, 0.060500003, 0.050000001, 0.009931793, 0.087815235 gwei**, so I used the median: **0.050000001 gwei/gas**.
- Total effective gas price estimate: **0.17395185 + 0.050000001 = 0.223951851 gwei/gas**.
- ETH/USD from CoinGecko simple price API: **$1,737.42 per ETH**, last updated **2026-07-08T09:35:52Z**.

Calculation:

```text
cost in ETH = gas used * total gas price in gwei * 1e-9
            = 65,000 * 0.223951851 * 1e-9
            = 0.000014556870315 ETH

cost in USD = 0.000014556870315 ETH * $1,737.42/ETH
            = $0.0252913976
```

Rounded estimate: **about $0.03**, or **about 2.5 cents**.

For comparison, using only the base fee and no priority fee:

```text
65,000 * 0.17395185 gwei * 1e-9 * $1,737.42 = $0.0196447825
```

So the current base-fee-only lower bound is about **2.0 cents**, and the practical transfer estimate with a small tip is about **2.5 cents**.
