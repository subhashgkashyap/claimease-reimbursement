/* ClaimEase - script_includes
 * name: ClaimEaseConfig
 * api_name: x_2180676_claime_0.ClaimEaseConfig
 * active: true
 * access: public
 * field: script
 */

/**
 * ClaimEaseConfig
 * ============================================================================
 * Thin, reusable, read-only accessor over the ClaimEase system properties.
 * Every other ClaimEase artifact (business rules, record producer, flow,
 * notifications, ATF tests) must read configuration through this class so that
 * there is exactly ONE interpretation of each setting.
 *
 * NOTHING in this application may hardcode 50, 90 or "USD".
 *
 * ----------------------------------------------------------------------------
 * THE $50 BOUNDARY RULE (and how to change it)
 * ----------------------------------------------------------------------------
 * Two features depend on "is this a small claim?":
 *   1. Approval routing  — small claims take the PARALLEL path (Manager and
 *      Finance asked at the same time); larger claims take the SEQUENTIAL path
 *      (Manager, then Finance).
 *   2. Duplicate detection — only small claims are subject to the rolling
 *      window "one small claim per employee per N days" rule.
 *
 * The requirement describes behaviour *below* the threshold and *above* the
 * threshold but is silent about an amount exactly EQUAL to it. ClaimEase
 * resolves that boundary explicitly with a property instead of guessing:
 *
 *   x_2180676_claime_0.threshold_boundary = 'sequential'   (DEFAULT)
 *       amount <  threshold  => small  => parallel
 *       amount >= threshold  => large  => sequential
 *       i.e. exactly $50 routes Manager -> Finance (sequential).
 *
 *   x_2180676_claime_0.threshold_boundary = 'parallel'
 *       amount <= threshold  => small  => parallel
 *       amount >  threshold  => large  => sequential
 *       i.e. exactly $50 routes in parallel.
 *
 * `isParallelPath()` and `isSmallClaim()` deliberately share one comparison
 * (`_isWithinSmallBoundary`) so routing and duplicate detection can NEVER
 * disagree about which claims are "small".
 *
 * TO CHANGE THE BOUNDARY:
 *   - Change the amount  -> set `x_2180676_claime_0.approval_threshold`.
 *   - Change the currency the amount is expressed in -> `..._base_currency`.
 *   - Change the exactly-equal case -> `..._threshold_boundary`.
 *   No code change is required for any of these.
 * ----------------------------------------------------------------------------
 *
 * Not client callable: all ClaimEase enforcement is server-side.
 */
var ClaimEaseConfig = Class.create()

