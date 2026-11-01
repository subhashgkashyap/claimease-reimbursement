/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Normalise Amount
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 100
 * active: true
 * field: script
 */

/**
 * ClaimEase - Normalise Amount  (before insert/update, order 100)
 *
 * PURPOSE
 *   `amount` is a currency field and may be captured in any permitted currency.
 *   Every downstream decision (approval routing and duplicate detection) uses
 *   `amount_usd` instead, so this rule is the single place where the claim
 *   amount is converted into the configured base currency.
 *
 *   It runs FIRST (order 100) because the validation, duplicate and lifecycle
 *   rules all depend on a trustworthy `amount_usd`.
 *
 *   If conversion is not possible the save is aborted with a friendly message
 *   and the technical reason is logged. A foreign-currency amount is never
 *   silently treated as if it were already in the base currency.
 *
 * Thin by design: all logic lives in the ClaimEaseCurrency script include.
 */
;(function executeRule() {
    var config = new ClaimEaseConfig()
    var currency = new ClaimEaseCurrency()

    // current.operation() throws "Cannot convert null to an object" in the
    // record-producer save path, which previously aborted this rule and left
    // amount_usd empty on every portal submission. Use `previous` instead.
    var isInsert = !previous || !previous.getValue('sys_id')
    var amountChanged = !previous || current.getValue('amount') !== previous.getValue('amount')

    // Skip the (potentially FX-querying) conversion when nothing relevant moved
    // and we already hold a normalised amount.
    if (!isInsert && !amountChanged && current.getValue('amount_usd')) {
        return
    }

    var result = currency.normalizeClaim(current)

    if (!result.ok) {
        gs.error(
            '[ClaimEase] Could not normalise the amount on claim ' +
                (current.getValue('number') || '(new record)') +
                '. Reason: ' +
                result.error
        )
        gs.addErrorMessage(
            'We could not convert this claim amount into ' +
                config.getBaseCurrency() +
                ', so the claim has not been saved. Please re-enter the amount, or contact your ClaimEase ' +
                'administrator so the exchange rates can be checked.'
        )
        current.setAbortAction(true)
    }
})()
