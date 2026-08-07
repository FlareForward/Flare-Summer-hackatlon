# Steer on SparkDEX — Smart Account integration plan

Status: planned, not implemented. Spectra portfolio and trade visibility are the current priority.

## Scope

This integration gives a Flare Smart Account direct access to an existing Steer-managed SparkDEX liquidity vault. Steer is an independent automated liquidity manager. It is not one of our LP vaults, does not use `ConcentratedLpVault`, and does not require our keepers or strategy contracts.

The first release will support one approved SparkDEX pair and one approved Steer vault, with a single-token entry experience. The user signs every entry and exit from XRPL.

## Entry flow

1. Discover and pin the official Steer vault, its token pair, SparkDEX pool, router, and quoter.
2. Verify bytecode and token ordering on Flare, then simulate the complete call sequence.
3. Read `getTotalAmounts()` from the Steer vault and calculate the deposit ratio.
4. Quote the required input-token swap through SparkDEX.
5. Show the user the expected split, minimum token amounts, expected vault shares, price impact, slippage, and contracts involved.
6. Submit one Smart Account UserOperation containing:

   - `inputToken.approve(router, swapAmount)`
   - `router.exactInputSingle(...)`
   - `token0.approve(steerVault, amount0Desired)`
   - `token1.approve(steerVault, amount1Desired)`
   - `steerVault.deposit(amount0Desired, amount1Desired, amount0Min, amount1Min, personalAccount)`

If that operation cannot fit in an inline XRPL memo, use a hash-committed executor only after its allow-list and validation rules explicitly support the selected router, tokens, pool, and Steer vault.

## Exit flow

1. Read the user's Steer vault share balance and preview the pro-rata token outputs.
2. Show both output tokens and minimum amounts before signing.
3. Submit `steerVault.withdraw(shares, amount0Min, amount1Min, personalAccount)` through the Smart Account.
4. Leave both assets in the PersonalAccount for the initial release. A separately quoted swap-to-one-token action can be added later.

## Required Steer interface

```solidity
function getTotalAmounts() external view returns (uint256 total0, uint256 total1);
function deposit(
    uint256 amount0Desired,
    uint256 amount1Desired,
    uint256 amount0Min,
    uint256 amount1Min,
    address receiver
) external returns (uint256 shares, uint256 amount0, uint256 amount1);
function withdraw(
    uint256 shares,
    uint256 amount0Min,
    uint256 amount1Min,
    address receiver
) external returns (uint256 amount0, uint256 amount1);
```

## Safety gates before execution

- Confirm all addresses from official sources and independently verify them on-chain.
- Confirm the Steer vault's `token0`, `token1`, SparkDEX pool, share decimals, and live strategy state.
- Reject inactive, paused, deprecated, or empty vaults.
- Cap swap price impact, slippage, and total entry size.
- Use exact or bounded approvals and a deadline on the SparkDEX swap.
- Simulate the full operation from the user's PersonalAccount before asking for an XRPL signature.
- Show XRPL transaction, UserOp hash, Flare transaction, and final share balance in the UI.

## Explicit non-goals

- Creating or managing Steer strategies
- Running Steer keepers
- Reusing our LP vault or carry-vault contracts
- Arbitrary token zaps or arbitrary Steer vaults
- Native Steer single-asset helper contracts
- Automatic entry or exit without a user signature

## Implementation checklist

- [ ] Identify and verify the first official SparkDEX/Steer vault.
- [ ] Add pinned addresses and minimal ABIs.
- [ ] Add read helpers and optimal-split math with tests.
- [ ] Add SparkDEX quote and swap call builders with tests.
- [ ] Add Steer deposit/withdraw call builders with tests.
- [ ] Extend the executor allow-list only if memo size requires it.
- [ ] Build entry/exit UI with simulation and execution progress.
- [ ] Run a small-value mainnet entry and exit, then record both Flare transaction hashes.

