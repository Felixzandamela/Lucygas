# Security Specification — ChamaGest Firestore Rules

## 1. Data Invariants
1. **Depot Isolation**: Every subcollection document under `/depots/{depotId}` must belong to the authenticated, email-verified user (`depotId == request.auth.uid` and `ownerId == request.auth.uid`), backed by a parent `get()` gate on single-document operations (including `delete` on owned records).
2. **Identity Integrity**: `ownerId` must always equal `request.auth.uid` on creation and is strictly immutable on updates.
3. **Referential Integrity**: A `Sale` or `StockMovement` cannot be created unless the referenced `Cylinder` document exists in `/depots/{depotId}/cylinders/{cylinderId}`.
4. **Terminal State Locking**: Once a `Sale` reaches `deliveryStatus == 'cancelled'`, no further updates are permitted. Once `deliveryStatus == 'delivered'`, `deliveryStatus` is locked and only `paymentStatus` may transition from `'pending'` to `'paid'`.
5. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` on creation; `createdAt` is immutable on update and `updatedAt` must equal `request.time`. Optional `occurredAt` (when supplied for historical ledger reconstruction) must be a valid `timestamp <= request.time`.
6. **Boundary & Schema Enforcement**: All documents enforce exact key sets (`hasAll` + `hasOnly`), string `.size()` limits, numeric range constraints, and regex-validated IDs.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Cross-Tenant Depot Read/Write**: User B attempts to `get` or `create` `/depots/{userA_uid}/sales/sale_1` -> **PERMISSION_DENIED**.
2. **Identity Spoofing**: User A creates a `Sale` with `ownerId: "userB_uid"` -> **PERMISSION_DENIED**.
3. **Shadow Field Injection**: User A creates a `Customer` with extra field `isAdmin: true` -> **PERMISSION_DENIED** (`hasOnly` rejects).
4. **Unverified Email Write**: User with `email_verified: false` attempts to write a `Depot` -> **PERMISSION_DENIED**.
5. **Oversized ID Poisoning**: Request targets `/depots/{uid}/sales/{1500_char_id}` -> **PERMISSION_DENIED** (`isValidId` rejects).
6. **Oversized String Exhaustion**: `Customer.notes` has 10,000 characters -> **PERMISSION_DENIED** (`size() <= 240`).
7. **Negative Quantity/Price Manipulation**: `Sale` submitted with `quantity: -5` or `totalAmount: -100` -> **PERMISSION_DENIED**.
8. **Orphaned Sale Reference**: `Sale` created pointing to non-existent `cylinderId: "ghost_sku"` -> **PERMISSION_DENIED** (`exists()` check fails).
9. **Client Timestamp Forgery**: `Sale` created with client-provided backdated `createdAt` != `request.time` -> **PERMISSION_DENIED**.
10. **Immutable Field Tampering**: Update on `Sale` alters `createdAt` or `ownerId` -> **PERMISSION_DENIED**.
11. **Terminal State Bypass**: Update attempts to change a `'cancelled'` or `'delivered'` sale back to `'pending'` -> **PERMISSION_DENIED**.
12. **Unbounded Array Poisoning**: `Depot.drivers` submitted with 50 items or non-string first element -> **PERMISSION_DENIED**.
