// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IOAuth3AppRegistry, IOAuth3IdentityRegistry} from "./IOAuth3.sol";

/**
 * @title OAuth3AppRegistry
 * @notice Multi-tenant OAuth3 application registry
 * @dev Allows anyone to register OAuth apps managed by their DAO/Board
 */
contract OAuth3AppRegistry is IOAuth3AppRegistry {
    address public identityRegistry;
    address public teeVerifier;
    uint256 public totalApps;

    mapping(bytes32 => App) private apps;
    mapping(bytes32 => AppConfig) private appConfigs;
    mapping(bytes32 => AppCredentials) private appCredentials;
    mapping(bytes32 => bytes32) private clientIdToApp;
    mapping(address => bytes32[]) private ownerApps;
    mapping(address => bytes32[]) private boardApps;

    modifier onlyAppOwner(bytes32 appId) {
        require(apps[appId].owner == msg.sender, "Not app owner");
        _;
    }

    modifier appExists(bytes32 appId) {
        require(apps[appId].createdAt > 0, "App not found");
        _;
    }

    modifier appActive(bytes32 appId) {
        require(apps[appId].active, "App not active");
        _;
    }

    constructor(address _identityRegistry, address _teeVerifier) {
        identityRegistry = _identityRegistry;
        teeVerifier = _teeVerifier;
    }

    function registerApp(string calldata name, string calldata description, address board, AppConfig calldata config)
        external
        returns (bytes32 appId)
    {
        require(bytes(name).length > 0, "Name required");
        require(config.redirectUris.length > 0, "Redirect URIs required");

        appId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp, block.chainid, totalApps));

        apps[appId] = App({
            appId: appId,
            name: name,
            description: description,
            owner: msg.sender,
            board: board,
            createdAt: block.timestamp,
            active: true
        });

        appConfigs[appId] = config;

        bytes32 clientId = _generateClientId(appId);
        bytes32 clientSecretHash = _generateClientSecretHash(appId, block.timestamp);

        appCredentials[appId] = AppCredentials({clientId: clientId, clientSecretHash: clientSecretHash});

        clientIdToApp[clientId] = appId;
        ownerApps[msg.sender].push(appId);

        if (board != address(0)) {
            boardApps[board].push(appId);
        }

        totalApps++;

        emit AppRegistered(appId, msg.sender, board, name, block.timestamp);
    }

    function updateApp(bytes32 appId, string calldata name, string calldata description, AppConfig calldata config)
        external
        appExists(appId)
        onlyAppOwner(appId)
    {
        require(bytes(name).length > 0, "Name required");
        require(config.redirectUris.length > 0, "Redirect URIs required");

        apps[appId].name = name;
        apps[appId].description = description;
        appConfigs[appId] = config;

        emit AppUpdated(appId, block.timestamp);
    }

    function rotateCredentials(bytes32 appId)
        external
        appExists(appId)
        onlyAppOwner(appId)
        returns (bytes32 newClientId)
    {
        bytes32 oldClientId = appCredentials[appId].clientId;
        delete clientIdToApp[oldClientId];

        newClientId = _generateClientId(appId);
        bytes32 newSecretHash = _generateClientSecretHash(appId, block.timestamp);

        appCredentials[appId] = AppCredentials({clientId: newClientId, clientSecretHash: newSecretHash});

        clientIdToApp[newClientId] = appId;

        emit AppCredentialsRotated(appId, newClientId, block.timestamp);
    }

    function deactivateApp(bytes32 appId) external appExists(appId) onlyAppOwner(appId) {
        apps[appId].active = false;
        emit AppDeactivated(appId, block.timestamp);
    }

    function reactivateApp(bytes32 appId) external appExists(appId) onlyAppOwner(appId) {
        apps[appId].active = true;
        emit AppUpdated(appId, block.timestamp);
    }

    function transferApp(bytes32 appId, address newOwner) external appExists(appId) onlyAppOwner(appId) {
        require(newOwner != address(0), "Invalid new owner");

        address previousOwner = apps[appId].owner;

        _removeFromOwnerApps(previousOwner, appId);
        ownerApps[newOwner].push(appId);
        apps[appId].owner = newOwner;

        emit AppUpdated(appId, block.timestamp);
    }

    function updateBoard(bytes32 appId, address newBoard) external appExists(appId) onlyAppOwner(appId) {
        address previousBoard = apps[appId].board;

        if (previousBoard != address(0)) {
            _removeFromBoardApps(previousBoard, appId);
        }

        if (newBoard != address(0)) {
            boardApps[newBoard].push(appId);
        }

        apps[appId].board = newBoard;
        emit AppUpdated(appId, block.timestamp);
    }

    function getApp(bytes32 appId) external view returns (App memory) {
        return apps[appId];
    }

    function getAppConfig(bytes32 appId) external view returns (AppConfig memory) {
        return appConfigs[appId];
    }

    function getAppCredentials(bytes32 appId) external view returns (AppCredentials memory) {
        require(msg.sender == apps[appId].owner || msg.sender == teeVerifier, "Unauthorized");
        return appCredentials[appId];
    }

    function getAppByClientId(bytes32 clientId) external view returns (App memory) {
        return apps[clientIdToApp[clientId]];
    }

    function getAppsByOwner(address owner) external view returns (bytes32[] memory) {
        return ownerApps[owner];
    }

    function getAppsByBoard(address board) external view returns (bytes32[] memory) {
        return boardApps[board];
    }

    function validateRedirectUri(bytes32 appId, string calldata uri) external view returns (bool) {
        string[] storage uris = appConfigs[appId].redirectUris;
        bytes32 uriHash = keccak256(bytes(uri));

        for (uint256 i = 0; i < uris.length; i++) {
            if (keccak256(bytes(uris[i])) == uriHash) {
                return true;
            }
        }
        return false;
    }

    function isProviderAllowed(bytes32 appId, IOAuth3IdentityRegistry.AuthProvider provider)
        external
        view
        returns (bool)
    {
        IOAuth3IdentityRegistry.AuthProvider[] storage providers = appConfigs[appId].allowedProviders;

        if (providers.length == 0) {
            return true;
        }

        for (uint256 i = 0; i < providers.length; i++) {
            if (providers[i] == provider) {
                return true;
            }
        }
        return false;
    }

    function verifyClientSecret(bytes32 appId, bytes32 secretHash) external view returns (bool) {
        return appCredentials[appId].clientSecretHash == secretHash;
    }

    function _generateClientId(bytes32 appId) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("oauth3_client", appId, block.timestamp, block.prevrandao));
    }

    function _generateClientSecretHash(bytes32 appId, uint256 timestamp) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("oauth3_secret", appId, timestamp, block.prevrandao, msg.sender));
    }

    function _removeFromOwnerApps(address owner, bytes32 appId) internal {
        bytes32[] storage appList = ownerApps[owner];
        for (uint256 i = 0; i < appList.length; i++) {
            if (appList[i] == appId) {
                appList[i] = appList[appList.length - 1];
                appList.pop();
                break;
            }
        }
    }

    function _removeFromBoardApps(address board, bytes32 appId) internal {
        bytes32[] storage appList = boardApps[board];
        for (uint256 i = 0; i < appList.length; i++) {
            if (appList[i] == appId) {
                appList[i] = appList[appList.length - 1];
                appList.pop();
                break;
            }
        }
    }
}
