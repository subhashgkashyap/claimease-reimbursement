/* ClaimEase - portal_widgets
 * name: ClaimEase - My Claims
 * id: x_2180676_claime_0_my_claims
 * field: script
 */

/**
 * ClaimEase - "My Claims" widget server script
 * ============================================================================
 * SECURITY CONTRACT (read this before changing anything below)
 *
 *   1. The table is a constant here. It is never taken from an option or from
 *      input, so this widget can only ever read reimbursement claims.
 *   2. `requested_for` is ALWAYS the authenticated user, resolved with
 *      gs.getUserID() on the server. It is never read from input, so no
 *      crafted payload can widen the result set to another employee's claims.
 *   3. Client-supplied filters are additive only, and are sanitised:
 *        - the claim-number search is passed as a bound CONTAINS term, not as
 *          an encoded query, so it cannot inject query operators;
 *        - category and status must appear in the table's own choice list;
 *        - dates must match yyyy-MM-dd.
 *   4. Rows are read with GlideRecordSecure, so the read ACLs (owned by the
 *      security agent) apply on top of the explicit owner filter.
 *   5. Only whitelisted fields are copied into `data`. `manager`,
 *      `submitted_by`, `amount_usd`, `flow_started`, `duplicate_check`,
 *      `manager_comments`, the approver identity/decision fields and the
 *      internal lock table are never read or returned.
 */
