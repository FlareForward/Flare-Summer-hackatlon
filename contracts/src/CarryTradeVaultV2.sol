// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// ─── External interfaces ──────────────────────────────────────────────────────

/// @dev Morpho Blue market identity. Field order is consensus-critical.
struct MarketParams {
    address loanToken;       // USDT0
    address collateralToken; // WFLR or FXRP
    address oracle;
    address irm;
    uint256 lltv;
}

interface IMorpho {
    function supply(MarketParams calldata marketParams, uint256 assets, uint256 shares, address onBehalf, bytes calldata data)
        external
        returns (uint256 assetsSupplied, uint256 sharesSupplied);
    function withdraw(MarketParams calldata marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);
    function supplyCollateral(MarketParams calldata marketParams, uint256 assets, address onBehalf, bytes calldata data)
        external;
    function withdrawCollateral(MarketParams calldata marketParams, uint256 assets, address onBehalf, address receiver)
        external;
    function borrow(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);
    function repay(MarketParams calldata marketParams, uint256 assets, uint256 shares, address onBehalf, bytes calldata data)
        external returns (uint256 assetsRepaid, uint256 sharesRepaid);
    function accrueInterest(MarketParams calldata marketParams) external;
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );
}

interface IMorphoOracle {
    function price() external view returns (uint256);
}

/// @dev Compound-fork (Kinetic) kToken.
interface IKToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function borrow(uint256 borrowAmount) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function accrueInterest() external returns (uint256);
    function getCash() external view returns (uint256);
    function underlying() external view returns (address);
}

/// @dev Compound-fork native FLR market (Kinetic kFLR / CNative).
interface INativeKToken {
    function mint() external payable;
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
}

interface IWFLR {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @dev Minimal ERC4626 surface used for Mystic-style yield vault supply venues.
///      V2 CHANGE: new interface enabling ERC4626 venues alongside Kinetic kTokens.
interface IERC4626Venue {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function balanceOf(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
}

interface IComptroller {
    function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory);
    function claimReward(
        uint8 rewardType,
        address[] calldata holders,
        address[] calldata kTokens,
        bool borrowers,
        bool suppliers
    ) external;
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

interface IRNat {
    function claimRewards(uint256[] calldata projectIds, uint256 month) external returns (uint128 claimedRewardsWei);
    function getBalancesOf(address owner)
        external
        view
        returns (uint256 wNatBalance, uint256 rNatBalance, uint256 lockedBalance);
    function withdraw(uint128 amount, bool wrap) external;
}

// ─── CarryTradeVaultV2 ────────────────────────────────────────────────────────

/// @title CarryTradeVaultV2
/// @notice Collateral-native carry vault with two explicitly separated carry directions:
///
///   1. MORPHO-DEBT / VENUE-SUPPLY CARRY
///      The legacy path posts collateral to Morpho, borrows USDT0, then supplies
///      USDT0 into configured yield venues. Supply venues support two kinds:
///        VENUE_KIND_KINETIC (0): Compound-fork kToken (Kinetic). Unchanged from V1.
///        VENUE_KIND_ERC4626 (1): ERC4626 yield vault (Mystic). New in V2.
///      The keeper selects the kind per venue at registration. ERC4626 venues skip
///      the Kinetic accrueInterest() call in _pokeAll and have no comptroller.
///
///   2. KINETIC-DEBT / MORPHO-SUPPLY REVERSE CARRY
///      Optional constructor config enables a reverse leg that posts collateral to
///      Kinetic, borrows USDT0 there, and supplies USDT0 to the fixed Morpho market.
///      The two directions are intentionally mutually exclusive at runtime to keep
///      accounting and liquidation risk auditable.
///
///   3. SURPLUS USDT0 CLAIM BY SHAREHOLDERS
///      USDT0 accumulated above total USDT0 debt is distributed directly to shareholders
///      in USDT0 rather than swapped back to collateral. A MasterChef-style per-share
///      accumulator (surplusPerShareAcc) tracks earned USDT0 per vault share. Surplus
///      is booked via _bookSurplus() which charges a 10% performance fee to the operator
///      in USDT0 and distributes the rest proportionally to all current shareholders.
///
///      Booking happens at the top of deposit() and requestWithdrawal(), so a new
///      depositor's index is set AFTER any existing surplus is distributed — a
///      flash-deposit/withdraw sequence earns zero on pre-existing surplus (JIT-safe).
///
///      Users claim their USDT0 via claimSurplus() at any time, or it is paid out
///      automatically when they call requestWithdrawal().
///
/// @dev V1 → V2 changes requiring keeper update before deployment:
///      - supplyToKinetic renamed to supplyToVenue
///      - redeemFromKinetic renamed to redeemFromVenue
///      - VenueConfig struct adds uint8 kind
///      - VenueRegistered event adds uint8 kind
///
///      V1 → V2 removals:
///      - IUsdt0RewardReceiver interface removed
///      - ISwapRouterV3 interface removed
///      - _routeUsdt0Surplus() replaced by _bookSurplus() accumulator
///      - Usdt0SurplusRouted event replaced by SurplusBooked / SurplusClaimed
///      - CarryCompoundReceiver is superseded
contract CarryTradeVaultV2 is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Constants -----------------------------------------------------------

    address public constant USDT0 = 0xe7cd86e13AC4309349F30B3435a9d337750fC82D;
    address public constant WFLR  = 0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d;
    address public constant FXRP  = 0xAd552A648C74D49E10027AB8a618A3ad4901c5bE;
    address public constant RNAT  = 0x26d460c3Cf931Fb2014FA436a49e3Af08619810e;

    address public constant MORPHO    = 0xF4346F5132e810f80a28487a79c7559d9797E8B0;
    uint256 public constant ORACLE_SCALE  = 1e36;
    uint256 public constant LLTV_TO_BPS   = 1e14;
    uint256 public constant BPS_DIVISOR   = 10_000;
    uint256 public constant PERFORMANCE_FEE_BPS = 1_000;
    uint256 public constant MAX_VENUES    = 6;
    uint256 public constant MIN_FIRST_DEPOSIT = 1e6;
    uint256 public constant DEAD_SHARES   = 1_000;

    // V2 CHANGE: explicit venue kind constants
    uint8 public constant VENUE_KIND_KINETIC = 0;
    uint8 public constant VENUE_KIND_ERC4626 = 1;

    // --- Types ---------------------------------------------------------------

    struct LegInit {
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
        uint16 maxBorrowLtvBps;
        uint16 emergencyLtvBps;
    }

    /// @dev Supply venue for borrowed USDT0.
    ///      V2 CHANGE: added `kind` field.
    ///        kind == VENUE_KIND_KINETIC  → kToken is a Compound-fork kToken
    ///        kind == VENUE_KIND_ERC4626  → kToken is an ERC4626 vault address
    ///      The field name `kToken` is kept for layout continuity; for ERC4626 venues
    ///      it holds the ERC4626 vault address.
    struct KineticVenue {
        address kToken;
        address comptroller;     // Kinetic only; address(0) for ERC4626
        bool redeemable;
        bool enabled;
        uint16 maxAllocationBps;
        uint8 kind;
    }

    struct VenueConfig {
        address kToken;
        address comptroller;
        bool redeemable;
        uint16 maxAllocationBps;
        uint8 kind;              // V2 CHANGE: added kind field
    }

    /// @dev Optional reverse carry leg:
    ///      deposit vault collateral into Kinetic, borrow USDT0 there, and supply
    ///      that USDT0 into the fixed Morpho market as lender liquidity.
    struct KineticBorrowConfig {
        address comptroller;
        address collateralKToken;
        address debtKToken;
        uint16 maxBorrowLtvBps;
        uint16 emergencyLtvBps;
        bool collateralIsNative;
        bool enabled;
    }

    // --- Immutables ----------------------------------------------------------

    address public immutable collateralToken;
    address public immutable oracle;
    address public immutable irm;
    uint256 public immutable lltv;
    bytes32 public immutable marketId;

    // --- Storage -------------------------------------------------------------

    address public keeper;
    address public guardian;
    address public rewardHarvester;
    address public operator;
    bool public depositsPaused;
    bool public emergencyMode;

    uint16 public maxBorrowLtvBps;
    uint16 public emergencyLtvBps;
    uint16 public emergencyRepayBps;

    // Per-share surplus accumulator (1e18-scaled USDT0 per vault share).
    // Monotonically increases as surplus is booked; never decreases.
    uint256 public surplusPerShareAcc;

    // Per-user last-seen surplusPerShareAcc snapshot, updated on every balance change.
    mapping(address => uint256) public userSurplusIndex;

    // Per-user claimable USDT0 that has been earned but not yet paid out.
    mapping(address => uint256) public userSurplusAccrued;

