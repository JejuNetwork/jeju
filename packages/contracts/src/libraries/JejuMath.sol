// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title JejuMath
 * @author Jeju Network
 * @notice High-precision math library for prediction markets and AMMs
 * @dev Implements exp, ln, sqrt, and LMSR cost functions with 18-decimal precision
 */
library JejuMath {
    // ============ Constants ============

    /// @notice Fixed-point precision (18 decimals)
    uint256 internal constant PRECISION = 1e18;

    /// @notice ln(2) with 18 decimal precision
    uint256 internal constant LN_2 = 693147180559945309;

    /// @notice e with 18 decimal precision
    uint256 internal constant E = 2718281828459045235;

    /// @notice Maximum input for exp() to prevent overflow
    uint256 internal constant MAX_EXP_INPUT = 130e18;

    // ============ Errors ============

    error MathOverflow();
    error InvalidInput();
    error DivisionByZero();

    // ============ Exponential Functions ============

    /**
     * @notice Calculate e^x with 18-decimal precision
     * @param x Input value (18 decimals), must be <= 130e18
     * @return result e^x with 18 decimals
     * @dev Uses Taylor series: e^x = 1 + x + x^2/2! + x^3/3! + ...
     *      Accurate for x in [0, 10e18], approximation degrades for larger x
     */
    function exp(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) return PRECISION;
        if (x > MAX_EXP_INPUT) revert MathOverflow();

        // For large x, use identity: e^x = e^(x/2) * e^(x/2)
        if (x > 10e18) {
            uint256 halfExp = exp(x / 2);
            return (halfExp * halfExp) / PRECISION;
        }

        // Taylor series: e^x ≈ 1 + x + x^2/2! + x^3/3! + x^4/4! + x^5/5! + x^6/6!
        result = PRECISION;
        uint256 term = x;

        result += term;                                   // x^1/1!
        term = (term * x) / (2 * PRECISION);
        result += term;                                   // x^2/2!
        term = (term * x) / (3 * PRECISION);
        result += term;                                   // x^3/3!
        term = (term * x) / (4 * PRECISION);
        result += term;                                   // x^4/4!
        term = (term * x) / (5 * PRECISION);
        result += term;                                   // x^5/5!
        term = (term * x) / (6 * PRECISION);
        result += term;                                   // x^6/6!
        term = (term * x) / (7 * PRECISION);
        result += term;                                   // x^7/7!
        term = (term * x) / (8 * PRECISION);
        result += term;                                   // x^8/8!
    }

    /**
     * @notice Calculate natural logarithm ln(x) with 18-decimal precision
     * @param x Input value (18 decimals), must be >= PRECISION (x >= 1)
     * @return result ln(x) with 18 decimals
     * @dev Reverts for x < 1 since result would be negative (use lnSigned instead)
     *      Uses identity: ln(x) = k * ln(2) + ln(x / 2^k) where 2^k is chosen
     *      so that x / 2^k is in range [1, 2)
     */
    function ln(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) revert InvalidInput();
        if (x < PRECISION) revert InvalidInput(); // ln(x) < 0 for x < 1, use lnSigned
        if (x == PRECISION) return 0;

        // Use ln(x) = k * ln(2) + ln(x / 2^k)
        // Find k such that x / 2^k is in [1, 2)
        uint256 k = 0;
        uint256 scaled = x;
        
        // Scale down by powers of 2 until scaled < 2
        while (scaled >= 2 * PRECISION) {
            scaled = scaled / 2;
            k++;
        }
        
        // Now scaled is in [1, 2), use Taylor series for ln(scaled)
        // result = k * ln(2) + ln(scaled)
        result = k * LN_2 + _lnTaylorRange1to2(scaled);
    }
    
    /**
     * @notice Taylor series for ln(x) where x is in range [1, 2)
     * @dev Uses ln(1+y) = y - y²/2 + y³/3 - y⁴/4 + ... for y = x - 1
     *      Converges well for |y| < 1
     */
    function _lnTaylorRange1to2(uint256 x) private pure returns (uint256) {
        if (x == PRECISION) return 0;
        if (x >= 2 * PRECISION) revert InvalidInput();
        
        // y = x - 1, so y is in [0, 1)
        uint256 y = x - PRECISION;
        
        // Compute powers of y
        uint256 y2 = (y * y) / PRECISION;
        uint256 y3 = (y2 * y) / PRECISION;
        uint256 y4 = (y3 * y) / PRECISION;
        uint256 y5 = (y4 * y) / PRECISION;
        uint256 y6 = (y5 * y) / PRECISION;
        uint256 y7 = (y6 * y) / PRECISION;
        uint256 y8 = (y7 * y) / PRECISION;
        
        // ln(1+y) = y - y²/2 + y³/3 - y⁴/4 + y⁵/5 - y⁶/6 + y⁷/7 - y⁸/8
        uint256 positive = y + (y3 / 3) + (y5 / 5) + (y7 / 7);
        uint256 negative = (y2 / 2) + (y4 / 4) + (y6 / 6) + (y8 / 8);
        
        return positive > negative ? positive - negative : 0;
    }

    /**
     * @notice Calculate signed natural logarithm for any x > 0
     * @param x Input value (18 decimals), must be > 0
     * @return result Absolute value of ln(x)
     * @return isNegative True if result is negative (x < 1)
     * @dev For x < 1: |ln(x)| = ln(1/x), and isNegative = true
     */
    function lnSigned(uint256 x) internal pure returns (uint256 result, bool isNegative) {
        if (x == 0) revert InvalidInput();
        if (x == PRECISION) return (0, false);

        if (x >= PRECISION) {
            return (ln(x), false);
        } else {
            // x < 1: ln(x) = -ln(1/x), so compute ln(1/x) and flag negative
            uint256 invX = (PRECISION * PRECISION) / x;
            return (ln(invX), true);
        }
    }

    // ============ Square Root ============

    /**
     * @notice Calculate square root with 18-decimal precision
     * @param x Input value (18 decimals)
     * @return result sqrt(x) with 18 decimals
     * @dev Uses Babylonian method with bit-length based initial guess
     */
    function sqrt(uint256 x) internal pure returns (uint256 result) {
        if (x == 0) return 0;
        if (x == PRECISION) return PRECISION;

        // We want sqrt(x) where x has 18 decimals
        // sqrt(x) should also have 18 decimals
        // So we compute: sqrt(x * 1e18) which gives us the right precision
        
        uint256 scaled = x * PRECISION;
        
        // Initial guess: find the highest bit set and use 2^(highestBit/2)
        // This gives us a much better starting point than x itself
        uint256 xAux = scaled;
        result = 1;
        
        if (xAux >= 1 << 128) { xAux >>= 128; result <<= 64; }
        if (xAux >= 1 << 64) { xAux >>= 64; result <<= 32; }
        if (xAux >= 1 << 32) { xAux >>= 32; result <<= 16; }
        if (xAux >= 1 << 16) { xAux >>= 16; result <<= 8; }
        if (xAux >= 1 << 8) { xAux >>= 8; result <<= 4; }
        if (xAux >= 1 << 4) { xAux >>= 4; result <<= 2; }
        if (xAux >= 1 << 2) { result <<= 1; }
        
        // Babylonian method iterations (7 iterations is enough for 256-bit precision)
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;
        result = (result + scaled / result) >> 1;

        // Ensure we round down
        uint256 resultSquared = result * result;
        if (resultSquared > scaled) {
            result--;
        }
    }

    // ============ LMSR Functions ============

    /**
     * @notice LMSR cost function: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
     * @param qYes Quantity of YES shares
     * @param qNo Quantity of NO shares
     * @param b Liquidity parameter
     * @return cost Total cost in the same units as b
     * @dev This is the core function for prediction market pricing
     */
    function lmsrCost(uint256 qYes, uint256 qNo, uint256 b) internal pure returns (uint256 cost) {
        if (b == 0) revert DivisionByZero();

        // Calculate e^(q_yes/b) and e^(q_no/b)
        uint256 expYes = exp((qYes * PRECISION) / b);
        uint256 expNo = exp((qNo * PRECISION) / b);
        uint256 sum = expYes + expNo;

        // C = b * ln(sum)
        cost = (b * ln(sum)) / PRECISION;
    }

    /**
     * @notice Calculate LMSR price for an outcome
     * @param qYes Quantity of YES shares
     * @param qNo Quantity of NO shares
     * @param b Liquidity parameter
     * @param forYes True to get YES price, false for NO price
     * @return price Price in basis points (10000 = 100%)
     * @dev P(YES) = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
     */
    function lmsrPrice(uint256 qYes, uint256 qNo, uint256 b, bool forYes) internal pure returns (uint256 price) {
        if (b == 0) revert DivisionByZero();

        uint256 expYes = exp((qYes * PRECISION) / b);
        uint256 expNo = exp((qNo * PRECISION) / b);
        uint256 sum = expYes + expNo;

        if (forYes) {
            price = (expYes * 10000) / sum;
        } else {
            price = (expNo * 10000) / sum;
        }
    }

    /**
     * @notice Calculate shares received for a given cost
     * @param qYes Current YES shares
     * @param qNo Current NO shares
     * @param b Liquidity parameter
     * @param cost Cost to spend
     * @param buyYes True if buying YES, false for NO
     * @return shares Number of shares received
     * @dev Uses binary search to find shares that match the cost
     *      Upper bound: At minimum price (near 0), cost ≈ shares * minPrice
     *      So max shares ≈ cost / minPrice ≈ cost * 100 (for 1% min price)
     *      We use b * ln(e^(cost/b)) as a tighter bound when possible
     */
    function lmsrSharesForCost(
        uint256 qYes,
        uint256 qNo,
        uint256 b,
        uint256 cost,
        bool buyYes
    ) internal pure returns (uint256 shares) {
        if (cost == 0) return 0;
        if (b == 0) revert DivisionByZero();

        uint256 costBefore = lmsrCost(qYes, qNo, b);
        uint256 targetCost = costBefore + cost;

        // Upper bound estimation:
        // In LMSR, buying shares increases cost. The cheapest case is when 
        // the outcome has probability near 0, where price ≈ 0.
        // A reasonable upper bound is cost * b / PRECISION when prices are low,
        // or cost * 100 as a safe maximum (assumes min price > 1%)
        uint256 upperBound = (cost * b) / PRECISION;
        if (upperBound < cost) upperBound = cost; // Handle small b
        uint256 high = upperBound > cost * 100 ? cost * 100 : upperBound * 2;
        if (high == 0) high = cost;

        uint256 low = 0;

        // Binary search with max 256 iterations (log2 of max uint256)
        for (uint256 i = 0; i < 256 && low < high; i++) {
            uint256 mid = (low + high + 1) / 2;
            uint256 newQYes = buyYes ? qYes + mid : qYes;
            uint256 newQNo = buyYes ? qNo : qNo + mid;
            uint256 costAfter = lmsrCost(newQYes, newQNo, b);

            if (costAfter <= targetCost) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        shares = low;
    }

    // ============ Utility Functions ============

    /**
     * @notice Multiply then divide with full precision
     * @param a First multiplicand
     * @param b Second multiplicand
     * @param denominator Divisor
     * @return result a * b / denominator
     */
    function mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        if (denominator == 0) revert DivisionByZero();
        
        // Use assembly for 512-bit precision multiplication
        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        if (prod1 == 0) {
            return prod0 / denominator;
        }

        // Handle 512-bit division
        assembly {
            let remainder := mulmod(a, b, denominator)
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)

            let twos := and(sub(0, denominator), denominator)
            denominator := div(denominator, twos)
            prod0 := div(prod0, twos)

            twos := add(div(sub(0, twos), twos), 1)
            prod0 := or(prod0, mul(prod1, twos))

            let inv := mul(3, denominator)
            inv := mul(inv, sub(2, mul(denominator, inv)))
            inv := mul(inv, sub(2, mul(denominator, inv)))
            inv := mul(inv, sub(2, mul(denominator, inv)))
            inv := mul(inv, sub(2, mul(denominator, inv)))
            inv := mul(inv, sub(2, mul(denominator, inv)))
            inv := mul(inv, sub(2, mul(denominator, inv)))

            result := mul(prod0, inv)
        }
    }

    /**
     * @notice Calculate percentage with basis points
     * @param value Base value
     * @param bps_ Basis points (10000 = 100%)
     * @return result value * bps / 10000
     */
    function bps(uint256 value, uint256 bps_) internal pure returns (uint256 result) {
        return (value * bps_) / 10000;
    }

    /**
     * @notice Calculate absolute difference
     * @param a First value
     * @param b Second value
     * @return diff |a - b|
     */
    function absDiff(uint256 a, uint256 b) internal pure returns (uint256 diff) {
        return a >= b ? a - b : b - a;
    }
}

