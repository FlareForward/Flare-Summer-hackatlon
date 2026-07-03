// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ConcentratedLpVault.sol";

/**
 * @notice Deploy three ConcentratedLpVault instances for Enosys V3 LP strategies.
 *
 * Usage:
 *   # Dry run (no broadcast)
 *   forge script script/DeployLpVaults.s.sol \
 *     --rpc-url https://flare-api.flare.network/ext/C/rpc \
 *     --private-key $LP_KEEPER_PRIVATE_KEY
 *
 *   # Live deploy
 *   forge script script/DeployLpVaults.s.sol \
 *     --rpc-url https://flare-api.flare.network/ext/C/rpc \
 *     --private-key $LP_KEEPER_PRIVATE_KEY \
 *     --broadcast
 *
 * After deploy:
 *   1. Record vault addresses in .env (LP_WFLR_USDT0_VAULT, LP_FXRP_USDT0_VAULT, LP_WFLR_FXRP_VAULT)
 *   2. Fund vaults with test deposits and confirm keeper can open positions
 *   3. Transfer ownership to cold storage: vault.transferOwnership(coldStorage)
 *      then cold storage calls vault.acceptOwnership()
 *
 * Keeper / ownership wallet: 0x835627520F6936857A94b99065057a8C48C18f8d
 */
contract DeployLpVaults is Script {

    // ── Enosys V3 Infrastructure (chain-wide, same for all pairs) ─────────────

    address constant POSITION_MANAGER = 0xD9770b1C7A6ccd33C75b5bcB1c0078f46bE46657;
    address constant ROUTER            = 0x38D6C8086E34E04A6dCf6b343CD3C7b615a4Ce53;
    address constant FTSO_V2           = 0x7BDE3Df0624114eDB3A67dFe6753e62f4e7c1d20;

    // ── Tokens ────────────────────────────────────────────────────────────────

    address constant WFLR  = 0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d;  // 18 dec
    address constant FXRP  = 0xAd552A648C74D49E10027AB8a618A3ad4901c5bE;  // 6 dec
    address constant USDT0 = 0xe7cd86e13AC4309349F30B3435a9d337750fC82D;  // 6 dec

    // ── Pools ─────────────────────────────────────────────────────────────────

    // token0=WFLR, token1=USDT0, fee=3000, tickSpacing=60
    address constant POOL_WFLR_USDT0 = 0x3C2a7B76795E58829FAAa034486D417dd0155162;

    // token0=FXRP, token1=USDT0, fee=3000, tickSpacing=60
    address constant POOL_FXRP_USDT0 = 0x686f53F0950Ef193C887527eC027E6A574A4DbE1;

    // token0=WFLR, token1=FXRP, fee=3000, tickSpacing=60
    address constant POOL_WFLR_FXRP  = 0xb4CB11a84CFbd8F6336Dc9417aC45c1F8E5B59E7;

    // ── FTSOv2 Feed IDs ───────────────────────────────────────────────────────

    bytes21 constant FEED_FLR_USD  = 0x01464c522f55534400000000000000000000000000;
    bytes21 constant FEED_XRP_USD  = 0x015852502f55534400000000000000000000000000;
    bytes21 constant FEED_USDT_USD = 0x01555344542f555344000000000000000000000000;

    // ── Keeper / Fee Recipient ────────────────────────────────────────────────

    // This is the new LP keeper wallet. The deployer (msg.sender) becomes owner.
    // Transfer ownership to cold storage after testing is complete.
    address constant KEEPER = 0x835627520F6936857A94b99065057a8C48C18f8d;

    // ── Initial Parameters ────────────────────────────────────────────────────

    uint16 constant RANGE_BPS    = 500;   // 5% range width
    uint16 constant PERF_FEE_BPS = 1500;  // 15% performance fee on collected asset fees

    // ─────────────────────────────────────────────────────────────────────────

    function run() external returns (
        address wflrUsdt0Vault,
        address fxrpUsdt0Vault,
        address wflrFxrpVault
    ) {
        vm.startBroadcast();

        // ── Vault 1: WFLR/USDT0 ──────────────────────────────────────────────
        // asset=WFLR (token0), other=USDT0 (token1)
        // deposit WFLR, earn USDT0 fees (disposed per otherMode)
        wflrUsdt0Vault = address(new ConcentratedLpVault(
            "WFLR/USDT0 LP Vault",
            "wuLP",
            WFLR,
            USDT0,
            POOL_WFLR_USDT0,
            POSITION_MANAGER,
            ROUTER,
            FTSO_V2,
            FEED_FLR_USD,   // asset feed: FLR/USD
            FEED_USDT_USD,  // other feed: USDT/USD
            KEEPER,
            KEEPER,         // fee recipient = keeper wallet initially
            RANGE_BPS,
            PERF_FEE_BPS
        ));

        // ── Vault 2: FXRP/USDT0 ──────────────────────────────────────────────
        // asset=FXRP (token0 in this pool), other=USDT0 (token1)
        // deposit FXRP, earn USDT0 fees
        // Note: FXRP and USDT0 both have 6 decimals; vault shares are 18 dec
        fxrpUsdt0Vault = address(new ConcentratedLpVault(
            "FXRP/USDT0 LP Vault",
            "fuLP",
            FXRP,
            USDT0,
            POOL_FXRP_USDT0,
            POSITION_MANAGER,
            ROUTER,
            FTSO_V2,
            FEED_XRP_USD,   // asset feed: XRP/USD
            FEED_USDT_USD,  // other feed: USDT/USD
            KEEPER,
            KEEPER,
            RANGE_BPS,
            PERF_FEE_BPS
        ));

        // ── Vault 3: WFLR/FXRP ───────────────────────────────────────────────
        // Pool token ordering: WFLR=token0, FXRP=token1
        // asset=WFLR (token0), other=FXRP (token1)
        // deposit WFLR, earn FXRP fees (compounded to WFLR when FLR is cheap)
        wflrFxrpVault = address(new ConcentratedLpVault(
            "WFLR/FXRP LP Vault",
            "wfLP",
            WFLR,
            FXRP,
            POOL_WFLR_FXRP,
            POSITION_MANAGER,
            ROUTER,
            FTSO_V2,
            FEED_FLR_USD,   // asset feed: FLR/USD
            FEED_XRP_USD,   // other feed: XRP/USD
            KEEPER,
            KEEPER,
            RANGE_BPS,
            PERF_FEE_BPS
        ));

        vm.stopBroadcast();

        console2.log("=== Deployed LP Vaults ===");
        console2.log("WFLR/USDT0 vault:", wflrUsdt0Vault);
        console2.log("FXRP/USDT0 vault:", fxrpUsdt0Vault);
        console2.log("WFLR/FXRP  vault:", wflrFxrpVault);
        console2.log("Keeper / fee recipient:", KEEPER);
        console2.log("Owner (deployer):", msg.sender);
        console2.log("Transfer ownership to cold storage after testing.");
    }
}
