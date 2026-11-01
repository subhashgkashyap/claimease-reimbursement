/* ClaimEase - script_includes
 * name: ClaimEaseDuplicateCheck
 * api_name: x_2180676_claime_0.ClaimEaseDuplicateCheck
 * active: true
 * access: public
 * field: script
 */

/**
 * ClaimEaseDuplicateCheck
 * ============================================================================
 * Reusable, SERVER-ONLY duplicate validation for ClaimEase. This is the single
 * implementation of the rolling-window rule and is callable from the record
 * producer, business rules, the approval flow and ATF tests.
 *
 * ----------------------------------------------------------------------------
 * THE RULE
 * ----------------------------------------------------------------------------
 * A claim is a duplicate when ALL of the following hold:
 *   1. The claim being validated is a SMALL claim, i.e.
 *      `ClaimEaseConfig.isSmallClaim(amount_usd)` is true. Claims at or above
 *      the boundary are returned as "not duplicate" IMMEDIATELY, so the rule can
 *      never block an unrelated claim of $50 or more.
 *   2. The same employee (`requested_for`) has an earlier SMALL claim — the
 *      category is deliberately ignored, as required.
 *   3. That earlier claim has a non-empty `submitted_on` that falls inside the
 *      rolling window. The window is computed with explicit GlideDateTime
 *      arithmetic (`addDaysUTC`) rather than relative-date query strings, so the
 *      boundary and the time zone are unambiguous:
 *
 *          windowStart = now (UTC) addDaysUTC(-duplicate_window_days)
 *          qualifying  <=>  submitted_on >= windowStart
 *
 *      The window start instant is INCLUSIVE: a prior claim submitted at
 *      exactly `windowStart` still blocks. `GlideDateTime.subtract` is used to
 *      log how old the matched claim is.
 *   4. The earlier claim's status is not excluded by configuration:
 *        - `cancelled` AND `duplicate` are excluded when
 *          `duplicate_exclude_cancelled` is true (default true);
 *        - `rejected` is excluded only when `duplicate_exclude_rejected` is true
 *          (default FALSE — a rejected small claim still consumes the window).
 *   5. It is not the record currently being validated (`excludeClaimSysId`).
 *
 * The most recent qualifying claim is returned (ordered by `submitted_on`
 * descending).
 *
 * ----------------------------------------------------------------------------
 * INFORMATION DISCLOSURE
 * ----------------------------------------------------------------------------
 * The friendly message only names the existing claim when the caller is
 * actually allowed to read it (`GlideRecord.canRead()` on the matched record,
 * or the caller is the employee / a ClaimEase admin). Otherwise a generic
 * message with no identifiers is returned, so a delegate or a portal visitor
 * can never learn another employee's claim numbers.
 *
 * ----------------------------------------------------------------------------
 * CONCURRENCY
 * ----------------------------------------------------------------------------
 * `acquireSubmissionLock()` must be called BEFORE `check()` by any caller that
 * is about to create or submit a claim. It takes a per-employee named mutex
 * backed by a UNIQUE database index (see `ClaimEaseLock`), which makes it
 * impossible for two simultaneous qualifying submissions to both pass the
 * query. The lock is released by the "Release Submission Lock" after-rule, once
 * the claim row has committed.
 *
 * Not client callable.
 */
var ClaimEaseDuplicateCheck = Class.create()

