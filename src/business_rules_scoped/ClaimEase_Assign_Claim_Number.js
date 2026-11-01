/* ClaimEase - business_rules_scoped
 * name: ClaimEase - Assign Claim Number
 * collection: x_2180676_claime_0_claim
 * when: before
 * order: 50
 * active: true
 * field: script
 */

/**
 * ClaimEase - Assign Claim Number  (before insert, order 50)
 *
 * PURPOSE
 *   Issues the claim's `number` before anything else runs.
 *
 *   This replaces the conventional dictionary default
 *   `javascript:getNextObjNumberPadded();`, which cannot work from a scoped
 *   application: `getNextObjNumberPadded` is a method on the GLOBAL
 *   `NumberManager` script include, and that include is `package_private`, so
 *   the scope cannot reach it. Leaving the default in place produced
 *   "getNextObjNumberPadded undefined, maybe missing global qualifier" on every
 *   claim form load and left claims unnumbered.
 *
 *   Running as a business rule rather than a dictionary default has two
 *   advantages:
 *     - it covers EVERY insert path (portal, record producer, platform form,
 *       Table API, server script, ATF) rather than only form default evaluation;
 *     - it is explicit and testable.
 *
 *   Order 50 puts it ahead of Normalise Amount (100), Validate Claim (200) and
 *   the Duplicate Guard (300), all of which log using the claim number.
 *
 *   Idempotent: an existing number is never overwritten, so an administrator or
 *   a data import may supply its own.
 *
 * Thin by design: the logic lives in the ClaimEaseNumber script include.
 */
;(function executeRule() {
    var existing = current.getValue('number')

    // Respect a number that was supplied deliberately.
    if (existing !== null && existing !== undefined && ('' + existing).replace(/^\s+|\s+$/g, '') !== '') {
        return
    }

    current.setValue('number', new ClaimEaseNumber().getNext())
})()
