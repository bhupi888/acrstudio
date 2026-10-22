// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MilestoneEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DISPUTE_WINDOW = 48 hours;
    /// @notice Time after which a disputed milestone can be force-refunded if the arbiter has not acted.
    uint256 public constant ARBITER_TIMEOUT = 7 days;

    enum MilestoneStatus {
        Pending,
        Submitted,
        Released,
        Cancelled,
        Disputed,
        AutoReleased
    }

    struct Milestone {
        uint256 id;
        string description;
        uint256 amount;
        MilestoneStatus status;
        string evidence;
        uint256 submittedAt;
        uint256 disputeDeadline;
        bool disputed;
    }

    struct Agreement {
        address client;
        address provider;
        address usdcToken;
        uint256 totalAmount;
        uint256 fundedAmount;
        bool funded;
        bool cancelled;
        Milestone[] milestones;
        address arbiter;
    }

    error NotClient();
    error NotProvider();
    error AlreadyFunded();
    error NotFunded();
    error AlreadyCancelled();
    error InvalidStatus();
    error ZeroAddress();
    error EmptyMilestones();
    error LengthMismatch();
    error TooManyMilestones();
    error ZeroAmount();
    error InvalidAgreement();
    error EmptyEvidence();
    error DisputeWindowClosed();
    error DisputeWindowOpen();
    error NotArbiter();
    error NoArbiter();
    error NotDisputed();
    error PartialAmountInvalid();

    event AgreementCreated(uint256 indexed agreementId, address indexed client, address indexed provider, uint256 totalAmount);
    event EscrowFunded(uint256 indexed agreementId, uint256 amount);
    event MilestoneSubmitted(uint256 indexed agreementId, uint256 indexed milestoneId);
    event MilestoneReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount);
    event EscrowCancelled(uint256 indexed agreementId, address indexed client, uint256 refundAmount);
    event MilestoneDisputeRaised(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client);
    event MilestoneArbiterDecision(
        uint256 indexed agreementId,
        uint256 indexed milestoneId,
        uint256 releasedToProvider,
        uint256 refundedToClient
    );
    event MilestoneAutoReleased(
        uint256 indexed agreementId,
        uint256 indexed milestoneId,
        address indexed provider,
        uint256 amount
    );
    event ArbiterTimeoutClaimed(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client, uint256 amount);

    mapping(uint256 => Agreement) public agreements;
    uint256 public agreementCount;

    address private immutable i_usdc;

    /// @notice Creates the escrow contract with a fixed USDC token address.
    /// @param _usdc The USDC ERC-20 token address used for all agreements.
    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddress();
        i_usdc = _usdc;
    }

    /// @notice Creates a new milestone agreement between the caller (client) and a provider.
    /// @param provider The provider who will submit milestones and receive released payments.
    /// @param arbiter Optional dispute resolver. Use address(0) for no arbiter.
    /// @param descriptions The ordered milestone descriptions.
    /// @param amounts The ordered milestone payment amounts in raw USDC units (6 decimals).
    /// @return agreementId The newly created agreement ID.
    function createAgreement(
        address provider,
        address arbiter,
        string[] calldata descriptions,
        uint256[] calldata amounts
    ) external returns (uint256 agreementId) {
        if (provider == address(0)) revert ZeroAddress();
        if (provider == msg.sender) revert InvalidAgreement();
        if (arbiter != address(0) && (arbiter == msg.sender || arbiter == provider)) revert InvalidAgreement();

        uint256 length = descriptions.length;
        if (length == 0) revert EmptyMilestones();
        if (length != amounts.length) revert LengthMismatch();
        if (length > 20) revert TooManyMilestones();

        agreementId = ++agreementCount;
        Agreement storage agreement = agreements[agreementId];
        agreement.client = msg.sender;
        agreement.provider = provider;
        agreement.usdcToken = i_usdc;
        agreement.arbiter = arbiter;

        uint256 total = 0;
        for (uint256 i = 0; i < length; i++) {
            uint256 amount = amounts[i];
            if (amount == 0) revert ZeroAmount();

            agreement.milestones.push(
                Milestone({
                    id: i,
                    description: descriptions[i],
                    amount: amount,
                    status: MilestoneStatus.Pending,
                    evidence: "",
                    submittedAt: 0,
                    disputeDeadline: 0,
                    disputed: false
                })
            );
            total += amount;
        }

        agreement.totalAmount = total;

        emit AgreementCreated(agreementId, msg.sender, provider, total);
    }

    /// @notice Funds an agreement's escrow in a single USDC transfer of total milestone value.
    /// @param agreementId The agreement ID to fund.
    function fundEscrow(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);

        if (msg.sender != agreement.client) revert NotClient();
        if (agreement.funded) revert AlreadyFunded();
        if (agreement.cancelled) revert AlreadyCancelled();

        IERC20(agreement.usdcToken).safeTransferFrom(msg.sender, address(this), agreement.totalAmount);

        agreement.funded = true;
        agreement.fundedAmount = agreement.totalAmount;

        emit EscrowFunded(agreementId, agreement.totalAmount);
    }

    /// @notice Marks a pending milestone as submitted by the provider.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    /// @param evidence Provider-supplied evidence note or URL.
    function submitMilestone(uint256 agreementId, uint256 milestoneId, string calldata evidence) external {
        Agreement storage agreement = _getAgreement(agreementId);

        if (msg.sender != agreement.provider) revert NotProvider();
        if (!agreement.funded) revert NotFunded();
        if (agreement.cancelled) revert AlreadyCancelled();
        if (bytes(evidence).length == 0) revert EmptyEvidence();

        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Pending) revert InvalidStatus();

        milestone.evidence = evidence;
        milestone.submittedAt = block.timestamp;
        milestone.disputeDeadline = block.timestamp + DISPUTE_WINDOW;
        milestone.disputed = false;
        milestone.status = MilestoneStatus.Submitted;

        emit MilestoneSubmitted(agreementId, milestoneId);
    }

    /// @notice Approves a submitted milestone and releases its payment to the provider.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    function approveAndRelease(uint256 agreementId, uint256 milestoneId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);

        if (msg.sender != agreement.client) revert NotClient();
        if (!agreement.funded) revert NotFunded();
        if (agreement.cancelled) revert AlreadyCancelled();

        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidStatus();
        if (block.timestamp < milestone.disputeDeadline) revert DisputeWindowOpen();

        milestone.status = MilestoneStatus.Released;
        milestone.disputed = false;
        milestone.disputeDeadline = 0;

        IERC20(agreement.usdcToken).safeTransfer(agreement.provider, milestone.amount);

        emit MilestoneReleased(agreementId, milestoneId, agreement.provider, milestone.amount);
    }

    /// @notice Client raises a dispute on a submitted milestone within the 48-hour window.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    function raiseDispute(uint256 agreementId, uint256 milestoneId) external {
        Agreement storage agreement = _getAgreement(agreementId);

        if (agreement.arbiter == address(0)) revert NoArbiter();
        if (msg.sender != agreement.client) revert NotClient();
        if (!agreement.funded) revert NotFunded();
        if (agreement.cancelled) revert AlreadyCancelled();

        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidStatus();
        if (block.timestamp >= milestone.disputeDeadline) revert DisputeWindowClosed();

        milestone.disputed = true;
        milestone.status = MilestoneStatus.Disputed;

        emit MilestoneDisputeRaised(agreementId, milestoneId, agreement.client);
    }

    /// @notice Arbiter resolves a disputed milestone: full release, partial release, or full refund.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    /// @param releaseAmount Amount to send to provider. 0 means full refund to client.
    function resolveDispute(uint256 agreementId, uint256 milestoneId, uint256 releaseAmount) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);

        if (agreement.arbiter == address(0)) revert NoArbiter();
        if (msg.sender != agreement.arbiter) revert NotArbiter();

        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Disputed) revert NotDisputed();
        if (releaseAmount > milestone.amount) revert PartialAmountInvalid();

        uint256 refundAmount = milestone.amount - releaseAmount;

        if (releaseAmount > 0) {
            IERC20(agreement.usdcToken).safeTransfer(agreement.provider, releaseAmount);
        }

        if (refundAmount > 0) {
            IERC20(agreement.usdcToken).safeTransfer(agreement.client, refundAmount);
        }

        milestone.status = MilestoneStatus.Released;
        milestone.disputed = false;
        milestone.disputeDeadline = 0;

        emit MilestoneArbiterDecision(agreementId, milestoneId, releaseAmount, refundAmount);
    }

    /// @notice Anyone can trigger auto-release once the dispute window has passed without a dispute or approval.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    function claimAutoRelease(uint256 agreementId, uint256 milestoneId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);

        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Submitted) revert InvalidStatus();
        if (block.timestamp < milestone.disputeDeadline) revert DisputeWindowOpen();

        milestone.status = MilestoneStatus.AutoReleased;
        milestone.disputed = false;
        milestone.disputeDeadline = 0;

        IERC20(agreement.usdcToken).safeTransfer(agreement.provider, milestone.amount);

        emit MilestoneAutoReleased(agreementId, milestoneId, agreement.provider, milestone.amount);
    }

    /// @notice Force-refunds a disputed milestone to the client after the arbiter timeout has elapsed.
    /// @dev Anyone can call this after ARBITER_TIMEOUT has passed since the dispute was raised (submittedAt + DISPUTE_WINDOW + ARBITER_TIMEOUT).
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    function claimArbiterTimeout(uint256 agreementId, uint256 milestoneId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);
        if (!agreement.funded) revert NotFunded();
        if (agreement.cancelled) revert AlreadyCancelled();
        Milestone storage milestone = _getMilestone(agreement, milestoneId);
        if (milestone.status != MilestoneStatus.Disputed) revert InvalidStatus();
        // The timeout is measured from when the dispute window opened (submittedAt + DISPUTE_WINDOW)
        // plus the extra ARBITER_TIMEOUT buffer.
        if (block.timestamp < milestone.submittedAt + DISPUTE_WINDOW + ARBITER_TIMEOUT) revert DisputeWindowOpen();
        milestone.status = MilestoneStatus.Cancelled;
        IERC20(agreement.usdcToken).safeTransfer(agreement.client, milestone.amount);
        emit ArbiterTimeoutClaimed(agreementId, milestoneId, agreement.client, milestone.amount);
    }

    /// @notice Cancels all unreleased milestones and refunds their amount back to the client.
    /// @param agreementId The agreement ID.
    function cancelRemainingAndRefund(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);

        if (msg.sender != agreement.client) revert NotClient();
        if (!agreement.funded) revert NotFunded();
        if (agreement.cancelled) revert AlreadyCancelled();

        uint256 unreleasedAmount;
        uint256 length = agreement.milestones.length;

        for (uint256 i = 0; i < length; i++) {
            Milestone storage milestone = agreement.milestones[i];

            if (
                milestone.status == MilestoneStatus.Pending || milestone.status == MilestoneStatus.Submitted
                    || milestone.status == MilestoneStatus.Disputed
            ) {
                unreleasedAmount += milestone.amount;
                milestone.status = MilestoneStatus.Cancelled;
                milestone.disputed = false;
                milestone.disputeDeadline = 0;
            }
        }

        agreement.cancelled = true;

        if (unreleasedAmount > 0) {
            IERC20(agreement.usdcToken).safeTransfer(agreement.client, unreleasedAmount);
        }

        emit EscrowCancelled(agreementId, agreement.client, unreleasedAmount);
    }

    /// @notice Returns core agreement fields.
    /// @param agreementId The agreement ID.
    /// @return client The client address.
    /// @return provider The provider address.
    /// @return arbiter The arbiter address (zero when none is configured).
    /// @return totalAmount Sum of all milestone amounts.
    /// @return fundedAmount Amount deposited into escrow.
    /// @return funded Whether the agreement has been funded.
    /// @return cancelled Whether the agreement has been cancelled.
    function getAgreement(
        uint256 agreementId
    )
        external
        view
        returns (
            address client,
            address provider,
            address arbiter,
            uint256 totalAmount,
            uint256 fundedAmount,
            bool funded,
            bool cancelled
        )
    {
        Agreement storage agreement = _getAgreement(agreementId);

        return (
            agreement.client,
            agreement.provider,
            agreement.arbiter,
            agreement.totalAmount,
            agreement.fundedAmount,
            agreement.funded,
            agreement.cancelled
        );
    }

    /// @notice Returns a milestone's details.
    /// @param agreementId The agreement ID.
    /// @param milestoneId The milestone ID within the agreement.
    /// @return id The milestone ID.
    /// @return description The milestone description.
    /// @return amount The milestone amount.
    /// @return status The milestone status.
    /// @return evidence The submission evidence note or URL.
    /// @return submittedAt The submission timestamp.
    /// @return disputeDeadline The dispute deadline timestamp.
    /// @return disputed Whether a dispute has been raised.
    function getMilestone(
        uint256 agreementId,
        uint256 milestoneId
    )
        external
        view
        returns (
            uint256 id,
            string memory description,
            uint256 amount,
            MilestoneStatus status,
            string memory evidence,
            uint256 submittedAt,
            uint256 disputeDeadline,
            bool disputed
        )
    {
        Agreement storage agreement = _getAgreement(agreementId);
        Milestone storage milestone = _getMilestone(agreement, milestoneId);

        return (
            milestone.id,
            milestone.description,
            milestone.amount,
            milestone.status,
            milestone.evidence,
            milestone.submittedAt,
            milestone.disputeDeadline,
            milestone.disputed
        );
    }

    /// @notice Returns the number of milestones in an agreement.
    /// @param agreementId The agreement ID.
    /// @return The milestone count.
    function getMilestoneCount(uint256 agreementId) external view returns (uint256) {
        Agreement storage agreement = _getAgreement(agreementId);
        return agreement.milestones.length;
    }

    /// @notice Returns the sum of milestone amounts that are not yet released.
    /// @param agreementId The agreement ID.
    /// @return unreleasedAmount The remaining unreleased amount.
    function getUnreleasedAmount(uint256 agreementId) external view returns (uint256 unreleasedAmount) {
        Agreement storage agreement = _getAgreement(agreementId);
        uint256 length = agreement.milestones.length;

        for (uint256 i = 0; i < length; i++) {
            MilestoneStatus status = agreement.milestones[i].status;
            if (status != MilestoneStatus.Released && status != MilestoneStatus.AutoReleased) {
                unreleasedAmount += agreement.milestones[i].amount;
            }
        }
    }

    function _getAgreement(uint256 agreementId) internal view returns (Agreement storage agreement) {
        if (agreementId == 0 || agreementId > agreementCount) revert InvalidAgreement();
        agreement = agreements[agreementId];
    }

    function _getMilestone(
        Agreement storage agreement,
        uint256 milestoneId
    ) internal view returns (Milestone storage milestone) {
        if (milestoneId >= agreement.milestones.length) revert InvalidAgreement();
        milestone = agreement.milestones[milestoneId];
    }
}
