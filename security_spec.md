# Security Specification — Lucygas Firestore Rules

## 1. Data Invariants
1. **Shared Depot Membership Isolation**: Access to `/depots/{depotId}` and every subcollection document is restricted to authenticated, email-verified users (`request.auth.token.email_verified == true`) who are either the depot owner (`depotId == request.auth.uid` / `ownerId == request.auth.uid`) or explicitly listed in the depot's bounded `memberEmails` allowlist (`request.auth.token.email.lower() in depot.memberEmails`), backed by a parent `get()` gate on single-document operations (`get`, `create`, `update`, `delete`) and direct `resource.data` membership checks on `list` queries.
2. **Granular Collaborator RBAC**: When `memberPermissions[userEmail]` is configured on `/depots/{depotId}`, every collaborator write operation is gated by the corresponding capability flag (`createSales`, `manageDeliveries`, `manageInventory`, `manageCustomers`, `manageExpenses`, `manageSettings`, `manageUsers`). Collaborators without `manageUsers` cannot invite users, modify `memberEmails`/`memberPermissions`, or edit `/depots/{depotId}/members`. The depot owner always retains full privileges and cannot be evicted or downgraded.
3. **Identity Integrity**: `ownerId` must always equal `request.auth.uid` (the creating actor) on creation and is strictly immutable on updates. Only a verified collaborator activating their own `/members/{memberId}` invite may update `status: 'active'` and `joinedUid == request.auth.uid` on their own member document.
4. **Referential Integrity**: A `Sale` or `StockMovement` cannot be created unless the referenced `Cylinder` document exists in `/depots/{depotId}/cylinders/{cylinderId}`.
5. **Terminal State Locking**: Once a `Sale` reaches `deliveryStatus == 'cancelled'`, business state updates are forbidden (only admin `memberEmails` propagation is allowed without altering sale status/totals). Once `deliveryStatus == 'delivered'`, `deliveryStatus` is locked and only `paymentStatus` may transition from `'pending'` to `'paid'`.
6. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` on creation; `createdAt` is immutable on update and `updatedAt` must equal `request.time`. Optional `occurredAt` (when supplied for historical ledger reconstruction) must be a valid `timestamp <= request.time`.
7. **Boundary & Schema Enforcement**: All documents enforce exact key sets (`hasAll` + `hasOnly`), string `.size()` limits, bounded arrays/maps (`<= 20` items), strict boolean permission map schemas, numeric range constraints, and regex-validated IDs.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Non-Member Depot Read/Write**: User C (not owner and email not in `memberEmails`) attempts to `get`, `list`, or `create` `/depots/{userA_uid}/sales/sale_1` -> **PERMISSION_DENIED**.
2. **Identity Spoofing**: Member B creates a `Sale` or `DepotMember` in Depot A with `ownerId: "userA_uid"` instead of `request.auth.uid` -> **PERMISSION_DENIED**.
3. **Privilege Escalation on Member Permissions**: A `seller` collaborator (`manageUsers: false`) attempts to update `memberPermissions` on `/depots/{userA_uid}` or grant themselves `manageUsers: true` in `/members/{memberId}` -> **PERMISSION_DENIED**.
4. **Cross-Module Write Without Permission**: A `driver` collaborator (`manageExpenses: false`) attempts to create a document in `/depots/{userA_uid}/expenses/exp_1` or edit `/cylinders` prices -> **PERMISSION_DENIED**.
5. **Unverified Email Access**: User with `email_verified: false` (even matching a `memberEmails` entry) attempts to read or write -> **PERMISSION_DENIED**.
6. **Oversized ID Poisoning**: Request targets `/depots/{uid}/members/{1500_char_id}` -> **PERMISSION_DENIED** (`isValidId` rejects).
7. **Shadow Field Injection on Permissions**: Admin/User submits `DepotMember.permissions` with an unknown ghost key like `isSuperAdmin: true` -> **PERMISSION_DENIED** (`isValidPermissionsMap` rejects).
8. **Negative Quantity/Price Manipulation**: `Sale` submitted with `quantity: -5` or `totalAmount: -100` -> **PERMISSION_DENIED**.
9. **Orphaned Sale Reference**: `Sale` created pointing to non-existent `cylinderId: "ghost_sku"` -> **PERMISSION_DENIED** (`exists()` check fails).
10. **Client Timestamp Forgery**: `DepotMember` or `Sale` created with client-provided backdated `createdAt` != `request.time` -> **PERMISSION_DENIED**.
11. **Terminal State Bypass**: Update attempts to change a `'cancelled'` or `'delivered'` sale back to `'pending'` -> **PERMISSION_DENIED**.
12. **Owner Eviction Attempt**: An invited `admin` collaborator attempts to remove the primary owner's email from `Depot.memberEmails` -> **PERMISSION_DENIED**.
