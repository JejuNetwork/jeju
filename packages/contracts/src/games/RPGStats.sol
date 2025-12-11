// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title RPGStats
 * @author Jeju Network
 * @notice Library for common RPG stat calculations
 * @dev Provides reusable functions for:
 *      - XP to level conversion (RuneScape-style exponential curve)
 *      - Combat damage calculations
 *      - Hit chance calculations
 *      - Skill level requirements
 * 
 * Used by Gold.sol, Items.sol, and MUD game contracts.
 * 
 * @custom:security-contact security@jeju.network
 */
library RPGStats {
    
    // ============ Constants ============
    
    /// @notice Maximum skill level
    uint8 public constant MAX_LEVEL = 99;
    
    /// @notice XP required for level 99
    uint32 public constant MAX_XP = 13034431;
    
    /// @notice Base damage multiplier (scaled by 100)
    uint16 public constant DAMAGE_MULTIPLIER = 100;
    
    // ============ XP & Leveling ============
    
    /**
     * @notice Calculate level from XP (RuneScape-style curve)
     * @param xp Experience points
     * @return level Current level (1-99)
     * @dev Formula: XP = floor(1/4 * (level + 300 * 2^(level/7)))
     */
    function getLevelFromXP(uint32 xp) internal pure returns (uint8) {
        // XP thresholds for each level (precomputed)
        // Level 1 = 0 XP, Level 2 = 83 XP, etc.
        if (xp >= 13034431) return 99;
        if (xp >= 11805606) return 98;
        if (xp >= 10692629) return 97;
        if (xp >= 9684577) return 96;
        if (xp >= 8771558) return 95;
        if (xp >= 7944614) return 94;
        if (xp >= 7195629) return 93;
        if (xp >= 6517253) return 92;
        if (xp >= 5902831) return 91;
        if (xp >= 5346332) return 90;
        if (xp >= 4842295) return 89;
        if (xp >= 4385776) return 88;
        if (xp >= 3972294) return 87;
        if (xp >= 3597792) return 86;
        if (xp >= 3258594) return 85;
        if (xp >= 2951373) return 84;
        if (xp >= 2673114) return 83;
        if (xp >= 2421087) return 82;
        if (xp >= 2192818) return 81;
        if (xp >= 1986068) return 80;
        if (xp >= 1798808) return 79;
        if (xp >= 1629200) return 78;
        if (xp >= 1475581) return 77;
        if (xp >= 1336443) return 76;
        if (xp >= 1210421) return 75;
        if (xp >= 1096278) return 74;
        if (xp >= 992895) return 73;
        if (xp >= 899257) return 72;
        if (xp >= 814445) return 71;
        if (xp >= 737627) return 70;
        if (xp >= 668051) return 69;
        if (xp >= 605032) return 68;
        if (xp >= 547953) return 67;
        if (xp >= 496254) return 66;
        if (xp >= 449428) return 65;
        if (xp >= 407015) return 64;
        if (xp >= 368599) return 63;
        if (xp >= 333804) return 62;
        if (xp >= 302288) return 61;
        if (xp >= 273742) return 60;
        if (xp >= 247886) return 59;
        if (xp >= 224466) return 58;
        if (xp >= 203254) return 57;
        if (xp >= 184040) return 56;
        if (xp >= 166636) return 55;
        if (xp >= 150872) return 54;
        if (xp >= 136594) return 53;
        if (xp >= 123660) return 52;
        if (xp >= 111945) return 51;
        if (xp >= 101333) return 50;
        if (xp >= 91721) return 49;
        if (xp >= 83014) return 48;
        if (xp >= 75127) return 47;
        if (xp >= 67983) return 46;
        if (xp >= 61512) return 45;
        if (xp >= 55649) return 44;
        if (xp >= 50339) return 43;
        if (xp >= 45529) return 42;
        if (xp >= 41171) return 41;
        if (xp >= 37224) return 40;
        if (xp >= 33648) return 39;
        if (xp >= 30408) return 38;
        if (xp >= 27473) return 37;
        if (xp >= 24815) return 36;
        if (xp >= 22406) return 35;
        if (xp >= 20224) return 34;
        if (xp >= 18247) return 33;
        if (xp >= 16456) return 32;
        if (xp >= 14833) return 31;
        if (xp >= 13363) return 30;
        if (xp >= 12031) return 29;
        if (xp >= 10824) return 28;
        if (xp >= 9730) return 27;
        if (xp >= 8740) return 26;
        if (xp >= 7842) return 25;
        if (xp >= 7028) return 24;
        if (xp >= 6291) return 23;
        if (xp >= 5624) return 22;
        if (xp >= 5018) return 21;
        if (xp >= 4470) return 20;
        if (xp >= 3973) return 19;
        if (xp >= 3523) return 18;
        if (xp >= 3115) return 17;
        if (xp >= 2746) return 16;
        if (xp >= 2411) return 15;
        if (xp >= 2107) return 14;
        if (xp >= 1833) return 13;
        if (xp >= 1584) return 12;
        if (xp >= 1358) return 11;
        if (xp >= 1154) return 10;
        if (xp >= 969) return 9;
        if (xp >= 801) return 8;
        if (xp >= 650) return 7;
        if (xp >= 512) return 6;
        if (xp >= 388) return 5;
        if (xp >= 276) return 4;
        if (xp >= 174) return 3;
        if (xp >= 83) return 2;
        return 1;
    }
    
    /**
     * @notice Calculate XP required for a level
     * @param level Target level
     * @return xp XP required
     */
    function getXPForLevel(uint8 level) internal pure returns (uint32) {
        if (level <= 1) return 0;
        if (level >= 99) return MAX_XP;
        
        // Simplified calculation (precomputed values recommended in production)
        uint32 total = 0;
        for (uint8 i = 1; i < level; i++) {
            total += uint32(i) + uint32(300 * (2 ** (uint32(i) / 7))) / 4;
        }
        return total;
    }
    
    // ============ Combat Calculations ============
    
    /**
     * @notice Calculate melee damage
     * @param attackLevel Attacker's attack level
     * @param strengthLevel Attacker's strength level
     * @param attackBonus Equipment attack bonus
     * @param strengthBonus Equipment strength bonus
     * @param defenseLevel Defender's defense level
     * @return damage Damage dealt
     */
    function calculateMeleeDamage(
        uint8 attackLevel,
        uint8 strengthLevel,
        int16 attackBonus,
        int16 strengthBonus,
        uint8 defenseLevel
    ) internal pure returns (uint32) {
        // Effective strength determines max hit
        int32 effectiveStrength = int32(uint32(strengthLevel)) + strengthBonus;
        if (effectiveStrength < 1) effectiveStrength = 1;
        
        // Max hit = (effectiveStrength * 0.5) + 1.3
        uint32 maxHit = uint32(effectiveStrength) / 2 + 1;
        
        // Hit chance based on attack vs defense
        int32 effectiveAttack = int32(uint32(attackLevel)) + attackBonus;
        if (effectiveAttack < 1) effectiveAttack = 1;
        
        int32 attackRoll = effectiveAttack * 64;
        int32 defenseRoll = int32(uint32(defenseLevel)) * 64;
        
        // Hit chance = attack / (attack + defense)
        // If successful, deal random damage up to maxHit
        // For deterministic on-chain, use block hash as seed
        if (attackRoll > defenseRoll) {
            return maxHit;
        } else if (attackRoll == defenseRoll) {
            return maxHit / 2;
        } else {
            return maxHit / 4;
        }
    }
    
    /**
     * @notice Calculate ranged damage
     * @param rangedLevel Attacker's ranged level
     * @param rangedBonus Equipment ranged bonus
     * @param ammoBonus Ammunition bonus
     * @param defenseLevel Defender's defense level
     * @return damage Damage dealt
     */
    function calculateRangedDamage(
        uint8 rangedLevel,
        int16 rangedBonus,
        int16 ammoBonus,
        uint8 defenseLevel
    ) internal pure returns (uint32) {
        int32 effectiveRanged = int32(uint32(rangedLevel)) + rangedBonus + ammoBonus;
        if (effectiveRanged < 1) effectiveRanged = 1;
        
        uint32 maxHit = uint32(effectiveRanged) / 2 + 1;
        
        int32 attackRoll = effectiveRanged * 64;
        int32 defenseRoll = int32(uint32(defenseLevel)) * 64;
        
        if (attackRoll > defenseRoll) {
            return maxHit;
        } else if (attackRoll == defenseRoll) {
            return maxHit / 2;
        } else {
            return maxHit / 4;
        }
    }
    
    /**
     * @notice Calculate hit chance percentage (scaled by 100)
     * @param attackLevel Attacker's level
     * @param attackBonus Equipment bonus
     * @param defenseLevel Defender's level
     * @param defenseBonus Defender's equipment bonus
     * @return chance Hit chance (0-100)
     */
    function calculateHitChance(
        uint8 attackLevel,
        int16 attackBonus,
        uint8 defenseLevel,
        int16 defenseBonus
    ) internal pure returns (uint8) {
        int32 effectiveAttack = int32(uint32(attackLevel)) + attackBonus;
        int32 effectiveDefense = int32(uint32(defenseLevel)) + defenseBonus;
        
        if (effectiveAttack <= 0) return 5; // Minimum 5%
        if (effectiveDefense <= 0) return 95; // Maximum 95%
        
        int32 chance = (effectiveAttack * 100) / (effectiveAttack + effectiveDefense);
        
        if (chance < 5) return 5;
        if (chance > 95) return 95;
        
        return uint8(uint32(chance));
    }
    
    // ============ Combat Level ============
    
    /**
     * @notice Calculate combat level (RuneScape formula)
     * @param attackLevel Attack level
     * @param strengthLevel Strength level
     * @param defenseLevel Defense level
     * @param constitutionLevel Constitution/Hitpoints level
     * @param rangedLevel Ranged level
     * @param prayerLevel Prayer level (pass 1 if not used)
     * @param magicLevel Magic level (pass 1 if not used)
     * @return combatLevel Combat level (3-126)
     */
    function calculateCombatLevel(
        uint8 attackLevel,
        uint8 strengthLevel,
        uint8 defenseLevel,
        uint8 constitutionLevel,
        uint8 rangedLevel,
        uint8 prayerLevel,
        uint8 magicLevel
    ) internal pure returns (uint8) {
        // Base = 0.25 * (Defense + Constitution + floor(Prayer/2))
        uint32 base = (uint32(defenseLevel) + uint32(constitutionLevel) + uint32(prayerLevel) / 2) / 4;
        
        // Melee = 0.325 * (Attack + Strength)
        uint32 melee = (uint32(attackLevel) + uint32(strengthLevel)) * 325 / 1000;
        
        // Ranged = 0.325 * floor(Ranged * 1.5)
        uint32 ranged = (uint32(rangedLevel) * 3 / 2) * 325 / 1000;
        
        // Magic = 0.325 * floor(Magic * 1.5)
        uint32 magic = (uint32(magicLevel) * 3 / 2) * 325 / 1000;
        
        // Combat = Base + max(Melee, Ranged, Magic)
        uint32 maxCombat = melee;
        if (ranged > maxCombat) maxCombat = ranged;
        if (magic > maxCombat) maxCombat = magic;
        
        uint32 combatLevel = base + maxCombat;
        
        if (combatLevel < 3) return 3;
        if (combatLevel > 126) return 126;
        
        return uint8(combatLevel);
    }
}



