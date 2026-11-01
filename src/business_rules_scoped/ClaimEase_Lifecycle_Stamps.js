/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Lifecycle Stamps
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 400
 * active: true
 * field: script
 */

/**
 * ClaimEase - Lifecycle Stamps  (before insert/update, order 400)
 *
 * PURPOSE
 *   Maintains the audit and process timestamps that the flow, the portal, the
 *   notifications and the reports all rely on. Runs last of the before-rules
 *   (order 400) so it stamps the values the earlier rules have settled on.
 *
 *   - `submitted_by`        forced to the authenticated user on insert, so the
 *                           submitter can never be spoofed by any interface.
 *   - `submitted_on`        set the FIRST time the claim becomes `submitted`,
 *                           and only when empty. This is the reference instant
 *                           for the rolling duplicate window, so it must never
 *                           be rewritten by a later save.
 *   - `last_status_update`  refreshed whenever `approval_status` changes.
 *   - `manager`            populated from the requested_for employee's manager
 *                           when empty. When the employee has no usable
 *                           manager, the claim is marked for the fallback /
 *                           exception queue instead of being left unapproved.
 *   - decision stamps       `manager_decision_on`/`by` and
 *                           `finance_decision_on`/`by` are captured when the
 *                           matching approval field moves to approved/rejected.
 *
 * Thin by design: manager resolution lives in ClaimEaseValidator.
 */
;(function executeRule() {
    var validator = new ClaimEaseValidator()

    // See the Duplicate Guard rule: current.operation() is unreliable in the
    // record-producer save path, so insert is detected via `previous`.
    var isInsert = !previous || !previous.getValue('sys_id')
    var now = new GlideDateTime().getValue()
    var currentUser = gs.getUserID()

    /* ---------- Submitter ---------- */
    if (isInsert) {
        // Authoritative: the submitter is always the authenticated user.
        current.setValue('submitted_by', currentUser)
    }

    /* ---------- Status timestamps ---------- */
    var statusNow = '' + (current.getValue('approval_status') || '')
    var statusBefore = !isInsert && previous ? '' + (previous.getValue('approval_status') || '') : ''

    if (statusNow === 'submitted' && !current.getValue('submitted_on')) {
        // First submission only - this instant anchors the duplicate window.
        current.setValue('submitted_on', now)
    }

    if (isInsert || statusNow !== statusBefore) {
        current.setValue('last_status_update', now)
    }

    /* ---------- Manager ---------- */
    if (!current.getValue('manager')) {
        var resolved = validator.resolveManager(current.getValue('requested_for'))
        if (resolved.managerSysId) {
            current.setValue('manager', resolved.managerSysId)
        } else if (!current.getValue('exception_reason')) {
            // Never "no approval needed": record that the fallback approver group
            // owns this claim so the flow routes it to the exception queue.
            gs.info(
                '[ClaimEase] No usable manager for this claim; routing to the fallback approver group. Reason: ' +
                    resolved.error
            )
            current.setValue(
                'exception_reason',
                'No active manager on the employee record - routed to the fallback approver group.'
            )
        }
    }

    /* ---------- Approval decision stamps (audit) ---------- */
    var decided = ['approved', 'rejected']

    var managerNow = '' + (current.getValue('manager_approval') || '')
    var managerBefore = !isInsert && previous ? '' + (previous.getValue('manager_approval') || '') : ''
    if (managerNow !== managerBefore && decided.indexOf(managerNow) > -1) {
        current.setValue('manager_decision_on', now)
        current.setValue('manager_decision_by', currentUser)
    }

    var financeNow = '' + (current.getValue('finance_approval') || '')
    var financeBefore = !isInsert && previous ? '' + (previous.getValue('finance_approval') || '') : ''
    if (financeNow !== financeBefore && decided.indexOf(financeNow) > -1) {
        current.setValue('finance_decision_on', now)
        current.setValue('finance_decision_by', currentUser)
    }
})()