    // Total USDT0 booked and earmarked to shareholders but not yet claimed.
    // NOTE: surplusUsdt0() >= surplusReserved holds at the moment of each _bookSurplus,
    // but is NOT a standing invariant: borrow interest raises debt() over time, so
    // under sustained negative carry surplusUsdt0() can fall below surplusReserved. This is
    // fund-safe — every payout (claimSurplus / requestWithdrawal) is hard-capped to
    // `idle - debt()`, so the vault never pays out USDT0 it needs for debt and surplusReserved
    // never underflows (it is only decremented by amounts actually paid). The residual effect
    // is first-come-first-served: if carry has gone negative since booking, late claimers may
    // receive a partial payout and the remainder stays in userSurplusAccrued for a later claim.
    // Keeper guidance: book surplus frequently and keep carry positive.
    uint256 public surplusReserved;

    // Per-share WFLR (rFLR vesting rewards) accumulator (1e18-scaled).
    // Increases each time withdrawVestedRflr books a new unlock batch.
    uint256 public wflrPerShareAcc;

    // Per-user WFLR index snapshot and claimable balance.
    mapping(address => uint256) public userWflrIndex;
    mapping(address => uint256) public userWflrAccrued;

    // Total WFLR booked into the accumulator but not yet claimed.
    uint256 public wflrReserved;

    uint256 public highWaterMarkPerShare;
    uint256 public nextWithdrawalId;
    uint256 public depositCap;
    uint256 public collateralCostBasis;

    KineticVenue[] internal _venues;

    KineticBorrowConfig public kineticBorrow;

    // --- Events --------------------------------------------------------------

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event WithdrawalRequested(address indexed user, uint256 indexed requestId, uint256 shares, uint256 assets);
    event WithdrawalClaimed(address indexed user, uint256 indexed requestId, uint256 assets);
    event PerformanceFeeMinted(address indexed operator, uint256 feeAssets, uint256 feeShares);

    event CollateralPosted(uint256 collateralSupplied);
    event Borrowed(uint256 usdt0Borrowed, uint256 ltvBps);
    event DebtRepaid(uint256 usdt0Repaid);
    event CollateralWithdrawn(uint256 collateralWithdrawn);

    // V2 CHANGE: renamed from KineticSupplied / KineticRedeemed
    event VenueSupplied(uint256 indexed venueId, uint256 usdt0Amount, uint256 sharesReceived);
    event VenueRedeemed(uint256 indexed venueId, uint256 usdt0Requested, uint256 usdt0Received);

    event KineticBorrowConfigured(
        address indexed comptroller,
        address indexed collateralKToken,
        address indexed debtKToken,
        uint16 maxBorrowLtvBps,
        uint16 emergencyLtvBps,
        bool enabled
    );
    event KineticCollateralSupplied(uint256 collateralAmount, uint256 sharesReceived);
    event KineticCollateralRedeemed(uint256 collateralAmount);
    event KineticBorrowed(uint256 usdt0Borrowed, uint256 ltvBps);
    event KineticDebtRepaid(uint256 usdt0Repaid);
    event MorphoLenderSupplied(uint256 usdt0Amount, uint256 sharesReceived);
    event MorphoLenderWithdrawn(uint256 usdt0Amount, uint256 sharesBurned);

    event EmergencyRepaid(uint256 usdt0Repaid, uint256 ltvBefore, uint256 ltvAfter);

    // V2 CHANGE: VenueRegistered now includes kind
    event VenueRegistered(uint256 indexed venueId, address indexed kToken, bool redeemable, uint16 maxAllocationBps, uint8 kind);
    event VenueUpdated(uint256 indexed venueId, bool enabled, uint16 maxAllocationBps);
    event VenueAllowanceRevoked(uint256 indexed venueId, address indexed kToken);

    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event RewardHarvesterUpdated(address indexed oldHarvester, address indexed newHarvester);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event DepositsPaused(bool paused);
    event DepositCapUpdated(uint256 newCap);
    event EmergencyModeSet(bool enabled);
    event RiskParamsUpdated(
        uint16 maxBorrowLtvBps,
        uint16 emergencyLtvBps,
        uint16 emergencyRepayBps
    );
    event RflrClaimed(uint256 indexed month, uint256[] projectIds, uint128 claimed, uint256 wNatDelta);
    event RflrWithdrawn(uint256 amount);
    event VenueRewardsClaimed(uint256 indexed venueId, address indexed comptroller, uint256 rflrDelta);

    // Emitted when unbooked surplus is distributed: operatorFee goes to operator's
    // userSurplusAccrued directly; the rest flows into surplusPerShareAcc for all holders.
    event SurplusBooked(uint256 newSurplus, uint256 operatorFee, uint256 perShareIncrease);

    // Emitted when a user receives accrued USDT0 surplus (via claimSurplus or requestWithdrawal).
    event SurplusClaimed(address indexed user, uint256 usdt0Amount);

    // Emitted when a vested WFLR batch is distributed to the per-share accumulator.
    event WflrBooked(uint256 amount, uint256 perShareIncrease);

    // Emitted when a user claims their accrued WFLR.
    event WflrClaimed(address indexed user, uint256 amount);

    // --- Errors --------------------------------------------------------------

    error NotKeeper();
    error NotGuardian();
    error NotHarvester();

    error ZeroKeeper();
    error ZeroGuardian();
    error ZeroHarvester();
    error ZeroOperator();

    error BadVenueCount();
    error BadCollateral();
    error BadMarket();
    error BadLltv();
    error BorrowLtvGtLltv();
    error BadEmergencyLtv();
    error ZeroPool();
    error VenueCapTooHigh();
    error ZeroComptroller();
    error BadUnderlying();
    error BadVenue();
    error BadRepayBps();
    error BadVenueKind();
    error BadKineticBorrowConfig();
    error KineticBorrowDisabled();
    error MixedCarryMode();
    error NothingToClaim();
    error NothingToClaimWflr();

    error DepositsPausedError();
    error ZeroAssets();
    error DepositCapExceeded();
    error BelowMinFirstDeposit();
    error ZeroShares();
    error InsufficientShares();

    error InsufficientCollateral();
    error NotFunded();
    error NoCollateral();

    error ZeroAmount();
    error Emergency();
    error ExceedsIdle();
    error LtvCapBreached();
    error LtvBelowTrigger();
    error NothingToRepay();
    error NoDebt();
    error LtvNotReduced();
    error InsufficientUsdt0();
    error ReserveFloor();

    error VenueDisabled();
    error ExceedsIdleUsdt0();
    error VenueCap();
    error ZeroVenueShares();
    error ZeroReceived();
    error KineticMintFailed();
    error KineticRedeemFailed();
    error KineticBorrowFailed();
    error KineticRepayFailed();
    error KineticEnterMarketFailed();
    error NativeCollateralRequiresWflr();
    error WflrUnwrapFailed();
    error WflrWrapFailed();
    error UnexpectedNative();

    error BadOracle();
    error NothingUnlocked();
    error WithdrawReturnedZero();

    // --- Modifiers -----------------------------------------------------------

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
        _;
    }

    modifier onlyRewardHarvester() {
        if (msg.sender != rewardHarvester) revert NotHarvester();
        _;
    }

    // --- Constructor ---------------------------------------------------------

    constructor(
        address _owner,
        address _keeper,
        address _guardian,
        address _rewardHarvester,
        address _operator,
        string memory _name,
        string memory _symbol,
        LegInit memory leg,
        VenueConfig[] memory venues,
        KineticBorrowConfig memory kineticBorrowConfig
    ) ERC20(_name, _symbol) Ownable(_owner) {
        if (_keeper == address(0)) revert ZeroKeeper();
        if (_guardian == address(0)) revert ZeroGuardian();
        if (_rewardHarvester == address(0)) revert ZeroHarvester();
        if (_operator == address(0)) revert ZeroOperator();
        if (!(venues.length > 0 && venues.length <= MAX_VENUES)) revert BadVenueCount();

        if (!(leg.collateralToken != address(0) && leg.collateralToken != USDT0)) revert BadCollateral();
        if (!(leg.oracle != address(0) && leg.irm != address(0))) revert BadMarket();
        uint256 lltvBps_ = leg.lltv / LLTV_TO_BPS;
        if (!(lltvBps_ > 0 && lltvBps_ < BPS_DIVISOR)) revert BadLltv();
        if (leg.maxBorrowLtvBps >= lltvBps_) revert BorrowLtvGtLltv();
        if (!(leg.emergencyLtvBps > leg.maxBorrowLtvBps && leg.emergencyLtvBps < lltvBps_)) revert BadEmergencyLtv();

        keeper = _keeper;
        guardian = _guardian;
        rewardHarvester = _rewardHarvester;
        operator = _operator;
        highWaterMarkPerShare = 1e18;

        collateralToken = leg.collateralToken;
        oracle = leg.oracle;
        irm = leg.irm;
        lltv = leg.lltv;
        marketId = keccak256(abi.encode(MarketParams({
            loanToken: USDT0,
            collateralToken: leg.collateralToken,
            oracle: leg.oracle,
            irm: leg.irm,
            lltv: leg.lltv
        })));

        maxBorrowLtvBps = leg.maxBorrowLtvBps;
        emergencyLtvBps = leg.emergencyLtvBps;
        emergencyRepayBps = 5_000;
        for (uint256 i; i < venues.length;) {
            _registerVenue(venues[i]);
            unchecked { ++i; }
        }
        _configureKineticBorrow(kineticBorrowConfig);
    }

