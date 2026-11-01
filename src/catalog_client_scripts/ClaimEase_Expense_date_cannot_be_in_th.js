/* ClaimEase - catalog_client_scripts
 * name: ClaimEase - Expense date cannot be in th
 * type: onChange
 * active: true
 * applies_to: item
 * field: script
 */

/**
 * ClaimEase - Expense date onChange (catalog client script)
 *
 * USABILITY ONLY: warns the employee straight away that the expense date cannot
 * be in the future. The authoritative check is
 * ClaimEaseValidator._validateExpenseDate, which reads the
 * `allow_future_expense_date` property on the server. This script deliberately
 * cannot read that property (no GlideAjax), so it is only a hint: if an
 * administrator permits future dates, the server accepts the claim even though
 * the form showed this message.
 */
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading) {
        return
    }

    g_form.hideFieldMsg('expense_incurred_on', true)

    var raw = (newValue || '').toString().replace(/^\s+|\s+$/g, '')
    if (raw === '') {
        return
    }

    var entered = parseIsoDate(raw)
    if (!entered) {
        // Unrecognised date format: say nothing and let the server decide.
        return
    }

    var today = new Date()
    today.setHours(0, 0, 0, 0)

    if (entered.getTime() > today.getTime()) {
        g_form.showFieldMsg(
            'expense_incurred_on',
            'The expense date cannot be in the future. Please enter the date you actually incurred the expense.',
            'error'
        )
    }

    /**
     * Service Portal supplies catalog date variables in the internal
     * yyyy-MM-dd format. Anything else is treated as unknown rather than
     * guessed at, so a dd/mm vs mm/dd locale can never produce a wrong warning.
     */
    function parseIsoDate(value) {
        var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
        if (!match) {
            return null
        }
        var year = parseInt(match[1], 10)
        var month = parseInt(match[2], 10) - 1
        var day = parseInt(match[3], 10)
        var date = new Date(year, month, day)
        date.setHours(0, 0, 0, 0)
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
            return null
        }
        return date
    }
}
