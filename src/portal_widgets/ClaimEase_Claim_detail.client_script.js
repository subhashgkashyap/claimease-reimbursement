/* ClaimEase - portal_widgets
 * name: ClaimEase - Claim detail
 * id: x_2180676_claime_0_claim_detail
 * field: client_script
 */

/**
 * ClaimEase - Claim detail widget client controller
 *
 * Read-only view: there is no client-side state to manage and nothing is sent
 * back to the server. The controller exists so the template has an explicit `c`
 * and so a refresh helper is available if the page ever needs one.
 */
api.controller = function () {
    var c = this;

    /** Re-reads the claim. Ownership is re-verified server-side every time. */
    c.reload = function () {
        c.server.update();
    };
};