    receive() external payable {
        if (msg.sender != WFLR && msg.sender != kineticBorrow.collateralKToken) revert UnexpectedNative();
    }

    function _configureKineticBorrow(KineticBorrowConfig memory cfg) internal {
        if (!cfg.enabled) {
            if (
                cfg.comptroller != address(0) ||
                cfg.collateralKToken != address(0) ||
                cfg.debtKToken != address(0) ||
                cfg.maxBorrowLtvBps != 0 ||
                cfg.emergencyLtvBps != 0 ||
                cfg.collateralIsNative
            ) revert BadKineticBorrowConfig();
            emit KineticBorrowConfigured(address(0), address(0), address(0), 0, 0, false);
            return;
        }

        if (cfg.comptroller == address(0) || cfg.collateralKToken == address(0) || cfg.debtKToken == address(0)) {
            revert BadKineticBorrowConfig();
        }
        if (cfg.collateralIsNative) {
            if (collateralToken != WFLR) revert NativeCollateralRequiresWflr();
        } else {
            if (IKToken(cfg.collateralKToken).underlying() != collateralToken) revert BadUnderlying();
        }
        if (IKToken(cfg.debtKToken).underlying() != USDT0) revert BadUnderlying();
        if (cfg.maxBorrowLtvBps == 0 || cfg.maxBorrowLtvBps >= cfg.emergencyLtvBps || cfg.emergencyLtvBps >= BPS_DIVISOR) {
            revert BadKineticBorrowConfig();
        }

        address[] memory markets = new address[](1);
        markets[0] = cfg.collateralKToken;
        uint256[] memory results = IComptroller(cfg.comptroller).enterMarkets(markets);
        if (results.length != 1 || results[0] != 0) revert KineticEnterMarketFailed();

        kineticBorrow = cfg;
        emit KineticBorrowConfigured(
            cfg.comptroller,
            cfg.collateralKToken,
            cfg.debtKToken,
            cfg.maxBorrowLtvBps,
            cfg.emergencyLtvBps,
            true
        );
    }

    // V2 CHANGE: _registerVenue dispatches validation by kind.
    //            ERC4626: validate asset() == USDT0; comptroller not required.
    //            Kinetic:  unchanged (validate underlying() == USDT0, require comptroller).
    function _registerVenue(VenueConfig memory cfg) internal {
        if (cfg.kToken == address(0)) revert ZeroPool();
        if (cfg.maxAllocationBps > BPS_DIVISOR) revert VenueCapTooHigh();

        if (cfg.kind == VENUE_KIND_KINETIC) {
            if (cfg.comptroller == address(0)) revert ZeroComptroller();
            if (IKToken(cfg.kToken).underlying() != USDT0) revert BadUnderlying();
        } else if (cfg.kind == VENUE_KIND_ERC4626) {
            // comptroller unused — ERC4626 yield is already priced into share rate
            if (IERC4626Venue(cfg.kToken).asset() != USDT0) revert BadUnderlying();
        } else {
            revert BadVenueKind();
        }

        uint256 venueId = _venues.length;
        _venues.push(KineticVenue({
            kToken: cfg.kToken,
            comptroller: cfg.comptroller,
            redeemable: cfg.redeemable,
            enabled: true,
            maxAllocationBps: cfg.maxAllocationBps,
            kind: cfg.kind
        }));
        emit VenueRegistered(venueId, cfg.kToken, cfg.redeemable, cfg.maxAllocationBps, cfg.kind);
    }

    function decimals() public view override returns (uint8) {
        return IERC20Decimals(collateralToken).decimals();
    }

    function asset() external view returns (address) {
        return collateralToken;
    }

    // --- Views ---------------------------------------------------------------

    /// @notice Net asset value in collateral units. USDT0 surplus above debt is NOT included
    ///         here — it is distributed directly to shareholders in USDT0 via the surplus
    ///         accumulator. Shares are purely collateral-denominated; the collateral-side HWM
    ///         and performance fee are unaffected by USDT0 surplus movements.
    function totalAssets() public view returns (uint256) {
        uint256 collateralAssets = IERC20(collateralToken).balanceOf(address(this))
            + postedCollateral()
            + kineticCollateralAssets();
        uint256 usdt0Assets = IERC20(USDT0).balanceOf(address(this)) + totalVenueAssets() + morphoSupplyAssets();
        uint256 d = debt();
        uint256 gross = collateralAssets;
        if (usdt0Assets < d) {
            uint256 shortfall = _usdt0ToCollateral(d - usdt0Assets);
            gross = gross > shortfall ? gross - shortfall : 0;
        }
        return gross;
    }