(function () {
    var CLAIM_TABLE = 'x_2180676_claime_0_claim';
    var MAX_SEARCH_LENGTH = 40;
    var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    /** Status -> Bootstrap label class. Each value carries its own meaning. */
    var STATUS_CLASS = {
        draft: 'label-default',
        submitted: 'label-info',
        pending_manager: 'label-warning',
        pending_finance: 'label-warning',
        approved: 'label-success',
        rejected: 'label-danger',
        duplicate: 'label-warning',
        cancelled: 'label-default'
    };

    /** Approval step -> Bootstrap label class. */
    var STEP_CLASS = {
        not_requested: 'label-default',
        requested: 'label-info',
        approved: 'label-success',
        rejected: 'label-danger'
    };

    /* ---------------------------------------------------------------- *
     * Presentation options and the authoritative owner
     * ---------------------------------------------------------------- */
    data.title = options.title || gs.getMessage('My reimbursement claims');
    data.detailPageId = options.detail_page || 'x_2180676_claime_0_claimease_claim';
    data.submitPageId = options.submit_page || 'x_2180676_claime_0_claimease_home';
    data.pageSize = positiveInt(options.page_size, 15);

    // THE owner filter. Server-side, every time, for every caller.
    var ownerSysId = gs.getUserID() + '';

    /* ---------------------------------------------------------------- *
     * Choice lists for the filter controls (from the table's own choices)
     * ---------------------------------------------------------------- */
    data.categoryChoices = choicesFor('category');
    data.statusChoices = choicesFor('approval_status');

    /* ---------------------------------------------------------------- *
     * Sanitise the client-supplied filters
     * ---------------------------------------------------------------- */
    var submitted = (input && input.filters) ? input.filters : {};
    var filters = {
        number: text(submitted.number, MAX_SEARCH_LENGTH),
        category: fromChoices(submitted.category, data.categoryChoices),
        status: fromChoices(submitted.status, data.statusChoices),
        submittedFrom: isoDate(submitted.submittedFrom),
        submittedTo: isoDate(submitted.submittedTo)
    };
    data.filters = filters;
    data.hasFilters = !!(filters.number || filters.category || filters.status || filters.submittedFrom || filters.submittedTo);

    /* ---------------------------------------------------------------- *
     * Count, then fetch exactly one page
     * ---------------------------------------------------------------- */
    data.rowCount = 0;
    try {
        var counter = new GlideAggregate(CLAIM_TABLE);
        applyQuery(counter);
        counter.addAggregate('COUNT');
        counter.query();
        if (counter.next()) {
            data.rowCount = parseInt(counter.getAggregate('COUNT'), 10) || 0;
        }
    } catch (e) {
        gs.error('[ClaimEase] My Claims could not count the employee\'s claims: ' + e);
    }

    data.totalPages = Math.max(1, Math.ceil(data.rowCount / data.pageSize));
    var page = positiveInt(input && input.page, 1);
    if (page > data.totalPages) {
        page = data.totalPages;
    }
    data.page = page;

    data.claims = [];
    try {
        var claims = new GlideRecordSecure(CLAIM_TABLE);
        applyQuery(claims);
        // Newest submission first; created date breaks the tie for drafts that
        // have no submitted_on yet.
        claims.orderByDesc('submitted_on');
        claims.orderByDesc('sys_created_on');
        // chooseWindow (not setLimit) is what makes page 2 actually be page 2.
        claims.chooseWindow((page - 1) * data.pageSize, page * data.pageSize);
        claims.query();

        while (claims.next()) {
            var status = claims.getValue('approval_status') + '';
            var managerStep = claims.getValue('manager_approval') + '';
            var financeStep = claims.getValue('finance_approval') + '';

            data.claims.push({
                sys_id: claims.getUniqueValue() + '',
                number: claims.getValue('number') + '',
                short_description: claims.getValue('short_description') + '',
                category: claims.getDisplayValue('category') + '',
                // Display value carries the claim's own currency, so no
                // currency code is hardcoded anywhere in the portal.
                amount: claims.getDisplayValue('amount') + '',
                expense_date: claims.getDisplayValue('expense_date') + '',
                submitted_on: claims.getDisplayValue('submitted_on') + '',
                last_status_update: claims.getDisplayValue('last_status_update') + '',
                status: claims.getDisplayValue('approval_status') + '',
                statusClass: STATUS_CLASS[status] || 'label-default',
                managerApproval: claims.getDisplayValue('manager_approval') + '',
                managerApprovalClass: STEP_CLASS[managerStep] || 'label-default',
                financeApproval: claims.getDisplayValue('finance_approval') + '',
                financeApprovalClass: STEP_CLASS[financeStep] || 'label-default',
                // Flags only: the full text is shown on the claim detail page.
                hasRejectionReason: !gs.nil(claims.getValue('rejection_reason')),
                hasFinanceComments: !gs.nil(claims.getValue('finance_comments'))
            });
        }
    } catch (e) {
        gs.error('[ClaimEase] My Claims could not read the employee\'s claims: ' + e);
        data.claims = [];
    }

    data.windowStart = data.rowCount === 0 ? 0 : (page - 1) * data.pageSize + 1;
    data.windowEnd = Math.min(page * data.pageSize, data.rowCount);

    /* ================================================================ *
     * Helpers
     * ================================================================ */

    /**
     * Applies the owner filter plus the sanitised client filters.
     * The owner term is added FIRST and unconditionally.
     */
    function applyQuery(gr) {
        gr.addQuery('requested_for', ownerSysId);

        if (filters.number) {
            // Bound query term: the value is data, never query syntax.
            gr.addQuery('number', 'CONTAINS', filters.number);
        }
        if (filters.category) {
            gr.addQuery('category', filters.category);
        }
        if (filters.status) {
            gr.addQuery('approval_status', filters.status);
        }
        // submitted_on is a date-time stored in UTC; the whole local day is
        // covered by using the day's start and end boundaries.
        if (filters.submittedFrom) {
            gr.addQuery('submitted_on', '>=', filters.submittedFrom + ' 00:00:00');
        }
        if (filters.submittedTo) {
            gr.addQuery('submitted_on', '<=', filters.submittedTo + ' 23:59:59');
        }
    }

    /** Active choices for a field on the claim table, in sequence order. */
    function choicesFor(element) {
        var out = [];
        var seen = {};
        try {
            var choice = new GlideRecord('sys_choice');
            choice.addQuery('name', CLAIM_TABLE);
            choice.addQuery('element', element);
            choice.addQuery('inactive', '!=', true);
            choice.orderBy('sequence');
            choice.setLimit(100);
            choice.query();
            while (choice.next()) {
                var value = choice.getValue('value') + '';
                if (!value || seen[value]) {
                    continue;
                }
                seen[value] = true;
                out.push({ value: value, label: choice.getValue('label') + '' });
            }
        } catch (e) {
            gs.error('[ClaimEase] My Claims could not read the choice list for "' + element + '": ' + e);
        }
        return out;
    }

    /** Trimmed, length-capped free text. */
    function text(value, maxLength) {
        if (value === null || value === undefined) {
            return '';
        }
        var cleaned = ('' + value).replace(/^\s+|\s+$/g, '');
        return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
    }

    /** Allow-list check: the value must be one of the table's own choices. */
    function fromChoices(value, choices) {
        var candidate = text(value, 60);
        if (!candidate) {
            return '';
        }
        for (var i = 0; i < choices.length; i++) {
            if (choices[i].value === candidate) {
                return candidate;
            }
        }
        gs.info('[ClaimEase] My Claims ignored an unrecognised filter value submitted by the client.');
        return '';
    }

    /** Accepts yyyy-MM-dd and nothing else. */
    function isoDate(value) {
        var candidate = text(value, 10);
        return ISO_DATE.test(candidate) ? candidate : '';
    }

    function positiveInt(value, fallback) {
        var parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < 1) {
            return fallback;
        }
        return parsed;
    }
})();
