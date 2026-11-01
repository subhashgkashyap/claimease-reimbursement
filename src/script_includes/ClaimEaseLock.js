/* ClaimEase - script_includes
 * name: ClaimEaseLock
 * api_name: x_2180676_claime_0.ClaimEaseLock
 * active: true
 * access: package_private
 * field: script
 */

/**
 * ClaimEaseLock
 * ============================================================================
 * A named, database-enforced mutex for ClaimEase, used to serialise claim
 * submissions per employee so that two simultaneous qualifying submissions can
 * never both pass the duplicate check.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS STRATEGY WAS CHOSEN (please read before changing it)
 * ----------------------------------------------------------------------------
 * Investigated first:
 *   - `GlideRecordLock` / `GlideNativeRecordMutex`: the platform does have
 *     cluster-wide record mutexes, but they are not part of the documented
 *     scoped-application API surface. A scoped app (`x_2180676_claime_0`)
 *     cannot depend on them: the call either fails the scope check at runtime
 *     or is silently unavailable after an upgrade. Correctness must not rest on
 *     an undocumented, non-scoped class.
 *   - `GlideRecord.setWorkflow(false)`: only suppresses business rules /
 *     notifications for an operation. It provides NO mutual exclusion and is
 *     irrelevant to this problem (it is used elsewhere in ClaimEase purely to
 *     avoid recursive rule execution).
 *   - A client-side "are you sure" check: rejected outright — the requirement
 *     is server-side enforcement across every interface (form, portal, Table
 *     API, script, flow).
 *
 * CHOSEN: a lock row in `x_2180676_claime_0_claim_lock` whose `lock_key` column
 * carries a UNIQUE index. Acquiring the lock is a single INSERT. If two
 * transactions on two cluster nodes try to acquire the same key at the same
 * instant, the DATABASE rejects one of them — the race is impossible by
 * construction rather than by lucky timing. No spin-waiting, no reliance on
 * node-local state, and it works identically for the form, the portal, the
 * Table API and server scripts.
 *
 * LOCK LIFETIME
 *   acquire() is called from the BEFORE insert/update duplicate guard, and
 *   release() from an AFTER insert/update rule. That is deliberate: the lock
 *   must still be held while the claim row commits, otherwise a second
 *   transaction could acquire the lock and run its duplicate query before the
 *   first claim became visible. `expires_on` bounds the damage if a transaction
 *   aborts between the two rules — the next acquirer reclaims the stale lock.
 *
 * Not client callable.
 */
var ClaimEaseLock = Class.create()

