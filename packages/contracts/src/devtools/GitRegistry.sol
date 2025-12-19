// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GitRegistry
 * @notice On-chain registry for decentralized Git repositories (JejuGit)
 * @dev Stores repository metadata with IPFS/Arweave content IDs for data permanence
 * 
 * Features:
 * - Repository registration and discovery
 * - Contributor management
 * - Star/fork tracking
 * - ERC-8004 reputation integration
 * - Council proposal linking
 */
contract GitRegistry is Ownable, ReentrancyGuard {
    
    // Repository visibility levels
    enum Visibility { Public, Private, Internal }
    
    // Repository record
    struct Repository {
        string name;
        address owner;
        string description;
        Visibility visibility;
        string defaultBranch;
        string headCid;         // IPFS/Arweave CID of HEAD
        string packCid;         // IPFS/Arweave CID of pack file
        uint256 createdAt;
        uint256 updatedAt;
        uint256 pushedAt;
        uint256 starCount;
        uint256 forkCount;
        uint256 cloneCount;
        bytes32 forkedFrom;     // Repository ID of parent fork
        uint256 reputationScore;
        uint256 councilProposalId;
        bool verified;
        bool archived;
    }
    
    // Issue record
    struct Issue {
        uint256 number;
        string title;
        address author;
        string state;           // "open", "closed"
        string cid;             // IPFS/Arweave CID of issue data
        uint256 createdAt;
        uint256 closedAt;
    }
    
    // Pull request record
    struct PullRequest {
        uint256 number;
        string title;
        address author;
        string sourceBranch;
        string targetBranch;
        string state;           // "open", "closed", "merged"
        string cid;
        uint256 createdAt;
        uint256 mergedAt;
        address mergedBy;
    }
    
    // Branch/tag reference
    struct GitRef {
        string name;
        string sha;
        string cid;
        uint256 updatedAt;
    }
    
    // Storage
    mapping(bytes32 => Repository) public repositories;
    mapping(bytes32 => mapping(uint256 => Issue)) public issues;
    mapping(bytes32 => mapping(uint256 => PullRequest)) public pullRequests;
    mapping(bytes32 => mapping(string => GitRef)) public branches;
    mapping(bytes32 => mapping(string => GitRef)) public tags;
    mapping(bytes32 => mapping(address => bool)) public contributors;
    mapping(bytes32 => address[]) public contributorList;
    mapping(bytes32 => uint256) public issueCount;
    mapping(bytes32 => uint256) public prCount;
    mapping(address => mapping(bytes32 => bool)) public stars;
    mapping(address => bytes32[]) public userRepositories;
    mapping(address => bytes32[]) public userStars;
    mapping(string => bytes32) public nameToRepo;  // "owner/name" -> repoId
    
    // ERC-8004 integration
    address public reputationRegistry;
    
    // Events
    event RepositoryCreated(bytes32 indexed repoId, address indexed owner, string name);
    event RepositoryUpdated(bytes32 indexed repoId, string headCid);
    event RepositoryForked(bytes32 indexed repoId, bytes32 indexed parentId, address indexed owner);
    event RepositoryStarred(bytes32 indexed repoId, address indexed user);
    event RepositoryUnstarred(bytes32 indexed repoId, address indexed user);
    event ContributorAdded(bytes32 indexed repoId, address indexed contributor);
    event ContributorRemoved(bytes32 indexed repoId, address indexed contributor);
    event IssueCreated(bytes32 indexed repoId, uint256 indexed number, address indexed author);
    event IssueClosed(bytes32 indexed repoId, uint256 indexed number);
    event PullRequestCreated(bytes32 indexed repoId, uint256 indexed number, address indexed author);
    event PullRequestMerged(bytes32 indexed repoId, uint256 indexed number, address indexed mergedBy);
    event RefUpdated(bytes32 indexed repoId, string refType, string name, string sha);
    event CouncilProposalLinked(bytes32 indexed repoId, uint256 proposalId);
    
    constructor(address _reputationRegistry) Ownable(msg.sender) {
        reputationRegistry = _reputationRegistry;
    }
    
    // Repository Management
    
    function createRepository(
        string calldata name,
        string calldata description,
        Visibility visibility,
        string calldata defaultBranch
    ) external returns (bytes32 repoId) {
        require(bytes(name).length > 0 && bytes(name).length <= 100, "Invalid name");
        
        string memory fullName = string(abi.encodePacked(addressToString(msg.sender), "/", name));
        require(nameToRepo[fullName] == bytes32(0), "Repository exists");
        
        repoId = keccak256(abi.encodePacked(msg.sender, name, block.timestamp));
        
        repositories[repoId] = Repository({
            name: name,
            owner: msg.sender,
            description: description,
            visibility: visibility,
            defaultBranch: defaultBranch,
            headCid: "",
            packCid: "",
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            pushedAt: 0,
            starCount: 0,
            forkCount: 0,
            cloneCount: 0,
            forkedFrom: bytes32(0),
            reputationScore: 0,
            councilProposalId: 0,
            verified: false,
            archived: false
        });
        
        contributors[repoId][msg.sender] = true;
        contributorList[repoId].push(msg.sender);
        userRepositories[msg.sender].push(repoId);
        nameToRepo[fullName] = repoId;
        
        emit RepositoryCreated(repoId, msg.sender, name);
    }
    
    function updateRepository(
        bytes32 repoId,
        string calldata description,
        Visibility visibility,
        string calldata defaultBranch
    ) external {
        Repository storage repo = repositories[repoId];
        require(repo.owner == msg.sender, "Not owner");
        require(!repo.archived, "Archived");
        
        repo.description = description;
        repo.visibility = visibility;
        repo.defaultBranch = defaultBranch;
        repo.updatedAt = block.timestamp;
        
        emit RepositoryUpdated(repoId, repo.headCid);
    }
    
    function pushUpdate(
        bytes32 repoId,
        string calldata headCid,
        string calldata packCid
    ) external {
        Repository storage repo = repositories[repoId];
        require(contributors[repoId][msg.sender], "Not contributor");
        require(!repo.archived, "Archived");
        
        repo.headCid = headCid;
        repo.packCid = packCid;
        repo.pushedAt = block.timestamp;
        repo.updatedAt = block.timestamp;
        
        emit RepositoryUpdated(repoId, headCid);
    }
    
    function updateRef(
        bytes32 repoId,
        string calldata refType,
        string calldata name,
        string calldata sha,
        string calldata cid
    ) external {
        require(contributors[repoId][msg.sender], "Not contributor");
        
        GitRef memory ref = GitRef({
            name: name,
            sha: sha,
            cid: cid,
            updatedAt: block.timestamp
        });
        
        if (keccak256(bytes(refType)) == keccak256(bytes("branch"))) {
            branches[repoId][name] = ref;
        } else if (keccak256(bytes(refType)) == keccak256(bytes("tag"))) {
            tags[repoId][name] = ref;
        }
        
        repositories[repoId].updatedAt = block.timestamp;
        
        emit RefUpdated(repoId, refType, name, sha);
    }
    
    // Forking
    
    function forkRepository(bytes32 parentId) external returns (bytes32 repoId) {
        Repository storage parent = repositories[parentId];
        require(parent.owner != address(0), "Parent not found");
        require(parent.visibility == Visibility.Public, "Cannot fork private repo");
        
        repoId = keccak256(abi.encodePacked(msg.sender, parent.name, block.timestamp));
        
        repositories[repoId] = Repository({
            name: parent.name,
            owner: msg.sender,
            description: parent.description,
            visibility: Visibility.Public,
            defaultBranch: parent.defaultBranch,
            headCid: parent.headCid,
            packCid: parent.packCid,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            pushedAt: 0,
            starCount: 0,
            forkCount: 0,
            cloneCount: 0,
            forkedFrom: parentId,
            reputationScore: 0,
            councilProposalId: 0,
            verified: false,
            archived: false
        });
        
        contributors[repoId][msg.sender] = true;
        contributorList[repoId].push(msg.sender);
        userRepositories[msg.sender].push(repoId);
        parent.forkCount++;
        
        string memory fullName = string(abi.encodePacked(addressToString(msg.sender), "/", parent.name));
        nameToRepo[fullName] = repoId;
        
        emit RepositoryForked(repoId, parentId, msg.sender);
    }
    
    // Stars
    
    function starRepository(bytes32 repoId) external {
        require(repositories[repoId].owner != address(0), "Not found");
        require(!stars[msg.sender][repoId], "Already starred");
        
        stars[msg.sender][repoId] = true;
        userStars[msg.sender].push(repoId);
        repositories[repoId].starCount++;
        
        emit RepositoryStarred(repoId, msg.sender);
    }
    
    function unstarRepository(bytes32 repoId) external {
        require(stars[msg.sender][repoId], "Not starred");
        
        stars[msg.sender][repoId] = false;
        repositories[repoId].starCount--;
        
        // Remove from userStars array
        bytes32[] storage userStarList = userStars[msg.sender];
        for (uint256 i = 0; i < userStarList.length; i++) {
            if (userStarList[i] == repoId) {
                userStarList[i] = userStarList[userStarList.length - 1];
                userStarList.pop();
                break;
            }
        }
        
        emit RepositoryUnstarred(repoId, msg.sender);
    }
    
    // Contributors
    
    function addContributor(bytes32 repoId, address contributor) external {
        require(repositories[repoId].owner == msg.sender, "Not owner");
        require(!contributors[repoId][contributor], "Already contributor");
        
        contributors[repoId][contributor] = true;
        contributorList[repoId].push(contributor);
        
        emit ContributorAdded(repoId, contributor);
    }
    
    function removeContributor(bytes32 repoId, address contributor) external {
        require(repositories[repoId].owner == msg.sender, "Not owner");
        require(contributor != msg.sender, "Cannot remove owner");
        require(contributors[repoId][contributor], "Not contributor");
        
        contributors[repoId][contributor] = false;
        
        // Remove from contributorList
        address[] storage list = contributorList[repoId];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == contributor) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        
        emit ContributorRemoved(repoId, contributor);
    }
    
    // Issues
    
    function createIssue(
        bytes32 repoId,
        string calldata title,
        string calldata cid
    ) external returns (uint256 number) {
        require(repositories[repoId].owner != address(0), "Not found");
        
        number = ++issueCount[repoId];
        
        issues[repoId][number] = Issue({
            number: number,
            title: title,
            author: msg.sender,
            state: "open",
            cid: cid,
            createdAt: block.timestamp,
            closedAt: 0
        });
        
        emit IssueCreated(repoId, number, msg.sender);
    }
    
    function closeIssue(bytes32 repoId, uint256 number) external {
        Issue storage issue = issues[repoId][number];
        require(
            issue.author == msg.sender || 
            repositories[repoId].owner == msg.sender ||
            contributors[repoId][msg.sender],
            "Not authorized"
        );
        
        issue.state = "closed";
        issue.closedAt = block.timestamp;
        
        emit IssueClosed(repoId, number);
    }
    
    // Pull Requests
    
    function createPullRequest(
        bytes32 repoId,
        string calldata title,
        string calldata sourceBranch,
        string calldata targetBranch,
        string calldata cid
    ) external returns (uint256 number) {
        require(repositories[repoId].owner != address(0), "Not found");
        
        number = ++prCount[repoId];
        
        pullRequests[repoId][number] = PullRequest({
            number: number,
            title: title,
            author: msg.sender,
            sourceBranch: sourceBranch,
            targetBranch: targetBranch,
            state: "open",
            cid: cid,
            createdAt: block.timestamp,
            mergedAt: 0,
            mergedBy: address(0)
        });
        
        emit PullRequestCreated(repoId, number, msg.sender);
    }
    
    function mergePullRequest(bytes32 repoId, uint256 number) external {
        require(
            repositories[repoId].owner == msg.sender ||
            contributors[repoId][msg.sender],
            "Not authorized"
        );
        
        PullRequest storage pr = pullRequests[repoId][number];
        require(keccak256(bytes(pr.state)) == keccak256(bytes("open")), "Not open");
        
        pr.state = "merged";
        pr.mergedAt = block.timestamp;
        pr.mergedBy = msg.sender;
        
        // Add PR author as contributor if not already
        if (!contributors[repoId][pr.author]) {
            contributors[repoId][pr.author] = true;
            contributorList[repoId].push(pr.author);
            emit ContributorAdded(repoId, pr.author);
        }
        
        emit PullRequestMerged(repoId, number, msg.sender);
    }
    
    // Council Integration
    
    function linkCouncilProposal(bytes32 repoId, uint256 proposalId) external {
        require(
            repositories[repoId].owner == msg.sender ||
            msg.sender == owner(),
            "Not authorized"
        );
        
        repositories[repoId].councilProposalId = proposalId;
        
        emit CouncilProposalLinked(repoId, proposalId);
    }
    
    // ERC-8004 Integration
    
    function updateReputationScore(bytes32 repoId, uint256 score) external {
        require(
            msg.sender == reputationRegistry || 
            msg.sender == owner(),
            "Not authorized"
        );
        
        repositories[repoId].reputationScore = score;
    }
    
    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        reputationRegistry = _reputationRegistry;
    }
    
    // Verification
    
    function verifyRepository(bytes32 repoId) external onlyOwner {
        repositories[repoId].verified = true;
    }
    
    // Archive
    
    function archiveRepository(bytes32 repoId) external {
        require(repositories[repoId].owner == msg.sender, "Not owner");
        repositories[repoId].archived = true;
    }
    
    // Views
    
    function getRepository(bytes32 repoId) external view returns (Repository memory) {
        return repositories[repoId];
    }
    
    function getRepositoryByName(string calldata fullName) external view returns (Repository memory) {
        bytes32 repoId = nameToRepo[fullName];
        return repositories[repoId];
    }
    
    function getContributors(bytes32 repoId) external view returns (address[] memory) {
        return contributorList[repoId];
    }
    
    function getUserRepositories(address user) external view returns (bytes32[] memory) {
        return userRepositories[user];
    }
    
    function getUserStars(address user) external view returns (bytes32[] memory) {
        return userStars[user];
    }
    
    function isContributor(bytes32 repoId, address user) external view returns (bool) {
        return contributors[repoId][user];
    }
    
    // Helper
    
    function addressToString(address addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = abi.encodePacked(addr);
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}