    /// @notice Total USDT0 above debt (idle + venues). Includes already-booked surplusReserved.
    ///         The unbooked portion (surplusUsdt0() - surplusReserved) is distributed on
    ///         the next _bookSurplus() call.
    function surplusUsdt0() public view returns (uint256) {
        uint256 usdt0Assets = repayableUsdt0();
        uint256 d = debt();
        return usdt0Assets > d ? usdt0Assets - d : 0;
    }

    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalAssets() * 1e18) / supply;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 nav = totalAssets();
        if (supply == 0 || nav == 0) return assets;
        return (assets * supply) / nav;
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(collateralToken).balanceOf(address(this));
    }

    function repayableUsdt0() public view returns (uint256) {
        uint256 pool = IERC20(USDT0).balanceOf(address(this)) + morphoSupplyLiquidity();
        uint256 len = _venues.length;
        for (uint256 i; i < len;) {
            pool += _venueLiquidity(_venues[i]);
            unchecked { ++i; }
        }
        return pool;
    }

    function totalVenueAssets() public view returns (uint256 total) {
        uint256 len = _venues.length;
        for (uint256 i; i < len;) {
            total += _venuePositionValue(_venues[i]);
            unchecked { ++i; }
        }
    }

    function postedCollateral() public view returns (uint256 collateral) {
        (,, uint128 posted) = IMorpho(MORPHO).position(marketId, address(this));
        collateral = posted;
    }

    function morphoDebt() public view returns (uint256) {
        (, uint128 borrowShares,) = IMorpho(MORPHO).position(marketId, address(this));
        if (borrowShares == 0) return 0;
        (,, uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = IMorpho(MORPHO).market(marketId);
        if (totalBorrowShares == 0) return 0;
        return Math.mulDiv(borrowShares, totalBorrowAssets, totalBorrowShares, Math.Rounding.Ceil);
    }

    function kineticDebt() public view returns (uint256) {
        if (!kineticBorrow.enabled) return 0;
        return IKToken(kineticBorrow.debtKToken).borrowBalanceStored(address(this));
    }

    function debt() public view returns (uint256) {
        return morphoDebt() + kineticDebt();
    }

    function morphoSupplyAssets() public view returns (uint256) {
        (uint256 supplyShares,,) = IMorpho(MORPHO).position(marketId, address(this));
        if (supplyShares == 0) return 0;
        (uint128 totalSupplyAssets, uint128 totalSupplyShares,,,,) = IMorpho(MORPHO).market(marketId);
        if (totalSupplyShares == 0) return 0;
        return Math.mulDiv(supplyShares, totalSupplyAssets, totalSupplyShares);
    }

    function morphoSupplyLiquidity() public view returns (uint256) {
        uint256 supplied = morphoSupplyAssets();
        if (supplied == 0) return 0;
        (uint128 totalSupplyAssets,, uint128 totalBorrowAssets,,,) = IMorpho(MORPHO).market(marketId);
        uint256 cash = totalSupplyAssets > totalBorrowAssets ? uint256(totalSupplyAssets) - uint256(totalBorrowAssets) : 0;
        return supplied < cash ? supplied : cash;
    }

    function kineticCollateralAssets() public view returns (uint256) {
        if (!kineticBorrow.enabled) return 0;
        uint256 shares = IKToken(kineticBorrow.collateralKToken).balanceOf(address(this));
        if (shares == 0) return 0;
        return (shares * IKToken(kineticBorrow.collateralKToken).exchangeRateStored()) / 1e18;
    }

    function morphoLtvBps() public view returns (uint256) {
        uint256 coll = _collateralToUsdt0(postedCollateral());
        uint256 d = morphoDebt();
        if (coll == 0) return d == 0 ? 0 : type(uint256).max;
        return Math.mulDiv(d, BPS_DIVISOR, coll);
    }

    function kineticLtvBps() public view returns (uint256) {
        uint256 coll = _collateralToUsdt0(kineticCollateralAssets());
        uint256 d = kineticDebt();
        if (coll == 0) return d == 0 ? 0 : type(uint256).max;
        return Math.mulDiv(d, BPS_DIVISOR, coll);
    }

    function ltvBps() public view returns (uint256) {
        uint256 morphoLtv = morphoLtvBps();
        uint256 kineticLtv = kineticLtvBps();
        return morphoLtv > kineticLtv ? morphoLtv : kineticLtv;
    }

    function venueCount() external view returns (uint256) { return _venues.length; }

    /// @notice Total claimable USDT0 surplus for `user`, including unbooked accrual
    ///         from the current accumulator value. This is a view — call _bookSurplus()
    ///         first on-chain (e.g. via claimSurplus) to materialise the exact value.
    function pendingSurplus(address user) external view returns (uint256) {
        uint256 acc = surplusPerShareAcc;
        uint256 idx = userSurplusIndex[user];
        uint256 earned = acc > idx ? (balanceOf(user) * (acc - idx)) / 1e18 : 0;
        return userSurplusAccrued[user] + earned;
    }

    /// @notice Total claimable WFLR (vested rFLR rewards) for `user` based on the
    ///         current accumulator. Only reflects batches booked by withdrawVestedRflr.
    function pendingWflr(address user) external view returns (uint256) {
        uint256 acc = wflrPerShareAcc;
        uint256 idx = userWflrIndex[user];
        uint256 earned = acc > idx ? (balanceOf(user) * (acc - idx)) / 1e18 : 0;
        return userWflrAccrued[user] + earned;
    }

    // --- Deposit / withdraw --------------------------------------------------

    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (depositsPaused || emergencyMode) revert DepositsPausedError();
        if (assets == 0) revert ZeroAssets();

        _pokeAll();
        // Book surplus BEFORE minting shares so new depositor's index starts post-booking.
        // This prevents a flash-deposit/withdraw from claiming pre-existing surplus.
        _bookSurplus();
        // For non-WFLR-collateral vaults (e.g. FXRP): book any idle WFLR that landed from
        // a prior withdrawVestedRflr call before new shares are minted. This prevents a
        // depositor from front-running the keeper's harvest in the same block.
        // For the WFLR-collateral vault this is a no-op (can't distinguish collateral from reward).
        _bookIdleWflr();
        _accruePerformanceFee();
        if (depositCap > 0) {
            if (totalAssets() + assets > depositCap) revert DepositCapExceeded();
        }

        uint256 supply = totalSupply();
        if (supply == 0) {
            if (assets < MIN_FIRST_DEPOSIT) revert BelowMinFirstDeposit();
            IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), assets);
            uint256 bal = IERC20(collateralToken).balanceOf(address(this));
            shares = bal - DEAD_SHARES;
            _mint(address(0xdead), DEAD_SHARES);
            _mint(msg.sender, shares);
        } else {
            uint256 assetsBefore = totalAssets();
            IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), assets);
            shares = (assets * supply) / assetsBefore;
            if (shares == 0) revert ZeroShares();
            _mint(msg.sender, shares);
        }

        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Burns `shares` and pays the caller their pro-rata collateral plus all
    ///         accrued USDT0 surplus. Surplus is booked before pricing so a same-block
    ///         depositor earns zero on pre-existing carry (JIT-safe). The 10% performance
    ///         fee on USDT0 gains is taken inside _bookSurplus at booking time.
    function requestWithdrawal(uint256 shares) external nonReentrant returns (uint256 requestId) {
        if (shares == 0) revert ZeroShares();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        _pokeAll();
        _bookSurplus();
        _accruePerformanceFee();

        // Settle USDT0 accrual before burn so the full balance is captured.
        _settleUser(msg.sender);
        uint256 usdt0Owed = userSurplusAccrued[msg.sender];

        uint256 supply = totalSupply();
        uint256 assets = (shares * totalAssets()) / supply;
        if (assets == 0) revert ZeroAssets();

        _burn(msg.sender, shares);

        requestId = nextWithdrawalId++;

        _fundWithdrawal(assets);
        IERC20(collateralToken).safeTransfer(msg.sender, assets);

        // Pay out all accrued USDT0 surplus alongside the collateral withdrawal.
        if (usdt0Owed > 0) {
            _pullUsdt0ForRepay(debt() + usdt0Owed);
            uint256 idle = IERC20(USDT0).balanceOf(address(this));
            uint256 d = debt();
            uint256 available = idle > d ? idle - d : 0;
            uint256 toPay = available < usdt0Owed ? available : usdt0Owed;
            if (toPay > 0) {
                userSurplusAccrued[msg.sender] -= toPay;
                surplusReserved -= toPay;
                IERC20(USDT0).safeTransfer(msg.sender, toPay);
                emit SurplusClaimed(msg.sender, toPay);
            }
        }

        emit WithdrawalRequested(msg.sender, requestId, shares, assets);
        emit WithdrawalClaimed(msg.sender, requestId, assets);
    }

    /// @notice Claim accrued USDT0 surplus without withdrawing collateral.
    ///         Books any pending surplus first, then pays whatever is owed to the caller.
    ///         If venues are illiquid, a partial payment is made and the remainder stays
    ///         in userSurplusAccrued for a future claim.
    function claimSurplus() external nonReentrant returns (uint256 usdt0Paid) {
        _pokeAll();
        _bookSurplus();
        _settleUser(msg.sender);

        uint256 owed = userSurplusAccrued[msg.sender];
        if (owed == 0) revert NothingToClaim();

        _pullUsdt0ForRepay(debt() + owed);
        uint256 idle = IERC20(USDT0).balanceOf(address(this));
        uint256 d = debt();
        uint256 available = idle > d ? idle - d : 0;
        usdt0Paid = available < owed ? available : owed;
        if (usdt0Paid == 0) revert NothingToClaim();

        userSurplusAccrued[msg.sender] -= usdt0Paid;
        surplusReserved -= usdt0Paid;
        IERC20(USDT0).safeTransfer(msg.sender, usdt0Paid);
        emit SurplusClaimed(msg.sender, usdt0Paid);
    }

    // --- Keeper: open the carry ---------------------------------------------

    function openOrIncrease(uint256 collateralAmount, uint256 borrowAmount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 collateralSupplied)
    {
        if (collateralAmount == 0 && borrowAmount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_reversePositionOpen()) revert MixedCarryMode();
        _pokeAll();

        MarketParams memory mp = _marketParams();
        if (collateralAmount > 0) {
            if (collateralAmount > idleAssets()) revert ExceedsIdle();
            IERC20(collateralToken).forceApprove(MORPHO, collateralAmount);
            IMorpho(MORPHO).supplyCollateral(mp, collateralAmount, address(this), "");
            IERC20(collateralToken).forceApprove(MORPHO, 0);
            collateralCostBasis += collateralAmount;
            collateralSupplied = collateralAmount;
            emit CollateralPosted(collateralAmount);
        }

        if (borrowAmount > 0) {
            uint256 balBefore = IERC20(USDT0).balanceOf(address(this));
            IMorpho(MORPHO).borrow(mp, borrowAmount, 0, address(this), address(this));
            uint256 borrowed = IERC20(USDT0).balanceOf(address(this)) - balBefore;
            uint256 ltvAfter = ltvBps();
            if (ltvAfter > maxBorrowLtvBps) revert LtvCapBreached();
            emit Borrowed(borrowed, ltvAfter);
        }
        _enforceReserve();
    }

    function borrow(uint256 usdt0Amount) external onlyKeeper nonReentrant returns (uint256 borrowed) {
        if (usdt0Amount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_reversePositionOpen()) revert MixedCarryMode();
        _pokeAll();

        MarketParams memory mp = _marketParams();
        uint256 balBefore = IERC20(USDT0).balanceOf(address(this));
        IMorpho(MORPHO).borrow(mp, usdt0Amount, 0, address(this), address(this));
        borrowed = IERC20(USDT0).balanceOf(address(this)) - balBefore;

        uint256 ltvAfter = ltvBps();
        if (ltvAfter > maxBorrowLtvBps) revert LtvCapBreached();
        _enforceReserve();

        emit Borrowed(borrowed, ltvAfter);
    }

    /// @notice V2 CHANGE: renamed from supplyToKinetic. Dispatches to the correct
    ///         venue kind (Kinetic kToken or ERC4626) via _venueDeposit.
    function supplyToVenue(uint256 venueId, uint256 usdt0Amount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 sharesReceived)
    {
        if (usdt0Amount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_reversePositionOpen()) revert MixedCarryMode();
        _pokeAll();
        KineticVenue memory v = _venue(venueId);
        if (!v.enabled) revert VenueDisabled();
        if (usdt0Amount > IERC20(USDT0).balanceOf(address(this))) revert ExceedsIdle();

        uint256 nav = totalAssets();
        if (_venuePositionValue(v) + usdt0Amount > (nav * v.maxAllocationBps) / BPS_DIVISOR) revert VenueCap();

        sharesReceived = _venueDeposit(v, usdt0Amount);
        if (sharesReceived == 0) revert ZeroVenueShares();
        _enforceReserve();

        emit VenueSupplied(venueId, usdt0Amount, sharesReceived);
    }

    // --- Keeper: reverse carry ---------------------------------------------

    /// @notice Supply idle collateral to the configured Kinetic collateral market.
    ///         This is the first leg of the reverse carry: Kinetic borrow, Morpho lend.
    function supplyCollateralToKinetic(uint256 collateralAmount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 sharesReceived)
    {
        if (!kineticBorrow.enabled) revert KineticBorrowDisabled();
        if (collateralAmount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_legacyPositionOpen()) revert MixedCarryMode();
        if (collateralAmount > idleAssets()) revert ExceedsIdle();
        _pokeAll();

        uint256 sharesBefore = IKToken(kineticBorrow.collateralKToken).balanceOf(address(this));
        if (kineticBorrow.collateralIsNative) {
            _unwrapWflr(collateralAmount);
            INativeKToken(kineticBorrow.collateralKToken).mint{value: collateralAmount}();
        } else {
            IERC20(collateralToken).forceApprove(kineticBorrow.collateralKToken, collateralAmount);
            uint256 err = IKToken(kineticBorrow.collateralKToken).mint(collateralAmount);
            IERC20(collateralToken).forceApprove(kineticBorrow.collateralKToken, 0);
            if (err != 0) revert KineticMintFailed();
        }
        sharesReceived = IKToken(kineticBorrow.collateralKToken).balanceOf(address(this)) - sharesBefore;
        if (sharesReceived == 0) revert ZeroVenueShares();
        collateralCostBasis += collateralAmount;
        emit KineticCollateralSupplied(collateralAmount, sharesReceived);
    }

    /// @notice Borrow USDT0 from Kinetic against Kinetic-posted collateral.
    function borrowFromKinetic(uint256 usdt0Amount) external onlyKeeper nonReentrant returns (uint256 borrowed) {
        if (!kineticBorrow.enabled) revert KineticBorrowDisabled();
        if (usdt0Amount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_legacyPositionOpen()) revert MixedCarryMode();
        _pokeAll();

        uint256 balBefore = IERC20(USDT0).balanceOf(address(this));
        uint256 err = IKToken(kineticBorrow.debtKToken).borrow(usdt0Amount);
        if (err != 0) revert KineticBorrowFailed();
        borrowed = IERC20(USDT0).balanceOf(address(this)) - balBefore;
        uint256 ltvAfter = kineticLtvBps();
        if (ltvAfter > kineticBorrow.maxBorrowLtvBps) revert LtvCapBreached();
        _enforceReverseReserve();
        emit KineticBorrowed(borrowed, ltvAfter);
    }

    /// @notice Supply idle USDT0 into the fixed Morpho market as lender liquidity.
    function supplyUsdt0ToMorpho(uint256 usdt0Amount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 sharesReceived)
    {
        if (!kineticBorrow.enabled) revert KineticBorrowDisabled();
        if (usdt0Amount == 0) revert ZeroAmount();
        if (emergencyMode) revert Emergency();
        if (_legacyPositionOpen()) revert MixedCarryMode();
        if (usdt0Amount > IERC20(USDT0).balanceOf(address(this))) revert ExceedsIdle();
        _pokeAll();

        MarketParams memory mp = _marketParams();
        IERC20(USDT0).forceApprove(MORPHO, usdt0Amount);
        (, sharesReceived) = IMorpho(MORPHO).supply(mp, usdt0Amount, 0, address(this), "");
        IERC20(USDT0).forceApprove(MORPHO, 0);
        if (sharesReceived == 0) revert ZeroVenueShares();
        _enforceReverseReserve();
        emit MorphoLenderSupplied(usdt0Amount, sharesReceived);
    }

    /// @notice Withdraw USDT0 lender liquidity from Morpho back to idle.
    function withdrawUsdt0FromMorpho(uint256 usdt0Amount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 withdrawn, uint256 sharesBurned)
    {
        if (usdt0Amount == 0) revert ZeroAmount();
        _poke();
        (withdrawn, sharesBurned) = _withdrawMorphoSupply(usdt0Amount);
        if (withdrawn == 0) revert ZeroReceived();
        emit MorphoLenderWithdrawn(withdrawn, sharesBurned);
    }

    function repayKineticDebt(uint256 usdt0Amount) external onlyKeeper nonReentrant returns (uint256 repaid) {
        if (usdt0Amount == 0) revert ZeroAmount();
        _pokeAll();
        repaid = _repayKinetic(usdt0Amount);
        emit KineticDebtRepaid(repaid);
    }

    function redeemCollateralFromKinetic(uint256 collateralAmount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 received)
    {
        if (!kineticBorrow.enabled) revert KineticBorrowDisabled();
        if (collateralAmount == 0) revert ZeroAmount();
        _pokeAll();

        uint256 postedBefore = kineticCollateralAssets();
        if (postedBefore == 0) revert NoCollateral();
        uint256 amount = collateralAmount > postedBefore ? postedBefore : collateralAmount;
        uint256 balBefore = IERC20(collateralToken).balanceOf(address(this));
        if (kineticBorrow.collateralIsNative) {
            received = _redeemNativeKineticCollateral(amount, balBefore);
        } else {
            uint256 err = IKToken(kineticBorrow.collateralKToken).redeemUnderlying(amount);
            if (err != 0) revert KineticRedeemFailed();
            received = IERC20(collateralToken).balanceOf(address(this)) - balBefore;
        }
        if (kineticLtvBps() > kineticBorrow.maxBorrowLtvBps) revert LtvCapBreached();

        uint256 basisReleased = Math.mulDiv(collateralCostBasis, received, postedBefore);
        collateralCostBasis = collateralCostBasis > basisReleased ? collateralCostBasis - basisReleased : 0;
        emit KineticCollateralRedeemed(received);
    }

    // --- Keeper: de-risk ----------------------------------------------------

    /// @notice V2 CHANGE: renamed from redeemFromKinetic. Dispatches by venue kind.
    function redeemFromVenue(uint256 venueId, uint256 usdt0Amount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 received)
    {
        if (usdt0Amount == 0) revert ZeroAmount();
        KineticVenue memory v = _venue(venueId);
        received = _venueWithdraw(v, usdt0Amount);
        if (received == 0) revert ZeroReceived();
        emit VenueRedeemed(venueId, usdt0Amount, received);
    }

    function repayDebt(uint256 usdt0Amount) external onlyKeeper nonReentrant returns (uint256 repaid) {
        if (usdt0Amount == 0) revert ZeroAmount();
        _poke();
        repaid = _repay(usdt0Amount);
        emit DebtRepaid(repaid);
    }

    /// @notice Keeper-callable surplus booking. Useful after a carry-close unwind to
    ///         distribute accumulated surplus to shareholders before deposits re-open.
    function bookSurplus() external onlyKeeper nonReentrant {
        _pokeAll();
        _bookSurplus();
    }

    // --- Emergency / guardian -----------------------------------------------

    function emergencyRepay() external nonReentrant returns (uint256 repaid) {
        _pokeAll();
        uint256 ltvBefore = ltvBps();
        uint256 trigger = kineticDebt() > 0 ? kineticBorrow.emergencyLtvBps : emergencyLtvBps;
        if (ltvBefore < trigger) revert LtvBelowTrigger();

        uint256 d = debt();
        if (d == 0) revert NoDebt();
        uint256 target = (d * emergencyRepayBps) / BPS_DIVISOR;

        uint256 idleNow = _pullUsdt0ForRepay(target);
        uint256 toRepay = idleNow < target ? idleNow : target;
        if (toRepay == 0) revert NothingToRepay();

        if (kineticDebt() > 0) {
            repaid = _repayKinetic(toRepay);
            emit KineticDebtRepaid(repaid);
        } else {
            repaid = _repay(toRepay);
            emit DebtRepaid(repaid);
        }
        uint256 ltvAfter = ltvBps();
        if (ltvAfter >= ltvBefore) revert LtvNotReduced();

        emergencyMode = true;
        depositsPaused = true;
        emit EmergencyModeSet(true);
        emit DepositsPaused(true);
        emit EmergencyRepaid(repaid, ltvBefore, ltvAfter);
    }

    function withdrawCollateral(uint256 collateralAmount)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 withdrawn)
    {
        if (collateralAmount == 0) revert ZeroAmount();
        _poke();

        (,, uint128 postedBefore) = IMorpho(MORPHO).position(marketId, address(this));
        if (postedBefore == 0) revert NoCollateral();
        withdrawn = collateralAmount > postedBefore ? postedBefore : collateralAmount;

        MarketParams memory mp = _marketParams();
        IMorpho(MORPHO).withdrawCollateral(mp, withdrawn, address(this), address(this));

        if (ltvBps() > maxBorrowLtvBps) revert LtvCapBreached();

        uint256 basisReleased = Math.mulDiv(collateralCostBasis, withdrawn, postedBefore);
        collateralCostBasis = collateralCostBasis > basisReleased ? collateralCostBasis - basisReleased : 0;

        _accruePerformanceFee();
        emit CollateralWithdrawn(withdrawn);
    }

    // --- Reward harvester hooks ---------------------------------------------

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

    /// @notice Withdraw up to `amount` of unlocked vested WFLR from the RNAT contract
    ///         and distribute it immediately to current shareholders via wflrPerShareAcc.
    ///         Booking is atomic with the withdrawal so there is no window between the
    ///         WFLR landing in the vault and it being credited to existing holders.
    function withdrawVestedRflr(uint128 amount, bool wrap)
        external
        onlyRewardHarvester
        nonReentrant
        returns (uint256 wrappedOut)
    {
        (uint256 wNatBalance, uint256 lockedBalance) = _rnatBalances();
        uint256 unlocked = wNatBalance > lockedBalance ? wNatBalance - lockedBalance : 0;
        uint256 toWithdraw = amount < unlocked ? amount : unlocked;
        if (toWithdraw == 0) revert NothingUnlocked();

        uint256 balBefore = IERC20(WFLR).balanceOf(address(this));
        IRNat(RNAT).withdraw(uint128(toWithdraw), wrap);
        wrappedOut = IERC20(WFLR).balanceOf(address(this)) - balBefore;
        if (wrappedOut == 0) revert WithdrawReturnedZero();

        // H-1 fix: for the WFLR-collateral vault the withdrawn rFLR IS the collateral
        // token. Booking it into the WFLR accumulator would double-count it — once in
        // collateral-denominated NAV (it lands in balanceOf(WFLR)) and again in the
        // accumulator — letting holders extract it twice and draining the vault. Instead
        // let it become collateral: NAV rises, every holder benefits pro-rata, and new
        // depositors price it in (JIT-safe). Mirrors the existing `_bookIdleWflr` guard.
        // For non-WFLR collateral (FXRP) the reward token is distinct from NAV, so the
        // accumulator distribution is correct and is booked atomically here.
        if (collateralToken != WFLR) {
            _bookWflr(wrappedOut);
        }
        emit RflrWithdrawn(wrappedOut);
    }

    /// @notice Claim accrued WFLR rewards. Anyone can call on behalf of themselves.
    ///         WFLR is extra yield; it does not affect the collateral-denominated NAV.
    function claimWflr() external nonReentrant returns (uint256 wflrPaid) {
        _settleWflrUser(msg.sender);

        uint256 owed = userWflrAccrued[msg.sender];
        if (owed == 0) revert NothingToClaimWflr();

        uint256 available = IERC20(WFLR).balanceOf(address(this));
        wflrPaid = available < owed ? available : owed;
        if (wflrPaid == 0) revert NothingToClaimWflr();

        userWflrAccrued[msg.sender] -= wflrPaid;
        wflrReserved -= wflrPaid;
        IERC20(WFLR).safeTransfer(msg.sender, wflrPaid);
        emit WflrClaimed(msg.sender, wflrPaid);
    }

    /// @notice V2 CHANGE: returns 0 silently for ERC4626 venues (no comptroller;
    ///         yield is already priced into the ERC4626 share rate).
    function claimVenueRewards(uint256 venueId)
        external
        onlyRewardHarvester
        nonReentrant
        returns (uint256 rflrDelta)
    {
        KineticVenue memory v = _venue(venueId);
        if (v.kind != VENUE_KIND_KINETIC) return 0;
        if (v.comptroller == address(0)) revert ZeroComptroller();

        (uint256 wNatBefore,) = _rnatBalances();

        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory kTokens = new address[](1);
        kTokens[0] = v.kToken;
        IComptroller(v.comptroller).claimReward(3, holders, kTokens, false, true);

        (uint256 wNatAfter,) = _rnatBalances();
        rflrDelta = wNatAfter > wNatBefore ? wNatAfter - wNatBefore : 0;
        emit VenueRewardsClaimed(venueId, v.comptroller, rflrDelta);
    }

    // --- Admin ---------------------------------------------------------------

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroKeeper();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroGuardian();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setRewardHarvester(address newHarvester) external onlyOwner {
        if (newHarvester == address(0)) revert ZeroHarvester();
        emit RewardHarvesterUpdated(rewardHarvester, newHarvester);
        rewardHarvester = newHarvester;
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroOperator();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setDepositsPaused(bool paused) external onlyGuardian {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    function setDepositCap(uint256 newCap) external onlyOwner {
        depositCap = newCap;
        emit DepositCapUpdated(newCap);
    }

    function setEmergencyMode(bool enabled) external onlyGuardian {
        emergencyMode = enabled;
        emit EmergencyModeSet(enabled);
    }

    function setRiskParams(
        uint16 _maxBorrowLtvBps,
        uint16 _emergencyLtvBps,
        uint16 _emergencyRepayBps
    ) external onlyOwner {
        uint256 lltvBps_ = lltv / LLTV_TO_BPS;
        if (_maxBorrowLtvBps >= lltvBps_) revert BorrowLtvGtLltv();
        if (!(_emergencyLtvBps > _maxBorrowLtvBps && _emergencyLtvBps < lltvBps_)) revert BadEmergencyLtv();
        if (!(_emergencyRepayBps >= 1_000 && _emergencyRepayBps <= BPS_DIVISOR)) revert BadRepayBps();
        maxBorrowLtvBps = _maxBorrowLtvBps;
        emergencyLtvBps = _emergencyLtvBps;
        emergencyRepayBps = _emergencyRepayBps;
        emit RiskParamsUpdated(_maxBorrowLtvBps, _emergencyLtvBps, _emergencyRepayBps);
    }

    function setVenueEnabled(uint256 venueId, bool enabled) external onlyOwner {
        if (venueId >= _venues.length) revert BadVenue();
        KineticVenue storage v = _venues[venueId];
        v.enabled = enabled;
        emit VenueUpdated(venueId, enabled, v.maxAllocationBps);
    }

    function setVenueCap(uint256 venueId, uint16 maxAllocationBps) external onlyOwner {
        if (venueId >= _venues.length) revert BadVenue();
        if (maxAllocationBps > BPS_DIVISOR) revert VenueCapTooHigh();
        KineticVenue storage v = _venues[venueId];
        v.maxAllocationBps = maxAllocationBps;
        emit VenueUpdated(venueId, v.enabled, maxAllocationBps);
    }

    function revokeVenueAllowance(uint256 venueId) external onlyOwner {
        if (venueId >= _venues.length) revert BadVenue();
        KineticVenue storage v = _venues[venueId];
        v.enabled = false;
        IERC20(USDT0).forceApprove(v.kToken, 0);
        emit VenueUpdated(venueId, false, v.maxAllocationBps);
        emit VenueAllowanceRevoked(venueId, v.kToken);
    }

    function accruePerformanceFee() external onlyOwner nonReentrant returns (uint256 feeShares) {
        _pokeAll();
        return _accruePerformanceFee();
    }

    // --- Internal: performance fee ------------------------------------------

    function _accruePerformanceFee() internal returns (uint256 feeShares) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;

        uint256 navForFee = totalAssets();
        uint256 currentPPS = (navForFee * 1e18) / supply;
        if (currentPPS <= highWaterMarkPerShare) return 0;

        uint256 gainPerShare = currentPPS - highWaterMarkPerShare;
        uint256 grossGain = (gainPerShare * supply) / 1e18;
        uint256 feeAssets = (grossGain * PERFORMANCE_FEE_BPS) / BPS_DIVISOR;
        if (feeAssets == 0 || feeAssets >= navForFee) return 0;

        feeShares = (feeAssets * supply) / (navForFee - feeAssets);
        if (feeShares == 0) return 0;

        _mint(operator, feeShares);
        highWaterMarkPerShare = (totalAssets() * 1e18) / totalSupply();
        emit PerformanceFeeMinted(operator, feeAssets, feeShares);
    }

    // --- Internal: surplus distribution -------------------------------------

    /// @notice Book any USDT0 surplus that has accrued since the last booking.
    ///         Takes PERFORMANCE_FEE_BPS (10%) for the operator in USDT0 directly,
    ///         then distributes the remainder to all current shareholders via
    ///         surplusPerShareAcc. New depositors earn zero on pre-existing surplus
    ///         because their index is set AFTER this call in _update (mint path).
    function _bookSurplus() internal {
        uint256 total = surplusUsdt0();
        if (total <= surplusReserved) return;

        uint256 newSurplus = total - surplusReserved;
        uint256 supply = totalSupply();
        if (supply == 0) return;

        // 10% performance fee to operator — settle operator's share accrual first
        // so their index is current before we add the direct USDT0 credit.
        uint256 operatorFee = (newSurplus * PERFORMANCE_FEE_BPS) / BPS_DIVISOR;
        uint256 userPortion = newSurplus - operatorFee;

        if (operatorFee > 0) {
            _settleUser(operator);
            userSurplusAccrued[operator] += operatorFee;
        }

        uint256 perShareIncrease;
        if (userPortion > 0) {
            perShareIncrease = (userPortion * 1e18) / supply;
            surplusPerShareAcc += perShareIncrease;
        }

        surplusReserved += newSurplus;
        emit SurplusBooked(newSurplus, operatorFee, perShareIncrease);
    }

    /// @notice Flush any outstanding per-share surplus accrual into userSurplusAccrued[user].
    ///         Must be called before any balance change (handled via _update override).
    function _settleUser(address user) internal {
        uint256 acc = surplusPerShareAcc;
        uint256 idx = userSurplusIndex[user];
        if (acc > idx) {
            uint256 bal = balanceOf(user);
            if (bal > 0) {
                userSurplusAccrued[user] += (bal * (acc - idx)) / 1e18;
            }
            userSurplusIndex[user] = acc;
        }
    }

    // --- Internal: WFLR (rFLR vesting rewards) distribution ----------------

    /// @notice Book `amount` of WFLR into the per-share accumulator. Called atomically
    ///         inside withdrawVestedRflr so the withdrawal and distribution are inseparable.
    function _bookWflr(uint256 amount) internal {
        if (amount == 0) return;
        uint256 supply = totalSupply();
        if (supply == 0) return; // no shareholders yet — WFLR stays idle
        uint256 perShareIncrease = (amount * 1e18) / supply;
        wflrPerShareAcc += perShareIncrease;
        wflrReserved    += amount;
        emit WflrBooked(amount, perShareIncrease);
    }

    /// @notice Book any WFLR balance above wflrReserved that is NOT the collateral token.
    ///         Safe only for non-WFLR-collateral vaults (FXRP vault); no-op for WFLR vault.
    ///         Called at the top of deposit() to front-run-proof the booking for FXRP vault.
    function _bookIdleWflr() internal {
        if (collateralToken == WFLR) return;
        uint256 idle = IERC20(WFLR).balanceOf(address(this));
        if (idle > wflrReserved) {
            _bookWflr(idle - wflrReserved);
        }
    }

    /// @notice Read the vault's RNat wNat/locked balances, tolerating the first-claim
    ///         `no RNat account` revert. Before the vault has ever claimed, RNat has no
    ///         account for it and getBalancesOf reverts; treat that as (0, 0) so the very
    ///         first claimRflrRewards can reach RNat and create the account instead of
    ///         reverting on the pre-claim snapshot. The before/after deltas are used only
    ///         for event emission, never for fund movement, so a (0,0) fallback is safe.
    function _rnatBalances() internal view returns (uint256 wNatBalance, uint256 lockedBalance) {
        try IRNat(RNAT).getBalancesOf(address(this)) returns (uint256 wNat, uint256, uint256 locked) {
            return (wNat, locked);
        } catch {
            return (0, 0);
        }
    }

    /// @notice Flush outstanding WFLR accumulator accrual into userWflrAccrued[user].
    function _settleWflrUser(address user) internal {
        uint256 acc = wflrPerShareAcc;
        uint256 idx = userWflrIndex[user];
        if (acc > idx) {
            uint256 bal = balanceOf(user);
            if (bal > 0) {
                userWflrAccrued[user] += (bal * (acc - idx)) / 1e18;
            }
            userWflrIndex[user] = acc;
        }
    }

    // --- Internal: Morpho accounting ----------------------------------------

    function _marketParams() internal view returns (MarketParams memory) {
        return MarketParams({
            loanToken: USDT0,
            collateralToken: collateralToken,
            oracle: oracle,
            irm: irm,
            lltv: lltv
        });
    }

    function _collateralToUsdt0(uint256 collateralAmount) internal view returns (uint256) {
        if (collateralAmount == 0) return 0;
        return Math.mulDiv(collateralAmount, IMorphoOracle(oracle).price(), ORACLE_SCALE);
    }

    function _usdt0ToCollateral(uint256 usdt0Amount) internal view returns (uint256) {
        if (usdt0Amount == 0) return 0;
        uint256 price = IMorphoOracle(oracle).price();
        if (price == 0) revert BadOracle();
        return Math.mulDiv(usdt0Amount, ORACLE_SCALE, price);
    }

    function _repay(uint256 usdt0Amount) internal returns (uint256 repaid) {
        uint256 d = morphoDebt();
        if (d == 0) revert NoDebt();
        uint256 amount = usdt0Amount > d ? d : usdt0Amount;
        if (IERC20(USDT0).balanceOf(address(this)) < amount) revert InsufficientUsdt0();

        MarketParams memory mp = _marketParams();
        IERC20(USDT0).forceApprove(MORPHO, amount);
        IMorpho(MORPHO).repay(mp, amount, 0, address(this), "");
        IERC20(USDT0).forceApprove(MORPHO, 0);
        repaid = amount;
    }

    function _repayKinetic(uint256 usdt0Amount) internal returns (uint256 repaid) {
        if (!kineticBorrow.enabled) revert KineticBorrowDisabled();
        uint256 d = kineticDebt();
        if (d == 0) revert NoDebt();
        uint256 amount = usdt0Amount > d ? d : usdt0Amount;
        if (IERC20(USDT0).balanceOf(address(this)) < amount) revert InsufficientUsdt0();

        IERC20(USDT0).forceApprove(kineticBorrow.debtKToken, amount);
        uint256 err = IKToken(kineticBorrow.debtKToken).repayBorrow(amount);
        IERC20(USDT0).forceApprove(kineticBorrow.debtKToken, 0);
        if (err != 0) revert KineticRepayFailed();
        repaid = amount;
    }

    function _unwrapWflr(uint256 amount) internal {
        uint256 nativeBefore = address(this).balance;
        IWFLR(WFLR).withdraw(amount);
        if (address(this).balance - nativeBefore != amount) revert WflrUnwrapFailed();
    }

    function _wrapFlr(uint256 amount) internal {
        uint256 wflrBefore = IERC20(WFLR).balanceOf(address(this));
        IWFLR(WFLR).deposit{value: amount}();
        if (IERC20(WFLR).balanceOf(address(this)) - wflrBefore != amount) revert WflrWrapFailed();
    }

    function _redeemNativeKineticCollateral(uint256 amount, uint256 wflrBalanceBefore) internal returns (uint256 received) {
        uint256 nativeBefore = address(this).balance;
        uint256 err = INativeKToken(kineticBorrow.collateralKToken).redeemUnderlying(amount);
        if (err != 0) revert KineticRedeemFailed();
        uint256 nativeReceived = address(this).balance - nativeBefore;
        if (nativeReceived > 0) _wrapFlr(nativeReceived);
        received = IERC20(WFLR).balanceOf(address(this)) - wflrBalanceBefore;
    }

    function _withdrawMorphoSupply(uint256 usdt0Amount) internal returns (uint256 withdrawn, uint256 sharesBurned) {
        uint256 liquidity = morphoSupplyLiquidity();
        uint256 amount = usdt0Amount > liquidity ? liquidity : usdt0Amount;
        if (amount == 0) return (0, 0);
        uint256 balBefore = IERC20(USDT0).balanceOf(address(this));
        (withdrawn, sharesBurned) = IMorpho(MORPHO).withdraw(_marketParams(), amount, 0, address(this), address(this));
        uint256 delta = IERC20(USDT0).balanceOf(address(this)) - balBefore;
        if (delta < withdrawn) withdrawn = delta;
    }

    function _legacyPositionOpen() internal view returns (bool) {
        return postedCollateral() > 0 || morphoDebt() > 0 || totalVenueAssets() > 0;
    }

    function _reversePositionOpen() internal view returns (bool) {
        return kineticCollateralAssets() > 0 || kineticDebt() > 0 || morphoSupplyAssets() > 0;
    }

    function _fundWithdrawal(uint256 assets) internal {
        uint256 bal = IERC20(collateralToken).balanceOf(address(this));
        if (bal >= assets) return;

        uint256 collateralNeeded = assets - bal;
        if (kineticCollateralAssets() > 0) {
            _fundWithdrawalFromKinetic(collateralNeeded);
            if (IERC20(collateralToken).balanceOf(address(this)) < assets) revert NotFunded();
            return;
        }

        (,, uint128 postedBefore) = IMorpho(MORPHO).position(marketId, address(this));
        if (collateralNeeded > postedBefore) revert InsufficientCollateral();

        uint256 postedAfter = uint256(postedBefore) - collateralNeeded;
        uint256 maxDebtAfter = (_collateralToUsdt0(postedAfter) * maxBorrowLtvBps) / BPS_DIVISOR;
        uint256 d = debt();
        if (d > maxDebtAfter) {
            uint256 repayNeeded = d - maxDebtAfter;
            if (_pullUsdt0ForRepay(repayNeeded) < repayNeeded) revert InsufficientUsdt0();
            _repay(repayNeeded);
            emit DebtRepaid(repayNeeded);
        }

        MarketParams memory mp = _marketParams();
        IMorpho(MORPHO).withdrawCollateral(mp, collateralNeeded, address(this), address(this));

        uint256 basisReleased = Math.mulDiv(collateralCostBasis, collateralNeeded, postedBefore);
        collateralCostBasis = collateralCostBasis > basisReleased ? collateralCostBasis - basisReleased : 0;
        emit CollateralWithdrawn(collateralNeeded);

        if (IERC20(collateralToken).balanceOf(address(this)) < assets) revert NotFunded();
    }

    function _fundWithdrawalFromKinetic(uint256 collateralNeeded) internal {
        uint256 postedBefore = kineticCollateralAssets();
        if (collateralNeeded > postedBefore) revert InsufficientCollateral();

        uint256 postedAfter = postedBefore - collateralNeeded;
        uint256 maxDebtAfter = (_collateralToUsdt0(postedAfter) * kineticBorrow.maxBorrowLtvBps) / BPS_DIVISOR;
        uint256 d = kineticDebt();
        if (d > maxDebtAfter) {
            uint256 repayNeeded = d - maxDebtAfter;
            if (_pullUsdt0ForRepay(repayNeeded) < repayNeeded) revert InsufficientUsdt0();
            uint256 repaid = _repayKinetic(repayNeeded);
            emit KineticDebtRepaid(repaid);
        }

        uint256 balBefore = IERC20(collateralToken).balanceOf(address(this));
        uint256 received;
        if (kineticBorrow.collateralIsNative) {
            received = _redeemNativeKineticCollateral(collateralNeeded, balBefore);
        } else {
            uint256 err = IKToken(kineticBorrow.collateralKToken).redeemUnderlying(collateralNeeded);
            if (err != 0) revert KineticRedeemFailed();
            received = IERC20(collateralToken).balanceOf(address(this)) - balBefore;
        }

        uint256 basisReleased = Math.mulDiv(collateralCostBasis, received, postedBefore);
        collateralCostBasis = collateralCostBasis > basisReleased ? collateralCostBasis - basisReleased : 0;
        emit KineticCollateralRedeemed(received);
    }

    function _pullUsdt0ForRepay(uint256 needed) internal returns (uint256 unreserved) {
        unreserved = IERC20(USDT0).balanceOf(address(this));
        if (unreserved >= needed) return unreserved;

        uint256 morphoLiquidity = morphoSupplyLiquidity();
        if (morphoLiquidity > 0) {
            uint256 toPull = (needed - unreserved) < morphoLiquidity ? (needed - unreserved) : morphoLiquidity;
            _withdrawMorphoSupply(toPull);
            unreserved = IERC20(USDT0).balanceOf(address(this));
            if (unreserved >= needed) return unreserved;
        }

        uint256 len = _venues.length;
        for (uint256 i; i < len && unreserved < needed;) {
            KineticVenue memory v = _venues[i];
            uint256 liq = _venueLiquidity(v);
            if (liq > 0) {
                uint256 toPull = (needed - unreserved) < liq ? (needed - unreserved) : liq;
                _venueWithdraw(v, toPull);
                unreserved = IERC20(USDT0).balanceOf(address(this));
            }
            unchecked { ++i; }
        }
    }

    function _enforceReserve() internal view {
        uint256 d = debt();
        if (d == 0) return;
        if (repayableUsdt0() < d) revert ReserveFloor();
    }

    function _enforceReverseReserve() internal view {
        uint256 d = kineticDebt();
        if (d == 0) return;
        if (repayableUsdt0() < d) revert ReserveFloor();
    }

    function _poke() internal { IMorpho(MORPHO).accrueInterest(_marketParams()); }

    /// @notice V2 CHANGE: accrueInterest skipped for VENUE_KIND_ERC4626 venues —
    ///         ERC4626 convertToAssets() is always current; no Compound checkpoint needed.
    function _pokeAll() internal {
        IMorpho(MORPHO).accrueInterest(_marketParams());
        if (kineticBorrow.enabled) {
            IKToken(kineticBorrow.collateralKToken).accrueInterest();
            IKToken(kineticBorrow.debtKToken).accrueInterest();
        }
        uint256 venueLen = _venues.length;
        for (uint256 i; i < venueLen;) {
            if (_venues[i].kind == VENUE_KIND_KINETIC) {
                IKToken(_venues[i].kToken).accrueInterest();
            }
            unchecked { ++i; }
        }
    }

    // --- Internal: venue dispatch -------------------------------------------

    function _venue(uint256 venueId) internal view returns (KineticVenue memory) {
        if (venueId >= _venues.length) revert BadVenue();
        return _venues[venueId];
    }

    /// @notice V2 CHANGE: ERC4626 uses convertToAssets(balanceOf); Kinetic unchanged.
    function _venuePositionValue(KineticVenue memory v) internal view returns (uint256) {
        if (v.kind == VENUE_KIND_ERC4626) {
            uint256 erc4626Shares = IERC4626Venue(v.kToken).balanceOf(address(this));
            if (erc4626Shares == 0) return 0;
            return IERC4626Venue(v.kToken).convertToAssets(erc4626Shares);
        }
        uint256 kTokenShares = IKToken(v.kToken).balanceOf(address(this));
        if (kTokenShares == 0) return 0;
        return (kTokenShares * IKToken(v.kToken).exchangeRateStored()) / 1e18;
    }

    /// @notice V2 CHANGE: ERC4626 liquidity uses maxWithdraw (may be capped by the
    ///         underlying vault — e.g. Mystic's maxWithdraw returns 0 during pauses).
    function _venueLiquidity(KineticVenue memory v) internal view returns (uint256) {
        if (v.kind == VENUE_KIND_ERC4626) {
            return IERC4626Venue(v.kToken).maxWithdraw(address(this));
        }
        uint256 position = _venuePositionValue(v);
        if (position == 0) return 0;
        uint256 cash = IKToken(v.kToken).getCash();
        return position < cash ? position : cash;
    }

    /// @notice V2 CHANGE: ERC4626 uses deposit(); Kinetic uses kToken.mint().
    function _venueDeposit(KineticVenue memory v, uint256 assets) internal returns (uint256 sharesReceived) {
        if (v.kind == VENUE_KIND_ERC4626) {
            IERC20(USDT0).forceApprove(v.kToken, assets);
            sharesReceived = IERC4626Venue(v.kToken).deposit(assets, address(this));
            IERC20(USDT0).forceApprove(v.kToken, 0);
            return sharesReceived;
        }
        uint256 sharesBefore = IKToken(v.kToken).balanceOf(address(this));
        IERC20(USDT0).forceApprove(v.kToken, assets);
        uint256 err = IKToken(v.kToken).mint(assets);
        IERC20(USDT0).forceApprove(v.kToken, 0);
        if (err != 0) revert KineticMintFailed();
        sharesReceived = IKToken(v.kToken).balanceOf(address(this)) - sharesBefore;
    }

    /// @notice V2 CHANGE: ERC4626 uses withdraw(); Kinetic uses redeemUnderlying().
    function _venueWithdraw(KineticVenue memory v, uint256 assets) internal returns (uint256 received) {
        uint256 balBefore = IERC20(USDT0).balanceOf(address(this));
        if (v.kind == VENUE_KIND_ERC4626) {
            IERC4626Venue(v.kToken).withdraw(assets, address(this), address(this));
        } else {
            uint256 err = IKToken(v.kToken).redeemUnderlying(assets);
            if (err != 0) revert KineticRedeemFailed();
        }
        received = IERC20(USDT0).balanceOf(address(this)) - balBefore;
    }

    // --- Internal: ERC20 _update override -----------------------------------

    /// @notice Settle both parties' USDT0 surplus accrual before every token balance change
    ///         (mint, burn, transfer). This ensures each user's earned surplus is always
    ///         calculated from their correct balance at the time of the last index update.
    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0)) { _settleUser(from);  _settleWflrUser(from); }
        if (to   != address(0)) { _settleUser(to);    _settleWflrUser(to);   }
        super._update(from, to, amount);
    }
}
