/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Release Submission Lock
 * collection: x_2180676_claime_0_claim
 * when: after
 * order: 1000
 * active: true
 * field: script
 */

/**
 * ClaimEase - Release Submission Lock  (after insert/update, order 1000)
 *
 * PURPOSE
 *   Releases the per-employee submission mutex that the "Duplicate Guard"
 *   before-rule acquired.
 *
 *   The release MUST happen here rather than at the end of the duplicate guard.
 *   The guard runs before the claim row is written, so releasing there would let
 *   a second transaction acquire the lock and run its duplicate query before the
 *   first claim became visible — re-opening exactly the race the lock exists to
 *   close. By the time an after-rule runs, the claim is committed and visible,
 *   so it is safe to let the next submission through.
 *
 *   Runs at order 1000 so it is the last thing to happen on the save.
 *
 * SAFETY
 *   - The lock is keyed by employee and owned by this claim's sys_id, so this
 *     rule can only ever release a lock that this claim took.
 *   - It is a harmless no-op when no lock is held (the common case: large
 *     claims, draft saves, approval updates).
 *   - If a transaction aborts between the guard and this rule, the lock's
 *     `expires_on` lets the next acquirer reclaim it, so no employee can be
 *     blocked indefinitely.
 */
;(function executeRule() {
    var duplicateCheck = new ClaimEaseDuplicateCheck()
    duplicateCheck.releaseSubmissionLock(current.getValue('requested_for'), current.getUniqueValue())
})()
