/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Protect Approval Fields
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 150
 * active: true
 * field: script
 */

/**
 * ClaimEase - Protect Approval Fields  (before update, order 150)
 *
 * PURPOSE
 *   Server-side authorisation guard for the approval decision fields and for
 *   the financial facts of a claim. This is the control that stops an employee
 *   approving their own claim by any route — form, Service Portal, Table API or
 *   a server script — because it sits in the save path rather than in the UI.
 *
 *   It runs at order 150: after "Normalise Amount" (100) and BEFORE "Validate
 *   Claim" (200), so an unauthorised write is rejected before any other work is
 *   done on it.
 *
 * WHAT IS GUARDED
 *   1. `manager_approval`  - only the recorded manager, a ClaimEase admin, or
 *      the approval automation may change it.
 *   2. `finance_approval`  - only a member of the configured Finance group, a
 *      holder of the `x_2180676_claime_0.finance_approver` role, a ClaimEase
 *      admin, or the approval automation may change it.
 *   3. `amount`, `amount_usd`, `requested_for` - frozen once the claim has left
 *      `draft`, except for admins. These are the facts the approval decision
 *      was based on, so they must not move underneath an approver.
 *   4. Approval transitions - e.g. Finance cannot approve a claim the manager
 *      has rejected, and no approval decision is accepted on a claim that is
 *      `cancelled` or `duplicate`.
 *
 * AUTOMATION BYPASS (documented mechanism)
 *   The approval flow records decisions on behalf of an approver, so it cannot
 *   satisfy "you must BE the manager". The agreed bypass, implemented in
 *   `ClaimEaseValidator.isApprovalAutomation()`, requires ALL THREE of:
 *     a) `current.flow_started` is true - the approval process really is running;
 *     b) the session scratchpad flag `x_2180676_claime_0.approval_automation`
 *        is set to 'true' (the flow sets it immediately before the update and
 *        clears it afterwards); and
 *     c) the session holds a ClaimEase approval role.
 *   The flag alone is never sufficient, so it cannot be forged by an employee.
 *
 * Thin by design: all authorisation logic lives in ClaimEaseValidator.
 */
;(function executeRule() {
    var validator = new ClaimEaseValidator()

    if (!previous) {
        return
    }

    var isAdmin = validator.isClaimEaseAdmin()
    var blocked = false

    /* ---------- 1. Manager approval ---------- */
    var managerChanged = current.getValue('manager_approval') !== previous.getValue('manager_approval')
    if (managerChanged && !validator.canSetManagerApproval(current)) {
        gs.error(
            '[ClaimEase] Rejected an unauthorised manager_approval change on claim ' +
                current.getValue('number') +
                '.'
        )
        gs.addErrorMessage(
            'Only the manager recorded on this claim can record the manager decision. ' +
                'Please use your approval record, or contact your ClaimEase administrator.'
        )
        blocked = true
    }

    /* ---------- 2. Finance approval ---------- */
    var financeChanged = current.getValue('finance_approval') !== previous.getValue('finance_approval')
    if (financeChanged && !validator.canSetFinanceApproval(current)) {
        gs.error(
            '[ClaimEase] Rejected an unauthorised finance_approval change on claim ' +
                current.getValue('number') +
                '.'
        )
        gs.addErrorMessage(
            'Only a member of the ClaimEase Finance approver group can record the finance decision. ' +
                'Please contact your ClaimEase administrator if you need access.'
        )
        blocked = true
    }

    /* ---------- 3. Financial facts frozen after draft ---------- */
    var hasLeftDraft = previous.getValue('approval_status') !== 'draft'
    if (hasLeftDraft && !isAdmin) {
        var frozen = [
            { field: 'amount', label: 'claim amount' },
            { field: 'amount_usd', label: 'normalised claim amount' },
            { field: 'requested_for', label: 'employee the claim is for' },
        ]
        for (var i = 0; i < frozen.length; i++) {
            if (current.getValue(frozen[i].field) !== previous.getValue(frozen[i].field)) {
                gs.error(
                    '[ClaimEase] Rejected a change to the protected field "' +
                        frozen[i].field +
                        '" on claim ' +
                        current.getValue('number') +
                        ' after it left draft.'
                )
                gs.addErrorMessage(
                    'The ' +
                        frozen[i].label +
                        ' cannot be changed once the claim has been submitted. ' +
                        'Please cancel this claim and raise a new one, or contact your ClaimEase administrator.'
                )
                blocked = true
            }
        }
    }

    /* ---------- 4. Transition validity ---------- */
    var transitionErrors = validator.validateApprovalTransition(current, previous)
    for (var j = 0; j < transitionErrors.length; j++) {
        gs.addErrorMessage(transitionErrors[j])
        blocked = true
    }
    if (transitionErrors.length) {
        gs.error(
            '[ClaimEase] Rejected ' +
                transitionErrors.length +
                ' invalid approval transition(s) on claim ' +
                current.getValue('number') +
                '.'
        )
    }

    if (blocked) {
        current.setAbortAction(true)
    }
})()
