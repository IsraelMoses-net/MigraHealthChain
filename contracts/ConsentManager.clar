;; ConsentManager.clar
;; Advanced Consent Management for Health Data Sharing in MigraHealthChain
;; This contract handles granular, time-bound consents for health data categories.
;; Features include delegation, templates, history tracking, renewal, and querying.
;; Assumes integration with AccessAuditor for logging.

(define-constant ERR_NOT_AUTHORIZED (err u100))
(define-constant ERR_CONSENT_EXPIRED (err u101))
(define-constant ERR_INVALID_CATEGORY (err u102))
(define-constant ERR_ALREADY_GRANTED (err u103))
(define-constant ERR_NOT_FOUND (err u104))
(define-constant ERR_NOT_DELEGATED (err u105))
(define-constant ERR_TEMPLATE_NOT_FOUND (err u106))
(define-constant ERR_INVALID_DURATION (err u107))
(define-constant ERR_HISTORY_LIMIT_EXCEEDED (err u108))
(define-constant ERR_MAX_DELEGATES_REACHED (err u109))
(define-constant ERR_INVALID_TEMPLATE (err u110))

(define-constant MAX_HISTORY_ENTRIES u50)
(define-constant MAX_DELEGATES u10)
(define-constant MAX_CATEGORIES_PER_TEMPLATE u10)

;; Data Structures

;; Consents map: key {granter, grantee, category} -> {expiry, active}
(define-map consents
  { granter: principal, grantee: principal, category: (string-ascii 32) }
  { expiry: uint, active: bool })

;; Valid categories: category -> bool
(define-map valid-categories (string-ascii 32) bool)

;; Consent history: key {granter, grantee, category} -> list of {block: uint, action: (string-ascii 64), details: (string-ascii 128)}
(define-map consent-history
  { granter: principal, grantee: principal, category: (string-ascii 32) }
  (list 50 { block: uint, action: (string-ascii 64), details: (string-ascii 128) }))

;; Delegated managers: granter -> list of delegates
(define-map delegated-managers principal (list 10 principal))

;; Consent templates: template-name -> {categories: list, duration: uint, description: (string-ascii 256)}
(define-map consent-templates (string-ascii 32)
  { categories: (list 10 (string-ascii 32)), duration: uint, description: (string-ascii 256) })

;; Initialization flag
(define-data-var initialized bool false)

;; Private: Initialize default categories
(define-private (initialize-categories)
  (begin
    (map-set valid-categories "medical-history" true)
    (map-set valid-categories "vaccinations" true)
    (map-set valid-categories "allergies" true)
    (map-set valid-categories "medications" true)
    (map-set valid-categories "lab-results" true)
    (map-set valid-categories "mental-health" true)
    (map-set valid-categories "imaging" true)
    (map-set valid-categories "genetics" true)
    (var-set initialized true)
    (ok true)))

;; Private: Add entry to history
(define-private (add-to-history (granter principal) (grantee principal) (category (string-ascii 32)) (action (string-ascii 64)) (details (string-ascii 128)))
  (let ((key {granter: granter, grantee: grantee, category: category})
        (current-history (default-to (list ) (map-get? consent-history key))))
    (if (>= (len current-history) MAX_HISTORY_ENTRIES)
      (map-set consent-history key (cdr current-history))
      true)
    (map-set consent-history key (append current-history {block: block-height, action: action, details: details}))
    true))

;; Private: Check if caller is authorized (granter or delegate)
(define-private (is-authorized (granter principal) (caller principal))
  (or (is-eq granter caller)
      (is-some (index-of? (default-to (list ) (map-get? delegated-managers granter)) caller))))

