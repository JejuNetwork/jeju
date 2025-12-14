// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IProver.sol";

contract DisputeGameFactory is Ownable, ReentrancyGuard, Pausable {
    struct DisputeGame {
        address challenger;
        address proposer;
        bytes32 stateRoot;
        bytes32 claimRoot;
        GameType gameType;
        ProverType proverType;
        GameStatus status;
        uint256 createdAt;
        uint256 resolvedAt;
        uint256 bondAmount;
        address winner;
    }

    enum GameType {
        FAULT_DISPUTE,
        VALIDITY_DISPUTE
    }
    enum ProverType {
        CANNON,
        SIMPLE,
        ALTERNATIVE
    }
    enum GameStatus {
        PENDING,
        CHALLENGER_WINS,
        PROPOSER_WINS,
        TIMEOUT,
        CANCELLED
    }

    uint256 public constant MIN_BOND = 1 ether;
    uint256 public constant MAX_BOND = 100 ether;
    uint256 public constant GAME_TIMEOUT = 7 days;
    address public treasury;
    mapping(bytes32 => DisputeGame) public games;
    bytes32[] public gameIds;
    bytes32[] public activeGames;
    mapping(ProverType => address) public proverImplementations;
    mapping(ProverType => bool) public proverEnabled;
    uint256 public totalBondsLocked;

    event GameCreated(
        bytes32 indexed gameId,
        address indexed challenger,
        address indexed proposer,
        bytes32 stateRoot,
        GameType gameType,
        ProverType proverType,
        uint256 bondAmount
    );
    event GameResolved(bytes32 indexed gameId, GameStatus status, address indexed winner, uint256 bondAmount);
    event ProverImplementationUpdated(ProverType indexed proverType, address implementation, bool enabled);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    error GameNotFound();
    error GameAlreadyResolved();
    error InvalidBond();
    error InvalidProver();
    error ProverNotEnabled();
    error NotChallenger();
    error GameNotResolved();
    error InvalidTreasury();
    error InsufficientBond();

    constructor(address _treasury, address _owner) Ownable(_owner) {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
    }

    function createGame(
        address _proposer,
        bytes32 _stateRoot,
        bytes32 _claimRoot,
        GameType _gameType,
        ProverType _proverType
    ) external payable nonReentrant whenNotPaused returns (bytes32 gameId) {
        if (!proverEnabled[_proverType]) revert ProverNotEnabled();
        if (msg.value < MIN_BOND) revert InsufficientBond();
        if (msg.value > MAX_BOND) revert InvalidBond();

        gameId = keccak256(
            abi.encodePacked(
                msg.sender, _proposer, _stateRoot, _claimRoot, _gameType, _proverType, block.timestamp, block.number
            )
        );

        games[gameId] = DisputeGame({
            challenger: msg.sender,
            proposer: _proposer,
            stateRoot: _stateRoot,
            claimRoot: _claimRoot,
            gameType: _gameType,
            proverType: _proverType,
            status: GameStatus.PENDING,
            createdAt: block.timestamp,
            resolvedAt: 0,
            bondAmount: msg.value,
            winner: address(0)
        });

        gameIds.push(gameId);
        activeGames.push(gameId);
        totalBondsLocked += msg.value;

        emit GameCreated(gameId, msg.sender, _proposer, _stateRoot, _gameType, _proverType, msg.value);
    }

    function resolveChallengerWins(bytes32 _gameId, bytes calldata _proof) external nonReentrant {
        DisputeGame storage game = games[_gameId];
        if (game.challenger == address(0)) revert GameNotFound();
        if (game.status != GameStatus.PENDING) revert GameAlreadyResolved();

        address prover = proverImplementations[game.proverType];
        if (prover == address(0)) revert InvalidProver();
        if (!_verifyProof(prover, game.stateRoot, game.claimRoot, _proof)) revert GameNotResolved();

        game.status = GameStatus.CHALLENGER_WINS;
        game.winner = game.challenger;
        game.resolvedAt = block.timestamp;
        totalBondsLocked -= game.bondAmount;
        _removeFromActiveGames(_gameId);

        (bool success,) = game.challenger.call{value: game.bondAmount}("");
        if (!success) {
            (bool treasurySuccess,) = treasury.call{value: game.bondAmount}("");
            if (!treasurySuccess) revert();
        }

        emit GameResolved(_gameId, GameStatus.CHALLENGER_WINS, game.challenger, game.bondAmount);
    }

    function resolveProposerWins(bytes32 _gameId, bytes calldata _defenseProof) external nonReentrant {
        DisputeGame storage game = games[_gameId];
        if (game.challenger == address(0)) revert GameNotFound();
        if (game.status != GameStatus.PENDING) revert GameAlreadyResolved();

        address prover = proverImplementations[game.proverType];
        if (prover == address(0)) revert InvalidProver();
        if (!_verifyDefenseProof(prover, game.stateRoot, game.claimRoot, _defenseProof)) revert GameNotResolved();

        game.status = GameStatus.PROPOSER_WINS;
        game.winner = game.proposer;
        game.resolvedAt = block.timestamp;
        totalBondsLocked -= game.bondAmount;
        _removeFromActiveGames(_gameId);

        (bool success,) = treasury.call{value: game.bondAmount}("");
        if (!success) revert();

        emit GameResolved(_gameId, GameStatus.PROPOSER_WINS, game.proposer, game.bondAmount);
    }

    function resolveTimeout(bytes32 _gameId) external nonReentrant {
        DisputeGame storage game = games[_gameId];
        if (game.challenger == address(0)) revert GameNotFound();
        if (game.status != GameStatus.PENDING) revert GameAlreadyResolved();
        if (block.timestamp < game.createdAt + GAME_TIMEOUT) revert GameNotResolved();

        game.status = GameStatus.TIMEOUT;
        game.winner = game.proposer;
        game.resolvedAt = block.timestamp;
        totalBondsLocked -= game.bondAmount;
        _removeFromActiveGames(_gameId);

        (bool success,) = treasury.call{value: game.bondAmount}("");
        if (!success) revert();

        emit GameResolved(_gameId, GameStatus.TIMEOUT, game.proposer, game.bondAmount);
    }

    function getGame(bytes32 _gameId) external view returns (DisputeGame memory) {
        DisputeGame memory game = games[_gameId];
        if (game.challenger == address(0)) revert GameNotFound();
        return game;
    }

    function getAllGameIds() external view returns (bytes32[] memory ids) {
        return gameIds;
    }

    function getActiveGames() external view returns (bytes32[] memory ids) {
        return activeGames;
    }

    function canResolveTimeout(bytes32 _gameId) external view returns (bool) {
        DisputeGame memory game = games[_gameId];
        return game.challenger != address(0) && game.status == GameStatus.PENDING
            && block.timestamp >= game.createdAt + GAME_TIMEOUT;
    }

    function isGame(bytes32 _gameId) external view returns (bool) {
        return games[_gameId].challenger != address(0);
    }

    function getGameCount() external view returns (uint256) {
        return gameIds.length;
    }

    function getActiveGameCount() external view returns (uint256) {
        return activeGames.length;
    }

    function _verifyProof(address prover, bytes32 stateRoot, bytes32 claimRoot, bytes calldata proof)
        internal
        view
        returns (bool)
    {
        return IProver(prover).verifyProof(stateRoot, claimRoot, proof);
    }

    function _verifyDefenseProof(address prover, bytes32 stateRoot, bytes32 claimRoot, bytes calldata defenseProof)
        internal
        view
        returns (bool)
    {
        return IProver(prover).verifyDefenseProof(stateRoot, claimRoot, defenseProof);
    }

    function _removeFromActiveGames(bytes32 _gameId) internal {
        uint256 length = activeGames.length;
        for (uint256 i = 0; i < length; i++) {
            if (activeGames[i] == _gameId) {
                activeGames[i] = activeGames[length - 1];
                activeGames.pop();
                break;
            }
        }
    }

    function setProverImplementation(ProverType _proverType, address _implementation, bool _enabled)
        external
        onlyOwner
    {
        proverImplementations[_proverType] = _implementation;
        proverEnabled[_proverType] = _enabled;
        emit ProverImplementationUpdated(_proverType, _implementation, _enabled);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {}
}
