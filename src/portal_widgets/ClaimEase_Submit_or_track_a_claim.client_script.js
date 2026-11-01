/* ClaimEase - portal_widgets
 * name: ClaimEase - Submit or track a claim
 * id: x_2180676_claime_0_claim_actions
 * field: client_script
 */

/**
 * ClaimEase - Landing widget client controller
 *
 * There is no client-side behaviour to add: the template binds directly to the
 * links the server script produced. The controller exists so the widget has an
 * explicit, documented `c` controller rather than relying on an implicit one.
 */
api.controller = function () {
    var c = this;

    /** True when the record producer could be resolved server-side. */
    c.canSubmit = function () {
        return !!(c.data && c.data.submitUrl);
    };
};
