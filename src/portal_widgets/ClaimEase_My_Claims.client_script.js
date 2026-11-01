/* ClaimEase - portal_widgets
 * name: ClaimEase - My Claims
 * id: x_2180676_claime_0_my_claims
 * field: client_script
 */

/**
 * ClaimEase - "My Claims" widget client controller
 *
 * The controller only moves filter state and the requested page number to the
 * server. It performs no filtering of its own: the authoritative query (and in
 * particular the "only my claims" rule) lives in the server script.
 */
api.controller = function () {
    var c = this;

    c.loading = false;

    /** Working copy of the filters, so the form can be edited then applied. */
    c.form = angular.copy(c.data.filters || {});

    c.applyFilters = function () {
        c.data.filters = angular.copy(c.form);
        c.data.page = 1;
        refresh();
    };

    c.clearFilters = function () {
        c.form = { number: '', category: '', status: '', submittedFrom: '', submittedTo: '' };
        c.data.filters = angular.copy(c.form);
        c.data.page = 1;
        refresh();
    };

    c.goToPage = function (page) {
        if (page < 1 || page > c.data.totalPages || page === c.data.page) {
            return;
        }
        c.data.page = page;
        refresh();
    };

    c.pages = function () {
        var pages = [];
        for (var i = 1; i <= (c.data.totalPages || 1); i++) {
            pages.push(i);
        }
        return pages;
    };

    c.claimUrl = function (claim) {
        return '?id=' + c.data.detailPageId + '&sys_id=' + claim.sys_id;
    };

    /**
     * c.server.update() posts the whole of c.data, which is why the filters and
     * the page number are assigned onto c.data before it is called.
     */
    function refresh() {
        c.loading = true;
        c.server.update().then(function () {
            c.loading = false;
            // Re-sync the form with whatever the server actually accepted, so a
            // rejected filter value disappears from the controls too.
            c.form = angular.copy(c.data.filters || {});
        });
    }
};