;; Public: Grant consent
(define-public (grant-consent (grantee principal) (category (string-ascii 32)) (duration uint) (notes (optional (string-ascii 128))))
  (let ((granter tx-sender)
        (key {granter: granter, grantee: grantee, category: category})
        (expiry (+ block-height duration))
        (note-details (default-to "" notes)))
    (if (not (var-get initialized))
      (try! (initialize-categories))
      (ok true))
    (asserts! (default-to false (map-get? valid-categories category)) ERR_INVALID_CATEGORY)
    (asserts! (> duration u0) ERR_INVALID_DURATION)
    (asserts! (is-none (map-get? consents key)) ERR_ALREADY_GRANTED)
    (map-set consents key {expiry: expiry, active: true})
    (add-to-history granter grantee category "consent-granted" note-details)
    (try! (contract-call? .AccessAuditor log-access grantee granter category true))
    (print {event: "consent-granted", granter: granter, grantee: grantee, category: category, expiry: expiry})
    (ok true)))

;; Public: Revoke consent
(define-public (revoke-consent (grantee principal) (category (string-ascii 32)))
  (let ((granter tx-sender)
        (key {granter: granter, grantee: grantee, category: category}))
    (asserts! (is-some (map-get? consents key)) ERR_NOT_FOUND)
    (asserts! (is-authorized granter tx-sender) ERR_NOT_AUTHORIZED)
    (map-set consents key (merge (unwrap-panic (map-get? consents key)) {active: false}))
    (add-to-history granter grantee category "consent-revoked" "")
    (try! (contract-call? .AccessAuditor log-access grantee granter category false))
    (print {event: "consent-revoked", granter: granter, grantee: grantee, category: category})
    (ok true)))

;; Read-only: Check if consent is valid
(define-read-only (check-consent (granter principal) (grantee principal) (category (string-ascii 32)))
  (match (map-get? consents {granter: granter, grantee: grantee, category: category})
    consent (if (and (get active consent) (<= block-height (get expiry consent)))
              (ok true)
              ERR_CONSENT_EXPIRED)
    ERR_NOT_FOUND))

;; Read-only: Get consent details
(define-read-only (get-consent-details (granter principal) (grantee principal) (category (string-ascii 32)))
  (map-get? consents {granter: granter, grantee: grantee, category: category}))

;; Public: Add a new valid category
(define-public (add-valid-category (category (string-ascii 32)))
  (begin
    (if (not (var-get initialized))
      (try! (initialize-categories))
      (ok true))
    (asserts! (is-none (map-get? valid-categories category)) ERR_ALREADY_GRANTED)
    (map-set valid-categories category true)
    (ok true)))

;; Public: Delegate consent management to another principal
(define-public (delegate-manager (delegatee principal))
  (let ((granter tx-sender)
        (current-delegates (default-to (list ) (map-get? delegated-managers granter))))
    (asserts! (< (len current-delegates) MAX_DELEGATES) ERR_MAX_DELEGATES_REACHED)
    (asserts! (not (is-some (index-of? current-delegates delegatee))) ERR_ALREADY_GRANTED)
    (map-set delegated-managers granter (append current-delegates delegatee))
    (print {event: "delegation-added", granter: granter, delegatee: delegatee})
    (ok true)))

;; Public: Revoke delegation
(define-public (revoke-delegation (delegatee principal))
  (let ((granter tx-sender)
        (current-delegates (default-to (list ) (map-get? delegated-managers granter))))
    (asserts! (is-some (index-of? current-delegates delegatee)) ERR_NOT_FOUND)
    (map-set delegated-managers granter (filter (lambda (d) (not (is-eq d delegatee))) current-delegates))
    (print {event: "delegation-revoked", granter: granter, delegatee: delegatee})
    (ok true)))

;; Public: Grant consent as a delegate
(define-public (grant-consent-as-delegate (granter principal) (grantee principal) (category (string-ascii 32)) (duration uint) (notes (optional (string-ascii 128))))
  (let ((caller tx-sender)
        (key {granter: granter, grantee: grantee, category: category})
        (expiry (+ block-height duration))
        (note-details (default-to "" notes)))
    (asserts! (is-authorized granter caller) ERR_NOT_DELEGATED)
    (asserts! (default-to false (map-get? valid-categories category)) ERR_INVALID_CATEGORY)
    (asserts! (> duration u0) ERR_INVALID_DURATION)
    (asserts! (is-none (map-get? consents key)) ERR_ALREADY_GRANTED)
    (map-set consents key {expiry: expiry, active: true})
    (add-to-history granter grantee category "consent-granted-by-delegate" (concat (principal-to-ascii caller) note-details))
    (try! (contract-call? .AccessAuditor log-access grantee granter category true))
    (print {event: "consent-granted-by-delegate", granter: granter, delegate: caller, grantee: grantee, category: category, expiry: expiry})
    (ok true)))

