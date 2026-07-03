# Contracts

This folder contains only the vault contracts relevant to the hackathon product:

- `CarryTradeVaultV2.sol`: FXRP collateral carry vault.
- `ConcentratedLpVault.sol`: generic single-sided ERC-4626 concentrated LP vault.
- `TickMath.sol`: math dependency for the LP vault.

The keeper and strategy automation are not copied here. The hackathon repo should demonstrate user access from XRPL through Flare Smart Accounts, not publish production keeper logic.

## Optional Deploys

The included scripts are references copied from the active vault repo:

- `DeployCarryFxrpV2.s.sol`
- `DeployLpVaults.s.sol`

Before deploying a hackathon-specific LP vault, update ranges and names in the deploy script. A 25% FXRP/USDT0 LP can be added once the UI flow is stable.
