/* ClaimEase - catalog_client_scripts
 * name: ClaimEase - Reimbursement claim submit c
 * type: onSubmit
 * active: true
 * applies_to: item
 * field: script
 */

/**
 * ClaimEase - Reimbursement claim onSubmit checks (catalog client script)
 *
 * USABILITY ONLY, and synchronous by design (no GlideAjax: an async call never
 * completes before the form submits). Every check below is also performed
 * server-side by ClaimEaseValidator through the "Validate Claim" business rule,
 * so removing or bypassing this script changes nothing about what the platform
 * will accept.
 */
function onSubmit() {
    var problems = []

    var summary = value('claim_summary')
    var category = value('claim_category')
    var amountRaw = value('claim_amount')
    var expenseDate = value('expense_incurred_on')

    if (summary === '') {
        problems.push('Please tell us what you are claiming for.')
        g_form.showFieldMsg('claim_summary', 'Please tell us what you are claiming for.', 'error')
    }

    if (category === '') {
        problems.push('Please choose a claim category.')
        g_form.showFieldMsg('claim_category', 'Please choose a claim category.', 'error')
    }

    if (amountRaw === '') {
        problems.push('Please enter the claim amount.')
        g_form.showFieldMsg('claim_amount', 'Please enter the claim amount.', 'error')
    } else {
        var amount = parseFloat(amountRaw.replace(/,/g, ''))
        if (isNaN(amount) || !isFinite(amount)) {
            problems.push('Please enter the claim amount as a number, for example 24.50.')
            g_form.showFieldMsg('claim_amount', 'Please enter the amount as a number, for example 24.50.', 'error')
        } else if (amount <= 0) {
            problems.push('The claim amount must be greater than zero.')
            g_form.showFieldMsg('claim_amount', 'The claim amount must be greater than zero.', 'error')
        }
    }

    if (expenseDate === '') {
        problems.push('Please enter the date you incurred the expense.')
        g_form.showFieldMsg('expense_incurred_on', 'Please enter the date you incurred the expense.', 'error')
    }

    if (problems.length > 0) {
        g_form.addErrorMessage(
            problems.length === 1
                ? problems[0]
                : 'Your claim is not quite ready: ' + problems.join(' ')
        )
        return false
    }

    return true

    function value(name) {
        if (!g_form.hasField(name)) {
            return ''
        }
        return (g_form.getValue(name) || '').toString().replace(/^\s+|\s+$/g, '')
    }
}
