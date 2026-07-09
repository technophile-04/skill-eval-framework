# ERC-20 transfer cost estimate

As of `2026-07-08T09:29:43Z`, I estimate a normal ERC-20 `transfer` on Ethereum mainnet costs about **$0.13** if you use a conservative prompt-inclusion fee.

## Numbers used

- Gas units for an ERC-20 transfer: **65,000 gas**
  - This is a typical estimate for a standard ERC-20 `transfer`, higher than a plain ETH transfer's 21,000 gas because the token contract updates balances and emits a `Transfer` event.
  - Actual ERC-20 transfers vary by token and state; a transfer to an address that already has a token balance can be closer to ~50,000 gas, while a zero-to-nonzero recipient balance commonly pushes the estimate toward ~65,000 gas.

- Current Ethereum fee data from `eth_feeHistory` via `https://ethereum.publicnode.com`:
  - Next-block base fee: `0x74c8b70` wei/gas = **0.122456944 gwei**
  - I used a conservative priority fee: **1.000000000 gwei**
  - Total effective gas price estimate: **1.122456944 gwei**

- Cross-check from `eth_gasPrice` via the same RPC:
  - `0x7508845` wei/gas = **0.122718277 gwei**
  - This is much lower because it does not include my conservative 1 gwei priority-fee assumption.

- ETH/USD quote:
  - CoinGecko `simple/price`: **1 ETH = $1,731.71**
  - Coinbase exchange-rate cross-check was similar: **1 ETH = $1,731.14**
  - I used **$1,731.71/ETH** in the calculation.

## Calculation

Using the conservative fee:

```text
65,000 gas * 1.122456944 gwei/gas = 72,959.70136 gwei
72,959.70136 gwei / 1,000,000,000 = 0.00007295970136 ETH
0.00007295970136 ETH * $1,731.71/ETH = $0.1263450444
```

Rounded: **about $0.13**.

For comparison, using the raw RPC `eth_gasPrice` value:

```text
65,000 gas * 0.122718277 gwei/gas = 7,976.688005 gwei
7,976.688005 gwei / 1,000,000,000 = 0.000007976688005 ETH
0.000007976688005 ETH * $1,731.71/ETH = $0.0138133104
```

Rounded: **about $0.014**.

So my practical estimate is **about $0.13**, with a very-low-fee lower bound around **$0.014** at the live RPC-suggested gas price.
