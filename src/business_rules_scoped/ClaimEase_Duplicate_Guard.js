/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Duplicate Guard
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 300
 * active: true
 * field: script
 */

/**
 * ClaimEase - Duplicate Guard  (before insert/update, order 300)
 *
 * PURPOSE
 *   Applies the rolling-window duplicate rule at the moment a claim ENTERS the
 *   `submitted` status (including an insert that arrives already submitted, as
 *   the record producer does).
 *
 *   Because this is a business rule it applies to EVERY interface — form,
 *   Service Portal, record producer, Table API, server script and flow. There
 *   is no client-side duplicate check anywhere in ClaimEase.
 *
 * WHAT HAPPENS ON A HIT
 *   The claim is NOT turned into an eligible claim: status becomes `duplicate`,
 *   `duplicate_of` points at the earlier claim, `duplicate_check` is stamped and
 *   `flow_started` is left false, so the "Start Approval Process" rule is a
 *   no-op and no approval is ever requested. The employee gets a friendly
 *   explanation (identifying the earlier claim only when they are allowed to
 *   read it).
 *
 * CONCURRENCY
 *   A per-employee named mutex is taken BEFORE the duplicate query. The mutex is
 *   a lock row whose key is covered by a UNIQUE database index, so two
 *   simultaneous qualifying submissions cannot both pass — the database rejects
 *   one of the two acquires. The loser is asked to retry rather than being
 *   allowed through. The lock is released by the "Release Submission Lock"
 *   after-rule, once the claim row has committed (releasing earlier would
 *   re-open the race). See the ClaimEaseLock script include for the full
 *   rationale and the alternatives that were rejected.
 *
 * Thin by design: all logic lives in ClaimEaseDuplicateCheck / ClaimEaseLock.
 */
;(function executeRule() {
    var config = new ClaimEaseConfig()
    var duplicateCheck = new ClaimEaseDuplicateCheck()

    // Insert detection must NOT use current.operation(): in the record-producer
    // save path that call throws "Cannot convert null to an object", which
    // previously aborted this rule and left claims unstamped. Comparing against
    // `previous` is reliable on every insert path.
    var isInsert = !previous || !previous.getValue('sys_id')
    var statusNow = current.getValue('approval_status')
    var statusBefore = !isInsert && previous ? previous.getValue('approval_status') : ''

    // Only guard the transition INTO submitted.
    if (statusNow !== 'submitted' || statusBefore === 'submitted') {
        return
    }

    // The rule must never block an unrelated claim at or above the boundary.
    var amountUsd = parseFloat(current.getValue('amount_usd'))
    if (isNaN(amountUsd) || !config.isSmallClaim(amountUsd)) {
        return
    }

    var requestedFor = current.getValue('requested_for')
    // The claim sys_id is already assigned in a before-insert rule, so it is a
    // stable, unique owner token for this submission attempt.
    var ownerToken = current.getUniqueValue()

    var lock = duplicateCheck.acquireSubmissionLock(requestedFor, ownerToken)
    if (!lock.acquired) {
        gs.error('[ClaimEase] Serialised submission refused: ' + lock.error)
        gs.addErrorMessage(
            'Another reimbursement claim for this employee is being submitted right now. ' +
                'Please wait a moment and submit again.'
        )
        current.setAbortAction(true)
        return
    }

    if (duplicateCheck.enforce(current)) {
        // enforce() has already set approval_status = duplicate, duplicate_of,
        // duplicate_check, rejection_reason and left flow_started false.
        gs.addErrorMessage(current.getValue('rejection_reason'))
    }
})()
