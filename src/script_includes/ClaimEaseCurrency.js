/* ClaimEase - script_includes
 * name: ClaimEaseCurrency
 * api_name: x_2180676_claime_0.ClaimEaseCurrency
 * active: true
 * access: public
 * field: script
 */

/**
 * ClaimEaseCurrency
 * ============================================================================
 * Converts a ClaimEase claim amount into the configured base currency and
 * writes the result to `amount_usd`, which is the ONLY field used for threshold
 * evaluation and duplicate detection.
 *
 * SAFETY RULE: a foreign-currency amount is NEVER silently treated as if it
 * were already in the base currency. If no rate can be found, every method
 * returns `ok: false` with a readable `error`, and the caller (the "Normalise
 * Amount" business rule) aborts the save / routes the claim to the exception
 * queue rather than letting an unconverted amount reach approval routing.
 *
 * The `amount` field is a currency column, stored as "<CODE>;<amount>", e.g.
 * "USD;25.0000". Parsing here is deliberately defensive and also accepts a
 * plain numeric string, an empty value and a value with no separator.
 *
 * Not client callable.
 */
var ClaimEaseCurrency = Class.create()

ClaimEaseCurrency.prototype = {
    /** Platform FX rate table (from_currency / to_currency / rate / span_start / span_end). */
    RATE_TABLE: 'fx_conversion_rate',

    /** Decimal places kept on the normalised amount. */
    SCALE: 2,

    initialize: function () {
        this.config = new ClaimEaseConfig()
    },

    /* ------------------------------------------------------------------ *
     * Parsing
     * ------------------------------------------------------------------ */

    /**
     * Pulls the raw composite currency string out of whatever the caller
     * handed us.
     *
     * @param {GlideRecord|string|number} input claim GlideRecord, or the raw value
     * @return {string} raw value, possibly ''
     */
    _rawValueOf: function (input) {
        if (input === null || input === undefined) {
            return ''
        }
        if (typeof input === 'string' || typeof input === 'number') {
            return ('' + input).replace(/^\s+|\s+$/g, '')
        }
        // Assume a GlideRecord positioned on a claim.
        try {
            if (typeof input.getValue === 'function') {
                var fromRecord = input.getValue('amount')
                return fromRecord === null || fromRecord === undefined
                    ? ''
                    : ('' + fromRecord).replace(/^\s+|\s+$/g, '')
            }
        } catch (e) {
            gs.error('[ClaimEase] Could not read the amount field from the supplied record: ' + e)
            return ''
        }
        return ('' + input).replace(/^\s+|\s+$/g, '')
    },

    /**
     * Parses "<CODE>;<amount>" without attempting any conversion.
     * Exposed so the validator can check "amount parses and is > 0" without
     * needing an FX rate.
     *
     * @param {GlideRecord|string|number} input
     * @return {{ok: boolean, value: number, code: string, error: string}}
     *         `code` is '' when the stored value carried no currency code.
     */
    parseAmount: function (input) {
        var result = { ok: false, value: 0, code: '', error: '' }
        var raw = this._rawValueOf(input)

        if (raw === '') {
            result.error = 'Claim amount is empty.'
            return result
        }

        var amountPart = raw
        if (raw.indexOf(';') > -1) {
            var parts = raw.split(';')
            result.code = ('' + parts[0]).replace(/^\s+|\s+$/g, '').toUpperCase()
            // Guard against a trailing separator such as "USD;".
            amountPart = parts.length > 1 ? ('' + parts[1]).replace(/^\s+|\s+$/g, '') : ''
        }

        if (amountPart === '') {
            result.error = 'Claim amount "' + raw + '" has a currency code but no numeric amount.'
            return result
        }

        // Strip grouping separators a client may have submitted ("1,250.00").
        var numeric = parseFloat(amountPart.replace(/,/g, ''))
        if (isNaN(numeric) || !isFinite(numeric)) {
            result.error = 'Claim amount "' + raw + '" is not a number.'
            return result
        }

        result.ok = true
        result.value = numeric
        return result
    },

    /* ------------------------------------------------------------------ *
     * Conversion
     * ------------------------------------------------------------------ */

    /**
     * Converts a claim amount into the configured base currency.
     *
     * @param {GlideRecord|string|number} glideRecordOrAmountString
     * @return {{ok: boolean, value: number, code: string, error: string}}
     *         `value` is the amount in the base currency when ok;
     *         `code` is the source currency code that was detected.
     */
    toBaseCurrency: function (glideRecordOrAmountString) {
        var base = this.config.getBaseCurrency()
        var parsed = this.parseAmount(glideRecordOrAmountString)

        if (!parsed.ok) {
            return { ok: false, value: 0, code: parsed.code || base, error: parsed.error }
        }

        // No code recorded (plain numeric value) => the platform stored it in the
        // base currency, so the amount is already usable.
        if (!parsed.code || parsed.code === base) {
            return { ok: true, value: this._round(parsed.value), code: base, error: '' }
        }

        var converted = this._convert(parsed.value, parsed.code, base)
        if (!converted.ok) {
            // Deliberately NOT falling back to the raw amount: see the safety rule
            // in the file header.
            return {
                ok: false,
                value: 0,
                code: parsed.code,
                error:
                    'No usable exchange rate from ' +
                    parsed.code +
                    ' to ' +
                    base +
                    '. ' +
                    converted.error,
            }
        }

        return { ok: true, value: this._round(converted.value), code: parsed.code, error: '' }
    },

    /**
     * Sets `amount_usd` on the supplied claim GlideRecord. Does NOT call
     * update() — intended for use from a before business rule.
     *
     * @param {GlideRecord} claimGr claim record being saved
     * @return {{ok: boolean, value: number, code: string, error: string}}
     */
    normalizeClaim: function (claimGr) {
        var result = this.toBaseCurrency(claimGr)
        if (result.ok && claimGr && typeof claimGr.setValue === 'function') {
            claimGr.setValue('amount_usd', result.value)
        }
        return result
    },

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    _round: function (value) {
        var factor = Math.pow(10, this.SCALE)
        return Math.round(value * factor) / factor
    },

    /**
     * Attempts every scoped-safe conversion route available on this instance.
     * Everything is wrapped in try/catch: if the FX tables are not readable
     * from this scope we report failure instead of guessing.
     *
     * Routes, in order:
     *   1. direct rate   from -> to
     *   2. inverse rate  to   -> from   (value / rate)
     *   3. cross rate via a shared pivot currency P, using P -> from and P -> to
     *      (the platform's seeded fx_conversion_rate data is EUR-pivoted, so the
     *      cross route is what makes e.g. GBP -> USD work).
     *
     * @return {{ok: boolean, value: number, error: string}}
     */
    _convert: function (amount, fromCode, toCode) {
        try {
            var direct = this._lookupRate(fromCode, toCode)
            if (direct !== null && direct !== 0) {
                return { ok: true, value: amount * direct, error: '' }
            }

            var inverse = this._lookupRate(toCode, fromCode)
            if (inverse !== null && inverse !== 0) {
                return { ok: true, value: amount / inverse, error: '' }
            }

            var pivots = this._pivotCurrencies()
            for (var i = 0; i < pivots.length; i++) {
                var pivot = pivots[i]
                if (pivot === fromCode || pivot === toCode) {
                    continue
                }
                var pivotToFrom = this._lookupRate(pivot, fromCode)
                var pivotToTarget = this._lookupRate(pivot, toCode)
                if (pivotToFrom !== null && pivotToFrom !== 0 && pivotToTarget !== null) {
                    return {
                        ok: true,
                        value: amount * (pivotToTarget / pivotToFrom),
                        error: '',
                    }
                }
            }

            return {
                ok: false,
                value: 0,
                error: 'No direct, inverse or cross rate exists in ' + this.RATE_TABLE + '.',
            }
        } catch (e) {
            // Typically a cross-scope read restriction on the FX tables.
            return {
                ok: false,
                value: 0,
                error: 'Currency conversion is unavailable to this application scope: ' + e,
            }
        }
    },

    /**
     * @return {number|null} the most recently effective rate, or null
     */
    _lookupRate: function (fromCode, toCode) {
        if (!fromCode || !toCode || fromCode === toCode) {
            return fromCode === toCode ? 1 : null
        }

        // Preferred: a rate whose effective span covers "now".
        var effective = this._queryRate(fromCode, toCode, true)
        if (effective !== null) {
            return effective
        }
        // Fallback: the newest rate regardless of span. Still a real published
        // rate, so it is safe (and far better than treating the amount as base
        // currency), but we log it so administrators can refresh FX data.
        var latest = this._queryRate(fromCode, toCode, false)
        if (latest !== null) {
            gs.info(
                '[ClaimEase] Using the latest out-of-span exchange rate for ' +
                    fromCode +
                    ' -> ' +
                    toCode +
                    '. Consider refreshing the currency rate data.'
            )
        }
        return latest
    },

    _queryRate: function (fromCode, toCode, restrictToSpan) {
        var rateGr = new GlideRecord(this.RATE_TABLE)
        rateGr.addQuery('from_currency', fromCode)
        rateGr.addQuery('to_currency', toCode)
        if (restrictToSpan) {
            var now = new GlideDateTime()
            rateGr.addQuery('span_start', '<=', now)
            rateGr.addQuery('span_end', '>=', now)
        }
        rateGr.orderByDesc('span_start')
        rateGr.setLimit(1)
        rateGr.query()
        if (!rateGr.next()) {
            return null
        }
        var rate = parseFloat(rateGr.getValue('rate'))
        if (isNaN(rate) || !isFinite(rate) || rate === 0) {
            return null
        }
        return rate
    },

    /**
     * Currencies that act as a hub in the rate table. Discovered from the data
     * rather than hardcoded, with a conservative fallback.
     *
     * @return {string[]}
     */
    _pivotCurrencies: function () {
        if (this._pivots) {
            return this._pivots
        }
        var pivots = []
        try {
            var agg = new GlideAggregate(this.RATE_TABLE)
            agg.addAggregate('COUNT')
            agg.groupBy('from_currency')
            agg.orderByAggregate('COUNT')
            agg.query()
            while (agg.next() && pivots.length < 5) {
                var code = ('' + agg.getValue('from_currency')).toUpperCase()
                if (code) {
                    pivots.push(code)
                }
            }
        } catch (e) {
            gs.info('[ClaimEase] Could not derive pivot currencies, using defaults: ' + e)
        }
        if (!pivots.length) {
            pivots = [this.config.getBaseCurrency(), 'USD', 'EUR']
        }
        this._pivots = pivots
        return pivots
    },

    type: 'ClaimEaseCurrency',
}
