# Next Steps

## Current Product Decision

Move forward with the FXRP Carry Vault path while the FXRP/USDT0 LP Carry Vault stays in candidate mode. The product should prove the Xaman -> Flare Smart Account -> vault position lifecycle before adding another active vault.

## Milestone 1 - Carry Path Readiness

- Confirm `getPersonalAccount` works for the intended demo XRPL account.
- Confirm FXRP, USDT0, and carry-vault share balance reads work for that PersonalAccount.
- Confirm the operator XRPL address returned by `MasterAccountController.getXrplProviderWallets()` is the expected production/demo operator.
- Confirm the real Smart Account instruction fee; replace the fixed 12-drop assumption before a public demo.
- Record one carry-vault demo from D'CENT signature through PersonalAccount share update if the provider is available; otherwise record the same flow with Xaman.
- Verify whether the D'CENT Chrome extension injects `window.xrpl`; if not, use the D'CENT in-app browser for wallet-native testing.

## Milestone 2 - Direct Mint Entry

- Keep the invalid `encodeCustomInstruction` payment-reference path out of the main entry action; migrate advanced non-entry actions to memo UserOps before public use.
- Validate the implemented inline `0xFF` direct-mint memo path with D'CENT/Xaman: XRP payment mints FXRP to the PersonalAccount and carries the vault deposit `PackedUserOperation`.
- Confirm the encoded `PersonalAccount.executeUserOp` call data for `FXRP.approve(vault, amount)` and `vault.deposit(amount)` stays below XRPL memo limits on the target amount/vault.
- Add `0xFE` hash-commitment support and recovery states for stuck direct-mint memos.
- Test D'CENT first if `window.xrpl` is available; keep Xaman as fallback.

## Milestone 3 - LP Vault Activation

- Keep FXRP/USDT0 LP Carry Vault as `candidate` until vault testing is complete.
- Before activation, confirm deposits are open, keeper behavior is stable, risk settings are sane, and expected share/balance changes are observable.
- Flip `entryEnabled` to `true` only after a complete Xaman-to-share-update test succeeds against the LP vault.

## Later

- Improve APY/risk explanation with live vault state.
- Add richer withdrawal and recovery views.
- Add more vaults only after the carry path lifecycle is trustworthy.
