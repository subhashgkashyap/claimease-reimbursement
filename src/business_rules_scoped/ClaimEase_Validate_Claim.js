/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Validate Claim
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 200
 * active: true
 * field: script
 */

/**
 * ClaimEase - Validate Claim  (before insert/update, order 200)
 *
 * PURPOSE
 *   Enforces every ClaimEase submission rule server-side, for ALL interfaces:
 *   form, Service Portal, record producer, Table API and server scripts. There
 *   is no client-only validation in this application.
 *
 *   Runs after "Normalise Amount" (order 100) so it can trust `amount_usd`, and
 *   before the duplicate guard (order 300) so an invalid claim never reaches
 *   duplicate detection.
 *
 * RECEIPT CHECK
 *   The receipt requirement is deliberately NOT evaluated on insert: an
 *   attachment cannot exist before the record does. It is enforced on the
 *   transition into `submitted`.
 *
 * Thin by design: all logic lives in the ClaimEaseValidator script include.
 */
;(function executeRule() {
    var validator = new ClaimEaseValidator()

    // See the Normalise Amount rule: insert is detected via `previous` because
    // current.operation() is unreliable in the record-producer save path.
    var isInsert = !previous || !previous.getValue('sys_id')
    var statusNow = current.getValue('approval_status')
    var statusBefore = !isInsert && previous ? previous.getValue('approval_status') : ''
    var enteringSubmitted = statusNow === 'submitted' && statusBefore !== 'submitted'

    var result = validator.validate(current, {
        // Only on the draft -> submitted transition, where an attachment can exist.
        checkReceipt: !isInsert && enteringSubmitted,
    })

    if (result.valid) {
        return
    }

    for (var i = 0; i < result.errors.length; i++) {
        gs.addErrorMessage(result.errors[i])
    }
    gs.info(
        '[ClaimEase] Validation rejected a claim save (' +
            result.errors.length +
            ' issue(s)) for claim ' +
            (current.getValue('number') || '(new record)') +
            '.'
    )
    current.setAbortAction(true)
})()
