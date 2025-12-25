//! Authentication-related Tauri commands

use crate::state::{AppState, UserSession};
use alloy::primitives::Address;
use alloy::signers::k256::ecdsa::{RecoveryId, Signature, VerifyingKey};
use alloy::signers::k256::elliptic_curve::sec1::ToEncodedPoint;
use tauri::State;

/// Expected message prefix for authentication
const AUTH_MESSAGE_PREFIX: &str = "Jeju VPN Authentication\n\nTimestamp: ";

/// Maximum age for auth message in seconds (5 minutes)
const MAX_MESSAGE_AGE_SECS: u64 = 300;

/// Verify an Ethereum signature
fn verify_signature(address: &str, message: &str, signature: &str) -> Result<bool, String> {
    // Parse the address
    let expected_addr: Address = address.parse().map_err(|_| "Invalid address format")?;

    // Decode hex signature (remove 0x prefix if present)
    let sig_hex = signature.strip_prefix("0x").unwrap_or(signature);
    let sig_bytes = hex::decode(sig_hex).map_err(|_| "Invalid signature hex")?;

    if sig_bytes.len() != 65 {
        return Err("Invalid signature length".into());
    }

    // Extract r, s, v from signature
    let r = &sig_bytes[0..32];
    let s = &sig_bytes[32..64];
    let v = sig_bytes[64];

    // Construct recovery id (v = 27 or 28 for Ethereum, or 0/1)
    // RecoveryId::new(is_y_odd, is_x_reduced)
    let recovery_id = match v {
        27 | 0 => RecoveryId::new(false, false),
        28 | 1 => RecoveryId::new(true, false),
        _ => return Err(format!("Invalid recovery id: {}", v)),
    };

    // Create signature
    let mut sig_array = [0u8; 64];
    sig_array[..32].copy_from_slice(r);
    sig_array[32..].copy_from_slice(s);

    let signature = Signature::from_bytes(&sig_array.into())
        .map_err(|e| format!("Invalid signature: {}", e))?;

    // Hash the message with Ethereum prefix
    let prefixed_message = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
    let message_hash = alloy::primitives::keccak256(prefixed_message.as_bytes());

    // Recover public key
    let recovered_key =
        VerifyingKey::recover_from_prehash(&message_hash[..], &signature, recovery_id)
            .map_err(|e| format!("Failed to recover key: {}", e))?;

    // Convert to address
    let pubkey_bytes = recovered_key.to_encoded_point(false);
    let pubkey_hash = alloy::primitives::keccak256(&pubkey_bytes.as_bytes()[1..]);
    let recovered_addr = Address::from_slice(&pubkey_hash[12..]);

    Ok(recovered_addr == expected_addr)
}

/// Login with wallet signature
#[tauri::command]
pub async fn login_with_wallet(
    state: State<'_, AppState>,
    address: String,
    signature: String,
    message: String,
) -> Result<UserSession, String> {
    // Validate message format and extract timestamp
    if !message.starts_with(AUTH_MESSAGE_PREFIX) {
        return Err("Invalid message format".into());
    }

    let timestamp_str = message
        .strip_prefix(AUTH_MESSAGE_PREFIX)
        .ok_or("Invalid message format")?;

    let timestamp: u64 = timestamp_str
        .parse()
        .map_err(|_| "Invalid timestamp in message")?;

    // Verify timestamp is recent (within 5 minutes)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let age = now.abs_diff(timestamp);
    if age > MAX_MESSAGE_AGE_SECS {
        return Err(format!(
            "Message expired. Age: {}s, max: {}s",
            age, MAX_MESSAGE_AGE_SECS
        ));
    }

    // Verify the signature
    let is_valid = verify_signature(&address, &message, &signature)?;
    if !is_valid {
        return Err("Invalid signature".into());
    }

    let session = UserSession {
        address: address.clone(),
        session_id: uuid::Uuid::new_v4().to_string(),
        expires_at: now + 24 * 60 * 60, // 24 hours
    };

    *state.session.write().await = Some(session.clone());

    tracing::info!("User {} authenticated successfully", address);

    Ok(session)
}

/// Logout
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.write().await = None;
    Ok(())
}

/// Get current session
#[tauri::command]
pub async fn get_session(state: State<'_, AppState>) -> Result<Option<UserSession>, String> {
    Ok(state.session.read().await.clone())
}
