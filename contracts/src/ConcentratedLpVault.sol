// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "./TickMath.sol";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface IEnosysPool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function tickSpacing() external view returns (int24);
    function fee() external view returns (uint24);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IEnosysPositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    function burn(uint256 tokenId) external payable;

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

interface IFtsoV2 {
    function getFeedsById(bytes21[] calldata feedIds)
        external
        view
        returns (uint256[] memory values, int8[] memory decimals, uint64 timestamp);
}

interface IRNat {
    function claimRewards(uint256[] calldata projectIds, uint256 month) external returns (uint128 claimedRewardsWei);
    function getBalancesOf(address owner)
        external
        view
        returns (uint256 wNatBalance, uint256 rNatBalance, uint256 lockedBalance);
    function withdraw(uint128 amount, bool wrap) external;
}

// ── Vault ─────────────────────────────────────────────────────────────────────

/**
 * @title  ConcentratedLpVault
 * @notice Generic ERC-4626 vault that provides concentrated liquidity on any
 *         Enosys V3 pool using a Snuggle-style rebalancing strategy:
 *         when a position exits its range it is repositioned single-sided at the
 *         boundary without executing a swap, deferring IL while earning fees.
 *
 *         Pair-specific configuration is set at construction time (immutables).
 *         Deploy one instance per pair; the audited logic is shared across all.
 *
 *         Deposits are asset token only (configured per deployment). Full exits
 *         use redeemInKind and return each token as held by the vault.
 *         Range width, harvest threshold, and fee split are tunable by the owner
 *         post-deploy without redeployment.
 *         Ownership can be transferred to cold storage via Ownable2Step.
 *
 *         Deployed pairs:
 *           WFLR/USDT0  — asset=WFLR,  other=USDT0, assetFeed=FLR/USD, otherFeed=USDT/USD
 *           FXRP/USDT0  — asset=FXRP,  other=USDT0, assetFeed=XRP/USD, otherFeed=USDT/USD
 *           WFLR/FXRP   — asset=WFLR,  other=FXRP,  assetFeed=FLR/USD, otherFeed=XRP/USD
 */
