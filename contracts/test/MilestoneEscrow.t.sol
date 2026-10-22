// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MilestoneEscrow} from "../MilestoneEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Handler for invariant testing
// ─────────────────────────────────────────────────────────────────────────────
contract EscrowHandler is Test {
    MilestoneEscrow internal escrow;
    MockERC20 internal usdc;

    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");

    // Track agreement IDs that were successfully funded so the invariant
    // can query them without calling a view that reverts on invalid IDs.
    uint256[] public fundedIds;

    constructor(MilestoneEscrow _escrow, MockERC20 _usdc) {
        escrow = _escrow;
        usdc = _usdc;
    }

    /// @dev Create + fund a 2-milestone agreement with amounts a0 and a1.
    function createAndFund(uint96 a0, uint96 a1) external {
        // Bound to non-zero, reasonable values to avoid reverts.
        uint256 amt0 = bound(uint256(a0), 1, 1_000_000e6);
        uint256 amt1 = bound(uint256(a1), 1, 1_000_000e6);

        string[] memory descs = new string[](2);
        descs[0] = "m0";
        descs[1] = "m1";

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amt0;
        amounts[1] = amt1;

        uint256 total = amt0 + amt1;

        // Mint and approve for client
        usdc.mint(client, total);
        vm.prank(client);
        usdc.approve(address(escrow), total);

        vm.prank(client);
        // arbiter = address(0) — no arbiter for invariant handler
        uint256 id = escrow.createAgreement(provider, address(0), descs, amounts);

        vm.prank(client);
        escrow.fundEscrow(id);

        fundedIds.push(id);
    }

    /// @dev Submit + approve milestone 0 of a previously funded agreement (index into fundedIds).
    function approveFirstMilestone(uint256 idx) external {
        if (fundedIds.length == 0) return;
        idx = bound(idx, 0, fundedIds.length - 1);
        uint256 id = fundedIds[idx];

        (, , , , , , bool cancelled) = escrow.getAgreement(id);
        if (cancelled) return;

        // Check milestone 0 status — only proceed if Pending
        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        if (status != MilestoneEscrow.MilestoneStatus.Pending) return;

        vm.prank(provider);
        escrow.submitMilestone(id, 0, "ipfs://evidence");

        // Warp past the 48-hour dispute window so approveAndRelease doesn't revert
        vm.warp(block.timestamp + 48 hours + 1);

        vm.prank(client);
        escrow.approveAndRelease(id, 0);
    }

    /// @dev Cancel a funded agreement (index into fundedIds).
    function cancelAgreement(uint256 idx) external {
        if (fundedIds.length == 0) return;
        idx = bound(idx, 0, fundedIds.length - 1);
        uint256 id = fundedIds[idx];

        (, , , , , , bool cancelled) = escrow.getAgreement(id);
        if (cancelled) return;

        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main unit-test contract
// ─────────────────────────────────────────────────────────────────────────────
contract MilestoneEscrowTest is Test {
    // ── Fixtures ─────────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    MilestoneEscrow internal escrow;

    address internal client   = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal stranger = makeAddr("stranger");
    address internal arbiter  = makeAddr("arbiter");

    // Convenience milestone data
    string[] internal descs2;
    uint256[] internal amounts2;
    uint256  internal total2;

    uint256 internal constant DISPUTE_WINDOW  = 48 hours;
    uint256 internal constant ARBITER_TIMEOUT = 7 days;

    // Re-declare events so we can use vm.expectEmit
    event AgreementCreated(uint256 indexed agreementId, address indexed client, address indexed provider, uint256 totalAmount);
    event EscrowFunded(uint256 indexed agreementId, uint256 amount);
    event MilestoneSubmitted(uint256 indexed agreementId, uint256 indexed milestoneId);
    event MilestoneReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount);
    event EscrowCancelled(uint256 indexed agreementId, address indexed client, uint256 refundAmount);
    event MilestoneDisputeRaised(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client);
    event MilestoneArbiterDecision(uint256 indexed agreementId, uint256 indexed milestoneId, uint256 releasedToProvider, uint256 refundedToClient);
    event MilestoneAutoReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount);
    event ArbiterTimeoutClaimed(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client, uint256 amount);

    function setUp() public {
        // Deploy mock token and escrow
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        escrow = new MilestoneEscrow(address(usdc));

        // 2-milestone fixture: 500 USDC + 300 USDC
        descs2 = new string[](2);
        descs2[0] = "Design";
        descs2[1] = "Development";

        amounts2 = new uint256[](2);
        amounts2[0] = 500e6;
        amounts2[1] = 300e6;
        total2     = 800e6;

        // Give client enough USDC
        usdc.mint(client, total2 * 10);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Create a 2-milestone agreement from client → provider (no arbiter) and return its ID.
    function _createDefault() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createAgreement(provider, address(0), descs2, amounts2);
    }

    /// Create a 2-milestone agreement from client → provider WITH an arbiter and return its ID.
    function _createWithArbiter() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createAgreement(provider, arbiter, descs2, amounts2);
    }

    /// Create + fund the default agreement (no arbiter).
    function _createAndFund() internal returns (uint256 id) {
        id = _createDefault();
        vm.prank(client);
        usdc.approve(address(escrow), total2);
        vm.prank(client);
        escrow.fundEscrow(id);
    }

    /// Create + fund an agreement WITH an arbiter.
    function _createAndFundWithArbiter() internal returns (uint256 id) {
        id = _createWithArbiter();
        vm.prank(client);
        usdc.approve(address(escrow), total2);
        vm.prank(client);
        escrow.fundEscrow(id);
    }

    /// Submit milestone `mid` with a default evidence string.
    function _submit(uint256 id, uint256 mid) internal {
        vm.prank(provider);
        escrow.submitMilestone(id, mid, "ipfs://evidence");
    }

    /// Submit milestone `mid`, then warp past the dispute window and approve+release.
    function _submitAndApprove(uint256 id, uint256 mid) internal {
        _submit(id, mid);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(client);
        escrow.approveAndRelease(id, mid);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  1. DEPLOYMENT / INITIALIZATION
    // ═════════════════════════════════════════════════════════════════════════

    function test_DeployRevertsOnZeroUsdcAddress() public {
        vm.expectRevert(MilestoneEscrow.ZeroAddress.selector);
        new MilestoneEscrow(address(0));
    }

    function test_InitialAgreementCountIsZero() public view {
        assertEq(escrow.agreementCount(), 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  2. createAgreement — happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateAgreement_StoresCorrectly() public {
        uint256 id = _createDefault();

        (address c, address p, address arb, uint256 tot, uint256 funded, bool isFunded, bool isCancelled)
            = escrow.getAgreement(id);

        assertEq(id, 1,            "agreementId should be 1");
        assertEq(c,  client,       "client mismatch");
        assertEq(p,  provider,     "provider mismatch");
        assertEq(arb, address(0),  "arbiter should be zero");
        assertEq(tot, total2,      "totalAmount mismatch");
        assertEq(funded, 0,        "fundedAmount should be 0 before funding");
        assertFalse(isFunded,      "funded flag should be false");
        assertFalse(isCancelled,   "cancelled flag should be false");
    }

    function test_CreateAgreement_MilestoneCount() public {
        uint256 id = _createDefault();
        assertEq(escrow.getMilestoneCount(id), 2);
    }

    function test_CreateAgreement_MilestoneData() public {
        uint256 id = _createDefault();

        (uint256 mid0, string memory desc0, uint256 amt0, MilestoneEscrow.MilestoneStatus s0, , , , )
            = escrow.getMilestone(id, 0);
        (uint256 mid1, string memory desc1, uint256 amt1, MilestoneEscrow.MilestoneStatus s1, , , , )
            = escrow.getMilestone(id, 1);

        assertEq(mid0, 0);
        assertEq(desc0, "Design");
        assertEq(amt0, 500e6);
        assertEq(uint8(s0), uint8(MilestoneEscrow.MilestoneStatus.Pending));

        assertEq(mid1, 1);
        assertEq(desc1, "Development");
        assertEq(amt1, 300e6);
        assertEq(uint8(s1), uint8(MilestoneEscrow.MilestoneStatus.Pending));
    }

    function test_CreateAgreement_IncrementsAgreementCount() public {
        _createDefault();
        _createDefault();
        assertEq(escrow.agreementCount(), 2);
    }

    function test_CreateAgreement_EmitsAgreementCreated() public {
        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgreementCreated(1, client, provider, total2);
        escrow.createAgreement(provider, address(0), descs2, amounts2);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  3. createAgreement — revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateAgreement_RevertZeroProvider() public {
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.ZeroAddress.selector);
        escrow.createAgreement(address(0), address(0), descs2, amounts2);
    }

    function test_CreateAgreement_RevertProviderIsCaller() public {
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.createAgreement(provider, address(0), descs2, amounts2);
    }

    function test_CreateAgreement_RevertEmptyMilestones() public {
        string[]  memory emptyDescs   = new string[](0);
        uint256[] memory emptyAmounts = new uint256[](0);
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.EmptyMilestones.selector);
        escrow.createAgreement(provider, address(0), emptyDescs, emptyAmounts);
    }

    function test_CreateAgreement_RevertLengthMismatch() public {
        uint256[] memory mismatchAmts = new uint256[](1);
        mismatchAmts[0] = 100e6;
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.LengthMismatch.selector);
        escrow.createAgreement(provider, address(0), descs2, mismatchAmts);
    }

    function test_CreateAgreement_RevertTooManyMilestones() public {
        uint256 n = 21;
        string[]  memory bigDescs   = new string[](n);
        uint256[] memory bigAmounts = new uint256[](n);
        for (uint256 i; i < n; i++) {
            bigDescs[i]   = "m";
            bigAmounts[i] = 1e6;
        }
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.TooManyMilestones.selector);
        escrow.createAgreement(provider, address(0), bigDescs, bigAmounts);
    }

    function test_CreateAgreement_RevertZeroAmount() public {
        uint256[] memory zeroAmounts = new uint256[](2);
        zeroAmounts[0] = 0;
        zeroAmounts[1] = 300e6;
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.ZeroAmount.selector);
        escrow.createAgreement(provider, address(0), descs2, zeroAmounts);
    }

    function test_CreateAgreement_RevertInvalidAgreement_BadId() public {
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.getAgreement(0);
    }

    function test_CreateAgreement_RevertInvalidAgreement_NonexistentId() public {
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.getAgreement(999);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  4. fundEscrow — happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_FundEscrow_SetsState() public {
        uint256 id = _createDefault();
        vm.prank(client);
        usdc.approve(address(escrow), total2);
        vm.prank(client);
        escrow.fundEscrow(id);

        (, , , uint256 tot, uint256 funded, bool isFunded, ) = escrow.getAgreement(id);
        assertTrue(isFunded,        "funded flag should be true");
        assertEq(funded, tot,       "fundedAmount should equal totalAmount");
        assertEq(usdc.balanceOf(address(escrow)), total2, "escrow token balance mismatch");
    }

    function test_FundEscrow_EmitsEscrowFunded() public {
        uint256 id = _createDefault();
        vm.prank(client);
        usdc.approve(address(escrow), total2);

        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit EscrowFunded(id, total2);
        escrow.fundEscrow(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  5. fundEscrow — revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_FundEscrow_RevertNotClient() public {
        uint256 id = _createDefault();
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotClient.selector);
        escrow.fundEscrow(id);
    }

    function test_FundEscrow_RevertAlreadyFunded() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        usdc.approve(address(escrow), total2);
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.AlreadyFunded.selector);
        escrow.fundEscrow(id);
    }

    function test_FundEscrow_RevertInvalidAgreement() public {
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.fundEscrow(999);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  6. submitMilestone — happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_SubmitMilestone_UpdatesStatus() public {
        uint256 id = _createAndFund();
        _submit(id, 0);

        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.Submitted));
    }

    function test_SubmitMilestone_EmitsMilestoneSubmitted() public {
        uint256 id = _createAndFund();
        vm.prank(provider);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit MilestoneSubmitted(id, 0);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  7. submitMilestone — revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_SubmitMilestone_RevertNotProvider() public {
        uint256 id = _createAndFund();
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotProvider.selector);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
    }

    function test_SubmitMilestone_RevertNotFunded() public {
        uint256 id = _createDefault();
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.NotFunded.selector);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
    }

    function test_SubmitMilestone_RevertInvalidStatus_AlreadySubmitted() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        // second submit should fail
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.InvalidStatus.selector);
        escrow.submitMilestone(id, 0, "ipfs://evidence2");
    }

    function test_SubmitMilestone_RevertInvalidStatus_AlreadyReleased() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);
        // submit after release
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.InvalidStatus.selector);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
    }

    function test_SubmitMilestone_RevertAlreadyCancelled() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.AlreadyCancelled.selector);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
    }

    function test_SubmitMilestone_RevertInvalidMilestoneId() public {
        uint256 id = _createAndFund();
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.submitMilestone(id, 99, "ipfs://evidence");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  8. approveAndRelease — happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_ApproveAndRelease_TransfersTokens() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 providerBalBefore = usdc.balanceOf(provider);
        vm.prank(client);
        escrow.approveAndRelease(id, 0);
        uint256 providerBalAfter = usdc.balanceOf(provider);

        assertEq(providerBalAfter - providerBalBefore, amounts2[0], "provider should receive milestone amount");
        assertEq(usdc.balanceOf(address(escrow)), total2 - amounts2[0], "escrow balance should decrease");
    }

    function test_ApproveAndRelease_UpdatesMilestoneStatus() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);

        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.Released));
    }

    function test_ApproveAndRelease_EmitsMilestoneReleased() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit MilestoneReleased(id, 0, provider, amounts2[0]);
        escrow.approveAndRelease(id, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  9. approveAndRelease — revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_ApproveAndRelease_RevertNotClient() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotClient.selector);
        escrow.approveAndRelease(id, 0);
    }

    function test_ApproveAndRelease_RevertNotFunded() public {
        uint256 id = _createDefault();
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.NotFunded.selector);
        escrow.approveAndRelease(id, 0);
    }

    function test_ApproveAndRelease_RevertInvalidStatus_Pending() public {
        uint256 id = _createAndFund();
        // Milestone is still Pending — not yet submitted
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.InvalidStatus.selector);
        escrow.approveAndRelease(id, 0);
    }

    function test_ApproveAndRelease_RevertInvalidStatus_DoubleRelease() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);
        // second release — still past window
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.InvalidStatus.selector);
        escrow.approveAndRelease(id, 0);
    }

    function test_ApproveAndRelease_RevertAlreadyCancelled() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.AlreadyCancelled.selector);
        escrow.approveAndRelease(id, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  10. cancelRemainingAndRefund — happy paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_CancelRemainingAndRefund_FullRefundWhenNoneReleased() public {
        uint256 id = _createAndFund();
        uint256 clientBalBefore = usdc.balanceOf(client);

        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        assertEq(usdc.balanceOf(client), clientBalBefore + total2, "client should receive full refund");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty");
    }

    function test_CancelRemainingAndRefund_PartialRefundAfterRelease() public {
        uint256 id = _createAndFund();

        // Release milestone 0 (500 USDC)
        _submitAndApprove(id, 0);

        uint256 clientBalBefore = usdc.balanceOf(client);
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        // Only milestone 1 (300 USDC) should be refunded
        assertEq(usdc.balanceOf(client), clientBalBefore + amounts2[1], "partial refund should equal unreleased milestone");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty after partial cancel");
    }

    function test_CancelRemainingAndRefund_SetsCancelledFlag() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        (, , , , , , bool isCancelled) = escrow.getAgreement(id);
        assertTrue(isCancelled);
    }

    function test_CancelRemainingAndRefund_SetsMilestonesToCancelled() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        (, , , MilestoneEscrow.MilestoneStatus s0, , , , ) = escrow.getMilestone(id, 0);
        (, , , MilestoneEscrow.MilestoneStatus s1, , , , ) = escrow.getMilestone(id, 1);
        assertEq(uint8(s0), uint8(MilestoneEscrow.MilestoneStatus.Cancelled));
        assertEq(uint8(s1), uint8(MilestoneEscrow.MilestoneStatus.Cancelled));
    }

    function test_CancelRemainingAndRefund_DoesNotCancelReleasedMilestone() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);

        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        (, , , MilestoneEscrow.MilestoneStatus s0, , , , ) = escrow.getMilestone(id, 0);
        (, , , MilestoneEscrow.MilestoneStatus s1, , , , ) = escrow.getMilestone(id, 1);
        assertEq(uint8(s0), uint8(MilestoneEscrow.MilestoneStatus.Released),  "released milestone should stay Released");
        assertEq(uint8(s1), uint8(MilestoneEscrow.MilestoneStatus.Cancelled), "pending milestone should become Cancelled");
    }

    function test_CancelRemainingAndRefund_EmitsEscrowCancelled() public {
        uint256 id = _createAndFund();

        vm.prank(client);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit EscrowCancelled(id, client, total2);
        escrow.cancelRemainingAndRefund(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  11. cancelRemainingAndRefund — revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_CancelRemainingAndRefund_RevertNotClient() public {
        uint256 id = _createAndFund();
        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotClient.selector);
        escrow.cancelRemainingAndRefund(id);
    }

    function test_CancelRemainingAndRefund_RevertNotFunded() public {
        uint256 id = _createDefault();
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.NotFunded.selector);
        escrow.cancelRemainingAndRefund(id);
    }

    function test_CancelRemainingAndRefund_RevertAlreadyCancelled() public {
        uint256 id = _createAndFund();
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.AlreadyCancelled.selector);
        escrow.cancelRemainingAndRefund(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  12. Full happy path: create → fund → submit all → approve all
    // ═════════════════════════════════════════════════════════════════════════

    function test_FullHappyPath_AllMilestonesReleased() public {
        uint256 id = _createAndFund();

        uint256 providerBalBefore = usdc.balanceOf(provider);

        // Milestone 0
        _submitAndApprove(id, 0);

        // Milestone 1
        _submitAndApprove(id, 1);

        uint256 providerBalAfter = usdc.balanceOf(provider);
        assertEq(providerBalAfter - providerBalBefore, total2, "provider should receive all milestone funds");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty after all milestones released");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  13. getUnreleasedAmount
    // ═════════════════════════════════════════════════════════════════════════

    function test_GetUnreleasedAmount_FullBeforeAnyRelease() public {
        uint256 id = _createAndFund();
        assertEq(escrow.getUnreleasedAmount(id), total2);
    }

    function test_GetUnreleasedAmount_DecreasesAfterRelease() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);
        assertEq(escrow.getUnreleasedAmount(id), amounts2[1]);
    }

    function test_GetUnreleasedAmount_ZeroAfterAllReleased() public {
        uint256 id = _createAndFund();
        _submitAndApprove(id, 0);
        _submitAndApprove(id, 1);
        assertEq(escrow.getUnreleasedAmount(id), 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  14. FUZZ — milestone amount arithmetic
    // ═════════════════════════════════════════════════════════════════════════

    /// @dev Fuzz: for any two non-zero milestone amounts a & b, the stored
    ///      totalAmount must equal a + b.
    function testFuzz_CreateAgreement_TotalAmountEqualsSumOfMilestones(
        uint128 a,
        uint128 b
    ) public {
        // Leave headroom for b: cap a at (max - 1) so b's range is always [1, max-a].
        a = uint128(bound(uint256(a), 1, uint256(type(uint128).max) - 1));
        b = uint128(bound(uint256(b), 1, uint256(type(uint128).max) - uint256(a)));

        string[]  memory fDescs   = new string[](2);
        fDescs[0] = "Milestone A";
        fDescs[1] = "Milestone B";

        uint256[] memory fAmounts = new uint256[](2);
        fAmounts[0] = uint256(a);
        fAmounts[1] = uint256(b);

        vm.prank(client);
        uint256 id = escrow.createAgreement(provider, address(0), fDescs, fAmounts);

        (, , , uint256 total, , , ) = escrow.getAgreement(id);
        assertEq(total, uint256(a) + uint256(b), "totalAmount must equal sum of milestone amounts");
    }

    /// @dev Fuzz: funding moves exactly totalAmount out of client and into escrow.
    function testFuzz_FundEscrow_ExactTransfer(uint96 a, uint96 b) public {
        a = uint96(bound(uint256(a), 1, 1_000_000e6));
        b = uint96(bound(uint256(b), 1, 1_000_000e6));

        string[]  memory fDescs   = new string[](2);
        fDescs[0] = "m0";
        fDescs[1] = "m1";
        uint256[] memory fAmounts = new uint256[](2);
        fAmounts[0] = a;
        fAmounts[1] = b;

        uint256 total = uint256(a) + uint256(b);
        usdc.mint(client, total);

        vm.prank(client);
        uint256 id = escrow.createAgreement(provider, address(0), fDescs, fAmounts);

        vm.prank(client);
        usdc.approve(address(escrow), total);

        uint256 escrowBalBefore = usdc.balanceOf(address(escrow));
        vm.prank(client);
        escrow.fundEscrow(id);

        assertEq(usdc.balanceOf(address(escrow)), escrowBalBefore + total,
            "escrow balance must increase by totalAmount");
    }

    /// @dev Fuzz: after approveAndRelease, provider receives exactly the milestone amount.
    function testFuzz_ApproveAndRelease_ProviderReceivesExactAmount(uint96 a, uint96 b) public {
        a = uint96(bound(uint256(a), 1, 1_000_000e6));
        b = uint96(bound(uint256(b), 1, 1_000_000e6));

        string[]  memory fDescs   = new string[](2);
        fDescs[0] = "m0";
        fDescs[1] = "m1";
        uint256[] memory fAmounts = new uint256[](2);
        fAmounts[0] = a;
        fAmounts[1] = b;

        uint256 total = uint256(a) + uint256(b);
        usdc.mint(client, total);

        vm.prank(client);
        uint256 id = escrow.createAgreement(provider, address(0), fDescs, fAmounts);

        vm.prank(client);
        usdc.approve(address(escrow), total);
        vm.prank(client);
        escrow.fundEscrow(id);

        vm.prank(provider);
        escrow.submitMilestone(id, 0, "ipfs://evidence");

        // Warp past dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 providerBal = usdc.balanceOf(provider);
        vm.prank(client);
        escrow.approveAndRelease(id, 0);

        assertEq(usdc.balanceOf(provider), providerBal + a,
            "provider must receive exactly the milestone amount");
    }

    /// @dev Fuzz: after cancel, client receives exactly sum of unreleased milestones.
    function testFuzz_CancelRemainingAndRefund_RefundEqualsUnreleased(uint96 a, uint96 b) public {
        a = uint96(bound(uint256(a), 1, 1_000_000e6));
        b = uint96(bound(uint256(b), 1, 1_000_000e6));

        string[]  memory fDescs   = new string[](2);
        fDescs[0] = "m0";
        fDescs[1] = "m1";
        uint256[] memory fAmounts = new uint256[](2);
        fAmounts[0] = a;
        fAmounts[1] = b;

        uint256 total = uint256(a) + uint256(b);
        usdc.mint(client, total);

        vm.prank(client);
        uint256 id = escrow.createAgreement(provider, address(0), fDescs, fAmounts);

        vm.prank(client);
        usdc.approve(address(escrow), total);
        vm.prank(client);
        escrow.fundEscrow(id);

        // Release only milestone 0
        vm.prank(provider);
        escrow.submitMilestone(id, 0, "ipfs://evidence");
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(client);
        escrow.approveAndRelease(id, 0);

        uint256 clientBal = usdc.balanceOf(client);
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        assertEq(usdc.balanceOf(client), clientBal + b,
            "refund should equal the sum of unreleased milestones");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  15. NEW — submitMilestone evidence requirement
    // ═════════════════════════════════════════════════════════════════════════

    function test_SubmitMilestone_RequiresEvidence() public {
        uint256 id = _createAndFund();
        vm.prank(provider);
        vm.expectRevert(MilestoneEscrow.EmptyEvidence.selector);
        escrow.submitMilestone(id, 0, "");
    }

    function test_SubmitMilestone_WithEvidence() public {
        uint256 id = _createAndFund();
        string memory ev = "ipfs://QmProof";
        vm.prank(provider);
        escrow.submitMilestone(id, 0, ev);

        (, , , , string memory storedEvidence, , , ) = escrow.getMilestone(id, 0);
        assertEq(storedEvidence, ev, "evidence should be stored on the milestone");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  16. NEW — approveAndRelease dispute window guard
    // ═════════════════════════════════════════════════════════════════════════

    function test_ApproveAndRelease_RevertsIfWindowOpen() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        // Still within the 48-hour dispute window
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.DisputeWindowOpen.selector);
        escrow.approveAndRelease(id, 0);
    }

    function test_ApproveAndRelease_AfterWindowClosed() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 providerBalBefore = usdc.balanceOf(provider);
        vm.prank(client);
        escrow.approveAndRelease(id, 0);

        assertEq(usdc.balanceOf(provider), providerBalBefore + amounts2[0],
            "provider should receive payment after window closes");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  17. NEW — raiseDispute
    // ═════════════════════════════════════════════════════════════════════════

    function test_RaiseDispute_HappyPath() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);

        vm.prank(client);
        escrow.raiseDispute(id, 0);

        (, , , MilestoneEscrow.MilestoneStatus status, , , , bool disputed) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.Disputed), "status should be Disputed");
        assertTrue(disputed, "disputed flag should be set");
    }

    function test_RaiseDispute_EmitsEvent() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);

        vm.prank(client);
        vm.expectEmit(true, true, true, false, address(escrow));
        emit MilestoneDisputeRaised(id, 0, client);
        escrow.raiseDispute(id, 0);
    }

    function test_RaiseDispute_RevertsIfNoArbiter() public {
        // Agreement with address(0) arbiter
        uint256 id = _createAndFund();
        _submit(id, 0);

        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.NoArbiter.selector);
        escrow.raiseDispute(id, 0);
    }

    function test_RaiseDispute_RevertsAfterDeadline() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);

        // Warp past the dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.DisputeWindowClosed.selector);
        escrow.raiseDispute(id, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  18. NEW — resolveDispute
    // ═════════════════════════════════════════════════════════════════════════

    function test_ResolveDispute_FullRelease() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        uint256 providerBalBefore = usdc.balanceOf(provider);
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, amounts2[0]);

        assertEq(usdc.balanceOf(provider), providerBalBefore + amounts2[0],
            "provider should receive full milestone amount");
        assertEq(usdc.balanceOf(address(escrow)), total2 - amounts2[0],
            "escrow should decrease by milestone amount");

        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.Released));
    }

    function test_ResolveDispute_FullRefund() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        uint256 clientBalBefore = usdc.balanceOf(client);
        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, 0);

        assertEq(usdc.balanceOf(client), clientBalBefore + amounts2[0],
            "client should receive full refund");
        assertEq(usdc.balanceOf(provider), 0,
            "provider should receive nothing");
    }

    function test_ResolveDispute_PartialRelease() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        uint256 half = amounts2[0] / 2;
        uint256 providerBalBefore = usdc.balanceOf(provider);
        uint256 clientBalBefore   = usdc.balanceOf(client);

        vm.prank(arbiter);
        escrow.resolveDispute(id, 0, half);

        assertEq(usdc.balanceOf(provider), providerBalBefore + half,
            "provider should receive half");
        assertEq(usdc.balanceOf(client), clientBalBefore + (amounts2[0] - half),
            "client should receive the other half");
    }

    function test_ResolveDispute_EmitsArbiterDecision() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneArbiterDecision(id, 0, amounts2[0], 0);
        escrow.resolveDispute(id, 0, amounts2[0]);
    }

    function test_ResolveDispute_RevertsNotArbiter() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.prank(stranger);
        vm.expectRevert(MilestoneEscrow.NotArbiter.selector);
        escrow.resolveDispute(id, 0, amounts2[0]);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  19. NEW — claimAutoRelease
    // ═════════════════════════════════════════════════════════════════════════

    function test_ClaimAutoRelease_AfterWindow() public {
        uint256 id = _createAndFund();
        _submit(id, 0);

        // Warp past the 48-hour dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 providerBalBefore = usdc.balanceOf(provider);
        // Anyone can trigger — use stranger
        vm.prank(stranger);
        escrow.claimAutoRelease(id, 0);

        assertEq(usdc.balanceOf(provider), providerBalBefore + amounts2[0],
            "provider should receive funds on auto-release");

        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.AutoReleased));
    }

    function test_ClaimAutoRelease_EmitsEvent() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit MilestoneAutoReleased(id, 0, provider, amounts2[0]);
        escrow.claimAutoRelease(id, 0);
    }

    function test_ClaimAutoRelease_RevertsIfWindowOpen() public {
        uint256 id = _createAndFund();
        _submit(id, 0);
        // Still within window
        vm.expectRevert(MilestoneEscrow.DisputeWindowOpen.selector);
        escrow.claimAutoRelease(id, 0);
    }

    function test_ClaimAutoRelease_RevertsIfDisputed() public {
        uint256 id = _createAndFundWithArbiter();
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Warp past dispute window (but NOT past arbiter timeout — status is Disputed not Submitted)
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        // Status is Disputed, not Submitted — should revert InvalidStatus
        vm.expectRevert(MilestoneEscrow.InvalidStatus.selector);
        escrow.claimAutoRelease(id, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  20. NEW — claimArbiterTimeout
    // ═════════════════════════════════════════════════════════════════════════

    function test_ClaimArbiterTimeout_HappyPath() public {
        uint256 id = _createAndFundWithArbiter();
        uint256 submitTime = block.timestamp;
        _submit(id, 0);

        // Raise dispute within window
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Warp past DISPUTE_WINDOW + ARBITER_TIMEOUT
        vm.warp(submitTime + DISPUTE_WINDOW + ARBITER_TIMEOUT + 1);

        uint256 clientBalBefore = usdc.balanceOf(client);
        vm.prank(stranger); // Anyone can call
        escrow.claimArbiterTimeout(id, 0);

        assertEq(usdc.balanceOf(client), clientBalBefore + amounts2[0],
            "client should get funds back after arbiter timeout");

        (, , , MilestoneEscrow.MilestoneStatus status, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(status), uint8(MilestoneEscrow.MilestoneStatus.Cancelled));
    }

    function test_ClaimArbiterTimeout_EmitsEvent() public {
        uint256 id = _createAndFundWithArbiter();
        uint256 submitTime = block.timestamp;
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        vm.warp(submitTime + DISPUTE_WINDOW + ARBITER_TIMEOUT + 1);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit ArbiterTimeoutClaimed(id, 0, client, amounts2[0]);
        escrow.claimArbiterTimeout(id, 0);
    }

    function test_ClaimArbiterTimeout_RevertsIfTooEarly() public {
        uint256 id = _createAndFundWithArbiter();
        uint256 submitTime = block.timestamp;
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Only 6 days elapsed — still within the 7-day arbiter timeout
        vm.warp(submitTime + DISPUTE_WINDOW + 6 days);

        vm.expectRevert(MilestoneEscrow.DisputeWindowOpen.selector);
        escrow.claimArbiterTimeout(id, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  21. NEW — cancelRemainingAndRefund includes Disputed milestones
    // ═════════════════════════════════════════════════════════════════════════

    function test_CancelRefund_IncludesDisputedMilestone() public {
        uint256 id = _createAndFundWithArbiter();

        // Submit milestone 0 and raise a dispute on it
        _submit(id, 0);
        vm.prank(client);
        escrow.raiseDispute(id, 0);

        // Milestone 1 remains Pending
        uint256 clientBalBefore = usdc.balanceOf(client);
        vm.prank(client);
        escrow.cancelRemainingAndRefund(id);

        // Both milestones' amounts should be refunded (500 + 300 = 800 USDC)
        assertEq(usdc.balanceOf(client), clientBalBefore + total2,
            "cancel should refund both Disputed and Pending milestones");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow should be empty");

        (, , , MilestoneEscrow.MilestoneStatus s0, , , , ) = escrow.getMilestone(id, 0);
        assertEq(uint8(s0), uint8(MilestoneEscrow.MilestoneStatus.Cancelled),
            "previously Disputed milestone should become Cancelled");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  22. NEW — createAgreement arbiter validation
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateAgreement_WithArbiter() public {
        vm.prank(client);
        uint256 id = escrow.createAgreement(provider, arbiter, descs2, amounts2);

        (, , address storedArbiter, , , , ) = escrow.getAgreement(id);
        assertEq(storedArbiter, arbiter, "arbiter should be stored correctly");
    }

    function test_CreateAgreement_ArbiterCannotBeClient() public {
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        // client is msg.sender here, so arbiter == client triggers InvalidAgreement
        escrow.createAgreement(provider, client, descs2, amounts2);
    }

    function test_CreateAgreement_ArbiterCannotBeProvider() public {
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.InvalidAgreement.selector);
        escrow.createAgreement(provider, provider, descs2, amounts2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────
contract MilestoneEscrowInvariantTest is Test {
    MilestoneEscrow internal escrow;
    MockERC20       internal usdc;
    EscrowHandler   internal handler;

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        escrow  = new MilestoneEscrow(address(usdc));
        handler = new EscrowHandler(escrow, usdc);

        // Scope fuzzer to handler only
        targetContract(address(handler));
    }

    /// @notice The escrow's USDC balance equals sum of (fundedAmount - releasedAmounts)
    ///         across all live agreements. We approximate this by checking the
    ///         USDC balance is never negative (trivially true for uint) and that
    ///         the escrow balance equals sum of unreleased amounts.
    function invariant_EscrowTokenBalanceEqualsUnreleasedAmounts() public view {
        uint256 sumUnreleased;
        uint256 count = escrow.agreementCount();
        for (uint256 i = 1; i <= count; i++) {
            (, , , , , bool funded, bool cancelled) = escrow.getAgreement(i);
            if (funded && !cancelled) {
                sumUnreleased += escrow.getUnreleasedAmount(i);
            }
        }
        assertEq(
            usdc.balanceOf(address(escrow)),
            sumUnreleased,
            "escrow USDC balance must equal sum of unreleased amounts across all live agreements"
        );
    }

    /// @notice fundedAmount is always <= totalAmount for every funded agreement.
    function invariant_FundedAmountNeverExceedsTotalAmount() public view {
        uint256 count = escrow.agreementCount();
        for (uint256 i = 1; i <= count; i++) {
            (, , , uint256 total, uint256 funded, , ) = escrow.getAgreement(i);
            assertLe(funded, total, "fundedAmount must never exceed totalAmount");
        }
    }
}
