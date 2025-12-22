// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ═══════════════════════════════════════════════════════════════════════════
//                              INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

interface IMailboxArb {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32);
    
    function localDomain() external view returns (uint32);
}

interface IInterchainGasPaymasterArb {
    function payForGas(
        bytes32 messageId,
        uint32 destinationDomain,
        uint256 gasAmount,
        address refundAddress
    ) external payable;
    
    function quoteGasPayment(
        uint32 destinationDomain,
        uint256 gasAmount
    ) external view returns (uint256);
}

interface IBanManagerArb {
    function applyAddressBan(address target, bytes32 caseId, string calldata reason) external;
    function removeAddressBan(address target) external;
}

/**
 * @title CrossChainArbitration
 * @author Jeju Network
 * @notice Cross-chain dispute resolution for moderation cases
 * @dev Uses Hyperlane for cross-chain communication and multi-chain voting
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *                              CROSS-CHAIN ARBITRATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When a moderation case involves users/assets on multiple chains:
 * 1. Case is escalated to cross-chain arbitration
 * 2. Votes can be cast on any supported chain
 * 3. Vote aggregation happens on the hub chain
 * 4. Resolution is broadcast to all chains
 * 5. Ban enforcement synchronized across networks
 *
 */
contract CrossChainArbitration is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct CrossChainCase {
        bytes32 caseId;
        bytes32 originChainCaseId;    // Case ID on originating chain
        uint32 originDomain;          // Hyperlane domain of origin
        address target;               // Target of the ban
        address reporter;             // Who reported
        uint256 totalYesVotes;        // Aggregated YES votes
        uint256 totalNoVotes;         // Aggregated NO votes
        mapping(uint32 => uint256) yesVotesByChain;  // YES votes per chain
        mapping(uint32 => uint256) noVotesByChain;   // NO votes per chain
        uint256 votingEnds;
        bool resolved;
        uint8 outcome;                // 0=pending, 1=banned, 2=cleared
        string reason;
    }

    struct ChainConfig {
        uint32 domain;               // Hyperlane domain
        bytes32 arbitrationContract; // This contract's address on that chain
        bytes32 banManagerContract;  // BanManager address on that chain
        bool isActive;
        uint256 voteWeight;          // Weight multiplier for votes from this chain
    }

    struct VoteMessage {
        bytes32 caseId;
        uint8 position;              // 0 = YES, 1 = NO
        uint256 voteWeight;
        address voter;
    }

    struct ResolutionMessage {
        bytes32 caseId;
        uint8 outcome;
        address target;
        string reason;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════

    uint256 public constant CROSS_CHAIN_VOTING_PERIOD = 5 days;
    uint256 public constant GAS_LIMIT = 500_000;
    uint256 public constant MIN_CHAINS_FOR_QUORUM = 2;
    
    // Message types
    uint8 public constant MSG_VOTE = 1;
    uint8 public constant MSG_RESOLUTION = 2;
    uint8 public constant MSG_ESCALATION = 3;

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    IMailboxArb public mailbox;
    IInterchainGasPaymasterArb public igp;
    IBanManagerArb public banManager;
    
    // caseId => case data
    mapping(bytes32 => CrossChainCase) public cases;
    
    // domain => chain config
    mapping(uint32 => ChainConfig) public chainConfigs;
    
    // List of active domains
    uint32[] public activeDomains;
    
    // Track which chains have voted on a case
    mapping(bytes32 => mapping(uint32 => bool)) public chainHasVoted;
    
    // Hub chain domain (where aggregation happens)
    uint32 public hubDomain;
    bool public isHub;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event CaseEscalated(
        bytes32 indexed caseId,
        bytes32 indexed originCaseId,
        uint32 originDomain,
        address target
    );

    event CrossChainVoteReceived(
        bytes32 indexed caseId,
        uint32 indexed fromDomain,
        uint256 yesVotes,
        uint256 noVotes
    );

    event CrossChainVoteSent(
        bytes32 indexed caseId,
        uint32 indexed toDomain,
        bytes32 messageId
    );

    event CaseResolvedCrossChain(
        bytes32 indexed caseId,
        uint8 outcome,
        uint256 totalYesVotes,
        uint256 totalNoVotes
    );

    event ResolutionBroadcast(
        bytes32 indexed caseId,
        uint32 indexed toDomain,
        bytes32 messageId
    );

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error NotHub();
    error AlreadyEscalated();
    error CaseNotFound();
    error VotingEnded();
    error ChainNotSupported();
    error OnlyMailbox();
    error InsufficientGas();
    error AlreadyResolved();
    error InsufficientChainParticipation();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(
        address _mailbox,
        address _igp,
        uint32 _hubDomain,
        address _owner
    ) Ownable(_owner) {
        mailbox = IMailboxArb(_mailbox);
        igp = IInterchainGasPaymasterArb(_igp);
        hubDomain = _hubDomain;
        isHub = mailbox.localDomain() == _hubDomain;
    }

    /**
     * @notice Set the BanManager contract for local ban enforcement
     */
    function setBanManager(address _banManager) external onlyOwner {
        banManager = IBanManagerArb(_banManager);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ESCALATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Escalate a local case to cross-chain arbitration
     */
    function escalateCase(
        bytes32 originCaseId,
        address target,
        address reporter,
        string calldata reason
    ) external payable nonReentrant returns (bytes32 caseId) {
        caseId = keccak256(abi.encodePacked(
            originCaseId,
            mailbox.localDomain(),
            block.timestamp
        ));

        CrossChainCase storage c = cases[caseId];
        if (c.caseId != bytes32(0)) revert AlreadyEscalated();

        c.caseId = caseId;
        c.originChainCaseId = originCaseId;
        c.originDomain = mailbox.localDomain();
        c.target = target;
        c.reporter = reporter;
        c.votingEnds = block.timestamp + CROSS_CHAIN_VOTING_PERIOD;
        c.reason = reason;

        emit CaseEscalated(caseId, originCaseId, mailbox.localDomain(), target);

        // If not hub, send escalation to hub
        if (!isHub) {
            _sendToHub(caseId, MSG_ESCALATION, abi.encode(
                originCaseId,
                target,
                reporter,
                reason
            ));
        }

        return caseId;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VOTING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit local chain votes to hub for aggregation
     */
    function submitChainVotes(
        bytes32 caseId,
        uint256 yesVotes,
        uint256 noVotes
    ) external payable nonReentrant {
        CrossChainCase storage c = cases[caseId];
        if (c.caseId == bytes32(0)) revert CaseNotFound();
        if (block.timestamp > c.votingEnds) revert VotingEnded();

        uint32 localDomain = mailbox.localDomain();
        
        // Apply chain weight
        ChainConfig storage config = chainConfigs[localDomain];
        uint256 weightedYes = yesVotes * config.voteWeight / 10000;
        uint256 weightedNo = noVotes * config.voteWeight / 10000;

        // Record locally
        c.yesVotesByChain[localDomain] = weightedYes;
        c.noVotesByChain[localDomain] = weightedNo;
        chainHasVoted[caseId][localDomain] = true;

        // Send to hub if not hub
        if (!isHub) {
            bytes memory voteData = abi.encode(VoteMessage({
                caseId: caseId,
                position: yesVotes > noVotes ? 0 : 1,
                voteWeight: yesVotes > noVotes ? weightedYes : weightedNo,
                voter: msg.sender
            }));
            
            _sendToHub(caseId, MSG_VOTE, voteData);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Resolve cross-chain case (hub only)
     */
    function resolveCase(bytes32 caseId) external payable nonReentrant {
        if (!isHub) revert NotHub();
        
        CrossChainCase storage c = cases[caseId];
        if (c.caseId == bytes32(0)) revert CaseNotFound();
        if (c.resolved) revert AlreadyResolved();
        if (block.timestamp <= c.votingEnds) revert VotingEnded();

        // Count chains that voted
        uint256 chainCount = 0;
        uint256 totalYes = 0;
        uint256 totalNo = 0;
        
        for (uint256 i = 0; i < activeDomains.length; i++) {
            uint32 domain = activeDomains[i];
            if (chainHasVoted[caseId][domain]) {
                chainCount++;
                totalYes += c.yesVotesByChain[domain];
                totalNo += c.noVotesByChain[domain];
            }
        }

        if (chainCount < MIN_CHAINS_FOR_QUORUM) revert InsufficientChainParticipation();

        c.totalYesVotes = totalYes;
        c.totalNoVotes = totalNo;
        c.resolved = true;
        c.outcome = totalYes > totalNo ? 1 : 2; // 1 = banned, 2 = cleared

        emit CaseResolvedCrossChain(caseId, c.outcome, totalYes, totalNo);

        // Broadcast resolution to all chains
        _broadcastResolution(caseId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              MESSAGE HANDLING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Handle incoming Hyperlane message
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external {
        if (msg.sender != address(mailbox)) revert OnlyMailbox();
        
        ChainConfig storage config = chainConfigs[origin];
        if (!config.isActive) revert ChainNotSupported();
        if (sender != config.arbitrationContract) revert ChainNotSupported();

        uint8 msgType = uint8(body[0]);
        bytes calldata payload = body[1:];

        if (msgType == MSG_VOTE) {
            _handleVote(origin, payload);
        } else if (msgType == MSG_RESOLUTION) {
            _handleResolution(payload);
        } else if (msgType == MSG_ESCALATION) {
            _handleEscalation(origin, payload);
        }
    }

    function _handleVote(uint32 origin, bytes calldata payload) internal {
        VoteMessage memory vote = abi.decode(payload, (VoteMessage));
        
        CrossChainCase storage c = cases[vote.caseId];
        if (c.caseId == bytes32(0)) return;
        if (block.timestamp > c.votingEnds) return;

        if (vote.position == 0) {
            c.yesVotesByChain[origin] += vote.voteWeight;
            c.totalYesVotes += vote.voteWeight;
        } else {
            c.noVotesByChain[origin] += vote.voteWeight;
            c.totalNoVotes += vote.voteWeight;
        }
        
        chainHasVoted[vote.caseId][origin] = true;

        emit CrossChainVoteReceived(vote.caseId, origin, 
            c.yesVotesByChain[origin], 
            c.noVotesByChain[origin]
        );
    }

    function _handleResolution(bytes calldata payload) internal {
        ResolutionMessage memory resolution = abi.decode(payload, (ResolutionMessage));
        
        CrossChainCase storage c = cases[resolution.caseId];
        if (c.resolved) return;

        c.resolved = true;
        c.outcome = resolution.outcome;

        emit CaseResolvedCrossChain(
            resolution.caseId,
            resolution.outcome,
            c.totalYesVotes,
            c.totalNoVotes
        );

        // Apply ban if outcome is BAN_UPHELD (1)
        if (resolution.outcome == 1 && address(banManager) != address(0)) {
            banManager.applyAddressBan(
                c.target,
                resolution.caseId,
                string(abi.encodePacked("Cross-chain arbitration: ", c.reason))
            );
        } else if (resolution.outcome == 2 && address(banManager) != address(0)) {
            // Clear any pending bans if CLEARED (2)
            banManager.removeAddressBan(c.target);
        }
    }

    function _handleEscalation(uint32 origin, bytes calldata payload) internal {
        (bytes32 originCaseId, address target, address reporter, string memory reason) = 
            abi.decode(payload, (bytes32, address, address, string));

        bytes32 caseId = keccak256(abi.encodePacked(originCaseId, origin, block.timestamp));

        CrossChainCase storage c = cases[caseId];
        c.caseId = caseId;
        c.originChainCaseId = originCaseId;
        c.originDomain = origin;
        c.target = target;
        c.reporter = reporter;
        c.votingEnds = block.timestamp + CROSS_CHAIN_VOTING_PERIOD;
        c.reason = reason;

        emit CaseEscalated(caseId, originCaseId, origin, target);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              INTERNAL
    // ═══════════════════════════════════════════════════════════════════════

    function _sendToHub(bytes32 caseId, uint8 msgType, bytes memory payload) internal {
        bytes memory message = abi.encodePacked(msgType, payload);
        
        uint256 gasPayment = igp.quoteGasPayment(hubDomain, GAS_LIMIT);
        if (msg.value < gasPayment) revert InsufficientGas();

        ChainConfig storage hubConfig = chainConfigs[hubDomain];
        
        bytes32 messageId = mailbox.dispatch{value: msg.value}(
            hubDomain,
            hubConfig.arbitrationContract,
            message
        );

        igp.payForGas{value: gasPayment}(messageId, hubDomain, GAS_LIMIT, msg.sender);

        emit CrossChainVoteSent(caseId, hubDomain, messageId);
    }

    function _broadcastResolution(bytes32 caseId) internal {
        CrossChainCase storage c = cases[caseId];
        
        ResolutionMessage memory resolution = ResolutionMessage({
            caseId: caseId,
            outcome: c.outcome,
            target: c.target,
            reason: c.reason
        });
        
        bytes memory message = abi.encodePacked(MSG_RESOLUTION, abi.encode(resolution));

        for (uint256 i = 0; i < activeDomains.length; i++) {
            uint32 domain = activeDomains[i];
            if (domain == hubDomain) continue;

            ChainConfig storage config = chainConfigs[domain];
            if (!config.isActive) continue;

            uint256 gasPayment = igp.quoteGasPayment(domain, GAS_LIMIT);
            
            bytes32 messageId = mailbox.dispatch{value: gasPayment}(
                domain,
                config.arbitrationContract,
                message
            );

            igp.payForGas{value: gasPayment}(messageId, domain, GAS_LIMIT, address(this));

            emit ResolutionBroadcast(caseId, domain, messageId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function addChain(
        uint32 domain,
        bytes32 arbitrationContract,
        bytes32 banManagerContract,
        uint256 voteWeight
    ) external onlyOwner {
        chainConfigs[domain] = ChainConfig({
            domain: domain,
            arbitrationContract: arbitrationContract,
            banManagerContract: banManagerContract,
            isActive: true,
            voteWeight: voteWeight
        });
        activeDomains.push(domain);
    }

    function removeChain(uint32 domain) external onlyOwner {
        chainConfigs[domain].isActive = false;
        
        for (uint256 i = 0; i < activeDomains.length; i++) {
            if (activeDomains[i] == domain) {
                activeDomains[i] = activeDomains[activeDomains.length - 1];
                activeDomains.pop();
                break;
            }
        }
    }

    receive() external payable {}
}

