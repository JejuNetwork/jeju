// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IOTCDesk {
    enum PaymentCurrency {
        ETH,
        USDC
    }

    function createOffer(uint256 tokenAmount, uint256 discountBps, PaymentCurrency currency, uint256 lockupSeconds)
        external
        returns (uint256 offerId);
    function fulfillOffer(uint256 offerId) external payable;
    function cancelOffer(uint256 offerId) external;
}

contract ReentrantAttacker {
    IOTCDesk public immutable desk;
    uint256 public targetOfferId;

    constructor(IOTCDesk desk_) {
        desk = desk_;
    }

    function makeOffer(uint256 tokenAmount) external returns (uint256) {
        // Create ETH-denominated offer with zero lockup
        uint256 id = desk.createOffer(tokenAmount, 0, IOTCDesk.PaymentCurrency.ETH, 0);
        targetOfferId = id;
        return id;
    }

    function payWithExcess(uint256 offerId, uint256 requiredWei, uint256 extraWei) external payable {
        require(msg.value == requiredWei + extraWei, "bad value");
        targetOfferId = offerId;
        desk.fulfillOffer{value: msg.value}(offerId);
    }

    receive() external payable {
        // Attempt to reenter into cancelOffer (should fail due to nonReentrant)
        try desk.cancelOffer(targetOfferId) {
            // no-op
        } catch {
            // swallow
        }
    }

    function withdraw() external {
        payable(msg.sender).transfer(address(this).balance);
    }
}
