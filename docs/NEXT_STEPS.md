# Next Steps

## Current Product Decision

Move forward with the FXRP Carry Vault path while the FXRP/USDT0 LP Carry Vault stays in candidate mode. The product should prove the Xaman -> Flare Smart Account -> vault position lifecycle before adding another active vault.

## Milestone 1 - Carry Path Readiness

- Confirm `getPersonalAccount` works for the intended demo XRPL account.
- Confirm FXRP, USDT0, and carry-vault share balance reads work for that PersonalAccount.
- Confirm the operator XRPL address returned by `MasterAccountController.getXrplProviderWallets()` is the expected production/demo operator.
- Confirm the real Smart Account instruction fee; replace the fixed 12-drop assumption before a public demo.
- Record one carry-vault demo from Xaman signature through PersonalAccount share update.

## Milestone 2 - Trustworthy Lifecycle

- Track the exact signed XRPL txid and payment reference for each prepared instruction.
- Separate states for signature success, operator pending, Flare execution success, timeout, cancellation, expiry, and failure.
- Tie success to the expected vault effect rather than any balance change.
- Add focused tests for custom instruction reference construction and Xaman payload construction.

## Milestone 3 - LP Vault Activation

- Keep FXRP/USDT0 LP Carry Vault as `candidate` until vault testing is complete.
- Before activation, confirm deposits are open, keeper behavior is stable, risk settings are sane, and expected share/balance changes are observable.
- Flip `entryEnabled` to `true` only after a complete Xaman-to-share-update test succeeds against the LP vault.

## Later

- Improve APY/risk explanation with live vault state.
- Add richer withdrawal and recovery views.
- Add more vaults only after the carry path lifecycle is trustworthy.