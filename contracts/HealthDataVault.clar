;; HealthDataVault.clar
;; Core contract for storing and verifying encrypted health data hashes
;; Owner-controlled, category-based, immutable after upload

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-DATA-NOT-FOUND u101)
(define-constant ERR-CATEGORY-EMPTY u102)
(define-constant ERR-HASH-INVALID u103)
(define-constant ERR-ALREADY-EXISTS u104)
(define-constant ERR-VERIFY-FAILED u105)
(define-constant ERR-UPDATE-DENIED u106)
(define-constant ERR-CATEGORY-LIMIT u107)

(define-constant MAX-CATEGORIES u20)
(define-constant HASH-SIZE u32)

(define-data-var contract-owner principal tx-sender)

(define-map user-data-hashes
  { owner: principal, category: (string-ascii 32) }
  { hash: (buff 32), uploaded-at: uint, version: uint }
)

(define-map category-index
  principal
  (list 20 (string-ascii 32))
)

(define-read-only (get-data-hash (owner principal) (category (string-ascii 32)))
  (map-get? user-data-hashes { owner: owner, category: category })
)

(define-read-only (get-user-categories (owner principal))
  (default-to (list) (map-get? category-index owner))
)

(define-read-only (verify-data-hash 
  (owner principal) 
  (category (string-ascii 32)) 
  (provided-data (buff 1024)))
  (let (
    (record (map-get? user-data-hashes { owner: owner, category: category }))
  )
    (match record
      data 
        (if (is-eq (hash160 provided-data) (get hash data))
          (ok true)
          (err ERR-VERIFY-FAILED))
      (err ERR-DATA-NOT-FOUND)
    )
  )
)

(define-read-only (is-category-used (owner principal) (category (string-ascii 32)))
  (is-some (map-get? user-data-hashes { owner: owner, category: category }))
)

(define-private (validate-category (category (string-ascii 32)))
  (if (and (> (len category) u0) (<= (len category) u32))
    (ok true)
    (err ERR-CATEGORY-EMPTY))
)

(define-private (validate-hash (data-hash (buff 32)))
  (if (is-eq (len data-hash) HASH-SIZE)
    (ok true)
    (err ERR-HASH-INVALID))
)

(define-private (get-caller-categories)
  (default-to (list) (map-get? category-index tx-sender))
)

(define-private (update-category-list (owner principal) (category (string-ascii 32)))
  (let (
    (current-list (get-caller-categories))
    (exists (is-some (index-of current-list category)))
  )
    (if exists
      (ok current-list)
      (let ((new-list (unwrap! (as-max-len? (append current-list category) u20) (err ERR-CATEGORY-LIMIT))))
        (map-set category-index owner new-list)
        (ok new-list)
      )
    )
  )
)

(define-public (upload-data 
  (category (string-ascii 32)) 
  (data-hash (buff 32)))
  (let (
    (key { owner: tx-sender, category: category })
    (existing (map-get? user-data-hashes key))
  )
    (try! (validate-category category))
    (try! (validate-hash data-hash))
    (match existing
      record 
        (err ERR-ALREADY-EXISTS)
      (begin
        (map-set user-data-hashes key 
          { hash: data-hash, uploaded-at: block-height, version: u1 })
        (try! (update-category-list tx-sender category))
        (print { event: "data-uploaded", owner: tx-sender, category: category, hash: data-hash })
        (ok true)
      )
    )
  )
)

(define-public (update-data 
  (category (string-ascii 32)) 
  (new-hash (buff 32)))
  (let (
    (key { owner: tx-sender, category: category })
    (existing (unwrap! (map-get? user-data-hashes key) (err ERR-DATA-NOT-FOUND)))
  )
    (try! (validate-hash new-hash))
    (asserts! (is-eq tx-sender (get owner key)) (err ERR-NOT-AUTHORIZED))
    (map-set user-data-hashes key 
      { 
        hash: new-hash, 
        uploaded-at: (get uploaded-at existing), 
        version: (+ (get version existing) u1)
      })
    (print { event: "data-updated", owner: tx-sender, category: category, new-hash: new-hash, version: (+ (get version existing) u1) })
    (ok true)
  )
)

(define-public (delete-data (category (string-ascii 32)))
  (let (
    (key { owner: tx-sender, category: category })
    (existing (unwrap! (map-get? user-data-hashes key) (err ERR-DATA-NOT-FOUND)))
    (current-categories (get-caller-categories))
  )
    (asserts! (is-eq tx-sender (get owner key)) (err ERR-NOT-AUTHORIZED))
    (map-delete user-data-hashes key)
    (let ((filtered (filter (lambda (c) (not (is-eq c category))) current-categories)))
      (map-set category-index tx-sender filtered)
    )
    (print { event: "data-deleted", owner: tx-sender, category: category })
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (let ((caller tx-sender))
    (asserts! (is-eq caller (var-get contract-owner)) (err ERR-NOT-AUTHORIZED))
    (var-set contract-owner new-owner)
    (print { event: "ownership-transferred", from: caller, to: new-owner })
    (ok true)
  )
)

(define-read-only (get-contract-owner)
  (ok (var-get contract-owner))
)

(define-read-only (get-data-version (owner principal) (category (string-ascii 32)))
  (match (map-get? user-data-hashes { owner: owner, category: category })
    record (ok (get version record))
    (err ERR-DATA-NOT-FOUND))
)

(define-read-only (get-upload-timestamp (owner principal) (category (string-ascii 32)))
  (match (map-get? user-data-hashes { owner: owner, category: category })
    record (ok (get uploaded-at record))
    (err ERR-DATA-NOT-FOUND))
)