;; Public: Renew consent
(define-public (renew-consent (grantee principal) (category (string-ascii 32)) (additional-duration uint))
  (let ((granter tx-sender)
        (key {granter: granter, grantee: grantee, category: category}))
    (match (map-get? consents key)
      consent (begin
        (asserts! (get active consent) ERR_NOT_FOUND)
        (asserts! (<= block-height (get expiry consent)) ERR_CONSENT_EXPIRED)
        (asserts! (> additional-duration u0) ERR_INVALID_DURATION)
        (asserts! (is-authorized granter tx-sender) ERR_NOT_AUTHORIZED)
        (let ((new-expiry (+ (get expiry consent) additional-duration)))
          (map-set consents key {expiry: new-expiry, active: true})
          (add-to-history granter grantee category "consent-renewed" (int-to-ascii additional-duration))
          (print {event: "consent-renewed", granter: granter, grantee: grantee, category: category, new-expiry: new-expiry})
          (ok true)))
      ERR_NOT_FOUND)))

;; Read-only: Get history for a consent
(define-read-only (get-consent-history (granter principal) (grantee principal) (category (string-ascii 32)))
  (default-to (list ) (map-get? consent-history {granter: granter, grantee: grantee, category: category})))

;; Public: Create a consent template
(define-public (create-consent-template (template-name (string-ascii 32)) (categories (list 10 (string-ascii 32))) (duration uint) (description (string-ascii 256)))
  (begin
    (asserts! (is-none (map-get? consent-templates template-name)) ERR_ALREADY_GRANTED)
    (asserts! (> duration u0) ERR_INVALID_DURATION)
    (asserts! (<= (len categories) MAX_CATEGORIES_PER_TEMPLATE) ERR_INVALID_TEMPLATE)
    (asserts! (fold (lambda (cat acc) (and acc (default-to false (map-get? valid-categories cat)))) categories true) ERR_INVALID_CATEGORY)
    (map-set consent-templates template-name {categories: categories, duration: duration, description: description})
    (print {event: "template-created", name: template-name, creator: tx-sender})
    (ok true)))

;; Public: Grant consents using a template
(define-public (grant-consent-with-template (grantee principal) (template-name (string-ascii 32)))
  (let ((granter tx-sender)
        (template (unwrap! (map-get? consent-templates template-name) ERR_TEMPLATE_NOT_FOUND)))
    (fold (lambda (cat acc)
            (and acc (is-ok (grant-consent grantee cat (get duration template) (some (get description template))))) )
          (get categories template)
          true)
    (print {event: "template-applied", template: template-name, granter: granter, grantee: grantee})
    (ok true)))

;; Read-only: Get template details
(define-read-only (get-consent-template (template-name (string-ascii 32)))
  (map-get? consent-templates template-name))

;; Public: Batch grant consents for multiple categories
(define-public (batch-grant-consent (grantee principal) (categories (list 10 (string-ascii 32))) (duration uint))
  (fold (lambda (cat acc)
          (and acc (is-ok (grant-consent grantee cat duration none))))
        categories
        true)
  (ok true))

;; Public: Batch revoke consents for multiple categories
(define-public (batch-revoke-consent (grantee principal) (categories (list 10 (string-ascii 32))))
  (fold (lambda (cat acc)
          (and acc (is-ok (revoke-consent grantee cat))))
        categories
        true)
  (ok true))

;; Read-only: Is category valid
(define-read-only (is-valid-category (category (string-ascii 32)))
  (default-to false (map-get? valid-categories category)))

;; Read-only: Get delegates for granter
(define-read-only (get-delegates (granter principal))
  (default-to (list ) (map-get? delegated-managers granter)))