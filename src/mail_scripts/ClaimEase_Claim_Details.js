/* ClaimEase - mail_scripts
 * name: ClaimEase Claim Details
 * field: script
 */

/**
 * ClaimEase Claim Details  (mail script, shared by every ClaimEase notification)
 *
 * Prints the common claim-detail block required by every ClaimEase
 * notification: claim number, category, amount WITH its currency, expense date,
 * current claim status, the relevant approval stage, and the approver comments
 * or rejection reason when one is present.
 *
 * Referenced inline from a notification body as
 *     ${mail_script:ClaimEase Claim Details}
 *
 * `current` is the claim record for both the record-driven notifications and
 * the event-driven ones (the flow fires every event against the claim).
 *
 * The base currency label is read from ClaimEaseConfig - "USD" is never
 * hardcoded - and the claim's own currency field supplies the entered amount
 * with its symbol/code.
 */
;(function runMailScript(
    /* GlideRecord */ current,
    /* TemplatePrinter */ template,
    /* Optional EmailOutbound */ email,
    /* Optional GlideRecord */ email_action,
    /* Optional GlideRecord */ event
) {
    var config = new ClaimEaseConfig()

    function esc(value) {
        return ('' + (value || ''))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

    var rows = []
    function row(label, value) {
        if (!value) {
            return
        }
        rows.push(
            '<tr><td style="padding:4px 14px 4px 0;color:#555555;vertical-align:top;">' +
                esc(label) +
                '</td><td style="padding:4px 0;color:#111111;"><strong>' +
                esc(value) +
                '</strong></td></tr>'
        )
    }

    /* ---------- amount, always WITH a currency ---------- */
    var amount = '' + (current.getDisplayValue('amount') || '')
    var normalised = '' + (current.getValue('amount_usd') || '')
    if (!amount && normalised) {
        amount = normalised + ' ' + config.getBaseCurrency()
    }
    if (normalised && amount.indexOf(normalised) === -1) {
        amount = amount + ' (' + normalised + ' ' + config.getBaseCurrency() + ')'
    }

    /* ---------- the relevant approval stage ---------- */
    var managerApproval = '' + (current.getValue('manager_approval') || 'not_requested')
    var financeApproval = '' + (current.getValue('finance_approval') || 'not_requested')
    var stage
    if (managerApproval === 'rejected') {
        stage = 'Rejected by the manager'
    } else if (financeApproval === 'rejected') {
        stage = 'Rejected by Finance'
    } else if (managerApproval === 'requested' && financeApproval === 'requested') {
        stage = 'Manager and Finance approval requested at the same time (parallel path)'
    } else if (managerApproval === 'requested') {
        stage = 'Awaiting Manager approval'
    } else if (managerApproval === 'approved' && financeApproval === 'requested') {
        stage = 'Manager approved - awaiting Finance approval'
    } else if (managerApproval === 'approved' && financeApproval === 'approved') {
        stage = 'Approved by the manager and by Finance'
    } else if (managerApproval === 'approved') {
        stage = 'Approved by the manager'
    } else if (financeApproval === 'approved') {
        stage = 'Approved by Finance'
    } else {
        stage = 'No approval has been requested'
    }

    row('Claim number', current.getValue('number'))
    row('Summary', current.getValue('short_description'))
    row('Employee', current.getDisplayValue('requested_for'))
    row('Category', current.getDisplayValue('category'))
    row('Amount', amount)
    row('Expense date', current.getDisplayValue('expense_date'))
    row('Claim status', current.getDisplayValue('approval_status'))
    row('Approval stage', stage)
    row('Manager', current.getDisplayValue('manager'))
    row('Manager comments', current.getValue('manager_comments'))
    row('Finance comments', current.getValue('finance_comments'))
    row('Rejection reason', current.getValue('rejection_reason'))
    row('Exception note', current.getValue('exception_reason'))

    template.print(
        '<table role="presentation" cellpadding="0" cellspacing="0" ' +
            'style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;">' +
            rows.join('') +
            '</table>'
    )
})(current, template, email, email_action, event)