ClaimEaseConfig.prototype = {
    /** Property namespace for this application. */
    PREFIX: 'x_2180676_claime_0.',

    /* Documented defaults, used when a property is missing, empty or invalid. */
    DEFAULT_THRESHOLD: 50,
    DEFAULT_BOUNDARY: 'sequential',
    DEFAULT_BASE_CURRENCY: 'USD',
    DEFAULT_WINDOW_DAYS: 90,

    initialize: function () {
        // Cache per-instance so a single transaction does not re-read the same
        // property dozens of times.
        this._groupCache = {}
    },

    /* ------------------------------------------------------------------ *
     * Low level property readers
     * ------------------------------------------------------------------ */

    /**
     * Reads a raw property value as a trimmed string.
     * @param {string} suffix property name without the scope prefix
     * @param {string} dflt value to use when unset/blank
     * @return {string}
     */
    _getString: function (suffix, dflt) {
        var raw = gs.getProperty(this.PREFIX + suffix, dflt)
        if (raw === null || raw === undefined) {
            return dflt
        }
        var value = ('' + raw).replace(/^\s+|\s+$/g, '')
        return value === '' ? dflt : value
    },

    /**
     * Reads a numeric property. Falls back to `dflt` when unset or not a
     * finite number (never throws, never returns NaN).
     */
    _getNumber: function (suffix, dflt) {
        var parsed = parseFloat(this._getString(suffix, ''))
        if (isNaN(parsed) || !isFinite(parsed)) {
            return dflt
        }
        return parsed
    },

    /** Reads a boolean property. Only the literal string "true" is true. */
    _getBoolean: function (suffix, dflt) {
        var value = this._getString(suffix, dflt ? 'true' : 'false').toLowerCase()
        if (value === 'true' || value === '1' || value === 'yes') {
            return true
        }
        if (value === 'false' || value === '0' || value === 'no') {
            return false
        }
        return !!dflt
    },

    /* ------------------------------------------------------------------ *
     * Approval routing / threshold
     * ------------------------------------------------------------------ */

    /**
     * Approval threshold expressed in the base currency.
     * @return {number} defaults to 50 when unset or invalid
     */
    getThreshold: function () {
        var threshold = this._getNumber('approval_threshold', this.DEFAULT_THRESHOLD)
        // A non-positive threshold would make every claim "large" and silently
        // disable duplicate detection, so refuse it.
        if (threshold <= 0) {
            gs.error(
                '[ClaimEase] Property ' +
                    this.PREFIX +
                    'approval_threshold is not a positive number; falling back to ' +
                    this.DEFAULT_THRESHOLD
            )
            return this.DEFAULT_THRESHOLD
        }
        return threshold
    },

    /**
     * How an amount exactly equal to the threshold is treated.
     * @return {string} 'sequential' (default) or 'parallel'
     */
    getBoundaryMode: function () {
        var mode = this._getString('threshold_boundary', this.DEFAULT_BOUNDARY).toLowerCase()
        return mode === 'parallel' ? 'parallel' : 'sequential'
    },

    /**
     * Currency the threshold and the duplicate rule are expressed in.
     * @return {string} upper-case ISO code, defaults to 'USD'
     */
    getBaseCurrency: function () {
        return this._getString('base_currency', this.DEFAULT_BASE_CURRENCY).toUpperCase()
    },

    /**
     * THE single boundary comparison. Both approval routing and duplicate
     * detection call this, which is what keeps them consistent.
     *
     * @param {number|string} amountInBaseCurrency normalised claim amount
     * @return {boolean} true when the amount counts as a "small" claim
     */
    _isWithinSmallBoundary: function (amountInBaseCurrency) {
        var amount = parseFloat(amountInBaseCurrency)
        if (isNaN(amount) || !isFinite(amount)) {
            // An unknown amount is never treated as small: it must not silently
            // gain the parallel path nor silently escape duplicate detection.
            return false
        }
        var threshold = this.getThreshold()
        if (this.getBoundaryMode() === 'parallel') {
            return amount <= threshold
        }
        return amount < threshold
    },

    /**
     * @param {number} amountUsd amount already normalised to the base currency
     * @return {boolean} true => Manager and Finance in parallel
     */
    isParallelPath: function (amountUsd) {
        return this._isWithinSmallBoundary(amountUsd)
    },

    /**
     * Uses the SAME comparison as isParallelPath so duplicate detection and
     * approval routing can never disagree about which claims are "small".
     *
     * @param {number} amountUsd amount already normalised to the base currency
     * @return {boolean}
     */
    isSmallClaim: function (amountUsd) {
        return this._isWithinSmallBoundary(amountUsd)
    },

    /* ------------------------------------------------------------------ *
     * Duplicate prevention
     * ------------------------------------------------------------------ */

    /**
     * Length of the rolling duplicate window, in whole days.
     * @return {number} defaults to 90
     */
    getDuplicateWindowDays: function () {
        var days = Math.floor(this._getNumber('duplicate_window_days', this.DEFAULT_WINDOW_DAYS))
        if (isNaN(days) || days <= 0) {
            return this.DEFAULT_WINDOW_DAYS
        }
        return days
    },

    /** Exclude Cancelled (and Duplicate) claims from duplicate detection. Default true. */
    excludeCancelledFromDuplicate: function () {
        return this._getBoolean('duplicate_exclude_cancelled', true)
    },

    /** Exclude Rejected claims from duplicate detection. Default FALSE — a rejected small claim still blocks. */
    excludeRejectedFromDuplicate: function () {
        return this._getBoolean('duplicate_exclude_rejected', false)
    },

    /* ------------------------------------------------------------------ *
     * Submission validation policy
     * ------------------------------------------------------------------ */

    /** Permit an expense date in the future. Default false. */
    allowFutureExpenseDate: function () {
        return this._getBoolean('allow_future_expense_date', false)
    },

    /** Require at least one receipt attachment before submission. Default true. */
    requireReceipt: function () {
        return this._getBoolean('require_receipt', true)
    },

    /** Allow submitting on behalf of another employee. Default false. */
    allowDelegatedSubmission: function () {
        return this._getBoolean('allow_delegated_submission', false)
    },

    /* ------------------------------------------------------------------ *
     * Approver resolution
     * ------------------------------------------------------------------ */

    /** Name of the group whose members perform Finance approval. */
    getFinanceGroupName: function () {
        return this._getString('finance_group', 'ClaimEase Finance Approvers')
    },

    /** Name of the fallback approver / exception-queue group. */
    getFallbackGroupName: function () {
        return this._getString('fallback_approver_group', 'ClaimEase Claim Administrators')
    },

    /** Finance group approval policy: 'anyone' (default) or 'everyone'. */
    getFinanceGroupPolicy: function () {
        var policy = this._getString('finance_group_policy', 'anyone').toLowerCase()
        return policy === 'everyone' ? 'everyone' : 'anyone'
    },

    /** Service Portal URL suffix used when building employee-facing links. */
    getPortalSuffix: function () {
        return this._getString('portal_suffix', 'claimease')
    },

    /**
     * Resolves a sys_user_group sys_id from its name.
     * @return {string} sys_id, or '' when the group does not exist
     */
    _groupSysIdByName: function (groupName) {
        if (!groupName) {
            return ''
        }
        if (this._groupCache.hasOwnProperty(groupName)) {
            return this._groupCache[groupName]
        }
        var sysId = ''
        try {
            var group = new GlideRecord('sys_user_group')
            group.addQuery('name', groupName)
            group.setLimit(1)
            group.query()
            if (group.next()) {
                sysId = group.getUniqueValue()
            } else {
                gs.error('[ClaimEase] Configured group "' + groupName + '" does not exist in sys_user_group.')
            }
        } catch (e) {
            gs.error('[ClaimEase] Unable to resolve group "' + groupName + '": ' + e)
        }
        this._groupCache[groupName] = sysId
        return sysId
    },

    /** @return {string} sys_id of the Finance approver group, '' when not found */
    getFinanceGroupSysId: function () {
        return this._groupSysIdByName(this.getFinanceGroupName())
    },

    /** @return {string} sys_id of the fallback approver group, '' when not found */
    getFallbackGroupSysId: function () {
        return this._groupSysIdByName(this.getFallbackGroupName())
    },

    type: 'ClaimEaseConfig',
}
