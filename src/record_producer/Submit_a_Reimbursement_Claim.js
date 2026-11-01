/* ClaimEase - record_producer
 * name: Submit a Reimbursement Claim
 * table_name: x_2180676_claime_0_claim
 * mandatory_attachment: true
 * field: script
 */

/**
 * ClaimEase - Record Producer script: "Submit a Reimbursement Claim"
 * ============================================================================
 * Runs on the SERVER, BEFORE the claim row is inserted (pre-insert script of
 * `sc_cat_item_producer`). It never calls insert(), update() or
 * setAbortAction() — those are forbidden in a record producer script.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS SCRIPT IS RESPONSIBLE FOR
 * ----------------------------------------------------------------------------
 *   1. Identity      - requested_for / submitted_by are forced to the
 *                      authenticated user unless delegated submission is
 *                      explicitly permitted.
 *   2. Approver       - manager is resolved through ClaimEaseValidator; when the
 *                      fallback approver group has to be used, the exception
 *                      context is recorded on `exception_reason` so the claim is
 *                      routed to the administrator exception queue instead of
 *                      bypassing approval.
 *   3. Validation     - ClaimEaseValidator.validate() decides. On failure the
 *                      friendly messages are shown and the claim is NOT turned
 *                      into an eligible submitted claim.
 *   4. Duplicates     - the per-employee submission mutex is taken first (the
 *                      same mutex, via the same helper, as the "Duplicate
 *                      Guard" business rule), then ClaimEaseDuplicateCheck runs.
 *                      On a hit the returned friendly message is shown and the
 *                      claim is left as `duplicate` with no approval started.
 *   5. Submission     - ONLY when 3 and 4 both pass does approval_status become
 *                      'submitted'. That single assignment is what lets the
 *                      lifecycle rule stamp submitted_on and the after-insert
 *                      "Start Approval Process" rule run. The approval process
 *                      therefore starts only after a valid claim is created.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
 * ----------------------------------------------------------------------------
 *   - It does not re-validate after the business rules: "Validate Claim"
 *     (order 200) re-runs exactly the same validator for every interface and
 *     aborts the save if it fails.
 *   A small amount of double work (the duplicate guard re-running the same
 *   check) is accepted on purpose: the rules must stay authoritative for the
 *   form, the Table API, scripts and flows, not just for this producer.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS SCRIPT NOW STAMPS FIELDS THE BUSINESS RULES "OWN"
 * ----------------------------------------------------------------------------
 *   This script previously delegated `amount_usd` to "Normalise Amount"
 *   (order 100), `submitted_on` / `last_status_update` to "Lifecycle Stamps"
 *   (order 400) and `flow_started` to "Start Approval Process" (order 500).
 *
 *   That delegation does not survive this submission path. The Service Portal
 *   posts to /api/sn_sc/v1/servicecatalog/items/{sys_id}/submit_producer, which
 *   calls sn_sc.CatItem.submitProducer(); on that path `current` is NULL inside
 *   the scoped before-insert business rules. Every one of them throws
 *   "Cannot convert null to an object" and applies none of its writes, so a
 *   portal claim committed with amount_usd empty, submitted_on empty,
 *   last_status_update empty and flow_started false.
 *
 *   The consequences were severe and silent:
 *     - flow_started false  -> the approval flow's trigger never fires, so the
 *                              claim is stranded at `submitted` with no
 *                              approval record (observed on CLM0001007);
 *     - amount_usd empty    -> threshold routing cannot choose a path AND the
 *                              90-day duplicate rule cannot evaluate, because
 *                              both read the normalised amount.
 *
 *   Those four values are therefore stamped here, where `current` is a valid
 *   GlideRecord received as a parameter. The business rules are unchanged and
 *   remain authoritative for the form, Table API, script and flow paths; they
 *   are idempotent, so on this path they simply agree with what is already set.
 *
 * FIELD POPULATION NOTE
 *   Every mapped variable is also copied onto `current` here, from the
 *   `producer` object, before anything is validated. The variables already
 *   carry `mapToField`, so the platform mapping writes the same values; copying
 *   them explicitly makes this script independent of whether the platform
 *   applies that mapping before or after the producer script runs, so
 *   validation and duplicate detection always see a fully populated claim.
 */
