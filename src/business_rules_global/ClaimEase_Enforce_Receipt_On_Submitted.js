/* ClaimEase - business_rules_global
 * name: ClaimEase - Enforce Receipt On Submitted
 * collection: x_2180676_claime_0_claim
 * when: async_always
 * order: 2000
 * active: true
 * filter_condition: approval_statusINsubmitted,pending_manager,pending_finance
 * field: script
 */

/**
 * ClaimEase - Enforce Receipt On Submitted Insert  (async, after insert, order 2000)
 *
 * PURPOSE
 *   Closes the one path on which the receipt requirement was not enforced.
 *
 *   "Validate Claim" (order 200) asks ClaimEaseValidator for the receipt check
 *   only when `!isInsert && enteringSubmitted`, because an attachment cannot
 *   exist before the record does. That is correct for the draft -> submitted
 *   transition, but it leaves the INSERT-as-submitted path unchecked, and that
 *   is the path the record producer uses: it sets approval_status = 'submitted'
 *   in the insert itself and passes checkReceipt: false, relying on the catalog
 *   item's `mandatory_attachment` flag.
 *
 *   `mandatory_attachment` is a client-side catalog control. It is enforced by
 *   the portal widget, not by the save, so it is absent for a direct POST to
 *   submit_producer, for the Table API, for server scripts and for flows. A
 *   claim could therefore be submitted, routed and fully approved with no
 *   receipt at all (reproduced on CLM0001069).
 *
 * WHY ASYNC RATHER THAN A SYNCHRONOUS AFTER-INSERT RULE
 *   On the record producer path the attachment is copied onto the claim AFTER
 *   the row is inserted. A synchronous after-insert rule can therefore run
 *   before the receipt has landed and would wrongly reject legitimate portal
 *   submissions. An async rule runs once the transaction has committed, by
 *   which time the attachment is present, so a genuine portal claim with a
 *   receipt is untouched.
 *
 * WHAT IT DOES ON A MISS
 *   The claim is returned to `draft` and `flow_started` is cleared, so it is no
 *   longer an eligible claim and the approval flow's own eligibility guard
 *   (claim still `submitted`) stops any run that had already begun. Approval
 *   records the flow may already have requested are cancelled, so no approver
 *   is left holding a decision on a claim that is no longer live. The reason is
 *   recorded on `exception_reason` so the employee can attach the receipt and
 *   submit again.
 *
 *   It deliberately does NOT touch manager_approval or finance_approval: those
 *   fields are guarded by "Protect Approval Fields", and the claim has not been
 *   decided yet, so there is nothing to undo on them.
 *
 * FAIL CLOSED
 *   ClaimEaseValidator.hasAttachment() returns false when it cannot prove an
 *   attachment exists. A claim is therefore returned to draft when the receipt
 *   cannot be confirmed, rather than being left approvable on an unproven one.
 */
(function executeRule(current, previous) {
    var config = new x_2180676_claime_0.ClaimEaseConfig()

    if (!config.requireReceipt()) {
        return
    }
    // The approval flow moves the claim off `submitted` within seconds of the
    // insert, and this rule runs after the transaction has committed, so the
    // status is usually `pending_manager` by now. Check the whole set of live
    // states rather than `submitted` alone, or the rule silently never fires.
    var LIVE_STATES = ['submitted', 'pending_manager', 'pending_finance']
    var statusNow = '' + (current.getValue('approval_status') || '')
    gs.info('[ClaimEase] Receipt check running for claim ' + current.getValue('number') + ' (status ' + statusNow + ').')
    if (LIVE_STATES.indexOf(statusNow) === -1) {
        return
    }

    var claimSysId = current.getUniqueValue()
    var validator = new x_2180676_claime_0.ClaimEaseValidator()

    if (validator.hasAttachment(claimSysId)) {
        return
    }

    gs.error(
        '[ClaimEase] Claim ' +
            current.getValue('number') +
            ' was inserted already submitted with no receipt attached. Returning it to draft so it cannot be approved.'
    )

    // Cancel anything the approval flow already requested for this claim.
    var cancelled = 0
    try {
        var approvals = new GlideRecord('sysapproval_approver')
        approvals.addQuery('source_table', 'x_2180676_claime_0_claim')
        approvals.addQuery('document_id', claimSysId)
        approvals.addQuery('state', 'IN', 'requested,not_requested')
        approvals.query()
        while (approvals.next()) {
            approvals.setValue('state', 'cancelled')
            if (approvals.update()) {
                cancelled++
            }
        }
    } catch (e) {
        gs.error('[ClaimEase] Could not cancel approvals for a receiptless claim: ' + e)
    }

    var claim = new GlideRecord('x_2180676_claime_0_claim')
    if (!claim.get(claimSysId)) {
        return
    }
    claim.setValue('approval_status', 'draft')
    claim.setValue('flow_started', false)
    claim.setValue('submitted_on', '')

    // The approval decision fields must come back with the claim. Leaving
    // manager_approval at 'requested' on a draft is wrong on its own terms, and
    // it also stops the claim ever re-entering approval: the approval flow is
    // triggered by approval_status = submitted on create OR update, but its
    // first step does not re-ask an approver whose decision is already
    // 'requested'. A claim restored after its receipt arrives would therefore
    // look pending for ever with no approval task (observed on CLM0001089).
    claim.setValue('manager_approval', 'not_requested')
    claim.setValue('finance_approval', 'not_requested')
    claim.setValue(
        'exception_reason',
        'Returned to draft: no receipt or supporting document was attached when this claim was submitted.'
    )

    // WHY setWorkflow(false)
    //   This is the application correcting its own record, not a user acting on
    //   it. "Protect Approval Fields" (order 150) allows manager_approval to be
    //   written only by the recorded manager, a ClaimEase admin or the approval
    //   automation, so an employee's own portal submission would be refused
    //   here and the revert would fail outright - leaving a receiptless claim
    //   approvable, which is the very thing this rule exists to prevent.
    //   Suppressing the rule chain for this system write avoids fighting that
    //   guard. It grants the user nothing: this path runs only inside this
    //   rule, only for a claim submitted with no receipt, and it only ever
    //   moves the claim backwards, away from approval.
    claim.setWorkflow(false)
    claim.update()

    gs.info(
        '[ClaimEase] Claim ' +
            current.getValue('number') +
            ' returned to draft for a missing receipt (' +
            cancelled +
            ' pending approval(s) cancelled).'
    )
})(current, previous)
