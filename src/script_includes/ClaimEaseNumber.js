/* ClaimEase - script_includes
 * name: ClaimEaseNumber
 * api_name: x_2180676_claime_0.ClaimEaseNumber
 * active: true
 * access: package_private
 * field: script
 */

/**
 * ClaimEaseNumber
 * ============================================================================
 * Generates the `number` value for a reimbursement claim (CLM0001000, ...).
 *
 * ----------------------------------------------------------------------------
 * WHY THIS CLASS EXISTS
 * ----------------------------------------------------------------------------
 * The usual dictionary default for an auto-numbered table is
 *
 *     javascript:getNextObjNumberPadded();
 *
 * That does NOT work from a scoped application on this instance, and produced
 * the runtime error:
 *
 *     "getNextObjNumberPadded undefined, maybe missing global qualifier"
 *
 * The reason is that `getNextObjNumberPadded` is not a global *function* — it is
 * a METHOD on the global `NumberManager` script include, and that script include
 * is published as `access = package_private`. A scoped application therefore
 * cannot call it, qualified (`global.NumberManager`) or not. Rather than depend
 * on an inaccessible global, ClaimEase issues its own numbers from the very same
 * platform record the `autoNumber` table property created:
 *
 *     sys_number  where category = 'x_2180676_claime_0_claim'
 *                 -> prefix 'CLM', number 1000, maximum_digits 7
 *
 * Administrators keep using the standard Number Maintenance UI to change the
 * prefix, the next number or the padding; nothing here is hardcoded except the
 * last-resort fallbacks.
 *
 * ----------------------------------------------------------------------------
 * CONCURRENCY
 * ----------------------------------------------------------------------------
 * `sys_number.number` holds the NEXT number to issue (this matches the platform
 * convention in NumberManager.createNumberCategory, which stores 10001 after
 * issuing 10000). Issuing a number is therefore a read-modify-write.
 *
 * Two safeguards make that safe:
 *   1. After reserving a candidate, we verify no claim already carries it and
 *      re-reserve if one does (bounded retry). This closes the practical race
 *      between two simultaneous inserts.
 *   2. The `number` column has a UNIQUE index, so the database is the final
 *      arbiter: a genuine collision can never be persisted.
 *
 * If numbering cannot be resolved at all, `getNext()` returns a timestamp-based
 * fallback and logs an error, because refusing to number a claim would block a
 * legitimate submission outright.
 *
 * Not client callable.
 */
var ClaimEaseNumber = Class.create()

ClaimEaseNumber.prototype = {
    CLAIM_TABLE: 'x_2180676_claime_0_claim',
    NUMBER_TABLE: 'sys_number',

    /* Last-resort values, used only when the sys_number record is missing. */
    DEFAULT_PREFIX: 'CLM',
    DEFAULT_DIGITS: 7,
    DEFAULT_START: 1000,

    /** Bounded retry when a reserved number turns out to be taken. */
    MAX_ATTEMPTS: 10,

    initialize: function () {},

    /**
     * Issues the next claim number.
     *
     * @return {string} e.g. 'CLM0001000' (never empty)
     */
    getNext: function () {
        for (var attempt = 0; attempt < this.MAX_ATTEMPTS; attempt++) {
            var candidate = this._reserveNext()

            if (!candidate) {
                // The counter record could not be read or written at all.
                break
            }

            if (!this._numberExists(candidate)) {
                return candidate
            }

            gs.info(
                '[ClaimEase] Claim number "' +
                    candidate +
                    '" was already taken; reserving the next one (attempt ' +
                    (attempt + 1) +
                    ').'
            )
        }

        return this._fallbackNumber()
    },

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    /**
     * Reads the counter, issues its current value and stores value + 1.
     *
     * @return {string} the reserved number, or '' when the counter is unusable
     */
    _reserveNext: function () {
        try {
            var counter = new GlideRecord(this.NUMBER_TABLE)
            counter.addQuery('category', this.CLAIM_TABLE)
            counter.setLimit(1)
            counter.query()

            if (!counter.next()) {
                gs.error(
                    '[ClaimEase] No sys_number record exists for category "' +
                        this.CLAIM_TABLE +
                        '". Claim numbering is falling back to a generated value. ' +
                        'Re-install the application or create the Number Maintenance record.'
                )
                return ''
            }

            var prefix = '' + (counter.getValue('prefix') || this.DEFAULT_PREFIX)

            var digits = parseInt(counter.getValue('maximum_digits'), 10)
            if (isNaN(digits) || digits <= 0) {
                digits = this.DEFAULT_DIGITS
            }

            var next = parseInt(counter.getValue('number'), 10)
            if (isNaN(next) || next <= 0) {
                next = this.DEFAULT_START
            }

            // Store the following value before returning this one.
            counter.setValue('number', next + 1)
            counter.setWorkflow(false)
            counter.update()

            return prefix + this._pad(next, digits)
        } catch (e) {
            gs.error('[ClaimEase] Could not reserve a claim number from sys_number: ' + e)
            return ''
        }
    },

    /**
     * @param {string} candidate
     * @return {boolean} true when a claim already carries this number
     */
    _numberExists: function (candidate) {
        try {
            var existing = new GlideRecord(this.CLAIM_TABLE)
            existing.addQuery('number', candidate)
            existing.setLimit(1)
            existing.query()
            return existing.hasNext()
        } catch (e) {
            gs.error('[ClaimEase] Could not verify claim number uniqueness: ' + e)
            // Treat as "not taken": the UNIQUE index still protects the data.
            return false
        }
    },

    /**
     * Unique, human-recognisable fallback used only when the counter is
     * unavailable. Deliberately distinguishable from a normal sequence number
     * so administrators can spot it.
     *
     * @return {string}
     */
    _fallbackNumber: function () {
        var stamp = new GlideDateTime().getNumericValue()
        var fallback = this.DEFAULT_PREFIX + 'X' + stamp
        gs.error(
            '[ClaimEase] Issued fallback claim number "' +
                fallback +
                '" because the Number Maintenance counter could not be used.'
        )
        return fallback
    },

    /** Zero-pads a number to the configured width. */
    _pad: function (value, digits) {
        var text = '' + value
        while (text.length < digits) {
            text = '0' + text
        }
        return text
    },

    type: 'ClaimEaseNumber',
}
