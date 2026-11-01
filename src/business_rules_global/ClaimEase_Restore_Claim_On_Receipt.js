/* ClaimEase - business_rules_global
 * name: ClaimEase - Restore Claim On Receipt
 * collection: sys_attachment
 * when: after
 * order: 2000
 * active: true
 * filter_condition: table_name=x_2180676_claime_0_claim^EQ
 * field: script
 */

/**
 * ClaimEase - Restore Claim On Receipt  (sys_attachment, after insert, order 2000)
 *
 * PURPOSE
 *   Closes the false-positive half of the receipt guarantee.
 *
 *   "ClaimEase - Enforce Receipt On Submitted" (async, order 2000) returns a
 *   claim to draft when it is submitted with no attachment. That is correct and
 *   must stay immediate: a receiptless claim has to become un-approvable at
 *   once, which is the point of the Defect 1 fix. It is also correct for the
 *   Service Portal, where the widget copies the receipt onto the claim inside
 *   the same request, so the async rule sees it.
 *
 *   It is NOT correct when a claim is inserted as `submitted` and the receipt
 *   is uploaded in a SECOND request moments later - how an integration, a
 *   server script or a mobile client submits. The async rule fires in the gap,
 *   finds nothing attached, and reverts a perfectly good claim. Reproduced on
 *   CLM0001080: inserted 14:05:35, receipt available 14:05:37, claim still
 *   returned to draft with its requested manager approval cancelled, and
 *   nothing to put it back.
 *
 *   When the receipt finally arrives, this rule returns the claim to
 *   `submitted` so it re-enters approval. The existing before-update rules then
 *   do their normal work: "Validate Claim" re-checks the receipt (now present),
 *   "Lifecycle Stamps" re-stamps `submitted_on`, and "Start Approval Process"
 *   re-arms the flow.
 *
 * HOW A REVERTED CLAIM IS RECOGNISED
 *   NOT by the enforcement rule's `exception_reason` marker. The approval flow
 *   writes its own exception text when it notices its approvals were cancelled,
 *   and that write lands AFTER the marker, overwriting it (observed on
 *   CLM0001089). The marker is therefore not durable.
 *
 *   The structural evidence is durable. A claim the enforcement rule pulled
 *   back is a draft with no `submitted_on`, `flow_started` false, and at least
 *   one CANCELLED approval that the rule itself cancelled. A draft the employee
 *   simply saved has never had an approval record at all, so it is left alone -
 *   submitting it stays their decision.
 *
 * NO LOOP
 *   The update re-fires the async enforcement rule, which now finds the
 *   attachment and returns early. A later attachment finds the claim no longer
 *   in draft and does nothing.
 *
 * HOW THE APPROVAL IS RE-ARMED
 *   Nothing here asks for approval. The flow's trigger is already
 *   `record_create_or_update` on the claim table with the condition
 *   `approval_status=submitted` and strategy `unique_changes`, so simply
 *   returning the claim to `submitted` re-triggers it. That works only because
 *   the enforcement rule now resets `manager_approval` and `finance_approval`
 *   to 'not_requested' when it pulls the claim back; the flow does not re-ask
 *   an approver whose decision still reads 'requested'. Verified on CLM0001090,
 *   which received a fresh `requested` approval for its manager one second
 *   after its receipt arrived.
 */
;(function executeRule(current, previous) {
    var CLAIM_TABLE = 'x_2180676_claime_0_claim'

    if (('' + current.getValue('table_name')) !== CLAIM_TABLE) {
        return
    }

    var claimSysId = '' + (current.getValue('table_sys_id') || '')
    if (!claimSysId) {
        return
    }

    var claim = new GlideRecord(CLAIM_TABLE)
    if (!claim.get(claimSysId)) {
        return
    }

    // Only a claim that was submitted and then pulled back, never a saved draft.
    if (('' + claim.getValue('approval_status')) !== 'draft') {
        return
    }
    if (('' + (claim.getValue('submitted_on') || '')) !== '') {
        return
    }
    if (claim.getValue('flow_started') == true || ('' + claim.getValue('flow_started')) === 'true') {
        return
    }

    var cancelled = new GlideRecord('sysapproval_approver')
    cancelled.addQuery('source_table', CLAIM_TABLE)
    cancelled.addQuery('document_id', claimSysId)
    cancelled.addQuery('state', 'cancelled')
    cancelled.setLimit(1)
    cancelled.query()
    if (!cancelled.hasNext()) {
        return
    }

    claim.setValue('approval_status', 'submitted')
    claim.setValue('exception_reason', '')
    claim.update()

    gs.info(
        '[ClaimEase] Claim ' +
            claim.getValue('number') +
            ' was returned to submitted because its receipt arrived after the enforcement rule had run.'
    )
})(current, previous)