ClaimEaseLock.prototype = {
    LOCK_TABLE: 'x_2180676_claime_0_claim_lock',

    /**
     * Default lifetime of a lock. Long enough to cover a save transaction,
     * short enough that an aborted transaction only briefly inconveniences the
     * same employee.
     */
    DEFAULT_TTL_SECONDS: 60,

    initialize: function () {},

    /**
     * Acquires the named lock.
     *
     * @param {string} lockKey      the named mutex
     * @param {string} ownerToken   identifies the holder (ClaimEase uses the claim sys_id)
     * @param {number} [ttlSeconds] lock lifetime, defaults to DEFAULT_TTL_SECONDS
     * @param {string} [context]    diagnostic text stored on the lock row
     * @return {{acquired: boolean, reentrant: boolean, lockKey: string, error: string}}
     */
    acquire: function (lockKey, ownerToken, ttlSeconds, context) {
        var result = { acquired: false, reentrant: false, lockKey: '' + lockKey, error: '' }

        if (!lockKey || !ownerToken) {
            result.error = 'A lock key and an owner token are both required.'
            gs.error('[ClaimEase] ClaimEaseLock.acquire called without a key or owner token.')
            return result
        }

        var ttl = parseInt(ttlSeconds, 10)
        if (isNaN(ttl) || ttl <= 0) {
            ttl = this.DEFAULT_TTL_SECONDS
        }

        // Two passes at most: the second pass exists only to retry after a stale
        // lock has been reclaimed, so this can never spin.
        for (var attempt = 0; attempt < 2; attempt++) {
            if (this._insertLock(lockKey, ownerToken, ttl, context)) {
                result.acquired = true
                return result
            }

            // The insert was refused, so a row already exists for this key.
            var existing = this._findLock(lockKey)
            if (!existing) {
                // It disappeared between the insert and the read: try once more.
                continue
            }

            if (('' + existing.getValue('owner_token')) === ('' + ownerToken)) {
                // Same holder (e.g. a nested update in the same transaction):
                // treat as re-entrant and extend the lease.
                this._extendLock(existing, ttl)
                result.acquired = true
                result.reentrant = true
                return result
            }

            if (this._isExpired(existing)) {
                gs.info('[ClaimEase] Reclaiming an expired submission lock for key "' + lockKey + '".')
                this._reclaimLock(existing)
                continue
            }

            result.error = 'Lock "' + lockKey + '" is currently held by another transaction.'
            return result
        }

        if (!result.error) {
            result.error = 'Could not acquire lock "' + lockKey + '" after reclaiming a stale lock.'
        }
        return result
    },

    /**
     * Releases a lock, but only if this owner still holds it.
     *
     * @param {string} lockKey
     * @param {string} ownerToken
     * @return {boolean} true when a lock row was removed
     */
    release: function (lockKey, ownerToken) {
        if (!lockKey || !ownerToken) {
            return false
        }
        try {
            var lockGr = new GlideRecord(this.LOCK_TABLE)
            lockGr.addQuery('lock_key', '' + lockKey)
            lockGr.addQuery('owner_token', '' + ownerToken)
            lockGr.setLimit(1)
            lockGr.query()
            if (!lockGr.next()) {
                return false
            }
            lockGr.setWorkflow(false)
            lockGr.deleteRecord()
            return true
        } catch (e) {
            gs.error('[ClaimEase] Failed to release submission lock "' + lockKey + '": ' + e)
            return false
        }
    },

    /* ------------------------------------------------------------------ *
     * Internals
     * ------------------------------------------------------------------ */

    /**
     * The actual mutual exclusion: the UNIQUE index on `lock_key` makes the
     * second concurrent insert fail.
     *
     * @return {boolean} true when this caller won the race
     */
    _insertLock: function (lockKey, ownerToken, ttlSeconds, context) {
        try {
            var lockGr = new GlideRecord(this.LOCK_TABLE)
            lockGr.initialize()
            lockGr.setValue('lock_key', '' + lockKey)
            lockGr.setValue('owner_token', '' + ownerToken)
            lockGr.setValue('context', this._truncate(context || 'ClaimEase submission guard', 255))
            lockGr.setValue('expires_on', this._expiryFrom(ttlSeconds))
            lockGr.setWorkflow(false)
            var sysId = lockGr.insert()
            return !!sysId
        } catch (e) {
            // A unique-index violation is an expected, non-exceptional outcome.
            gs.info('[ClaimEase] Submission lock "' + lockKey + '" is already held (' + e + ').')
            return false
        }
    },

    _findLock: function (lockKey) {
        try {
            var lockGr = new GlideRecord(this.LOCK_TABLE)
            lockGr.addQuery('lock_key', '' + lockKey)
            lockGr.setLimit(1)
            lockGr.query()
            return lockGr.next() ? lockGr : null
        } catch (e) {
            gs.error('[ClaimEase] Failed to read submission lock "' + lockKey + '": ' + e)
            return null
        }
    },

    _extendLock: function (lockGr, ttlSeconds) {
        try {
            lockGr.setValue('expires_on', this._expiryFrom(ttlSeconds))
            lockGr.setWorkflow(false)
            lockGr.update()
        } catch (e) {
            gs.info('[ClaimEase] Could not extend an existing submission lock: ' + e)
        }
    },

    _reclaimLock: function (lockGr) {
        try {
            lockGr.setWorkflow(false)
            lockGr.deleteRecord()
        } catch (e) {
            gs.info('[ClaimEase] Could not reclaim an expired submission lock: ' + e)
        }
    },

    /** @return {boolean} true when the lock row is past its expiry instant */
    _isExpired: function (lockGr) {
        var expires = lockGr.getValue('expires_on')
        if (!expires) {
            // A lock with no expiry is malformed; treat it as stale so it cannot
            // block submissions permanently.
            return true
        }
        var expiry = new GlideDateTime(expires)
        var now = new GlideDateTime()
        return expiry.compareTo(now) <= 0
    },

    /** @return {string} internal date-time string `ttlSeconds` from now */
    _expiryFrom: function (ttlSeconds) {
        var expiry = new GlideDateTime()
        expiry.addSeconds(ttlSeconds)
        return expiry.getValue()
    },

    _truncate: function (text, maxLength) {
        var value = '' + (text || '')
        return value.length > maxLength ? value.substring(0, maxLength) : value
    },

    type: 'ClaimEaseLock',
}
