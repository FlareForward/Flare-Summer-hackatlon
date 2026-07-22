# Architecture

## Product

Flare Vault Gateway lets an XRPL wallet holder use Xaman to control a Flare Smart Account and enter FXRP-denominated Flare vaults without setting up a separate Flare EVM wallet.

## Current Product Shape

The active product path is the FXRP Carry Vault. The FXRP/USDT0 LP Carry Vault is intentionally kept as a candidate opportunity until vault testing is complete.

Already existed:

- Carry and LP vault contracts in the original STFLR VAULT repo.
- Keeper/runtime automation in the original repo.
- A general-purpose vault dashboard.

New for this repo:

- Hackathon-specific UI with a Xaman-first Smart Account flow.
- XRPL address to Flare PersonalAccount lookup.
- PersonalAccount balance reads for FXRP, USDT0, and vault shares.
- Deposit, withdraw, claim-surplus, and surplus-swap call generation for supported carry-vault actions.
- `0xff` custom instruction reference encoding through `MasterAccountController.encodeCustomInstruction`.
- Server-side Xaman payload creation and polling.

## Deliberate Exclusions

- No keeper code.
- No backend runtime services beyond Xaman payload proxy routes.
- No private strategy vault contracts.
- No private deployment scripts or production environment values.

## Flow

1. User connects Xaman or enters an XRPL address.
2. UI reads `MasterAccountController.getPersonalAccount(xrplAddress)`.
3. UI reads FXRP, USDT0, and vault share balances for the PersonalAccount.
4. User selects an enabled vault and amount.
5. UI builds Flare calls such as:
   - `FXRP.approve(vault, amount)`
   - `vault.deposit(amount)`
6. UI encodes the call plan through `MasterAccountController.encodeCustomInstruction`.
7. Server route creates a Xaman Payment payload with the custom instruction in the memo field.
8. User signs in Xaman.
9. UI polls Xaman payload status, then polls Flare balances while waiting for operator execution.

## Wallet Support

- Xaman: primary user path. Xaman signs XRPL Payment payloads used by Flare Smart Accounts.
- Bifrost, WalletConnect, Rabby, MetaMask: useful for direct Flare EVM debugging and demos, but not required by the target user flow.

## Product Readiness Boundary

A vault should be active only when all of these are true:

- vault address is final for the target demo/network;
- deposits are open;
- keeper/runtime behavior is stable;
- expected share/balance changes are observable after Smart Account execution;
- risk settings and user-facing claims match the deployed vault.