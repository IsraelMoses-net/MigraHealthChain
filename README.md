# MigraHealthChain

## Overview

MigraHealthChain is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It provides a decentralized solution for securely sharing health data during migration crises, such as refugee movements or natural disasters. By leveraging blockchain's immutability, transparency, and user-controlled access, the project addresses real-world challenges like data fragmentation, privacy breaches, and inefficient cross-border information sharing.

In migration crises, individuals often lose access to their medical histories, leading to delayed treatments, redundant tests, or medical errors. Traditional centralized systems are prone to data silos, corruption, or unavailability in unstable regions. MigraHealthChain empowers users (e.g., migrants) to own their health data, grant granular consents to healthcare providers, and ensure auditable access— all while maintaining privacy through encryption and zero-knowledge proofs where applicable.

The system involves off-chain storage for sensitive data (e.g., IPFS for encrypted files) with on-chain hashes for verification. It solves:
- **Data Portability**: Migrants can carry verifiable health records across borders without physical documents.
- **Privacy and Consent**: Users control who accesses what data, revoking permissions instantly.
- **Auditability**: Immutable logs prevent tampering and enable compliance with regulations like GDPR or HIPAA equivalents.
- **Emergency Access**: Controlled overrides for life-saving situations.
- **Interoperability**: Integrates with existing health systems via standardized APIs.
- **Incentivization**: Tokens reward data sharing or verification by trusted entities.

This project uses 6 core smart contracts written in Clarity, ensuring security through Clarity's decidable and analyzable nature (no Turing completeness, reducing bugs like reentrancy).

## Architecture

- **Blockchain**: Stacks (STX), secured by Bitcoin.
- **Smart Contracts Language**: Clarity.
- **Off-Chain Components**: IPFS for data storage, frontend dApp (e.g., React with Hiro Wallet for STX).
- **Data Flow**:
  1. User registers and uploads encrypted health data (hash stored on-chain).
  2. Grants consent to specific providers.
  3. Providers request access, verified on-chain.
  4. Access logged immutably.
  5. Emergency protocols for urgent cases.
  6. Tokens for ecosystem incentives.

## Smart Contracts

The project consists of 6 solid smart contracts, each with clear responsibilities, error handling, and access controls. Contracts are designed to be composable, with principals (addresses) managing ownership.

1. **UserRegistry.clar**
   - **Purpose**: Manages user registration and identity verification. Stores user profiles (e.g., hashed IDs, roles: migrant, doctor, NGO).
   - **Key Functions**:
     - `register-user (user-principal: principal, role: (string-ascii 32))`: Registers a user with a role, emits event.
     - `get-user-role (user-principal: principal)`: Retrieves role (read-only).
     - `update-profile (user-principal: principal, metadata-hash: (buff 32))`: Updates profile hash (owner only).
   - **Security**: Only caller can update their profile; roles restricted to predefined enums.

2. **HealthDataVault.clar**
   - **Purpose**: Stores hashes of encrypted health data (e.g., medical records, vaccinations). Ensures data integrity without storing plaintext on-chain.
   - **Key Functions**:
     - `upload-data (owner: principal, data-hash: (buff 32), category: (string-ascii 32))`: Stores hash under owner's address.
     - `verify-data (data-hash: (buff 32), provided-data: (buff 1024))`: Verifies if provided data matches hash (read-only).
     - `get-data-hash (owner: principal, category: (string-ascii 32))`: Retrieves hash for authorized callers.
   - **Security**: Data hashes are immutable once uploaded; uses maps for efficient storage.

3. **ConsentManager.clar**
   - **Purpose**: Handles granular consent for data access. Users define permissions (e.g., read-only for specific categories, time-bound).
   - **Key Functions**:
     - `grant-consent (granter: principal, grantee: principal, category: (string-ascii 32), expiry: uint)`: Grants access, stores in map.
     - `revoke-consent (granter: principal, grantee: principal, category: (string-ascii 32))`: Revokes access.
     - `check-consent (granter: principal, grantee: principal, category: (string-ascii 32))`: Returns bool if consent active (read-only).
   - **Security**: Time-based expiry with block-height checks; only granter can grant/revoke.

4. **AccessAuditor.clar**
   - **Purpose**: Logs all data access events for transparency and auditing. Useful for compliance and dispute resolution.
   - **Key Functions**:
     - `log-access (accessor: principal, owner: principal, category: (string-ascii 32), success: bool)`: Appends to log (called by other contracts).
     - `get-access-logs (owner: principal)`: Returns list of logs for owner (read-only, paginated).
     - `query-logs-by-accessor (accessor: principal)`: Filtered logs (admin role only).
   - **Security**: Append-only list; events emitted for off-chain monitoring.

5. **EmergencyProtocol.clar**
   - **Purpose**: Allows emergency access in crises (e.g., verified by multiple parties) without full consent, but with post-audit.
   - **Key Functions**:
     - `request-emergency-access (requester: principal, target: principal, reason: (string-ascii 128))`: Initiates request.
     - `approve-emergency (approver: principal, request-id: uint)`: Multi-sig approval (e.g., needs 2/3 doctors).
     - `execute-emergency-access (request-id: uint)`: Grants temp access if approved.
   - **Security**: Requires predefined approver roles; auto-expires after short duration; logs heavily.

6. **IncentiveToken.clar**
   - **Purpose**: Manages a fungible token (STX-20 like) for incentivizing participation (e.g., rewards for data verification or sharing).
   - **Key Functions**:
     - `mint-tokens (recipient: principal, amount: uint)`: Mints tokens (admin only).
     - `transfer-tokens (sender: principal, recipient: principal, amount: uint)`: Standard transfer.
     - `reward-for-action (user: principal, action-type: (string-ascii 32))`: Auto-rewards based on events from other contracts.
   - **Security**: Total supply cap; uses Clarity's FT trait for standardization.

## Installation and Setup

1. **Prerequisites**:
   - Install Clarinet (Clarity dev tool): `cargo install clarinet`.
   - Stacks wallet (e.g., Hiro) for testing on testnet.

2. **Clone Repository**:
   ```
   git clone 
`git clone <repo-url>`
   cd migrahealthchain
   ```

3. **Deploy Contracts**:
   - Use Clarinet to deploy: `clarinet deploy --testnet`.
   - Contracts are in `/contracts/` directory.

4. **Frontend dApp**:
   - Run `npm install && npm start` in `/frontend/`.
   - Connect wallet to interact (upload data, grant consents).

## Usage

- **For Migrants**: Register, upload data hashes, manage consents via dApp.
- **For Providers**: Request access, view data (off-chain decryption with user key).
- **Testing**: Use Clarinet console: `clarinet console` to call functions.
- **Example Flow**:
  1. Call `UserRegistry::register-user`.
  2. Upload to `HealthDataVault`.
  3. Grant via `ConsentManager`.
  4. Access and log via integration.

## Contributing

Fork the repo, add features (e.g., ZK proofs integration), and PR. Focus on security audits.

## License

MIT License. See LICENSE file.