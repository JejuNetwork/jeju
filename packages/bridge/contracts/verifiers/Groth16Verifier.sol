// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IGroth16Verifier.sol";

/**
 * @title Groth16Verifier
 * @notice Groth16 proof verifier using BN254 pairing
 * @dev Optimized for SP1 proofs of Solana/Ethereum consensus
 *
 * The verification key is embedded at deployment time and cannot be changed.
 * This ensures the contract can only verify proofs for the intended circuit.
 */
contract Groth16Verifier is IGroth16Verifier {
    // =============================================================================
    // CONSTANTS - BN254 Curve Parameters
    // =============================================================================

    uint256 private constant PRIME_Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    uint256 private constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // =============================================================================
    // VERIFICATION KEY (Set at deployment)
    // =============================================================================

    // G1 points
    uint256 public immutable vk_alpha_x;
    uint256 public immutable vk_alpha_y;

    // G2 points (each point has 2 components, each component has 2 parts)
    uint256 public immutable vk_beta_x1;
    uint256 public immutable vk_beta_x2;
    uint256 public immutable vk_beta_y1;
    uint256 public immutable vk_beta_y2;

    uint256 public immutable vk_gamma_x1;
    uint256 public immutable vk_gamma_x2;
    uint256 public immutable vk_gamma_y1;
    uint256 public immutable vk_gamma_y2;

    uint256 public immutable vk_delta_x1;
    uint256 public immutable vk_delta_x2;
    uint256 public immutable vk_delta_y1;
    uint256 public immutable vk_delta_y2;

    // IC (input commitment) points - stored as array
    uint256[] public vk_ic;

    // Verification key hash for identity
    bytes32 public immutable verificationKeyHash;

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    constructor(
        uint256[2] memory alpha,
        uint256[4] memory beta,
        uint256[4] memory gamma,
        uint256[4] memory delta,
        uint256[] memory ic
    ) {
        require(ic.length >= 2, "IC must have at least 2 elements");
        require(ic.length % 2 == 0, "IC must have even length");

        vk_alpha_x = alpha[0];
        vk_alpha_y = alpha[1];

        vk_beta_x1 = beta[0];
        vk_beta_x2 = beta[1];
        vk_beta_y1 = beta[2];
        vk_beta_y2 = beta[3];

        vk_gamma_x1 = gamma[0];
        vk_gamma_x2 = gamma[1];
        vk_gamma_y1 = gamma[2];
        vk_gamma_y2 = gamma[3];

        vk_delta_x1 = delta[0];
        vk_delta_x2 = delta[1];
        vk_delta_y1 = delta[2];
        vk_delta_y2 = delta[3];

        vk_ic = ic;

        // Compute verification key hash
        verificationKeyHash = keccak256(abi.encodePacked(alpha, beta, gamma, delta, ic));
    }

    // =============================================================================
    // VERIFICATION
    // =============================================================================

    /**
     * @notice Verify a Groth16 proof
     * @dev Uses the bn256Add, bn256ScalarMul, and bn256Pairing precompiles
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        require(publicInputs.length == (vk_ic.length / 2) - 1, "Invalid public inputs length");

        // Validate inputs are in field
        for (uint256 i = 0; i < publicInputs.length; i++) {
            require(publicInputs[i] < SNARK_SCALAR_FIELD, "Public input too large");
        }

        // Compute the linear combination of public inputs
        // vk_x = vk_ic[0] + sum(publicInputs[i] * vk_ic[i+1])
        uint256[2] memory vk_x = [vk_ic[0], vk_ic[1]];

        for (uint256 i = 0; i < publicInputs.length; i++) {
            uint256[2] memory ic_point = [vk_ic[(i + 1) * 2], vk_ic[(i + 1) * 2 + 1]];

            // Scalar multiplication
            uint256[2] memory scaled = _bn256ScalarMul(ic_point, publicInputs[i]);

            // Point addition
            vk_x = _bn256Add(vk_x, scaled);
        }

        // Pairing check:
        // e(A, B) * e(-alpha, beta) * e(-vk_x, gamma) * e(-C, delta) == 1
        return
            _pairing(
                _negate(a),
                b,
                [vk_alpha_x, vk_alpha_y],
                [[vk_beta_x2, vk_beta_x1], [vk_beta_y2, vk_beta_y1]],
                _negate(vk_x),
                [[vk_gamma_x2, vk_gamma_x1], [vk_gamma_y2, vk_gamma_y1]],
                _negate(c),
                [[vk_delta_x2, vk_delta_x1], [vk_delta_y2, vk_delta_y1]]
            );
    }

    function getVerificationKeyHash() external view override returns (bytes32) {
        return verificationKeyHash;
    }

    // =============================================================================
    // PRECOMPILE WRAPPERS
    // =============================================================================

    function _bn256Add(
        uint256[2] memory p1,
        uint256[2] memory p2
    ) internal view returns (uint256[2] memory r) {
        uint256[4] memory input;
        input[0] = p1[0];
        input[1] = p1[1];
        input[2] = p2[0];
        input[3] = p2[1];

        bool success;
        assembly {
            success := staticcall(gas(), 0x06, input, 0x80, r, 0x40)
        }
        require(success, "bn256Add failed");
    }

    function _bn256ScalarMul(
        uint256[2] memory p,
        uint256 s
    ) internal view returns (uint256[2] memory r) {
        uint256[3] memory input;
        input[0] = p[0];
        input[1] = p[1];
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 0x07, input, 0x60, r, 0x40)
        }
        require(success, "bn256ScalarMul failed");
    }

    function _negate(uint256[2] memory p) internal pure returns (uint256[2] memory) {
        if (p[0] == 0 && p[1] == 0) {
            return p;
        }
        return [p[0], PRIME_Q - (p[1] % PRIME_Q)];
    }

    function _pairing(
        uint256[2] memory a1,
        uint256[2][2] memory b1,
        uint256[2] memory a2,
        uint256[2][2] memory b2,
        uint256[2] memory a3,
        uint256[2][2] memory b3,
        uint256[2] memory a4,
        uint256[2][2] memory b4
    ) internal view returns (bool) {
        uint256[24] memory input;

        input[0] = a1[0];
        input[1] = a1[1];
        input[2] = b1[0][0];
        input[3] = b1[0][1];
        input[4] = b1[1][0];
        input[5] = b1[1][1];

        input[6] = a2[0];
        input[7] = a2[1];
        input[8] = b2[0][0];
        input[9] = b2[0][1];
        input[10] = b2[1][0];
        input[11] = b2[1][1];

        input[12] = a3[0];
        input[13] = a3[1];
        input[14] = b3[0][0];
        input[15] = b3[0][1];
        input[16] = b3[1][0];
        input[17] = b3[1][1];

        input[18] = a4[0];
        input[19] = a4[1];
        input[20] = b4[0][0];
        input[21] = b4[0][1];
        input[22] = b4[1][0];
        input[23] = b4[1][1];

        uint256[1] memory out;
        bool success;
        assembly {
            success := staticcall(gas(), 0x08, input, 0x300, out, 0x20)
        }
        require(success, "pairing check failed");
        return out[0] == 1;
    }
}
