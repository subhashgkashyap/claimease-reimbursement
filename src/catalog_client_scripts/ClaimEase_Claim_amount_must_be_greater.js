/* ClaimEase - catalog_client_scripts
 * name: ClaimEase - Claim amount must be greater
 * type: onChange
 * active: true
 * applies_to: item
 * field: script
 */

/**
 * ClaimEase - Claim amount onChange (catalog client script)
 *
 * USABILITY ONLY: gives the employee immediate feedback that the amount must be
 * a number greater than zero. The authoritative check is
 * ClaimEaseValidator._validateAmount, which runs on the server for every
 * interface via the "Validate Claim" business rule.
 */
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) {
        return
    }

    g_form.hideFieldMsg('claim_amount', true)

    var raw = (newValue || '').toString().replace(/^\s+|\s+$/g, '')
    if (raw === '') {
        return
    }

    // Accept grouped input such as "1,250.00".
    var amount = parseFloat(raw.replace(/,/g, ''))

    if (isNaN(amount) || !isFinite(amount)) {
        g_form.showFieldMsg('claim_amount', 'Please enter the amount as a number, for example 24.50.', 'error')
        return
    }

    if (amount === 0) {
        g_form.showFieldMsg(
            'claim_amount',
            'The claim amount cannot be zero. Please enter the amount you actually spent.',
            'error'
        )
        return
    }

    if (amount < 0) {
        g_form.showFieldMsg('claim_amount', 'The claim amount must be a positive number.', 'error')
    }
}