contract ConcentratedLpVault is ERC4626, Ownable2Step, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 private constant Q96 = 1 << 96;
    uint256 private constant REWARD_ACC_PRECISION = 1e30;
    uint256 private constant FTSO_STALE_AFTER = 5 minutes;
    address public constant WFLR = 0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d;
    address public constant RNAT = 0x26d460c3Cf931Fb2014FA436a49e3Af08619810e;
    uint16 public constant MAX_PERF_FEE_BPS = 3000;   // 30% hard cap
    uint16 public constant MAX_RANGE_BPS = 5000;       // 50% max range width
    uint16 public constant MIN_RANGE_BPS = 10;         // 0.1% min range width (allows tight ranges on ts=10 pools)
    uint16 public constant MAX_POOL_ORACLE_DEVIATION_BPS = 2_000; // 20% hard cap

    // ── Immutables (pair-specific, set at construction) ───────────────────────

    address public immutable OTHER_TOKEN;       // the paired (non-asset) token in the pool
    address public immutable POOL_TOKEN0;       // pool.token0() — fixed pool ordering
    address public immutable POOL_TOKEN1;       // pool.token1()
    bool public immutable IS_ASSET_TOKEN0;      // true when asset() == POOL_TOKEN0
    uint8 public immutable ASSET_DECIMALS;      // decimals of the asset token
    uint8 public immutable OTHER_DECIMALS;      // decimals of the other token
    IEnosysPool public immutable POOL;
    IEnosysPositionManager public immutable POSITION_MANAGER;
    IFtsoV2 public immutable FTSO_V2;
    bytes21 public immutable ASSET_FEED_ID;     // FTSOv2 feed for asset in USD
    bytes21 public immutable OTHER_FEED_ID;     // FTSOv2 feed for other token in USD
    uint24 public immutable POOL_FEE;
    int24 public immutable TICK_SPACING;

    // ── Position State ────────────────────────────────────────────────────────

    uint256 public tokenId;   // NFT id of the current position; 0 = no position
    int24 public tickLower;
    int24 public tickUpper;
    bool private _minting;    // true only while the vault is minting its own position (L-03)

    // ── Owner-Tunable Parameters ──────────────────────────────────────────────

    uint16 public rangeBps;                    // LP range width in BPS, e.g. 500 = 5%
    uint256 public minHarvestAsset;            // minimum total fee value, in asset terms, before performance fee shares mint
    uint16 public performanceFeeBps;           // share of harvested total fee value minted to feeRecipient
    uint16 public feeClaimBps;                 // share of collected fees reserved for share-holder claims
    uint16 public poolOracleDeviationBps;      // max pool-vs-FTSO price deviation
    uint256 public depositCap;                 // max totalAssets; 0 = uncapped
    bool public depositsPaused;
    address public keeper;
    address public feeRecipient;
    address public rewardHarvester;
    mapping(address => bool) internal externalRewardClaimers;
    mapping(address => bool) internal externalRewardTargets;
    mapping(address => bool) internal externalRewardTokens;
    uint256 public accClaimableAssetPerShare;
    uint256 public accClaimableOtherPerShare;
    uint256 public accClaimableWflrPerShare;
    uint256 public totalClaimableAsset;
    uint256 public totalClaimableOther;
    uint256 public totalClaimableWflr;
    mapping(address => uint256) public claimableAsset;
    mapping(address => uint256) public claimableOther;
    mapping(address => uint256) public claimableWflr;
    mapping(address => uint256) public rewardDebtAsset;
    mapping(address => uint256) public rewardDebtOther;
    mapping(address => uint256) public rewardDebtWflr;

    // ── Events ────────────────────────────────────────────────────────────────

    event PositionOpened(uint256 indexed tokenId, int24 tickLower, int24 tickUpper, uint256 token0Used, uint256 token1Used);
    event PositionClosed(uint256 indexed tokenId, uint256 token0Out, uint256 token1Out);
    event FeesCollected(uint256 assetFees, uint256 otherFees, uint256 perfFeeAsset);
    event FeeSplitUpdated(uint16 oldClaimBps, uint16 newClaimBps);
    event FeeRewardsAccrued(uint256 assetAmount, uint256 otherAmount);
    event FeeRewardsClaimed(address indexed owner, address indexed receiver, uint256 assetAmount, uint256 otherAmount);
    event Rebalanced(uint256 indexed oldTokenId, uint256 indexed newTokenId, int24 newTickLower, int24 newTickUpper);
    event LiquidityPulled(uint128 liquidity, uint256 token0Out, uint256 token1Out);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event FeeRecipientUpdated(address indexed old_, address indexed new_);
    event RewardHarvesterUpdated(address indexed oldHarvester, address indexed newHarvester);
    event ExternalRewardsClaimed(
        address indexed caller,
        address indexed target,
        address indexed rewardToken,
        address receiver,
        uint256 amount
    );
    event RflrClaimed(uint256 indexed month, uint256[] projectIds, uint128 claimed, uint256 wNatDelta);
    event RflrWithdrawn(uint256 amount);
    event WflrRewardsAccrued(uint256 amount);
    event WflrRewardsClaimed(address indexed owner, address indexed receiver, uint256 amount);
    event WithdrawInKind(address indexed owner, address indexed receiver, uint256 shares, uint256 assetOut, uint256 otherOut);

    // ── Errors ────────────────────────────────────────────────────────────────

    error NotKeeper();
    error PositionExists();
    error NoPosition();
    error BadTicks();
    error TickNotAligned();
    error InvalidParam();
    error TokenMismatch();

    // ── Modifier ──────────────────────────────────────────────────────────────

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    modifier onlyRewardHarvester() {
        if (msg.sender != rewardHarvester) revert InvalidParam();
        _;
    }

    modifier onlyExternalRewardClaimer() {
        if (msg.sender != rewardHarvester && !externalRewardClaimers[msg.sender]) revert InvalidParam();
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param name_               ERC-20 name for vault shares (e.g. "WFLR/USDT0 LP Vault")
     * @param symbol_             ERC-20 symbol (e.g. "wuLP")
     * @param asset_              Token users deposit and withdraw (WFLR, FXRP, etc.)
     * @param otherToken_         Paired token in the pool (USDT0, FXRP, WFLR, etc.)
     * @param pool_               Enosys V3 pool address — must contain both tokens
     * @param positionManager_    Enosys V3 NonfungiblePositionManager
     * @param ftsoV2_             FTSOv2 price oracle
     * @param assetFeedId_        FTSOv2 bytes21 feed id for asset/USD (e.g. FLR/USD, XRP/USD)
     * @param otherFeedId_        FTSOv2 bytes21 feed id for other/USD (e.g. USDT/USD, FLR/USD)
     * @param initialKeeper_       Keeper address (manages position lifecycle)
     * @param initialFeeRecipient_ Where performance fees go
     * @param initialRangeBps_    LP range width (10–5000 BPS)
     * @param initialPerfFeeBps_  Performance fee on harvested total fee value (0–3000 BPS)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address asset_,
        address otherToken_,
        address pool_,
        address positionManager_,
        address,
        address ftsoV2_,
        bytes21 assetFeedId_,
        bytes21 otherFeedId_,
        address initialKeeper_,
        address initialFeeRecipient_,
        uint16 initialRangeBps_,
        uint16 initialPerfFeeBps_
    )
        ERC4626(IERC20(asset_))
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        if (initialRangeBps_ < MIN_RANGE_BPS || initialRangeBps_ > MAX_RANGE_BPS) revert InvalidParam();
        if (initialPerfFeeBps_ > MAX_PERF_FEE_BPS) revert InvalidParam();
        if (initialKeeper_ == address(0) || initialFeeRecipient_ == address(0)) revert InvalidParam();

        // Validate and record pool token ordering
        address pt0 = IEnosysPool(pool_).token0();
        address pt1 = IEnosysPool(pool_).token1();
        bool assetIsToken0 = (pt0 == asset_);
        if (!assetIsToken0 && pt1 != asset_) revert TokenMismatch();
        if (assetIsToken0 && pt1 != otherToken_) revert TokenMismatch();
        if (!assetIsToken0 && pt0 != otherToken_) revert TokenMismatch();

        POOL_TOKEN0 = pt0;
        POOL_TOKEN1 = pt1;
        IS_ASSET_TOKEN0 = assetIsToken0;
        OTHER_TOKEN = otherToken_;
        ASSET_DECIMALS = IERC20Metadata(asset_).decimals();
        OTHER_DECIMALS = IERC20Metadata(otherToken_).decimals();
        POOL = IEnosysPool(pool_);
        POSITION_MANAGER = IEnosysPositionManager(positionManager_);
        FTSO_V2 = IFtsoV2(ftsoV2_);
        ASSET_FEED_ID = assetFeedId_;
        OTHER_FEED_ID = otherFeedId_;
        POOL_FEE = IEnosysPool(pool_).fee();
        TICK_SPACING = IEnosysPool(pool_).tickSpacing();

        keeper = initialKeeper_;
        feeRecipient = initialFeeRecipient_;
        rewardHarvester = initialKeeper_;
        rangeBps = initialRangeBps_;
        performanceFeeBps = initialPerfFeeBps_;
        feeClaimBps = 5_000;
        minHarvestAsset = 10 ** ASSET_DECIMALS;  // 1 whole asset unit
        poolOracleDeviationBps = 500;           // 5%
    }

    // ── ERC-4626: Decimals ────────────────────────────────────────────────────

    /**
     * @dev Vault shares always have 18 decimals regardless of asset decimals.
     *      For 6-decimal assets (FXRP, USDT0) this also provides built-in
     *      inflation attack protection via the OZ virtual shares mechanism.
     */
    function _decimalsOffset() internal view override returns (uint8) {
        return ASSET_DECIMALS < 18 ? 18 - ASSET_DECIMALS : 0;
    }

    // ── ERC-4626: Asset Accounting ────────────────────────────────────────────

    /**
     * @notice Total asset-equivalent value managed by the vault:
     *         idle asset + LP position value (asset + other priced via FTSOv2) +
     *         uncollected fees in the position.
     *         Returns 0 for the other-token component if the FTSO oracle is stale.
     */
    function totalAssets() public view override returns (uint256) {
        uint256 assetIdle = _availableAssetBalance();
        uint256 otherIdle = _availableOtherBalance();

        if (tokenId == 0) {
            return assetIdle + _otherToAsset(otherIdle);
        }

        (,,,,, int24 tL, int24 tU, uint128 liq,,, uint128 owed0, uint128 owed1) =
            POSITION_MANAGER.positions(tokenId);

        (uint160 sqrtPriceX96,,,,,,) = POOL.slot0();
        (uint256 amount0, uint256 amount1) = _getAmounts(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tL),
            TickMath.getSqrtRatioAtTick(tU),
            liq
        );

        // Split position amounts into asset and other based on pool token ordering
        uint256 assetInPos;
        uint256 otherInPos;
        if (IS_ASSET_TOKEN0) {
            assetInPos = amount0 + _retainedAssetFee(uint256(owed0));
            otherInPos = amount1 + _retainedOtherFee(uint256(owed1));
        } else {
            assetInPos = amount1 + _retainedAssetFee(uint256(owed1));
            otherInPos = amount0 + _retainedOtherFee(uint256(owed0));
        }

        return assetIdle + assetInPos + _otherToAsset(otherIdle + otherInPos);
    }

    /// @notice Max asset withdrawable through ERC-4626 asset-only exits.
    /// @dev Derived from maxRedeem so that withdraw(maxWithdraw(o)) is always
    ///      satisfiable: previewWithdraw rounds shares up, and converting the
    ///      redeemable share cap back to assets keeps it within the idle buffer. (L-04)
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return convertToAssets(maxRedeem(owner_));
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        uint256 idleShares = convertToShares(_availableAssetBalance());
        uint256 shares = balanceOf(owner_);
        return shares < idleShares ? shares : idleShares;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (depositsPaused) return 0;
        uint256 cap = depositCap;
        if (cap == 0) return type(uint256).max;
        uint256 current = totalAssets();
        return current >= cap ? 0 : cap - current;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function availableAssets() external view returns (uint256) {
        return _availableAssetBalance();
    }

    // ── ERC-4626: Public Entry Points (reentrancy guards) ─────────────────────

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        _assertPoolOracleAlignedIfNeeded();
        _collectFeesForRewards();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        _assertPoolOracleAlignedIfNeeded();
        _collectFeesForRewards();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _collectFeesForRewards();
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        _collectFeesForRewards();
        return super.redeem(shares, receiver, owner_);
    }

    function pendingFeeRewards(address owner_)
        public
        view
        returns (uint256 assetAmount, uint256 otherAmount)
    {
        uint256 bal = balanceOf(owner_);
        assetAmount = claimableAsset[owner_]
            + Math.mulDiv(bal, accClaimableAssetPerShare, REWARD_ACC_PRECISION)
            - rewardDebtAsset[owner_];
        otherAmount = claimableOther[owner_]
            + Math.mulDiv(bal, accClaimableOtherPerShare, REWARD_ACC_PRECISION)
            - rewardDebtOther[owner_];
    }

    function pendingWflrRewards(address owner_) public view returns (uint256) {
        uint256 bal = balanceOf(owner_);
        return claimableWflr[owner_]
            + Math.mulDiv(bal, accClaimableWflrPerShare, REWARD_ACC_PRECISION)
            - rewardDebtWflr[owner_];
    }

    function claimFees(address receiver)
        external
        nonReentrant
        returns (uint256 assetAmount, uint256 otherAmount)
    {
        if (receiver == address(0)) revert InvalidParam();
        _checkpointRewards(msg.sender);

        assetAmount = claimableAsset[msg.sender];
        otherAmount = claimableOther[msg.sender];
        if (assetAmount == 0 && otherAmount == 0) revert InvalidParam();

        claimableAsset[msg.sender] = 0;
        claimableOther[msg.sender] = 0;
        _syncRewardDebt(msg.sender);
        totalClaimableAsset -= assetAmount;
        totalClaimableOther -= otherAmount;

        if (assetAmount > 0) IERC20(asset()).safeTransfer(receiver, assetAmount);
        if (otherAmount > 0) IERC20(OTHER_TOKEN).safeTransfer(receiver, otherAmount);

        emit FeeRewardsClaimed(msg.sender, receiver, assetAmount, otherAmount);
    }

    function claimWflr(address receiver) external nonReentrant returns (uint256 wflrAmount) {
        if (receiver == address(0)) revert InvalidParam();
        _checkpointRewards(msg.sender);

        wflrAmount = claimableWflr[msg.sender];
        if (wflrAmount == 0) revert InvalidParam();

        claimableWflr[msg.sender] = 0;
        _syncRewardDebt(msg.sender);
        totalClaimableWflr -= wflrAmount;

        IERC20(WFLR).safeTransfer(receiver, wflrAmount);
        emit WflrRewardsClaimed(msg.sender, receiver, wflrAmount);
    }

    /**
     * @notice Burn shares and receive a proportional slice of vault holdings in BOTH tokens — no swap.
     *         At lower boundary (100% asset):  receive all asset token.
     *         In range:                        receive a mix of asset + other.
     *         At upper boundary (100% other):  receive all other token.
     *         Value received equals the proportional NAV claim at current prices.
     */
    function redeemInKind(
        uint256 shares,
        address receiver,
        address owner_
    ) external nonReentrant returns (uint256 assetOut, uint256 otherOut) {
        if (shares == 0) revert InvalidParam();
        if (owner_ != msg.sender) _spendAllowance(owner_, msg.sender, shares);

        _collectFeesForRewards();
        uint256 supply = totalSupply();

        // Proportional idle balances
        assetOut = Math.mulDiv(_availableAssetBalance(), shares, supply);
        otherOut = Math.mulDiv(_availableOtherBalance(), shares, supply);

        // Proportional position liquidity — collect also drains accrued fees, no swap
        if (tokenId != 0) {
            (,,,,,,, uint128 liq,,,,) = POSITION_MANAGER.positions(tokenId);
            uint128 toRemove = uint128(Math.mulDiv(uint256(liq), shares, supply));
            if (toRemove > 0) {
                POSITION_MANAGER.decreaseLiquidity(
                    IEnosysPositionManager.DecreaseLiquidityParams({
                        tokenId: tokenId,
                        liquidity: toRemove,
                        amount0Min: 0,
                        amount1Min: 0,
                        deadline: block.timestamp
                    })
                );
                (uint256 a0, uint256 a1) = POSITION_MANAGER.collect(
                    IEnosysPositionManager.CollectParams({
                        tokenId: tokenId,
                        recipient: address(this),
                        amount0Max: type(uint128).max,
                        amount1Max: type(uint128).max
                    })
                );
                if (IS_ASSET_TOKEN0) { assetOut += a0; otherOut += a1; }
                else { assetOut += a1; otherOut += a0; }
            }
            // Full redemption: clean up the empty NFT
            if (shares == supply) {
                POSITION_MANAGER.burn(tokenId);
                tokenId = 0;
                tickLower = 0;
                tickUpper = 0;
            }
        }

        _burn(owner_, shares);

        if (assetOut > 0) IERC20(asset()).safeTransfer(receiver, assetOut);
        if (otherOut > 0) IERC20(OTHER_TOKEN).safeTransfer(receiver, otherOut);

        emit WithdrawInKind(owner_, receiver, shares, assetOut, otherOut);
    }


    // ── Keeper Functions ──────────────────────────────────────────────────────

    /**
     * @notice Open a new LP position using all idle asset and other-token balances.
     * @param newTickLower  Tick-spacing aligned, must be < newTickUpper.
     * @param newTickUpper  Tick-spacing aligned.
     *
     * Keeper chooses ticks for the desired position type:
     *   Centered (double-sided): tickLower < currentTick < tickUpper
     *   Single-sided asset:      currentTick <= tickLower  (asset is token0) OR
     *                            currentTick >= tickUpper  (asset is token1)
     *   Snuggle below price:     tickUpper <= currentTick  (other deposited, below current price)
     *   Snuggle above price:     tickLower >= currentTick  (asset deposited, above current price)
     */
    function openPosition(
        int24 newTickLower,
        int24 newTickUpper,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external onlyKeeper nonReentrant {
        if (tokenId != 0) revert PositionExists();
        _validateTicks(newTickLower, newTickUpper);
        _assertPoolOracleAligned();

        uint256 assetBal = _availableAssetBalance();
        uint256 otherBal = _availableOtherBalance();

        (uint256 amount0Desired, uint256 amount1Desired) = IS_ASSET_TOKEN0
            ? (assetBal, otherBal)
            : (otherBal, assetBal);

        IERC20(asset()).forceApprove(address(POSITION_MANAGER), assetBal);
        IERC20(OTHER_TOKEN).forceApprove(address(POSITION_MANAGER), otherBal);

        _minting = true;
        (uint256 tid,, uint256 a0, uint256 a1) = POSITION_MANAGER.mint(
            IEnosysPositionManager.MintParams({
                token0: POOL_TOKEN0,
                token1: POOL_TOKEN1,
                fee: POOL_FEE,
                tickLower: newTickLower,
                tickUpper: newTickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                recipient: address(this),
                deadline: deadline
            })
        );
        _minting = false;

        IERC20(asset()).forceApprove(address(POSITION_MANAGER), 0);
        IERC20(OTHER_TOKEN).forceApprove(address(POSITION_MANAGER), 0);

        tokenId = tid;
        tickLower = newTickLower;
        tickUpper = newTickUpper;

        emit PositionOpened(tid, newTickLower, newTickUpper, a0, a1);
    }

    /**
     * @notice Collect accrued LP fees only (does not touch liquidity).
     *         Takes performance fee on asset fees, reserves feeClaimBps of net fees
     *         for share-holder claims, and compounds the remaining other-token fees.
     */
    function collectFees() external onlyKeeper nonReentrant {
        if (tokenId == 0) revert NoPosition();
        _collectFeesForRewards();
    }

    /**
     * @notice Close the current position and optionally reopen at new ticks atomically.
     *         Pass newTickLower = newTickUpper = 0 to close only.
     */
    function rebalance(
        int24 newTickLower,
        int24 newTickUpper,
        uint256 removeAmount0Min,
        uint256 removeAmount1Min,
        uint256 mintAmount0Min,
        uint256 mintAmount1Min,
        uint256 deadline
    ) external onlyKeeper nonReentrant {
        uint256 oldId = tokenId;
        if (oldId == 0) revert NoPosition();
        _assertPoolOracleAligned();

        _collectFeesForRewards();

        (,,,,,,, uint128 liq,,,,) = POSITION_MANAGER.positions(oldId);

        if (liq > 0) {
            POSITION_MANAGER.decreaseLiquidity(
                IEnosysPositionManager.DecreaseLiquidityParams({
                    tokenId: oldId,
                    liquidity: liq,
                    amount0Min: removeAmount0Min,
                    amount1Min: removeAmount1Min,
                    deadline: deadline
                })
            );
        }

        (uint256 a0, uint256 a1) = POSITION_MANAGER.collect(
            IEnosysPositionManager.CollectParams({
                tokenId: oldId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        POSITION_MANAGER.burn(oldId);
        tokenId = 0;
        tickLower = 0;
        tickUpper = 0;

        emit PositionClosed(oldId, a0, a1);

        if (newTickLower != 0 || newTickUpper != 0) {
            _validateTicks(newTickLower, newTickUpper);

            uint256 assetBal = _availableAssetBalance();
            uint256 otherBal = _availableOtherBalance();

            (uint256 amount0Desired, uint256 amount1Desired) = IS_ASSET_TOKEN0
                ? (assetBal, otherBal)
                : (otherBal, assetBal);

            IERC20(asset()).forceApprove(address(POSITION_MANAGER), assetBal);
            IERC20(OTHER_TOKEN).forceApprove(address(POSITION_MANAGER), otherBal);

            _minting = true;
            (uint256 newId,, uint256 na0, uint256 na1) = POSITION_MANAGER.mint(
                IEnosysPositionManager.MintParams({
                    token0: POOL_TOKEN0,
                    token1: POOL_TOKEN1,
                    fee: POOL_FEE,
                    tickLower: newTickLower,
                    tickUpper: newTickUpper,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: mintAmount0Min,
                    amount1Min: mintAmount1Min,
                    recipient: address(this),
                    deadline: deadline
                })
            );
            _minting = false;

            IERC20(asset()).forceApprove(address(POSITION_MANAGER), 0);
            IERC20(OTHER_TOKEN).forceApprove(address(POSITION_MANAGER), 0);

            tokenId = newId;
            tickLower = newTickLower;
            tickUpper = newTickUpper;

            emit Rebalanced(oldId, newId, newTickLower, newTickUpper);
            emit PositionOpened(newId, newTickLower, newTickUpper, na0, na1);
        }
    }

    /**
     * @notice Remove a specific amount of liquidity to replenish the idle asset buffer.
     *         Use this to pre-fund large pending withdrawals without closing the full position.
     */
    function pullLiquidity(uint128 liquidityAmount, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external onlyKeeper nonReentrant {
        if (tokenId == 0) revert NoPosition();
        _assertPoolOracleAligned();

        _collectFeesForRewards();

        POSITION_MANAGER.decreaseLiquidity(
            IEnosysPositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidityAmount,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            })
        );

        (uint256 a0, uint256 a1) = POSITION_MANAGER.collect(
            IEnosysPositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        emit LiquidityPulled(liquidityAmount, a0, a1);
    }

    // --- Reward harvester hooks --------------------------------------------

    function claimRflrRewards(uint256[] calldata projectIds, uint256 month)
        external
        onlyRewardHarvester
        nonReentrant
        returns (uint256 claimed)
    {
        (uint256 wNatBefore,) = _rnatBalances();
        claimed = IRNat(RNAT).claimRewards(projectIds, month);
        (uint256 wNatAfter,) = _rnatBalances();
        uint256 wNatDelta = wNatAfter > wNatBefore ? wNatAfter - wNatBefore : 0;
        emit RflrClaimed(month, projectIds, uint128(claimed), wNatDelta);
    }

    function withdrawVestedRflr(uint128 amount, bool wrap)
        external
        onlyRewardHarvester
        nonReentrant
        returns (uint256 wrappedOut)
    {
        // Native FLR has no receive() path here and would be lost; only the wrapped
        // (WFLR) withdrawal is accountable, so reject wrap=false up front. (L-02)
        if (!wrap) revert InvalidParam();
        (uint256 wNatBalance, uint256 lockedBalance) = _rnatBalances();
        uint256 unlocked = wNatBalance > lockedBalance ? wNatBalance - lockedBalance : 0;
        uint256 toWithdraw = amount < unlocked ? amount : unlocked;
        if (toWithdraw == 0) revert InvalidParam();

        uint256 balBefore = IERC20(WFLR).balanceOf(address(this));
        IRNat(RNAT).withdraw(uint128(toWithdraw), wrap);
        wrappedOut = IERC20(WFLR).balanceOf(address(this)) - balBefore;
        if (wrappedOut == 0) revert InvalidParam();
        _accrueWflrRewards(wrappedOut);
        emit RflrWithdrawn(wrappedOut);
    }
    function claimExternalRewards(
        address claimTarget,
        bytes calldata claimData,
        address rewardToken,
        address receiver
    ) external onlyExternalRewardClaimer nonReentrant returns (uint256 claimed) {
        if (
            claimTarget == address(0) || rewardToken == address(0) || receiver == address(0)
                || !externalRewardTargets[claimTarget] || !externalRewardTokens[rewardToken]
        ) revert InvalidParam();
        // asset() and WFLR are NEVER claimable through the external path: asset() is the
        // share/NAV unit and WFLR is the rFLR->shareholder reward channel, so both stay
        // structurally untouchable by an arbitrary claim call. OTHER_TOKEN may legitimately
        // BE the incentive (e.g. a WFLR/APS pool earning APS, where APS == OTHER_TOKEN), so
        // it is permitted — but only when the owner has explicitly allowlisted it above.
        // The atomic claim->delta->ship below emits only the newly-received amount, and the
        // post-transfer floor keeps shareholder OTHER fee-claims fully backed. (audit HIGH)
        if (rewardToken == asset() || rewardToken == WFLR) revert InvalidParam();

        uint256 balBefore = IERC20(rewardToken).balanceOf(address(this));
        (bool ok, bytes memory returndata) = claimTarget.call(claimData);
        if (!ok) _revertWith(returndata);

        claimed = IERC20(rewardToken).balanceOf(address(this)) - balBefore;
        if (claimed == 0) revert InvalidParam();
        IERC20(rewardToken).safeTransfer(receiver, claimed);

        // When OTHER is itself the incentive, shipping it must not eat into the
        // shareholder OTHER fee-claim reserve.
        if (rewardToken == OTHER_TOKEN && IERC20(OTHER_TOKEN).balanceOf(address(this)) < totalClaimableOther) {
            revert InvalidParam();
        }

        emit ExternalRewardsClaimed(msg.sender, claimTarget, rewardToken, receiver, claimed);
    }

    /// @notice Allowlist status for the external-reward claim path.
    function isExternalRewardAllowed(address claimer, address target, address token)
        external
        view
        returns (bool claimerOk, bool targetOk, bool tokenOk)
    {
        claimerOk = externalRewardClaimers[claimer];
        targetOk = externalRewardTargets[target];
        tokenOk = externalRewardTokens[token];
    }

    // ── Owner Admin ───────────────────────────────────────────────────────────

    // NOTE: parameter setters below emit no events to stay under EIP-170; the
    // governance tx itself is the audit trail. Role setters (keeper/feeRecipient/
    // harvester) keep events since those are security-relevant.

    function setRangeBps(uint16 newBps) external onlyOwner {
        if (newBps < MIN_RANGE_BPS || newBps > MAX_RANGE_BPS) revert InvalidParam();
        rangeBps = newBps;
    }

    function setMinHarvestAsset(uint256 amount) external onlyOwner {
        minHarvestAsset = amount;
    }


    function setPerformanceFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_PERF_FEE_BPS) revert InvalidParam();
        performanceFeeBps = newBps;
    }

    function setFeeClaimBps(uint16 newBps) external onlyOwner {
        if (newBps > 10_000) revert InvalidParam();
        feeClaimBps = newBps;
    }


    function setDepositCap(uint256 newCap) external onlyOwner {
        depositCap = newCap;
    }

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
    }


    function setPoolOracleDeviationBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_POOL_ORACLE_DEVIATION_BPS) revert InvalidParam();
        poolOracleDeviationBps = newBps;
    }

    function setRewardHarvester(address newHarvester) external onlyOwner {
        if (newHarvester == address(0)) revert InvalidParam();
        emit RewardHarvesterUpdated(rewardHarvester, newHarvester);
        rewardHarvester = newHarvester;
    }
    function setExternalRewardClaimer(address claimer, bool allowed) external onlyOwner {
        if (claimer == address(0)) revert InvalidParam();
        externalRewardClaimers[claimer] = allowed;
    }

    function setExternalRewardTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert InvalidParam();
        externalRewardTargets[target] = allowed;
    }

    function setExternalRewardToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidParam();
        externalRewardTokens[token] = allowed;
    }

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert InvalidParam();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidParam();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ── IERC721Receiver ───────────────────────────────────────────────────────

    function onERC721Received(address, address, uint256, bytes calldata) external view override returns (bytes4) {
        // Only accept the position NFT the vault itself is minting. Unsolicited LP
        // NFTs are rejected so they cannot be permanently stranded here. (L-03)
        if (msg.sender != address(POSITION_MANAGER) || !_minting) revert InvalidParam();
        return IERC721Receiver.onERC721Received.selector;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _checkpointRewards(from);
        if (to != address(0)) _checkpointRewards(to);

        super._update(from, to, value);

        if (from != address(0)) _syncRewardDebt(from);
        if (to != address(0)) _syncRewardDebt(to);
    }

    function _checkpointRewards(address owner_) internal {
        uint256 bal = balanceOf(owner_);
        uint256 assetAccumulated = Math.mulDiv(bal, accClaimableAssetPerShare, REWARD_ACC_PRECISION);
        uint256 otherAccumulated = Math.mulDiv(bal, accClaimableOtherPerShare, REWARD_ACC_PRECISION);
        uint256 wflrAccumulated  = Math.mulDiv(bal, accClaimableWflrPerShare,  REWARD_ACC_PRECISION);

        uint256 assetDebt = rewardDebtAsset[owner_];
        if (assetAccumulated > assetDebt) {
            claimableAsset[owner_] += assetAccumulated - assetDebt;
        }

        uint256 otherDebt = rewardDebtOther[owner_];
        if (otherAccumulated > otherDebt) {
            claimableOther[owner_] += otherAccumulated - otherDebt;
        }

        uint256 wflrDebt = rewardDebtWflr[owner_];
        if (wflrAccumulated > wflrDebt) {
            claimableWflr[owner_] += wflrAccumulated - wflrDebt;
        }
    }

    function _syncRewardDebt(address owner_) internal {
        uint256 bal = balanceOf(owner_);
        rewardDebtAsset[owner_] = Math.mulDiv(bal, accClaimableAssetPerShare, REWARD_ACC_PRECISION);
        rewardDebtOther[owner_] = Math.mulDiv(bal, accClaimableOtherPerShare, REWARD_ACC_PRECISION);
        rewardDebtWflr[owner_]  = Math.mulDiv(bal, accClaimableWflrPerShare,  REWARD_ACC_PRECISION);
    }

    function _accrueFeeRewards(uint256 assetAmount, uint256 otherAmount) internal {
        if (assetAmount == 0 && otherAmount == 0) return;

        uint256 supply = totalSupply();
        if (supply == 0) return;

        // Reserve only the share-distributable (floored) portion. The rounding
        // remainder stays in idle balance and accrues to NAV instead of being
        // permanently stranded inside totalClaimable. (L-01)
        if (assetAmount > 0) {
            uint256 inc = Math.mulDiv(assetAmount, REWARD_ACC_PRECISION, supply);
            if (inc > 0) {
                accClaimableAssetPerShare += inc;
                totalClaimableAsset += Math.mulDiv(inc, supply, REWARD_ACC_PRECISION);
            }
        }
        if (otherAmount > 0) {
            uint256 inc = Math.mulDiv(otherAmount, REWARD_ACC_PRECISION, supply);
            if (inc > 0) {
                accClaimableOtherPerShare += inc;
                totalClaimableOther += Math.mulDiv(inc, supply, REWARD_ACC_PRECISION);
            }
        }

        emit FeeRewardsAccrued(assetAmount, otherAmount);
    }

    function _accrueWflrRewards(uint256 wflrAmount) internal {
        if (wflrAmount == 0) return;
        uint256 supply = totalSupply();
        if (supply == 0) return;
        uint256 inc = Math.mulDiv(wflrAmount, REWARD_ACC_PRECISION, supply);
        if (inc > 0) {
            accClaimableWflrPerShare += inc;
            totalClaimableWflr += Math.mulDiv(inc, supply, REWARD_ACC_PRECISION);
        }
        emit WflrRewardsAccrued(wflrAmount);
    }

    function _collectFeesForRewards() internal returns (uint256 assetFees, uint256 otherFees, uint256 perfFee) {
        if (tokenId == 0) return (0, 0, 0);

        (uint256 out0, uint256 out1) = POSITION_MANAGER.collect(
            IEnosysPositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (assetFees, otherFees) = IS_ASSET_TOKEN0 ? (out0, out1) : (out1, out0);

        uint256 assetClaim = (assetFees * feeClaimBps) / 10_000;
        uint256 otherClaim = (otherFees * feeClaimBps) / 10_000;
        _accrueFeeRewards(assetClaim, otherClaim);

        uint256 totalFeeValue = assetFees + _otherToAsset(otherFees);
        if (totalFeeValue >= minHarvestAsset && performanceFeeBps > 0) {
            perfFee = (totalFeeValue * performanceFeeBps) / 10_000;
            uint256 assetsAfterFees = totalAssets();
            uint256 supply = totalSupply();
            if (perfFee > 0 && supply > 0 && perfFee < assetsAfterFees) {
                uint256 feeShares = Math.mulDiv(perfFee, supply, assetsAfterFees - perfFee);
                if (feeShares > 0) _mint(feeRecipient, feeShares);
            }
        }

        emit FeesCollected(assetFees, otherFees, perfFee);
    }

    function _retainedAssetFee(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        return amount - ((amount * feeClaimBps) / 10_000);
    }

    function _retainedOtherFee(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        return amount - ((amount * feeClaimBps) / 10_000);
    }

    function _availableAssetBalance() internal view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = totalClaimableAsset;
        // RFLR-sourced WFLR is earmarked for claimWflr and must not enter LP positions
        // or NAV. Reserve it from the asset balance when asset == WFLR. (M-02)
        if (asset() == WFLR) reserved += totalClaimableWflr;
        return bal > reserved ? bal - reserved : 0;
    }

    function _availableOtherBalance() internal view returns (uint256) {
        uint256 bal = IERC20(OTHER_TOKEN).balanceOf(address(this));
        uint256 reserved = totalClaimableOther;
        if (OTHER_TOKEN == WFLR) reserved += totalClaimableWflr;
        return bal > reserved ? bal - reserved : 0;
    }



    function _rnatBalances() internal view returns (uint256 wNatBalance, uint256 lockedBalance) {
        try IRNat(RNAT).getBalancesOf(address(this)) returns (uint256 wNat, uint256, uint256 locked) {
            return (wNat, locked);
        } catch {
            return (0, 0);
        }
    }

    function _revertWith(bytes memory returndata) private pure {
        if (returndata.length == 0) revert InvalidParam();
        assembly {
            revert(add(returndata, 32), mload(returndata))
        }
    }

    // --- Internal: Oracle & Pricing ────────────────────────────────────────────

    function _assertPoolOracleAlignedIfNeeded() internal view {
        if (tokenId == 0 && _availableOtherBalance() == 0) return;
        _assertPoolOracleAligned();
    }

    function _assertPoolOracleAligned() internal view {
        // bytes21(0) means no FTSO feed for the other token — skip on-chain oracle guard.
        // Keeper enforces price sanity off-chain via DEX spot price.
        if (OTHER_FEED_ID == bytes21(0)) return;

        (uint256 assetUsdE18, bool validA) = _getFeedPriceE18(ASSET_FEED_ID);
        (uint256 otherUsdE18, bool validB) = _getFeedPriceE18(OTHER_FEED_ID);
        if (!validA || !validB || otherUsdE18 == 0) revert InvalidParam();

        uint256 oracleOtherPerAsset = Math.mulDiv(10 ** OTHER_DECIMALS, assetUsdE18, otherUsdE18);
        uint256 poolOtherPerAsset = _poolOtherPerAsset();
        uint256 diff = poolOtherPerAsset > oracleOtherPerAsset
            ? poolOtherPerAsset - oracleOtherPerAsset
            : oracleOtherPerAsset - poolOtherPerAsset;

        if (Math.mulDiv(diff, 10_000, oracleOtherPerAsset) > poolOracleDeviationBps) revert InvalidParam();
    }

    function _poolOtherPerAsset() internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,,,,) = POOL.slot0();
        uint256 oneAsset = 10 ** ASSET_DECIMALS;
        if (IS_ASSET_TOKEN0) {
            uint256 token1PerToken0 = Math.mulDiv(oneAsset, uint256(sqrtPriceX96), Q96);
            return Math.mulDiv(token1PerToken0, uint256(sqrtPriceX96), Q96);
        }

        uint256 token0PerToken1 = Math.mulDiv(oneAsset, Q96, uint256(sqrtPriceX96));
        return Math.mulDiv(token0PerToken1, Q96, uint256(sqrtPriceX96));
    }

    function _getFeedPriceE18(bytes21 feedId) internal view returns (uint256 priceE18, bool valid) {
        bytes21[] memory feeds = new bytes21[](1);
        feeds[0] = feedId;
        (uint256[] memory values, int8[] memory dec, uint64 ts) = FTSO_V2.getFeedsById(feeds);

        if (block.timestamp - ts > FTSO_STALE_AFTER) return (0, false);
        if (values[0] == 0) return (0, false);

        int8 d = dec[0];
        if (d >= 0) {
            uint8 ud = uint8(d);
            priceE18 = ud <= 18 ? values[0] * (10 ** (18 - ud)) : values[0] / (10 ** (ud - 18));
        } else {
            priceE18 = values[0] * (10 ** (18 + uint8(-d)));
        }
        valid = true;
    }

    /**
     * @dev Convert other-token amount to asset-equivalent using the current DEX spot price.
     */
    function _otherToAsset(uint256 otherAmount) internal view returns (uint256) {
        if (otherAmount == 0) return 0;
        uint256 spotOtherPerAsset = _poolOtherPerAsset();
        if (spotOtherPerAsset == 0) return 0;
        return Math.mulDiv(otherAmount, 10 ** ASSET_DECIMALS, spotOtherPerAsset);
    }

    // -- Internal: Uniswap V3 Liquidity Math ----------------------------------
    function _getAmounts(uint160 sqrtRatioX96, uint160 sqrtA, uint160 sqrtB, uint128 liq)
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);

        if (sqrtRatioX96 <= sqrtA) {
            amount0 = _amount0Delta(sqrtA, sqrtB, liq);
        } else if (sqrtRatioX96 < sqrtB) {
            amount0 = _amount0Delta(sqrtRatioX96, sqrtB, liq);
            amount1 = _amount1Delta(sqrtA, sqrtRatioX96, liq);
        } else {
            amount1 = _amount1Delta(sqrtA, sqrtB, liq);
        }
    }

    // liquidity * Q96 * (sqrtB - sqrtA) / (sqrtA * sqrtB)
    // Safe for all three pool pairs at realistic price ranges (sqrtA * sqrtB < 2^256)
    function _amount0Delta(uint160 sqrtA, uint160 sqrtB, uint128 liq) internal pure returns (uint256) {
        return Math.mulDiv(uint256(liq) << 96, uint256(sqrtB) - uint256(sqrtA), uint256(sqrtA) * uint256(sqrtB));
    }

    // liquidity * (sqrtB - sqrtA) / Q96
    function _amount1Delta(uint160 sqrtA, uint160 sqrtB, uint128 liq) internal pure returns (uint256) {
        return Math.mulDiv(uint256(liq), uint256(sqrtB) - uint256(sqrtA), Q96);
    }

    // ── Internal: Validation ──────────────────────────────────────────────────

    function _validateTicks(int24 lower, int24 upper) internal view {
        if (lower >= upper) revert BadTicks();
        if (lower % TICK_SPACING != 0 || upper % TICK_SPACING != 0) revert TickNotAligned();
    }

    // ── View Helpers ──────────────────────────────────────────────────────────

    /// @notice Current pool tick.
    function currentTick() external view returns (int24) {
        (, int24 tick,,,,,) = POOL.slot0();
        return tick;
    }

    /// @notice Whether the active position is within the earning price range.
    function isInRange() external view returns (bool) {
        if (tokenId == 0) return false;
        (, int24 tick,,,,,) = POOL.slot0();
        return tick >= tickLower && tick < tickUpper;
    }

    /**
     * @notice Ticks for a single-sided asset position placed just above current price.
     *         The entire range sits above current tick so only the asset token is needed.
     *         As price rises into the range, asset converts to other token and fees accrue.
     */
    function snuggleTicks() external view returns (int24 lower, int24 upper) {
        (, int24 tick,,,,,) = POOL.slot0();
        int24 ts = TICK_SPACING;
        int24 rangeWidth = int24(int256(uint256(rangeBps))) / ts * ts;
        if (rangeWidth < ts) rangeWidth = ts;
        // First tick-aligned boundary strictly above current tick
        int24 floorTick = (tick / ts) * ts;
        if (floorTick > tick) floorTick -= ts; // correct Solidity toward-zero truncation for negatives
        lower = floorTick + ts;
        upper = lower + rangeWidth;
    }
}
