// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title StringUtils
 * @author Jeju Network
 * @notice Shared string utility functions used across contracts
 * @dev DRY library for string conversions - use this instead of duplicating
 */
library StringUtils {
    /**
     * @notice Convert uint256 to string
     * @param value Number to convert
     * @return String representation
     */
    function uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        
        return string(buffer);
    }

    /**
     * @notice Convert bytes32 to string (hex representation)
     * @param value Bytes32 to convert
     * @return String representation
     */
    function bytes32ToString(bytes32 value) internal pure returns (string memory) {
        bytes memory bytesArray = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            bytesArray[i * 2] = _toHexChar(b >> 4);
            bytesArray[i * 2 + 1] = _toHexChar(b & 0x0f);
        }
        return string(abi.encodePacked("0x", bytesArray));
    }

    /**
     * @notice Convert bytes32 to raw string (truncated at null)
     * @param value Bytes32 to convert
     * @return String representation
     */
    function bytes32ToRawString(bytes32 value) internal pure returns (string memory) {
        bytes memory bytesArray = new bytes(32);
        for (uint256 i = 0; i < 32; i++) {
            bytesArray[i] = value[i];
        }
        return string(bytesArray);
    }

    /**
     * @notice Convert address to string
     * @param addr Address to convert
     * @return String representation (0x prefixed)
     */
    function addressToString(address addr) internal pure returns (string memory) {
        bytes memory bytesArray = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(addr) >> (8 * (19 - i)));
            bytesArray[i * 2] = _toHexChar(b >> 4);
            bytesArray[i * 2 + 1] = _toHexChar(b & 0x0f);
        }
        return string(abi.encodePacked("0x", bytesArray));
    }

    /**
     * @notice Concatenate two strings
     * @param a First string
     * @param b Second string
     * @return Concatenated string
     */
    function concat(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }

    /**
     * @notice Concatenate three strings
     * @param a First string
     * @param b Second string
     * @param c Third string
     * @return Concatenated string
     */
    function concat3(string memory a, string memory b, string memory c) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b, c));
    }

    /**
     * @dev Convert nibble to hex character
     */
    function _toHexChar(uint8 b) private pure returns (bytes1) {
        if (b < 10) {
            return bytes1(b + 48); // '0' = 48
        }
        return bytes1(b + 87); // 'a' = 97, so 10 + 87 = 97
    }
}
