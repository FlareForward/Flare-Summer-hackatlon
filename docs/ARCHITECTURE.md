# Architecture

## Product

Flare Vault Gateway lets an XRPL wallet holder discover and use FXRP-denominated Flare vaults through Flare Smart Accounts.

## Hackathon Delta

Already existed:

- Carry and LP vault contracts in the original STFLR VAULT repo.
- Keeper/runtime automation in the original repo.
- A general-purpose vault dashboard.

New for this repo:

- Hackathon-specific UI with only carry and LP products.
- XRPL address to Flare PersonalAccount lookup.
- PersonalAccount balance reads for FXRP and vault shares.
- Deposit call generation for Flare Smart Account execution.
- Xaman Payment template preview for the XRPL signing flow.

## Deliberate Exclusions

- No keeper code.
- No backend runtime services.
- No private strategy vault contracts.
- No private deployment scripts or production environment values.

## Flow

1. User enters an XRPL address.
2. UI reads `MasterAccountController.getPersonalAccount(xrplAddress)`.
3. UI reads FXRP and vault share balances for the PersonalAccount.
4. User selects a carry or LP vault and amount.
5. UI builds two Flare calls:
   - `FXRP.approve(vault, amount)`
   - `vault.deposit(...)`
6. The next implementation step is wiring those calls to the production FSA custom-instruction path and Xaman payload creation.

## Wallet Support

- Bifrost, WalletConnect, Rabby, MetaMask: direct Flare EVM debugging and demos.
- Xaman: XRPL signing lane. Xaman does not act as a Flare EVM wallet, so it signs XRPL Payment payloads used by Flare Smart Accounts.