ClaimEaseDuplicateCheck.prototype = {
    CLAIM_TABLE: 'x_2180676_claime_0_claim',

    /** Lock lifetime, in seconds. Covers a save transaction without stranding locks. */
    LOCK_TTL_SECONDS: 60,

    initialize: function () {
        this.config = new ClaimEaseConfig()
        this.lock = new ClaimEaseLock()
    },

    /* ------------------------------------------------------------------ *
     * Concurrency helpers
     * ------------------------------------------------------------------ */

    /** @return {string} the named mutex used to serialise one employee's submissions */
    lockKeyFor: function (requestedForSysId) {
        return 'claim_submit:' + requestedForSysId
    },

    /**
     * Serialises submissions for one employee. Call this immediately before
     * `check()` when a claim is being created or submitted.
     *
     * @param {string} requestedForSysId employee the claim is for
     * @param {string} ownerToken        unique per attempt (ClaimEase passes the claim sys_id)
     * @return {{acquired: boolean, reentrant: boolean, lockKey: string, error: string}}
     */
    acquireSubmissionLock: function (requestedForSysId, ownerToken) {
        return this.lock.acquire(
            this.lockKeyFor(requestedForSysId),
            ownerToken,
            this.LOCK_TTL_SECONDS,
            'ClaimEase duplicate guard'
        )
    },

    /**
     * Releases the per-employee submission lock. Safe to call when no lock is
     * held.
     *
     * @return {boolean} true when a lock was released
     */
    releaseSubmissionLock: function (requestedForSysId, ownerToken) {
        return this.lock.release(this.lockKeyFor(requestedForSysId), ownerToken)
    },

    /* ------------------------------------------------------------------ *
     * The rule
     * ------------------------------------------------------------------ */

    /**
     * Start of the rolling window, computed in UTC with explicit arithmetic.
     * @return {GlideDateTime}
     */
    getWindowStart: function () {
        var windowStart = new GlideDateTime()
        windowStart.addDaysUTC(-this.config.getDuplicateWindowDays())
        return windowStart
    },

    /**
     * Evaluates the rolling-window duplicate rule.
     *
     * @param {string} requestedForSysId employee the claim is for
     * @param {number} amountUsd         claim amount normalised to the base currency
     * @param {string} [excludeClaimSysId] sys_id of the claim being validated
     * @return {{isDuplicate: boolean, existingSysId: string, existingNumber: string,
     *           existingStatus: string, message: string, windowStart: string}}
     */
    check: function (requestedForSysId, amountUsd, excludeClaimSysId) {
        var outcome = {
            isDuplicate: false,
            existingSysId: '',
            existingNumber: '',
            existingStatus: '',
            message: '',
            windowStart: '',
        }

        if (!requestedForSysId) {
            gs.error('[ClaimEase] Duplicate check called without a requested_for value; skipping.')
            return outcome
        }

        var amount = parseFloat(amountUsd)
        if (isNaN(amount) || !isFinite(amount)) {
            // The normalisation rule aborts the save before this point, so an
            // unparseable amount here is a programming error, not a duplicate.
            gs.error(
                '[ClaimEase] Duplicate check received a non-numeric normalised amount ("' +
                    amountUsd +
                    '"); treating the claim as not duplicate.'
            )
            return outcome
        }

        // Rule 1: the rule applies to SMALL claims only. Anything at or above the
        // boundary is released immediately.
        if (!this.config.isSmallClaim(amount)) {
            return outcome
        }

        var windowStart = this.getWindowStart()
        outcome.windowStart = windowStart.getValue()

        var threshold = this.config.getThreshold()
        var parallelBoundary = this.config.getBoundaryMode() === 'parallel'

        var claims = new GlideRecord(this.CLAIM_TABLE)
        // Same employee, ANY category.
        claims.addQuery('requested_for', requestedForSysId)
        // Rule 3: a prior claim must actually have been submitted.
        claims.addNotNullQuery('submitted_on')
        claims.addQuery('submitted_on', '>=', windowStart)
        // Rule 2: the prior claim must itself be a small claim. The SAME boundary
        // comparison as ClaimEaseConfig is applied, expressed as a query.
        claims.addQuery('amount_usd', parallelBoundary ? '<=' : '<', threshold)
        // A zero/unset normalised amount is not a real small claim.
        claims.addQuery('amount_usd', '>', 0)
        // Rule 5: never match the record being validated.
        if (excludeClaimSysId) {
            claims.addQuery('sys_id', '!=', excludeClaimSysId)
        }
        // Rule 4: configurable status exclusions.
        var excludedStatuses = this._excludedStatuses()
        if (excludedStatuses.length) {
            claims.addQuery('approval_status', 'NOT IN', excludedStatuses.join(','))
        }
        claims.orderByDesc('submitted_on')
        claims.setLimit(1)
        claims.query()

        if (!claims.next()) {
            return outcome
        }

        outcome.isDuplicate = true
        outcome.existingSysId = claims.getUniqueValue()

        // Diagnostic only - uses GlideDateTime.subtract so the window maths stays explicit.
        var ageDays = this._daysBetween(new GlideDateTime(claims.getValue('submitted_on')), new GlideDateTime())
        gs.info(
            '[ClaimEase] Duplicate small-value claim detected. Matched claim sys_id=' +
                outcome.existingSysId +
                ', submitted ' +
                ageDays +
                ' day(s) ago, window start ' +
                outcome.windowStart +
                ' (inclusive).'
        )

        if (this._callerMayIdentify(claims, requestedForSysId)) {
            outcome.existingNumber = '' + claims.getValue('number')
            outcome.existingStatus = '' + claims.getDisplayValue('approval_status')
            outcome.message = this._specificMessage(outcome, claims.getDisplayValue('submitted_on'))
        } else {
            // No claim number, no status, no dates - nothing identifying.
            outcome.message = this._genericMessage()
        }

        return outcome
    },

    /**
     * Convenience wrapper for business rules. Runs `check()`, always stamps
     * `duplicate_check`, and on a hit marks the claim as a duplicate so that no
     * eligible claim is created and no approval is started.
     *
     * Does NOT call update() — intended for use from a before business rule.
     *
     * @param {GlideRecord} claimGr the claim being saved
     * @return {boolean} true when a duplicate was detected
     */
    enforce: function (claimGr) {
        if (!claimGr) {
            return false
        }

        // Record that duplicate validation has been evaluated, hit or miss.
        claimGr.setValue('duplicate_check', true)

        var result = this.check(
            claimGr.getValue('requested_for'),
            claimGr.getValue('amount_usd'),
            claimGr.getUniqueValue()
        )

        if (!result.isDuplicate) {
            return false
        }

        claimGr.setValue('duplicate_of', result.existingSysId)
        claimGr.setValue('approval_status', 'duplicate')
        // Belt and braces: a blocked submission must never start an approval.
        claimGr.setValue('flow_started', false)
        claimGr.setValue('rejection_reason', result.message)
        claimGr.setValue(
            'exception_reason',
            this._truncate('Duplicate small-value claim within the rolling duplicate window.', 255)
        )

        return true
    },

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    /** @return {string[]} approval_status values excluded from duplicate detection */
    _excludedStatuses: function () {
        var excluded = []
        if (this.config.excludeCancelledFromDuplicate()) {
            excluded.push('cancelled')
            // A claim already marked as a duplicate must never itself block.
            excluded.push('duplicate')
        }
        if (this.config.excludeRejectedFromDuplicate()) {
            excluded.push('rejected')
        }
        return excluded
    },

    /**
     * Is the caller allowed to be told WHICH claim matched?
     *
     * @param {GlideRecord} matchedClaim the matched claim, positioned
     * @param {string} requestedForSysId employee the new claim is for
     * @return {boolean}
     */
    _callerMayIdentify: function (matchedClaim, requestedForSysId) {
        try {
            // Primary check: record-level read access for the current user.
            if (typeof matchedClaim.canRead === 'function' && matchedClaim.canRead()) {
                return true
            }
            // The employee may always be told about their own claim.
            if (requestedForSysId && ('' + requestedForSysId) === ('' + gs.getUserID())) {
                return true
            }
            // Administrators troubleshooting the exception queue.
            return gs.hasRole('admin') || gs.hasRole('x_2180676_claime_0.admin')
        } catch (e) {
            // Fail closed: never leak on an unexpected error.
            gs.error('[ClaimEase] Could not evaluate read access for a matched duplicate claim: ' + e)
            return false
        }
    },

    _specificMessage: function (outcome, submittedOnDisplay) {
        return (
            'This claim looks like a repeat of claim ' +
            outcome.existingNumber +
            ', which was submitted on ' +
            submittedOnDisplay +
            ' and is currently "' +
            outcome.existingStatus +
            '". Only one reimbursement claim below ' +
            this.config.getThreshold() +
            ' ' +
            this.config.getBaseCurrency() +
            ' can be submitted per employee every ' +
            this.config.getDuplicateWindowDays() +
            ' days, so this claim has been recorded as a duplicate instead of going for approval. ' +
            'If this is a genuinely different expense, please contact your ClaimEase administrator.'
        )
    },

    _genericMessage: function () {
        return (
            'A similar small-value reimbursement claim has already been submitted for this employee within the last ' +
            this.config.getDuplicateWindowDays() +
            ' days. Only one claim below ' +
            this.config.getThreshold() +
            ' ' +
            this.config.getBaseCurrency() +
            ' is allowed in that period, so this claim has been recorded as a duplicate instead of going for approval. ' +
            'Please contact your ClaimEase administrator if you believe this is incorrect.'
        )
    },

    /**
     * Whole days between two instants, using GlideDateTime.subtract so the
     * arithmetic is explicit and time-zone safe.
     *
     * @return {number}
     */
    _daysBetween: function (start, end) {
        try {
            var duration = GlideDateTime.subtract(start, end)
            return Math.floor(duration.getNumericValue() / (1000 * 60 * 60 * 24))
        } catch (e) {
            return -1
        }
    },

    _truncate: function (text, maxLength) {
        var value = '' + (text || '')
        return value.length > maxLength ? value.substring(0, maxLength) : value
    },

    type: 'ClaimEaseDuplicateCheck',
}
