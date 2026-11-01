/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Start Approval Process
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 500
 * active: true
 * filter_condition: approval_status=submitted
 * field: script
 */

/**
 * ClaimEase - Start Approval Process  (before insert/update, order 500)
 *
 * PURPOSE
 *   The SINGLE entry point into the approval process. Its only job is to set
 *   `flow_started` to true on a claim that is genuinely ready for approval.
 *
 * WHY THIS IS NOW A *BEFORE* RULE  (defect fix)
 * ---------------------------------------------------------------------------
 *   It used to be an AFTER INSERT rule that re-read the committed row and
 *   issued a SECOND update() purely so the approval flow could trigger on that
 *   update. That indirection was fragile and it is exactly what broke when
 *   admin-only field write ACLs were present: the second update's write to
 *   `flow_started` was silently stripped, `flow_started` never became true, the
 *   flow's trigger never fired, and the claim was stranded at `submitted`
 *   (observed on CLM0001003).
 *
 *   Setting the flag in the BEFORE phase means `flow_started = true` is part of
 *   the very same INSERT that the record producer performs. The claim row is
 *   committed already carrying the flag, the flow's record trigger fires on the
 *   CREATE, and the approval starts in the same transaction chain with no
 *   dependence on a second update succeeding.
 *
 *   It is registered for insert AND update so that the later draft -> submitted
 *   transition keeps working identically.
 *
 * ORDER 500
 *   Runs after Normalise Amount (100), Protect Approval Fields (150), Validate
 *   Claim (200), Duplicate Guard (300) and Lifecycle Stamps (400), so it sees
 *   the FINAL approval_status and duplicate_of for this save. In particular a
 *   claim that the Duplicate Guard has just turned into a `duplicate` is
 *   correctly skipped.
 *
 * NO-OP CONDITIONS (all are required before anything happens)
 *   - the claim is not `submitted`            -> nothing to approve;
 *   - `flow_started` is already true          -> already running (idempotency);
 *   - the claim was blocked as a duplicate    -> must never approve.
 *
 * IDEMPOTENCY / EXACTLY-ONCE
 *   `flow_started` remains the idempotency guard and is still written in
 *   exactly one place (here). It only ever transitions false -> true, once.
 *   The flow's own eligibility guard (claim still `submitted` AND both
 *   manager_approval and finance_approval still `not_requested`) is the second
 *   line of defence, so even a re-fire of the trigger cannot request a second
 *   round of approvals.
 *
 *   No recursion is possible: this is a before-rule using current.setValue, so
 *   it performs no additional database write of its own.
 */
;(function executeRule() {
    // Guard 1: only a submitted claim starts an approval.
    if (current.getValue('approval_status') !== 'submitted') {
        return
    }
    // Guard 2: idempotency — never restart an approval that is already running.
    if (current.getValue('flow_started') === '1') {
        return
    }
    // Guard 3: a claim blocked as a duplicate must never initiate approvals.
    if (current.getValue('duplicate_of')) {
        return
    }

    current.setValue('flow_started', true)

    gs.info(
        '[ClaimEase] Approval process armed for claim ' +
            current.getValue('number') +
            ' (flow_started set in the same transaction as the save; the approval flow triggers on this create/update).'
    )
})()