;(function executeProducerScript(current, producer) {
    var config = new ClaimEaseConfig()
    var currency = new ClaimEaseCurrency()
    var validator = new ClaimEaseValidator()
    var duplicateCheck = new ClaimEaseDuplicateCheck()

    var MAX_TEXT = 255
    var callerSysId = '' + gs.getUserID()

    /* ---------------------------------------------------------------- *
     * 1. Identity — the server is the authority, not the form
     * ---------------------------------------------------------------- */
    var submittedRequestedFor = trim(producer.requested_for_employee)
    var delegationAllowed = config.allowDelegatedSubmission() || validator.isClaimEaseAdmin()
    var requestedFor = submittedRequestedFor

    if (!requestedFor) {
        requestedFor = callerSysId
    } else if (requestedFor !== callerSysId && !delegationAllowed) {
        // The variable is read-only and defaulted, so this can only happen if
        // the submitted payload was tampered with. Ignore it silently for the
        // employee and record the fact for administrators.
        gs.info(
            '[ClaimEase] Record producer ignored a Requested for value that differs from the authenticated user; ' +
                'delegated submission is not permitted by policy.'
        )
        requestedFor = callerSysId
    }

    current.setValue('requested_for', requestedFor)
    current.setValue('submitted_by', callerSysId)

    /* ---------------------------------------------------------------- *
     * 2. The rest of the form
     * ---------------------------------------------------------------- */
    setIfProvided('category', producer.claim_category)
    setIfProvided('short_description', producer.claim_summary)
    setIfProvided('amount', producer.claim_amount)
    setIfProvided('expense_date', producer.expense_incurred_on)
    setIfProvided('description', producer.claim_details)

    /* ---------------------------------------------------------------- *
     * 3. Approving manager, or the documented exception route
     * ---------------------------------------------------------------- */
    var resolved = validator.resolveManager(requestedFor)
    if (resolved.managerSysId) {
        current.setValue('manager', resolved.managerSysId)
    } else {
        // resolveManager never answers "no approval needed". Record WHY the
        // fallback group owns this claim so it lands in the administrator
        // exception queue rather than quietly skipping approval.
        current.setValue(
            'exception_reason',
            truncate(
                'No active manager could be resolved for this employee, so the claim is routed to the fallback ' +
                    'approver group (' +
                    config.getFallbackGroupName() +
                    '). ' +
                    (resolved.error || ''),
                MAX_TEXT
            )
        )
        gs.info(
            '[ClaimEase] Record producer could not resolve a manager; routing the claim to the fallback approver group. Reason: ' +
                resolved.error
        )
    }

    /* ---------------------------------------------------------------- *
     * 4. Validation — friendly messages, and never an eligible claim
     * ---------------------------------------------------------------- */
    var validation = validator.validate(current, {
        // No attachment can exist before the record does, so the receipt rule
        // is evaluated by the business rules on the transition into submitted.
        // The form itself requires an attachment (mandatoryAttachment).
        checkReceipt: false,
    })

    if (!validation.valid) {
        for (var i = 0; i < validation.errors.length; i++) {
            gs.addErrorMessage(validation.errors[i])
        }
        // Leave the claim as a draft: not submitted, so nothing downstream
        // treats it as an eligible claim and no approval can start. The
        // "Validate Claim" business rule will additionally refuse the save.
        current.setValue('approval_status', 'draft')
        current.setValue(
            'exception_reason',
            truncate('Submission refused by validation: ' + validation.errors.join(' '), MAX_TEXT)
        )
        gs.info(
            '[ClaimEase] Record producer refused a submission with ' + validation.errors.length + ' validation issue(s).'
        )
        return
    }

    /* ---------------------------------------------------------------- *
     * 5. Duplicate detection — lock first, exactly like the guard rule
     * ---------------------------------------------------------------- */

    // The duplicate rule works on the normalised amount. `amount_usd` is owned
    // by the "Normalise Amount" business rule and is not populated yet, so the
    // same shared converter is used here to obtain the value. Nothing is
    // written to amount_usd from this script.
    var converted = currency.toBaseCurrency(current.getValue('amount'))
    if (!converted.ok) {
        gs.addErrorMessage(
            'We could not convert this claim amount into ' +
                config.getBaseCurrency() +
                ', so it has not been sent for approval. Please contact your ClaimEase administrator.'
        )
        current.setValue('approval_status', 'draft')
        current.setValue(
            'exception_reason',
            truncate('Claim amount could not be normalised: ' + converted.error, MAX_TEXT)
        )
        gs.error('[ClaimEase] Record producer could not normalise the claim amount: ' + converted.error)
        return
    }

    /* ---------------------------------------------------------------- *
     * 5b. Stamp the normalised amount
     * ----------------------------------------------------------------
     * DEFECT FIX. `amount_usd` is nominally owned by the "Normalise Amount"
     * business rule, but on THIS submission path (the Service Portal posts to
     * /api/sn_sc/v1/servicecatalog/items/{sys_id}/submit_producer, which calls
     * sn_sc.CatItem.submitProducer) `current` is null inside the scoped
     * before-insert business rules, so every one of them throws
     * "Cannot convert null to an object" and applies none of its writes.
     * Claims therefore committed with amount_usd empty, which silently
     * disabled BOTH the threshold routing and the 90-day duplicate rule.
     * Observed on CLM0001006 and CLM0001007.
     *
     * The conversion has already succeeded above, so the value is written here
     * where `current` is a valid GlideRecord passed in as a parameter. The
     * business rule remains authoritative for the form, Table API, script and
     * flow paths, and is idempotent, so it simply agrees with this value.
     * ---------------------------------------------------------------- */
    current.setValue('amount_usd', converted.value)

    // The claim sys_id is a stable, unique owner token for this submission
    // attempt, and is the SAME token the "Duplicate Guard" and "Release
    // Submission Lock" rules use, so the acquire later in the transaction is
    // re-entrant rather than a self-deadlock.
    var ownerToken = '' + (current.getUniqueValue() || '')
    if (ownerToken) {
        var lock = duplicateCheck.acquireSubmissionLock(requestedFor, ownerToken)
        if (!lock.acquired) {
            gs.error('[ClaimEase] Serialised submission refused in the record producer: ' + lock.error)
            gs.addErrorMessage(
                'Another reimbursement claim for this employee is being submitted right now. ' +
                    'Please wait a moment and submit again.'
            )
            current.setValue('approval_status', 'draft')
            return
        }
        // Released by the after insert/update "Release Submission Lock" rule,
        // once the claim row has committed. Releasing earlier would re-open the
        // race the mutex exists to close.
    } else {
        gs.info(
            '[ClaimEase] No claim sys_id was available in the record producer, so the submission mutex is left to the ' +
                '"Duplicate Guard" business rule, which always takes it before querying.'
        )
    }

    var duplicate = duplicateCheck.check(requestedFor, converted.value, ownerToken)
    current.setValue('duplicate_check', true)

    if (duplicate.isDuplicate) {
        // `message` already includes the existing claim number and status ONLY
        // when the caller is allowed to see them.
        gs.addErrorMessage(duplicate.message)
        current.setValue('duplicate_of', duplicate.existingSysId)
        current.setValue('approval_status', 'duplicate')
        current.setValue('rejection_reason', duplicate.message)
        // Belt and braces: a blocked submission must never start an approval.
        current.setValue('flow_started', false)
        current.setValue(
            'exception_reason',
            truncate('Duplicate small-value claim within the rolling duplicate window.', MAX_TEXT)
        )
        return
    }

    /* ---------------------------------------------------------------- *
     * 6. Valid and not a duplicate: this is the ONLY path to submitted
     * ---------------------------------------------------------------- */
    current.setValue('approval_status', 'submitted')

    /* ---------------------------------------------------------------- *
     * 7. Lifecycle stamps and arming the approval process
     * ----------------------------------------------------------------
     * DEFECT FIX — same root cause as the amount_usd stamp above. Because the
     * scoped before-insert business rules receive a null `current` on the
     * submit_producer path, neither "Lifecycle Stamps" (order 400) nor
     * "Start Approval Process" (order 500) applied anything, so portal claims
     * committed with submitted_on empty, last_status_update empty and
     * flow_started false. flow_started false means the approval flow's trigger
     * never fires, which is why CLM0001007 ($105) sat at `submitted` with
     * manager_approval = not_requested and no approval record anywhere.
     *
     * These four values are written here, in the same INSERT, so the committed
     * row already carries them.
     *
     * `submitted_on` anchors the rolling duplicate window, so it is only ever
     * set when empty and is never rewritten by a later save — matching the
     * business rule's own contract.
     *
     * flow_started is set LAST and only on this path: the validation-failure,
     * conversion-failure and lock-failure branches above all return early
     * leaving the claim as `draft`, and the duplicate branch explicitly sets
     * flow_started false. A blocked claim therefore still never starts an
     * approval.
     * ---------------------------------------------------------------- */
    var nowStamp = new GlideDateTime().getValue()

    if (!current.getValue('submitted_on')) {
        current.setValue('submitted_on', nowStamp)
    }
    current.setValue('last_status_update', nowStamp)
    current.setValue('flow_started', true)

    gs.info(
        '[ClaimEase] Record producer submitted a valid claim and armed the approval process ' +
            '(amount_usd, submitted_on, last_status_update and flow_started stamped in the same insert).'
    )

    /* ---------------------------------------------------------------- *
     * Helpers
     * ---------------------------------------------------------------- */

    /** Copies a producer variable onto the claim, but never blanks a value. */
    function setIfProvided(fieldName, value) {
        var cleaned = trim(value)
        if (cleaned !== '') {
            current.setValue(fieldName, cleaned)
        }
    }

    function trim(value) {
        if (value === null || value === undefined) {
            return ''
        }
        return ('' + value).replace(/^\s+|\s+$/g, '')
    }

    function truncate(text, maxLength) {
        var value = '' + (text || '')
        return value.length > maxLength ? value.substring(0, maxLength) : value
    }
})(current, producer)
