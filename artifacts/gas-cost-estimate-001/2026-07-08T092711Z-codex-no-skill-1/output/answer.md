# ERC-20 transfer cost estimate

As of 2026-07-08T09:27:46Z, my estimate is:

**Typical ERC-20 transfer: about $0.013.**

**Conservative estimate: about $0.017.**

## Numbers used

- ETH/USD spot price: **$1,731.65 per ETH**
  - Source: Coinbase spot endpoint, `https://api.coinbase.com/v2/prices/ETH-USD/spot`
- Current Ethereum mainnet gas price: **146,640,597 wei per gas**
  - Same as **0.146640597 gwei**
  - Source: Ethereum JSON-RPC `eth_gasPrice` via `https://ethereum-rpc.publicnode.com`
  - RPC result: `0x8bd8ed5` = `146,640,597` wei
- Latest block base fee cross-check: **0.144286831 gwei**
  - Source: Ethereum JSON-RPC `eth_getBlockByNumber("latest")`
  - `baseFeePerGas: 0x899a46f` = `144,286,831` wei
- Gas units for an ERC-20 transfer:
  - Recent direct `transfer(address,uint256)` calls to USDC/USDT in block `25,486,952` used:
    - USDT: `46,097`
    - USDC: `40,360`
    - USDT: `41,309`
    - USDT: `41,297`
    - USDT: `41,321`
    - USDT: `41,309`
    - USDC: `62,248`
    - USDT: `58,421`
  - Average of that sample: **46,545 gas**
  - I use **50,000 gas** as a round typical estimate.
  - I also show **65,000 gas** as a conservative generic ERC-20 transfer estimate, since cost varies by token contract and storage state.

## Calculation

Formula:

```text
USD cost = gas units * gas price in wei * ETH/USD / 1e18
```

Typical estimate:

```text
50,000 gas * 146,640,597 wei/gas = 7,332,029,850,000 wei
7,332,029,850,000 wei = 0.00000733202985 ETH
0.00000733202985 ETH * $1,731.65/ETH = $0.0126965095
```

So the typical estimate is **$0.013**, about **1.3 cents**.

Conservative estimate:

```text
65,000 gas * 146,640,597 wei/gas = 9,531,638,805,000 wei
9,531,638,805,000 wei = 0.000009531638805 ETH
0.000009531638805 ETH * $1,731.65/ETH = $0.0165054623
```

So the conservative estimate is **$0.017**, about **1.7 cents**.
