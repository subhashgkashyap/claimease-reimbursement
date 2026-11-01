/* ClaimEase - script_includes
 * name: ClaimEaseValidator
 * api_name: x_2180676_claime_0.ClaimEaseValidator
 * active: true
 * access: public
 * field: script
 */

/**
 * ClaimEaseValidator
 * ============================================================================
 * Server-side validation and authorisation for ClaimEase, shared by the record
 * producer and the business rules so that every interface (form, portal, Table
 * API, script, flow) is held to exactly the same rules. There is no
 * client-only validation anywhere in this application.
 *
 * `validate()` returns `{ valid: boolean, errors: string[] }` where every entry
 * in `errors` is a friendly, user-facing sentence. Technical detail (field
 * names, sys_ids, exception text) goes to `gs.error`/`gs.info` ONLY, and never
 * contains another employee's data.
 *
 * This class also owns the approval-field authorisation helpers used by the
 * "Protect Approval Fields" business rule, so that rule can stay thin.
 *
 * Not client callable.
 */
var ClaimEaseValidator = Class.create()

ClaimEaseValidator.prototype = {
    CLAIM_TABLE: 'x_2180676_claime_0_claim',

    /** The eight permitted claim categories. */
    ALLOWED_CATEGORIES: [
        'business_travel',
        'meals',
        'accommodation',
        'medical',
        'office_supplies',
        'internet_phone',
        'training',
        'other',
    ],

    /**
     * Session flag the approval automation sets while it writes approval
     * decisions. See `isApprovalAutomation()` for the full contract.
     */
    AUTOMATION_FLAG: 'x_2180676_claime_0.approval_automation',

    ROLE_ADMIN: 'x_2180676_claime_0.admin',
    ROLE_MANAGER: 'x_2180676_claime_0.manager',
    ROLE_FINANCE: 'x_2180676_claime_0.finance_approver',

    initialize: function () {
        this.config = new ClaimEaseConfig()
        this.currency = new ClaimEaseCurrency()
    },

    /* ================================================================== *
     * VALIDATION
     * ================================================================== */

    /**
     * Validates a claim.
     *
     * @param {GlideRecord} claimGr the claim being created or saved
     * @param {{checkReceipt: boolean}} [options]
     *        `checkReceipt` - evaluate the receipt-attachment requirement.
     *        Callers pass false on insert, because no attachment can exist
     *        before the record does.
     * @return {{valid: boolean, errors: string[]}}
     */
    validate: function (claimGr, options) {
        var errors = []
        var opts = options || {}

        if (!claimGr) {
            gs.error('[ClaimEase] ClaimEaseValidator.validate was called without a record.')
            return { valid: false, errors: ['The claim could not be validated. Please try again.'] }
        }

        this._validateMandatory(claimGr, errors)
        this._validateAmount(claimGr, errors)
        this._validateCategory(claimGr, errors)
        this._validateExpenseDate(claimGr, errors)
        this._validateRequestedFor(claimGr, errors)
        this._validateDelegation(claimGr, errors)

        if (opts.checkReceipt === true) {
            this._validateReceipt(claimGr, errors)
        }

        return { valid: errors.length === 0, errors: errors }
    },

    /** Mandatory fields that must be present on every claim. */
    _validateMandatory: function (claimGr, errors) {
        var mandatory = [
            { field: 'short_description', label: 'a short description of the expense' },
            { field: 'requested_for', label: 'the employee the claim is for' },
            { field: 'category', label: 'a claim category' },
            { field: 'amount', label: 'the claim amount' },
            { field: 'expense_date', label: 'the date the expense was incurred' },
        ]
        for (var i = 0; i < mandatory.length; i++) {
            var value = claimGr.getValue(mandatory[i].field)
            if (value === null || value === undefined || ('' + value).replace(/^\s+|\s+$/g, '') === '') {
                errors.push('Please provide ' + mandatory[i].label + '.')
            }
        }
    },

    /** The amount must parse and be strictly greater than zero. */
    _validateAmount: function (claimGr, errors) {
        var raw = claimGr.getValue('amount')
        if (raw === null || raw === undefined || ('' + raw) === '') {
            // Already reported by the mandatory check.
            return
        }

        var parsed = this.currency.parseAmount(raw)
        if (!parsed.ok) {
            gs.error('[ClaimEase] Amount validation failed: ' + parsed.error)
            errors.push('Please enter the claim amount as a number, for example 24.50.')
            return
        }
        if (parsed.value === 0) {
            errors.push('The claim amount cannot be zero. Please enter the amount you actually spent.')
            return
        }
        if (parsed.value < 0) {
            errors.push('The claim amount cannot be negative. Please enter a positive amount.')
        }
    },

    /** Category must be one of the eight allowed values. */
    _validateCategory: function (claimGr, errors) {
        var category = '' + (claimGr.getValue('category') || '')
        if (category === '') {
            // Already reported by the mandatory check.
            return
        }
        if (this.ALLOWED_CATEGORIES.indexOf(category) === -1) {
            gs.error('[ClaimEase] Rejected an unrecognised claim category value: "' + category + '".')
            errors.push('Please choose one of the available claim categories.')
        }
    },

    /** Expense date must be a real date, and not in the future unless configured. */
    _validateExpenseDate: function (claimGr, errors) {
        var raw = '' + (claimGr.getValue('expense_date') || '')
        if (raw === '') {
            // Already reported by the mandatory check.
            return
        }

        var expenseDate
        try {
            expenseDate = new GlideDate()
            expenseDate.setValue(raw)
            if (!expenseDate.getValue()) {
                throw 'empty after parse'
            }
        } catch (e) {
            gs.error('[ClaimEase] Expense date "' + raw + '" could not be parsed: ' + e)
            errors.push('Please enter a valid expense date.')
            return
        }

        if (this.config.allowFutureExpenseDate()) {
            return
        }

        // GlideDate() with no arguments is initialised to the current date.
        var today = new GlideDate()
        if (expenseDate.compareTo(today) > 0) {
            errors.push('The expense date cannot be in the future. Please enter the date you actually incurred the expense.')
        }
    },

    /** requested_for must point at an existing, active user. */
    _validateRequestedFor: function (claimGr, errors) {
        var userSysId = '' + (claimGr.getValue('requested_for') || '')
        if (userSysId === '') {
            // Already reported by the mandatory check.
            return
        }
        var user = new GlideRecord('sys_user')
        if (!user.get(userSysId)) {
            gs.error('[ClaimEase] requested_for points at a user record that does not exist.')
            errors.push('The employee selected for this claim could not be found. Please choose a valid employee.')
            return
        }
        if (user.getValue('active') !== '1') {
            gs.error('[ClaimEase] requested_for points at an inactive user record.')
            errors.push('Claims cannot be raised for an inactive employee. Please choose an active employee.')
        }
    },

    /**
     * Delegated submission (requested_for differs from the submitter) is only
     * allowed when policy permits it or the caller is a ClaimEase admin.
     */
    _validateDelegation: function (claimGr, errors) {
        var requestedFor = '' + (claimGr.getValue('requested_for') || '')
        if (requestedFor === '') {
            return
        }
        var submittedBy = '' + (claimGr.getValue('submitted_by') || gs.getUserID())
        if (requestedFor === submittedBy) {
            return
        }
        if (this.config.allowDelegatedSubmission() || this.isClaimEaseAdmin()) {
            return
        }
        gs.error('[ClaimEase] Blocked a delegated submission while allow_delegated_submission is false.')
        errors.push(
            'You can only submit reimbursement claims for yourself. Please ask the employee to submit their own claim, ' +
                'or contact your ClaimEase administrator.'
        )
    },

    /** At least one attachment is required when require_receipt is true. */
    _validateReceipt: function (claimGr, errors) {
        if (!this.config.requireReceipt()) {
            return
        }
        var claimSysId = claimGr.getUniqueValue()
        if (!claimSysId) {
            return
        }
        if (this.hasAttachment(claimSysId)) {
            return
        }
        errors.push('Please attach a receipt or supporting document before submitting this claim.')
    },

    /**
     * @param {string} claimSysId
     * @return {boolean} true when the claim has at least one attachment
     */
    hasAttachment: function (claimSysId) {
        try {
            var attachments = new GlideRecord('sys_attachment')
            attachments.addQuery('table_name', this.CLAIM_TABLE)
            attachments.addQuery('table_sys_id', claimSysId)
            attachments.setLimit(1)
            attachments.query()
            return attachments.hasNext()
        } catch (e) {
            gs.error('[ClaimEase] Could not check attachments for a claim: ' + e)
            // Fail closed: if we cannot prove a receipt exists, treat it as missing.
            return false
        }
    },

    /* ================================================================== *
     * APPROVER RESOLUTION
     * ================================================================== */

    /**
     * Resolves the approving manager for an employee.
     *
     * This NEVER returns "no approval needed". When the employee has no manager
     * on their user record, the configured fallback approver group is returned
     * instead, so the claim is routed to the exception queue rather than being
     * auto-approved or silently stalled.
     *
     * @param {string} userSysId sys_user sys_id
     * @return {{managerSysId: string, usedFallback: boolean, fallbackGroupSysId: string, error: string}}
     */
    resolveManager: function (userSysId) {
        var result = { managerSysId: '', usedFallback: false, fallbackGroupSysId: '', error: '' }

        if (!userSysId) {
            result.usedFallback = true
            result.fallbackGroupSysId = this.config.getFallbackGroupSysId()
            result.error = 'No employee was supplied, so the claim must be routed to the fallback approver group.'
            gs.error('[ClaimEase] resolveManager called without a user sys_id.')
            return result
        }

        try {
            var user = new GlideRecord('sys_user')
            if (!user.get(userSysId)) {
                result.usedFallback = true
                result.fallbackGroupSysId = this.config.getFallbackGroupSysId()
                result.error = 'The employee record could not be found.'
                gs.error('[ClaimEase] resolveManager could not load the supplied user record.')
                return result
            }

            var managerSysId = '' + (user.getValue('manager') || '')
            if (managerSysId) {
                // A manager who is inactive cannot approve, so fall back.
                var manager = new GlideRecord('sys_user')
                if (manager.get(managerSysId) && manager.getValue('active') === '1') {
                    result.managerSysId = managerSysId
                    return result
                }
                result.error = 'The recorded manager is missing or inactive.'
                gs.info('[ClaimEase] Manager on the employee record is missing or inactive; using the fallback group.')
            } else {
                result.error = 'The employee has no manager recorded.'
                gs.info('[ClaimEase] Employee has no manager recorded; using the fallback group.')
            }
        } catch (e) {
            result.error = 'Manager resolution failed.'
            gs.error('[ClaimEase] resolveManager failed: ' + e)
        }

        result.usedFallback = true
        result.fallbackGroupSysId = this.config.getFallbackGroupSysId()
        if (!result.fallbackGroupSysId) {
            gs.error(
                '[ClaimEase] No manager AND no fallback approver group could be resolved. Check the property ' +
                    'x_2180676_claime_0.fallback_approver_group.'
            )
        }
        return result
    },

    /* ================================================================== *
     * APPROVAL AUTHORISATION (used by "Protect Approval Fields")
     * ================================================================== */

    /** @return {boolean} platform admin or ClaimEase scoped admin */
    isClaimEaseAdmin: function () {
        try {
            return gs.hasRole('admin') || gs.hasRole(this.ROLE_ADMIN)
        } catch (e) {
            return false
        }
    },

    /**
     * DOCUMENTED AUTOMATION BYPASS
     * ----------------------------------------------------------------------
     * The approval automation (Flow Designer) writes `manager_approval` and
     * `finance_approval` on behalf of an approver, so it cannot satisfy the
     * "you must BE the manager" test. The agreed bypass is a session
     * scratchpad flag that the flow sets immediately before it writes the
     * decision and clears afterwards:
     *
     *     gs.getSession().putClientData('x_2180676_claime_0.approval_automation', 'true');
     *     // ... update the claim ...
     *     gs.getSession().clearClientData('x_2180676_claime_0.approval_automation');
     *
     * The flag ALONE is never sufficient. The session must additionally hold a
     * ClaimEase approval role (admin / manager / finance_approver) AND the
     * claim must already have `flow_started = true`, i.e. the approval process
     * really is running for that claim. An employee therefore cannot forge the
     * flag to approve their own claim.
     *
     * @param {GlideRecord} claimGr the claim being updated
     * @return {boolean}
     */
    isApprovalAutomation: function (claimGr) {
        try {
            if (!claimGr || claimGr.getValue('flow_started') !== '1') {
                return false
            }
            var session = gs.getSession()
            if (!session || typeof session.getClientData !== 'function') {
                return false
            }
            var flag = '' + (session.getClientData(this.AUTOMATION_FLAG) || '')
            if (flag !== 'true') {
                return false
            }
            return (
                this.isClaimEaseAdmin() ||
                gs.hasRole(this.ROLE_MANAGER) ||
                gs.hasRole(this.ROLE_FINANCE)
            )
        } catch (e) {
            gs.info('[ClaimEase] Could not evaluate the approval automation bypass: ' + e)
            return false
        }
    },

    /**
     * May the current user change `manager_approval` on this claim?
     * Allowed for: the recorded manager, a ClaimEase admin, or the approval
     * automation.
     *
     * @param {GlideRecord} claimGr
     * @return {boolean}
     */
    canSetManagerApproval: function (claimGr) {
        if (this.isClaimEaseAdmin()) {
            return true
        }
        if (this.isApprovalAutomation(claimGr)) {
            return true
        }
        var recordedManager = '' + (claimGr.getValue('manager') || '')
        return recordedManager !== '' && recordedManager === ('' + gs.getUserID())
    },

    /**
     * May the current user change `finance_approval` on this claim?
     * Allowed for: a member of the configured Finance group, a holder of the
     * finance_approver role, a ClaimEase admin, or the approval automation.
     *
     * @param {GlideRecord} claimGr
     * @return {boolean}
     */
    canSetFinanceApproval: function (claimGr) {
        if (this.isClaimEaseAdmin()) {
            return true
        }
        if (this.isApprovalAutomation(claimGr)) {
            return true
        }
        try {
            if (gs.hasRole(this.ROLE_FINANCE)) {
                return true
            }
        } catch (e) {
            gs.info('[ClaimEase] Role check for the finance approver role failed: ' + e)
        }
        return this.isFinanceGroupMember(gs.getUserID())
    },

    /**
     * @param {string} userSysId
     * @return {boolean} true when the user belongs to the configured Finance group
     */
    isFinanceGroupMember: function (userSysId) {
        var groupSysId = this.config.getFinanceGroupSysId()
        if (!groupSysId || !userSysId) {
            return false
        }
        try {
            var member = new GlideRecord('sys_user_grmember')
            member.addQuery('group', groupSysId)
            member.addQuery('user', userSysId)
            member.setLimit(1)
            member.query()
            return member.hasNext()
        } catch (e) {
            gs.error('[ClaimEase] Could not evaluate Finance group membership: ' + e)
            return false
        }
    },

    /**
     * Validates approval state transitions.
     *
     * @param {GlideRecord} current
     * @param {GlideRecord} previous
     * @return {string[]} friendly errors; empty when the transition is valid
     */
    validateApprovalTransition: function (current, previous) {
        var errors = []
        if (!current || !previous) {
            return errors
        }

        var managerNow = '' + (current.getValue('manager_approval') || '')
        var managerBefore = '' + (previous.getValue('manager_approval') || '')
        var financeNow = '' + (current.getValue('finance_approval') || '')
        var financeBefore = '' + (previous.getValue('finance_approval') || '')
        var statusNow = '' + (current.getValue('approval_status') || '')
        var statusBefore = '' + (previous.getValue('approval_status') || '')

        var managerChanged = managerNow !== managerBefore
        var financeChanged = financeNow !== financeBefore

        if (!managerChanged && !financeChanged) {
            return errors
        }

        // No approval decisions on a closed-out claim.
        var closedStatuses = ['cancelled', 'duplicate']
        if (closedStatuses.indexOf(statusBefore) > -1 || closedStatuses.indexOf(statusNow) > -1) {
            errors.push(
                'This claim has been cancelled or recorded as a duplicate, so it can no longer be approved or rejected.'
            )
            return errors
        }

        // Finance cannot approve a claim the manager has rejected.
        if (financeChanged && financeNow === 'approved' && managerNow === 'rejected') {
            errors.push('Finance cannot approve this claim because the manager has already rejected it.')
        }

        // A recorded decision cannot be quietly rewound to "not requested".
        var decided = ['approved', 'rejected']
        if (managerChanged && decided.indexOf(managerBefore) > -1 && managerNow === 'not_requested') {
            errors.push('The manager decision on this claim has already been recorded and cannot be reset.')
        }
        if (financeChanged && decided.indexOf(financeBefore) > -1 && financeNow === 'not_requested') {
            errors.push('The finance decision on this claim has already been recorded and cannot be reset.')
        }

        return errors
    },

    type: 'ClaimEaseValidator',
}
