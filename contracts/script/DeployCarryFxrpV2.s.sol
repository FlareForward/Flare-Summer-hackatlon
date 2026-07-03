// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/CarryTradeVaultV2.sol";

/// @notice Deploy the FXRP-collateral CarryTradeVaultV2.
///
///   forge script script/DeployCarryFxrpV2.s.sol \
///     --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
///
/// Config mirrors the existing V1 FXRP carry deploy script:
///   scripts/deploy-carry-fxrp.ts
///
/// After deploy:
///   1. Set CARRY_FXRP_VAULT=<address> in .env.
///   2. Prove reward flow with low capital.
///   3. Transfer owner to multisig once confirmed.
///   4. Keeper must use supplyToVenue / redeemFromVenue (renamed from V1).
contract DeployCarryFxrpV2 is Script {
    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        // Morpho FXRP collateral / USDT0 debt market.
        CarryTradeVaultV2.LegInit memory leg = CarryTradeVaultV2.LegInit({
            collateralToken: 0xAd552A648C74D49E10027AB8a618A3ad4901c5bE, // FXRP
            oracle:          0x183fe314130c9d4C1dcdC9695DAe6C92d913d29A,
            irm:             0xE5B5627C5973AfAE1928a6b8e5c1D6AABFEC8a7a,
            lltv:            770_000_000_000_000_000, // 77% in 1e18
            maxBorrowLtvBps: 6500,                    // 65%
            emergencyLtvBps: 7000                     // 70%
        });

        // Supply venues for borrowed USDT0. Both are Kinetic kTokens (kind=0).
        CarryTradeVaultV2.VenueConfig[] memory venues = new CarryTradeVaultV2.VenueConfig[](2);

        // Kinetic Primary USDT0 market.
        venues[0] = CarryTradeVaultV2.VenueConfig({
            kToken:           0x76809aBd690B77488Ffb5277e0a8300a7e77B779,
            comptroller:      0x8041680Fb73E1Fe5F851e76233DCDfA0f2D2D7c8,
            redeemable:       true,
            maxAllocationBps: 8000,
            kind:             0 // VENUE_KIND_KINETIC
        });

        // Kinetic Secondary/ISO USDT0 market.
        venues[1] = CarryTradeVaultV2.VenueConfig({
            kToken:           0xad7e7989796414c9572da9854DEb1B920724fd09,
            comptroller:      0x15F69897E6aEBE0463401345543C26d1Fd994abB,
            redeemable:       false,
            maxAllocationBps: 8000,
            kind:             0 // VENUE_KIND_KINETIC
        });

        CarryTradeVaultV2.KineticBorrowConfig memory kineticBorrow = CarryTradeVaultV2.KineticBorrowConfig({
            comptroller:      address(0),
            collateralKToken: address(0),
            debtKToken:       address(0),
            maxBorrowLtvBps:  0,
            emergencyLtvBps:  0,
            collateralIsNative: false,
            enabled:          false
        });

        CarryTradeVaultV2 vault = new CarryTradeVaultV2(
            deployer, // owner
            deployer, // keeper
            deployer, // guardian
            deployer, // rewardHarvester
            deployer, // operator
            "FXRP Carry Vault V2",
            "cvFXRP-V2",
            leg,
            venues,
            kineticBorrow
        );

        console2.log("CARRY_FXRP_VAULT_V2=", address(vault));
        console2.log("marketId:", uint256(vault.marketId()));
        console2.log("collateral:", vault.collateralToken());

        vm.stopBroadcast();
    }
}
