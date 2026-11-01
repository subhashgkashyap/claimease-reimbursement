/* ClaimEase - catalog_client_scripts
 * name: ClaimEase - Reimbursement claim onLoad g
 * type: onLoad
 * active: true
 * applies_to: item
 * field: script
 */

/**
 * ClaimEase - Reimbursement claim form, onLoad (catalog client script)
 *
 * USABILITY ONLY. Nothing here is a security control: requested_for is forced
 * to the authenticated user by the record producer script, and every rule
 * hinted at below is enforced server-side by ClaimEaseValidator and the claim
 * business rules for every interface.
 */
function onLoad() {
    // Belt and braces alongside the variable's readOnly flag and the UI policy:
    // the employee submits for themselves, so there is nothing to choose here.
    if (g_form.hasField('requested_for_employee')) {
        g_form.setReadOnly('requested_for_employee', true)
    }

    // One short, friendly reminder of what makes a claim go through first time.
    g_form.addInfoMessage(
        'Tell us what you spent and when, then attach your receipt or supporting document before you submit. ' +
            'Your claim goes for approval as soon as it passes our automatic checks.'
    )
}
