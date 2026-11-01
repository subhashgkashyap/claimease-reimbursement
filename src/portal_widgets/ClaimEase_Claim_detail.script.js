/* ClaimEase - portal_widgets
 * name: ClaimEase - Claim detail
 * id: x_2180676_claime_0_claim_detail
 * field: script
 */

/**
 * ClaimEase - Claim detail widget server script
 * ============================================================================
 * SECURITY CONTRACT
 *
 *   1. The table is a constant: this widget can only ever read a reimbursement
 *      claim, whatever `table` the URL happens to carry.
 *   2. The claim is read with GlideRecordSecure (read ACLs apply) AND
 *      `requested_for` must equal gs.getUserID(). If either check fails the
 *      widget returns NOTHING about the record — just a neutral message — so a
 *      guessed sys_id cannot confirm the existence of another employee's claim.
 *   3. Only the whitelisted fields below are returned. Deliberately NOT
 *      returned: `manager` (the manager is not visible in the portal),
 *      `submitted_by`, `amount_usd`, `flow_started`, `duplicate_check`,
 *      `manager_comments`, `manager_decision_by/on`, `finance_decision_by/on`,
 *      `exception_reason`, and anything from the internal
 *      `x_2180676_claime_0_claim_lock` table.
 *   4. Attachments are listed only for the claim the caller owns, straight from
 *      `sys_attachment` (table_name + table_sys_id). No file content is copied
 *      anywhere; the links point at the platform's own attachment endpoint, and
 *      read protection on those records is enforced by the ACLs.
 */
(function () {
    var CLAIM_TABLE = 'x_2180676_claime_0_claim';
    var SYS_ID = /^[0-9a-f]{32}$/i;

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

    var STEP_CLASS = {
        not_requested: 'label-default',
        requested: 'label-info',
        approved: 'label-success',
        rejected: 'label-danger'
    };

    /** Plain-language explanation of each approval step state. */
    var STEP_HINT = {
        not_requested: gs.getMessage('Not requested yet'),
        requested: gs.getMessage('Waiting for a decision'),
        approved: gs.getMessage('Approved'),
        rejected: gs.getMessage('Rejected')
    };

    data.myClaimsPageId = options.my_claims_page || 'x_2180676_claime_0_claimease_my_claims';
    data.claim = null;
    data.attachments = [];
    data.available = false;
    data.message = '';

    // The sys_id may arrive from the URL or from the client; either way it is
    // only ever used as a sys_id, and ownership is checked below.
    var requestedSysId = '' + ($sp.getParameter('sys_id') || (input && input.sys_id) || '');
    requestedSysId = requestedSysId.replace(/^\s+|\s+$/g, '');

    if (!SYS_ID.test(requestedSysId)) {
        data.message = gs.getMessage('No claim was selected. Open a claim from the My claims page.');
        return;
    }

    var ownerSysId = gs.getUserID() + '';

    try {
        var claim = new GlideRecordSecure(CLAIM_TABLE);
        // Both terms matter: the owner term is the application rule, the ACLs
        // behind GlideRecordSecure are the platform rule.
        claim.addQuery('sys_id', requestedSysId);
        claim.addQuery('requested_for', ownerSysId);
        claim.setLimit(1);
        claim.query();

        if (!claim.next()) {
            // Deliberately neutral: the same message whether the claim does not
            // exist or belongs to somebody else.
            data.message = gs.getMessage('That claim is not available to you.');
            gs.info('[ClaimEase] Claim detail refused a request for a claim the caller does not own.');
            return;
        }

        var status = claim.getValue('approval_status') + '';
        var managerStep = claim.getValue('manager_approval') + '';
        var financeStep = claim.getValue('finance_approval') + '';

        data.claim = {
            sys_id: claim.getUniqueValue() + '',
            number: claim.getValue('number') + '',
            short_description: claim.getValue('short_description') + '',
            description: claim.getValue('description') + '',
            category: claim.getDisplayValue('category') + '',
            // Display value carries the claim's own currency: no currency code
            // is hardcoded in the portal.
            amount: claim.getDisplayValue('amount') + '',
            expense_date: claim.getDisplayValue('expense_date') + '',
            requested_for: claim.getDisplayValue('requested_for') + '',
            submitted_on: claim.getDisplayValue('submitted_on') + '',
            last_status_update: claim.getDisplayValue('last_status_update') + '',
            status: claim.getDisplayValue('approval_status') + '',
            statusValue: status,
            statusClass: STATUS_CLASS[status] || 'label-default',
            managerApproval: claim.getDisplayValue('manager_approval') + '',
            managerApprovalClass: STEP_CLASS[managerStep] || 'label-default',
            managerApprovalHint: STEP_HINT[managerStep] || '',
            financeApproval: claim.getDisplayValue('finance_approval') + '',
            financeApprovalClass: STEP_CLASS[financeStep] || 'label-default',
            financeApprovalHint: STEP_HINT[financeStep] || '',
            rejection_reason: claim.getValue('rejection_reason') + '',
            finance_comments: claim.getValue('finance_comments') + '',
            duplicate_of: claim.getDisplayValue('duplicate_of') + ''
        };

        // Normalise the "null" strings GlideRecord can hand back.
        tidy(data.claim, [
            'short_description',
            'description',
            'rejection_reason',
            'finance_comments',
            'duplicate_of',
            'submitted_on',
            'last_status_update'
        ]);

        data.available = true;
        data.attachments = attachmentsFor(data.claim.sys_id);
    } catch (e) {
        gs.error('[ClaimEase] Claim detail could not read the claim: ' + e);
        data.claim = null;
        data.available = false;
        data.message = gs.getMessage('We could not load this claim right now. Please try again.');
    }

    /**
     * Attachments that belong to THIS claim, listed as metadata only.
     * No file content is read or copied: the browser downloads through the
     * platform's own endpoint, where the attachment read ACLs apply.
     */
    function attachmentsFor(claimSysId) {
        var files = [];
        try {
            var attachments = new GlideRecord('sys_attachment');
            attachments.addQuery('table_name', CLAIM_TABLE);
            attachments.addQuery('table_sys_id', claimSysId);
            attachments.orderByDesc('sys_created_on');
            attachments.setLimit(50);
            attachments.query();
            while (attachments.next()) {
                files.push({
                    sys_id: attachments.getUniqueValue() + '',
                    file_name: attachments.getValue('file_name') + '',
                    content_type: attachments.getValue('content_type') + '',
                    size: attachments.getDisplayValue('size_bytes') + '',
                    created_on: attachments.getDisplayValue('sys_created_on') + '',
                    url: '/sys_attachment.do?sys_id=' + attachments.getUniqueValue()
                });
            }
        } catch (e) {
            gs.error('[ClaimEase] Claim detail could not list the claim attachments: ' + e);
        }
        return files;
    }

    function tidy(target, fields) {
        for (var i = 0; i < fields.length; i++) {
            var key = fields[i];
            if (target[key] === 'null' || target[key] === 'undefined') {
                target[key] = '';
            }
        }
    }
})();
